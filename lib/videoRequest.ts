// Pure parsing/validation for /api/generate-video, run before any paid provider submit.

export function asUrlList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && u !== "") : [];
}

export function asUrl(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

export function asResources(v: unknown): { url: string; label: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((r) => r && typeof r.url === "string" && r.url !== "")
    .map((r) => ({ url: r.url as string, label: typeof r.label === "string" ? r.label : "" }));
}

export function asKlingElements(v: unknown): { name: string; description: string; imageUrls: string[] }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((el) => el && typeof el === "object")
    .map((el) => ({
      name: typeof el.name === "string" ? el.name : "",
      description: typeof el.description === "string" ? el.description : "",
      imageUrls: asUrlList(el.imageUrls),
    }))
    .filter((el) => el.imageUrls.length > 0);
}

export function flowUpscale(
  rawResolution: unknown,
  cfg: { defaultResolution?: string },
): "1080p" | "none" {
  return ((rawResolution || cfg.defaultResolution) === "1080p") ? "1080p" : "none";
}

/** Error message when an interpolation (Frame A->B) model lacks a frame, else null. */
export function interpolationError(
  cfg: { apiInput: { isInterpolation?: boolean } },
  startFrame: string | undefined,
  endFrame: string | undefined,
): string | null {
  if (!cfg.apiInput.isInterpolation || (startFrame && endFrame)) return null;
  return "Frame A->B needs both a start frame and an end frame.";
}
