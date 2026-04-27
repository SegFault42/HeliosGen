import type { CSSProperties } from "react";

// Colours match the handle border colours exactly
export const EDGE_COLORS: Record<string, string> = {
  prompt: "#ff3df5", // green  — matches node-handle-icon-prompt
  image: "#fb923c", // orange — matches node-handle-icon-resource
  startFrame: "#818cf8", // indigo — matches node-handle-icon-image
  endFrame: "#818cf8", // indigo — matches node-handle-icon-image
  resource: "#fb923c", // orange — matches node-handle-icon-resource
  videoRef: "#22d3ee", // cyan   — matches node-handle-icon-videoref
  referenceVideo: "#38bdf8", // sky    — matches node-handle-icon-refvideo
  audioRef: "#a78bfa", // violet — matches node-handle-icon-audioref
  character: "#f472b6", // pink   — matches node-handle-icon-character (motion control startFrame)
  default: "#3a3a3a", // neutral
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
    case "imagePickOut": return "#818cf8";
    case "videoRefOut": return "#22d3ee";
    case "audioRefOut": return "#a78bfa";
  }
  // Legacy / single-output nodes — derive from node type
  switch (nodeType) {
    case "promptNode": return "#ff3df5";
    case "assistantNode": return "#FBBF24";
    case "imageInputNode": return "#818cf8";
    case "generateNode": return "#818cf8";
    case "videoInputNode": return "#22d3ee";
    case "videoGeneratorNode": return "#22d3ee";
    default: return EDGE_COLORS.default;
  }
}
