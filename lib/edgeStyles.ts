import type { CSSProperties } from "react";

// Colours match the handle border colours exactly
export const EDGE_COLORS: Record<string, string> = {
  prompt: "var(--accent)", // teal   — matches node-handle-icon-prompt
  image: "var(--accent)", // image → accent (Solstice)
  startFrame: "var(--accent)", // indigo — matches node-handle-icon-image
  endFrame: "var(--accent)", // indigo — matches node-handle-icon-image
  resource: "var(--accent)", // orange — matches node-handle-icon-resource
  videoRef: "var(--warning)", // cyan   — matches node-handle-icon-videoref
  referenceVideo: "var(--warning)", // sky    — matches node-handle-icon-refvideo
  audioRef: "var(--success)", // violet — matches node-handle-icon-audioref
  character: "var(--accent)", // pink   — matches node-handle-icon-character (motion control startFrame)
  default: "var(--border-2)", // neutral
};

// Handles that carry image data get a heavier stroke
const IMAGE_HANDLES = new Set(["image", "startFrame", "endFrame", "resource"]);

export function edgeStyle(targetHandle?: string | null | undefined): CSSProperties {
  const key = targetHandle ?? "default";
  const color = EDGE_COLORS[key] ?? EDGE_COLORS.default;
  const strokeWidth = IMAGE_HANDLES.has(key) ? 2.5 : 2;
  return { stroke: color, strokeWidth };
}

/** Returns the stroke color for a source (output) handle. */
export function getSourceHandleColor(nodeType: string | undefined, sourceHandleId: string | null | undefined): string {
  switch (sourceHandleId) {
    case "startFrameOut":
    case "endFrameOut":
    case "imagePickOut": return "var(--accent)";
    case "videoRefOut": return "var(--warning)";
    case "audioRefOut": return "var(--success)";
  }
  // Legacy / single-output nodes — derive from node type
  switch (nodeType) {
    case "promptNode": return "var(--accent)";
    case "assistantNode": return "var(--accent)";
    case "imageInputNode": return "var(--accent)";
    case "generateNode": return "var(--accent)";
    case "videoInputNode": return "var(--warning)";
    case "videoGeneratorNode": return "var(--warning)";
    default: return EDGE_COLORS.default;
  }
}
