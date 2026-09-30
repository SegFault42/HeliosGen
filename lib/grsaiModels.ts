/**
 * Client-safe list of the app image models Grsai can serve (see lib/grsai.ts
 * for the server-side API client). Imported by lib/providers for the UI.
 *
 * How each app image model maps onto Grsai:
 * - `ratio`:  aspectRatio is a ratio string ("16:9"), resolution via imageSize (Nano Banana).
 * - `pixels`: aspectRatio must be an explicit "WxH" size (GPT Image 2.5 Flare/Sunburst).
 */
export interface GrsaiImageModel {
  model: string;
  sizing: "ratio" | "pixels";
  /** Nano Banana 2 / Pro accept imageSize 1K/2K/4K. */
  imageSize?: boolean;
}

export const GRSAI_IMAGE_MODELS: Record<string, GrsaiImageModel> = {
  "google-nano-banana":     { model: "nano-banana",            sizing: "ratio" },
  "nano-banana-2":          { model: "nano-banana-2",          sizing: "ratio", imageSize: true },
  "nano-banana-pro":        { model: "nano-banana-pro",        sizing: "ratio", imageSize: true },
  "gpt-image-2":            { model: "gpt-image-2",            sizing: "ratio" },
  "gpt-image-2-5-flare":    { model: "gpt-image-2.5-flare",    sizing: "pixels" },
  "gpt-image-2-5-sunburst": { model: "gpt-image-2.5-sunburst", sizing: "pixels" },
};

export function grsaiSupportsModel(modelId: string): boolean {
  return modelId in GRSAI_IMAGE_MODELS;
}

export const GRSAI_MODEL_IDS = Object.keys(GRSAI_IMAGE_MODELS);
