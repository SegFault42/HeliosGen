// Shared node type definitions — imported by both Sidebar and NodePickerMenu
import React from "react";
import { MessageSquare, Image, Film, Sparkles, Bot, Clapperboard } from "lucide-react";

export type NodeCategory = "generators" | "resources";

export const NODE_META: Record<
  string,
  { accent: string; bg: string; bigIcon: React.ReactNode }
> = {
  promptNode:         { accent: "#4ade80", bg: "#052e16",  bigIcon: <MessageSquare size={18} strokeWidth={1.7} /> },
  imageInputNode:     { accent: "#fb923c", bg: "#431407",  bigIcon: <Image         size={18} strokeWidth={1.7} /> },
  videoInputNode:     { accent: "#60a5fa", bg: "#0c1a3b",  bigIcon: <Film          size={18} strokeWidth={1.7} /> },
  generateNode:       { accent: "#2DD4BF", bg: "#001f1f",  bigIcon: <Sparkles      size={18} strokeWidth={1.7} /> },
  assistantNode:      { accent: "#FBBF24", bg: "#1c1000",  bigIcon: <Bot           size={18} strokeWidth={1.7} /> },
  videoGeneratorNode: { accent: "#5EEAD4", bg: "#042f2e",  bigIcon: <Clapperboard  size={18} strokeWidth={1.7} /> },
};

export const NODES: Array<{
  type: string;
  category: NodeCategory;
  canReceiveConnection: boolean;
  icon: React.ReactNode;
  label: string;
  description: string;
}> = [
    /* ── Generators ─────────────────────────────────────────────────────────── */
    {
      type: "assistantNode",
      category: "generators",
      canReceiveConnection: false,
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
          <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
        </svg>
      ),
      label: "Assistant",
      description: "Text-to-text LLM node",
    },
    {
      type: "videoGeneratorNode",
      category: "generators",
      canReceiveConnection: true,
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect width="18" height="14" x="3" y="5" rx="2" />
          <path d="m16 10-4-2.5v5L16 10z" fill="currentColor" stroke="none" />
        </svg>
      ),
      label: "Video",
      description: "Google Veo / Kling 3.0 · video generation",
    },
    {
      type: "generateNode",
      category: "generators",
      canReceiveConnection: true,
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="m3 9 4-4 4 4 4-4 4 4" />
          <path d="M3 15h18" />
        </svg>
      ),
      label: "Image",
      description: "Nano Banana 2 · image generation",
    },

    /* ── Resources ──────────────────────────────────────────────────────────── */
    {
      type: "promptNode",
      category: "resources",
      canReceiveConnection: false,
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      label: "Text",
      description: "Standalone text source",
    },
    {
      type: "imageInputNode",
      category: "resources",
      canReceiveConnection: false,
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </svg>
      ),
      label: "Reference Image",
      description: "Upload or URL source",
    },
    {
      type: "videoInputNode",
      category: "resources",
      canReceiveConnection: false,
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect width="18" height="14" x="3" y="5" rx="2" />
          <path d="m16 10-4-2.5v5L16 10z" fill="currentColor" stroke="none" />
          <path d="M12 2v3M12 19v3M4 12H2M22 12h-2" strokeWidth="1.2" />
        </svg>
      ),
      label: "Reference Video",
      description: "Upload a video · max 100 MB",
    },
  ];

const GEN_NODE_SETTINGS: Record<string, string[]> = {
  generateNode: ["model", "aspectRatio", "quality", "azureQuality", "azureResolution"],
  videoGeneratorNode: ["videoModel", "klingMode", "grokResolution", "duration", "aspectRatio", "sound"],
};

/** Returns settings from the last existing node of `type` to seed a newly created one. */
export function getLastNodeSettings(
  type: string,
  nodes: Array<{ type?: string | null; data: Record<string, unknown> }>,
): Record<string, unknown> {
  const keys = GEN_NODE_SETTINGS[type];
  if (!keys) return {};
  const matching = nodes.filter((n) => n.type === type);
  if (!matching.length) return {};
  const last = matching[matching.length - 1];
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (last.data[k] !== undefined) out[k] = last.data[k];
  }
  return out;
}

// Rough pixel footprint per node type — used for placement + collision detection
export const NODE_SIZE: Record<string, { w: number; h: number }> = {
  assistantNode: { w: 280, h: 200 },
  videoGeneratorNode: { w: 320, h: 220 }, // Safe default for 16:9 + controls
  generateNode: { w: 280, h: 280 },       // 1:1 default
  promptNode: { w: 520, h: 250 },
  imageInputNode: { w: 200, h: 160 },
  videoInputNode: { w: 220, h: 180 },
};

export const FALLBACK_SIZE = { w: 280, h: 280 };

/** Size to use for a newly created node: last manually-resized size for this type, else the static default. */
export function getDefaultNodeSize(
  type: string,
  lastNodeSize: Record<string, { w: number; h: number }>,
): { w: number; h: number } {
  return lastNodeSize[type] ?? NODE_SIZE[type] ?? FALLBACK_SIZE;
}
