import { readFile } from "fs/promises";
import { join, extname, basename } from "path";
import { getKieApiToken } from "./db";

// Kie.ai's own file store. Sending the bytes here means kie.ai never has to
// fetch a URL from us — which is the whole point in Guest Mode, where our only
// public address is an ngrok tunnel (see uploadLocalFileToKie below).
const STREAM_UPLOAD = "https://kieai.redpandaai.co/api/file-stream-upload";

// Kie deletes uploads after 3 days; re-upload well before that.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const cache = new Map<string, { url: string; expiresAt: number }>();

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif",  ".webp": "image/webp",
  ".mp4": "video/mp4",  ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav",  ".m4a": "audio/mp4",
};

function mimeFor(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Uploads a "/generated/..." file to kie.ai's file store and returns the public
 * downloadUrl they serve it from.
 *
 * Why this exists: Guest Mode exposes reference files through an ngrok tunnel,
 * but ngrok's free tier answers some requests with its browser-warning page
 * (ERR_NGROK_6024, a 259-byte text body) instead of proxying them. kie.ai's
 * fetcher hits that page intermittently and reports the reference as corrupt
 * ("Invalid image format" / "get image info failed" / "Image fetch failed"),
 * because what it downloaded really is 259 bytes of prose. Pushing the bytes
 * straight to kie.ai takes the tunnel out of the reference path entirely.
 *
 * Returns null when there's no API key or the upload fails — callers fall back
 * to the tunnel URL, which still works whenever ngrok doesn't interstitial.
 */
export async function uploadLocalFileToKie(storedPath: string): Promise<string | null> {
  const cached = cache.get(storedPath);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const apiKey = getKieApiToken();
  if (!apiKey) return null;

  try {
    const buf  = await readFile(join(process.cwd(), "public", storedPath));
    const type = mimeFor(storedPath);

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type }), basename(storedPath));
    form.append("uploadPath", "images/references");

    const res = await fetch(STREAM_UPLOAD, {
      method:  "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body:    form,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const url  = json?.data?.downloadUrl;
    if (typeof url !== "string" || !url) throw new Error(json?.msg ?? "no downloadUrl in response");

    cache.set(storedPath, { url, expiresAt: Date.now() + CACHE_TTL_MS });
    return url;
  } catch (err) {
    console.error("[kieUpload] falling back to tunnel URL for", storedPath, "-", err);
    return null;
  }
}
