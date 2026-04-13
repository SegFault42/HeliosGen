import type { CSSProperties } from "react";

// One colour per handle type so wires are instantly readable
export const EDGE_COLORS: Record<string, string> = {
  prompt:     "#a78bfa", // violet  — text / prompt
  image:      "#fb923c", // amber   — image reference (generateNode)
  startFrame: "#818cf8", // indigo  — Kling start frame
  endFrame:   "#6366f1", // indigo  — Kling end frame
  resource:   "#f97316", // orange  — resource / reference image
  default:    "#3a3a3a", // neutral — untyped
};

// Handles that carry image data get a heavier stroke
const IMAGE_HANDLES = new Set(["image", "startFrame", "endFrame", "resource"]);

export function edgeStyle(targetHandle?: string | null): CSSProperties {
  const key   = targetHandle ?? "default";
  const color = EDGE_COLORS[key] ?? EDGE_COLORS.default;
  const strokeWidth = IMAGE_HANDLES.has(key) ? 2.5 : 2;
  return { stroke: color, strokeWidth };
}
