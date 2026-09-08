/**
 * Import a workflow ("space") from a `.zip` produced by `lib/exportWorkflow.ts`:
 *
 *   workflow.json      — nodes, edges, counters, viewport (asset URLs point at
 *                        the bundled files)
 *   assets/<hash>.<ext> — every referenced image/video
 *
 * Each bundled asset is re-uploaded to local storage via `/api/upload-asset`
 * and its `assets/…` reference in the workflow is rewritten to the fresh URL.
 * Assets that fail to upload are left as their original bundled path.
 */
import type { Edge, Node } from "@xyflow/react";
import type { NodeData } from "./store";
import { WORKFLOW_FORMAT } from "./exportWorkflow";

const ASSET_PREFIX = "assets/";

// ── ZIP reader ────────────────────────────────────────────────────────────────
// Parses the central directory (the authoritative index at the end of the file)
// instead of scanning local headers, so it tolerates zips written with streaming
// data descriptors (bit 0x08, sizes/CRC in a post-payload record), zip64, and any
// DEFLATE/STORE mix. Windows "Compress to ZIP" and `tar` both produce zips whose
// entries live under a wrapper folder, so after extracting we rebase everything
// onto the directory that holds `workflow.json`.

interface UnzipEntry {
  name: string;
  data: Uint8Array;
}

const ZIP_LOCAL_SIG = 0x04034b50; // PK\x03\x04
const ZIP_CENTRAL_SIG = 0x02014b50; // PK\x01\x02
const ZIP_EOCD_SIG = 0x06054b50; // PK\x05\x06
const ZIP64_LOC_SIG = 0x07064b50; // PK\x06\x07
const ZIP64_EOCD_SIG = 0x06064b50; // PK\x06\x06
const ZIP64_EXTRA_ID = 0x0001;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Backwards scan for the end-of-central-directory record (it sits ≤ 22 + 65,535
 *  bytes before EOF, since a max-size comment may follow it). */
function findEocd(view: DataView, len: number): number {
  const from = Math.max(len - 22 - 0xffff, 0);
  for (let i = len - 22; i >= from; i--) {
    if (view.getUint32(i, true) === ZIP_EOCD_SIG) return i;
  }
  throw new Error("invalid zip: end-of-central-directory record not found");
}

/** Read a single field out of a central directory entry's zip64 extra field. */
function zip64Extra(
  extra: Uint8Array,
  needUncomp: boolean,
  needComp: boolean,
  needOffset: boolean,
): { uncompSize?: number; compSize?: number; localOffset?: number } {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let p = 0;
  while (p + 4 <= extra.length) {
    const id = view.getUint16(p, true);
    const size = view.getUint16(p + 2, true);
    if (id === ZIP64_EXTRA_ID) {
      let q = p + 4;
      const out: { uncompSize?: number; compSize?: number; localOffset?: number } = {};
      if (needUncomp) { out.uncompSize = Number(view.getBigUint64(q, true)); q += 8; }
      if (needComp) { out.compSize = Number(view.getBigUint64(q, true)); q += 8; }
      if (needOffset) { out.localOffset = Number(view.getBigUint64(q, true)); }
      return out;
    }
    p += 4 + size;
  }
  return {};
}

/** When entries sit under a single wrapper directory (Windows "Compress to ZIP"
 *  of a folder, most archive UIs), rebase them so `workflow.json` is at root. */
function stripCommonRoot(entries: UnzipEntry[]): UnzipEntry[] {
  if (entries.some((e) => e.name === "workflow.json")) return entries;
  let root: string | null = null;
  for (const e of entries) {
    if (e.name.endsWith("/workflow.json")) {
      const r = e.name.slice(0, e.name.length - "workflow.json".length);
      if (!root || r.length < root.length) root = r;
    }
  }
  if (!root) return entries;
  return entries.map((e) =>
    e.name.startsWith(root) ? { name: e.name.slice(root.length), data: e.data } : e,
  );
}

