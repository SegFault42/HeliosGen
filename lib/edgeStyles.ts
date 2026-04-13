import type { CSSProperties } from "react";

// Colours match the handle border colours exactly
export const EDGE_COLORS: Record<string, string> = {
  prompt:     "#77E544", // green  — matches node-handle-icon-prompt
  image:      "#fb923c", // orange — matches node-handle-icon-resource
  startFrame: "#818cf8", // indigo — matches node-handle-icon-image
  endFrame:   "#818cf8", // indigo — matches node-handle-icon-image
  resource:   "#fb923c", // orange — matches node-handle-icon-resource
  default:    "#3a3a3a", // neutral
};

// Handles that carry image data get a heavier stroke
const IMAGE_HANDLES = new Set(["image", "startFrame", "endFrame", "resource"]);

export function edgeStyle(targetHandle?: string | null | undefined): CSSProperties {
  const key   = targetHandle ?? "default";
  const color = EDGE_COLORS[key] ?? EDGE_COLORS.default;
  const strokeWidth = IMAGE_HANDLES.has(key) ? 2.5 : 2;
  return { stroke: color, strokeWidth };
}
