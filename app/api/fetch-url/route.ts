/**
 * POST /api/fetch-url
 *
 * Fetches a remote image/video URL server-side and stores it locally.
 * Body: { url: string }
 * Returns: { cdnUrl: string; mediaType: "image" | "video" }
 */
import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns/promises";
import { uploadBuffer } from "@/lib/storage";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_REDIRECTS = 5;

function isPrivateIp(ip: string): boolean {
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1" || ip === "::" || /^f[cd]/i.test(ip) || /^fe80/i.test(ip)) return true;
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
  return p[0] === 10 || p[0] === 127 || p[0] === 0
    || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    || (p[0] === 192 && p[1] === 168)
    || (p[0] === 169 && p[1] === 254)
    || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
}

async function assertPublicHost(u: URL): Promise<void> {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("blocked host");
  if (isPrivateIp(host)) throw new Error("blocked host");
  const { address } = await dns.lookup(host);
  if (isPrivateIp(address)) throw new Error("blocked host");
}

async function fetchPublic(url: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(current);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("blocked host");
    await assertPublicHost(u);
    const res = await fetch(current, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ANVIL/1.0)" },
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json() as { url?: string };
    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing url" }, { status: 400 });
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "Only http/https URLs are supported" }, { status: 400 });
    }

    // This route is a fetch proxy; without this it could read anything on the
    // LAN or the machine itself (localhost services, cloud metadata, ...).
    const upstream = await fetchPublic(url);

    if (!upstream.ok) {
      return NextResponse.json({ error: `Failed to fetch URL: ${upstream.status} ${upstream.statusText}` }, { status: 400 });
    }

    const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
    const mimeType = contentType.split(";")[0].trim();

    const isImage = mimeType.startsWith("image/");
    const isVideo = mimeType.startsWith("video/");
    if (!isImage && !isVideo) {
      return NextResponse.json({ error: "URL does not point to an image or video" }, { status: 400 });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 413 });
    }

    const folder = isVideo ? "references" : "uploads";
    const cdnUrl = await uploadBuffer(buffer, mimeType, folder);
    const mediaType: "image" | "video" = isImage ? "image" : "video";

    // Record in uploads so it appears in the gallery "uploaded" section
    guestDb.insertUpload({ user_id: GUEST_USER_ID, r2_url: cdnUrl, mime_type: mimeType, source: "user_upload" });

    return NextResponse.json({ cdnUrl, mediaType });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
