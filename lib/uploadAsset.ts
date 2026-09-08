/**
 * Client-side asset upload: content hash → cache lookup → upload.
 * One place for what ImageInputNode, VideoInputNode and the canvas drop
 * handler each used to spell out by hand.
 */
import { sha256Hex } from "./assetHash";

/** URL of an identical file already stored, or null. Never throws. */
export async function findCachedAsset(bytes: ArrayBuffer): Promise<string | null> {
  try {
    const hash = await sha256Hex(bytes);
    const res = await fetch(`/api/lookup-asset?hash=${hash}`);
    const { cdnUrl } = (await res.json()) as { cdnUrl: string | null };
    return cdnUrl ?? null;
  } catch {
    return null;
  }
}

/** Upload raw bytes; resolves to the stored URL. Throws with the server's message on failure. */
export async function uploadAsset(bytes: ArrayBuffer, mime: string): Promise<string> {
  const res = await fetch("/api/upload-asset", {
    method: "POST",
    headers: { "Content-Type": mime },
    body: bytes,
  });
  const json = (await res.json()) as { cdnUrl?: string; error?: string };
  if (!res.ok || !json.cdnUrl) throw new Error(json.error ?? "Upload failed");
  return json.cdnUrl;
}

/** Cached URL when the file was seen before, otherwise upload it. */
export async function storeAsset(bytes: ArrayBuffer, mime: string): Promise<string> {
  return (await findCachedAsset(bytes)) ?? uploadAsset(bytes, mime);
}