async function unzip(buf: ArrayBuffer): Promise<UnzipEntry[]> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const decoder = new TextDecoder();
  const eocd = findEocd(view, bytes.length);

  let entryCount = view.getUint16(eocd + 10, true);
  let cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || entryCount === 0xffff) {
    // Zip64: the real counts/offsets live in a zip64 EOCD the locator points to.
    const loc = eocd - 20;
    if (view.getUint32(loc, true) === ZIP64_LOC_SIG) {
      const z64 = Number(view.getBigUint64(loc + 8, true));
      if (view.getUint32(z64, true) === ZIP64_EOCD_SIG) {
        entryCount = Number(view.getBigUint64(z64 + 32, true));
        cdOffset = Number(view.getBigUint64(z64 + 48, true));
      }
    }
  }

  // Parse the central directory for the authoritative size + local offset of
  // every entry. Local headers lie for streaming zips (sizes written as 0), so
  // they can't be trusted — the central directory can't.
  const central: { name: string; method: number; compSize: number; localOffset: number }[] = [];
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== ZIP_CENTRAL_SIG) break;
    const method = view.getUint16(p + 10, true);
    let compSize = view.getUint32(p + 20, true);
    const uncompSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    let localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const extra = bytes.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);

    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      const z = zip64Extra(extra, uncompSize === 0xffffffff, compSize === 0xffffffff, localOffset === 0xffffffff);
      if (compSize === 0xffffffff) compSize = z.compSize ?? 0;
      if (localOffset === 0xffffffff) localOffset = z.localOffset ?? 0;
    }

    central.push({ name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const entries: UnzipEntry[] = [];
  for (const cd of central) {
    if (cd.name.endsWith("/")) continue; // directory entry
    if (view.getUint32(cd.localOffset, true) !== ZIP_LOCAL_SIG) {
      throw new Error(`invalid zip: no local header found for ${cd.name}`);
    }
    // Read the local header only for the variable-length name/extra fields; the
    // compressed payload starts right after them at the central dir's offset.
    const nameLen = view.getUint16(cd.localOffset + 26, true);
    const extraLen = view.getUint16(cd.localOffset + 28, true);
    const dataStart = cd.localOffset + 30 + nameLen + extraLen;
    const raw = bytes.subarray(dataStart, dataStart + cd.compSize);

    let data: Uint8Array;
    if (cd.method === 0) data = raw; // STORE
    else if (cd.method === 8) data = await inflateRaw(raw); // DEFLATE
    else throw new Error(`unsupported zip compression method ${cd.method}`);

    entries.push({ name: cd.name, data });
  }

  return stripCommonRoot(entries);
}

// ── Asset content types ───────────────────────────────────────────────────────

function contentTypeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "mp4": return "video/mp4";
    case "webm": return "video/webm";
    case "png": return "image/png";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "jpg":
    case "jpeg": return "image/jpeg";
    default: return "application/octet-stream";
  }
}

// ── Rewrite bundled asset paths back to real URLs ─────────────────────────────

type Json = unknown;

function rewrite(value: Json, pathToUrl: Map<string, string>): Json {
  if (Array.isArray(value)) return value.map((v) => rewrite(v, pathToUrl));
  if (value && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewrite(v, pathToUrl);
    return out;
  }
  if (typeof value === "string" && value.startsWith(ASSET_PREFIX) && pathToUrl.has(value)) {
    return pathToUrl.get(value)!;
  }
  return value;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ImportedWorkflow {
  name: string;
  nodes: Node<NodeData>[];
  edges: Edge[];
  nodeCounters: Record<string, number>;
  viewport?: { x: number; y: number; zoom: number };
  assetCount: number;
  skipped: number;
}

export async function importWorkflowZip(file: File): Promise<ImportedWorkflow> {
  const entries = await unzip(await file.arrayBuffer());

  const manifestEntry = entries.find((e) => e.name === "workflow.json");
  if (!manifestEntry) throw new Error("workflow.json not found in zip");

  let manifest: {
    format?: string;
    name?: string;
    workflow?: {
      name?: string;
      nodes?: Node<NodeData>[];
      edges?: Edge[];
      nodeCounters?: Record<string, number>;
      viewport?: { x: number; y: number; zoom: number };
    };
  };
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data));
  } catch {
    throw new Error("workflow.json is not valid JSON");
  }

  if (manifest.format !== WORKFLOW_FORMAT) {
    throw new Error("this zip is not a HeliosGen workflow export");
  }

  const wf = manifest.workflow ?? {};
  const rawNodes = Array.isArray(wf.nodes) ? wf.nodes : [];
  if (rawNodes.length === 0) throw new Error("workflow has no nodes");

  // Re-upload every bundled asset, mapping its path → fresh URL.
  const pathToUrl = new Map<string, string>();
  let skipped = 0;
  for (const entry of entries) {
    if (!entry.name.startsWith(ASSET_PREFIX)) continue;
    try {
      const res = await fetch("/api/upload-asset", {
        method: "POST",
        headers: { "Content-Type": contentTypeFromName(entry.name) },
        body: entry.data as BodyInit,
      });
      if (!res.ok) throw new Error(`upload ${entry.name} → ${res.status}`);
      const { cdnUrl } = (await res.json()) as { cdnUrl: string };
      pathToUrl.set(entry.name, cdnUrl);
    } catch {
      skipped++;
    }
  }

  const nodes = rawNodes.map((n) => ({
    ...n,
    data: rewrite(n.data, pathToUrl) as NodeData,
  }));

  return {
    name: wf.name || manifest.name || "Imported workflow",
    nodes,
    edges: Array.isArray(wf.edges) ? wf.edges : [],
    nodeCounters: wf.nodeCounters ?? {},
    viewport: wf.viewport,
    assetCount: pathToUrl.size,
    skipped,
  };
}
