/** Select an actual downloadable video from HeyGen MCP results, not its web page. */
export function heygenVideoAssetUrl(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = heygenVideoAssetUrl(item);
      if (found) return found;
    }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  for (const key of ["video_url", "videoUrl", "download_url", "downloadUrl", "mp4_url", "mp4Url"]) {
    const candidate = object[key];
    if (typeof candidate !== "string") continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && /\.mp4$/i.test(url.pathname)) return candidate;
    } catch { /* ignore malformed provider field */ }
  }
  for (const item of Object.values(object)) {
    const found = heygenVideoAssetUrl(item);
    if (found) return found;
  }
  return undefined;
}
