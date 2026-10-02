import { IMAGE_MODELS } from "./modelConfig";

// Only Kie-routed image models need a saved Kie key. Codex and Flow do not.
export function imageNeedsKie(modelId: string, provider: string): boolean {
  if (provider === "codex") return false;
  return !IMAGE_MODELS.find((m) => m.id === modelId)?.apiInput.useFlow;
}

// Must match buildImagePayload's default so what the node shows is what a run sends.
export const DEFAULT_IMAGE_RATIO = "9:16";

// Error overlay: only non-Flow (Kie) failures are refunded. Splits a trailing
// "(screenshot: <path>)" so the UI can render it separately and readable.
export function parseGenerateError(msg: string): { text: string; screenshot?: string } {
  const m = msg.match(/\s*\(screenshot:\s*([^)]+)\)\s*$/);
  return m ? { text: msg.slice(0, m.index).trim(), screenshot: m[1].trim() } : { text: msg };
}
