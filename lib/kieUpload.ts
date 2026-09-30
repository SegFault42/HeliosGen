/**
 * Make image inputs reachable by kie.ai from a machine with no public URL.
 *
 * Hosted mode hands kie.ai a public R2 URL and (with a tunnel) can even expose
 * local files. The desktop app has neither, so local / data-URL images are
 * pushed to kie.ai's temporary file store (`POST /api/file-base64-upload`,
 * retained 3 days — long enough for a generation) and the returned `downloadUrl`
 * is used instead.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MEDIA_DIR } from "./guest/paths";

// kie.ai's temp file store lives on this host, not api.kie.ai (their docs are
// stale). Files land on tempfile.redpandaai.co and are purged after 3 days.
const UPLOAD_URL = "https://kieai.redpandaai.co/api/file-base64-upload";

function isRemotelyReachable(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const { hostname } = new URL(url);
    return hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "0.0.0.0";
  } catch {
    return false;
  }
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
};

/** A local reference that kie.ai can't fetch and we must re-host. */
function isLocalMedia(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("/generated/");
}

/** Read a `/generated/...` path or a `data:` URL into a base64 data URL. */
export async function toDataUrl(input: string): Promise<string> {
  if (input.startsWith("data:")) return input;

  const rel = input.replace(/^\/generated\//, "").replace(/^\/+/, "");
  const buf = await readFile(join(MEDIA_DIR, rel));
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// Cache so the same reference used in several input fields uploads once.
const uploadCache = new Map<string, Promise<string>>();

async function doUpload(input: string, apiKey: string): Promise<string> {
  const base64Data = await toDataUrl(input);
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ base64Data, uploadPath: "heliosgen" }),
  });
  const json = await res.json().catch(() => null);
  const url = json?.data?.downloadUrl;
  if (!res.ok || !url) {
    throw new Error(`kie.ai file upload failed (${res.status}): ${json?.msg ?? "no downloadUrl"}`);
  }
  return url as string;
}

function uploadOne(input: string, apiKey: string): Promise<string> {
  let p = uploadCache.get(input);
  if (!p) {
    p = doUpload(input, apiKey);
    uploadCache.set(input, p);
  }
  return p;
}

/**
 * Return the input list with any locally-hosted image swapped for a kie.ai
 * temporary URL. Already-public URLs pass through untouched. Throws if an upload
 * fails (the caller surfaces it — a silently dropped reference image is worse).
 */
export async function ensureKieReachableImages(urls: string[], apiKey: string): Promise<string[]> {
  return Promise.all(urls.map((u) => (isRemotelyReachable(u) ? Promise.resolve(u) : uploadOne(u, apiKey))));
}

/**
 * Deep-walk a kie.ai `input` payload and replace every local `/generated/...` or
 * `data:` media reference (in strings, arrays, and nested objects) with a kie.ai
 * temporary URL. Mutates in place. Use for the video route, whose payload shape
 * varies a lot between model families.
 */
export async function rewriteLocalMediaForKie(node: unknown, apiKey: string): Promise<void> {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === "string" && isLocalMedia(node[i])) {
        node[i] = await uploadOne(node[i], apiKey);
      } else {
        await rewriteLocalMediaForKie(node[i], apiKey);
      }
    }
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === "string" && isLocalMedia(value)) {
        (node as Record<string, unknown>)[key] = await uploadOne(value, apiKey);
      } else {
        await rewriteLocalMediaForKie(value, apiKey);
      }
    }
  }
}
