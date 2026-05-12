// Shared node type definitions — imported by both Sidebar and NodePickerMenu
import React from "react";

export type NodeCategory = "generators" | "resources";

export const NODE_META: Record<
  string,
  { accent: string; bg: string; bigIcon: React.ReactNode }
> = {
  promptNode: {
    accent: "#4ade80",
    bg: "#052e16",
    bigIcon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  imageInputNode: {
    accent: "#fb923c",
    bg: "#431407",
    bigIcon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
    ),
  },
  videoInputNode: {
    accent: "#60a5fa",
    bg: "#0c1a3b",
    bigIcon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="14" x="3" y="5" rx="2" />
        <path d="m16 10-4-2.5v5L16 10z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  generateNode: {
    accent: "#ff3df5",
    bg: "#0d1f06",
    bigIcon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="m3 9 4-4 4 4 4-4 4 4" />
        <path d="M3 15h18" />
      </svg>
    ),
  },
  assistantNode: {
    accent: "#FBBF24",
    bg: "#1c1000",
    bigIcon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
        <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
      </svg>
    ),
  },
  videoGeneratorNode: {
    accent: "#a78bfa",
    bg: "#1c0d3a",
    bigIcon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="14" x="3" y="5" rx="2" />
        <path d="m16 10-4-2.5v5L16 10z" fill="currentColor" stroke="none" />
        <path d="M7 12h4M9 10v4" />
      </svg>
    ),
  },
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
      canReceiveConnection: true,
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

// Rough pixel footprint per node type — used for placement + collision detection
export const NODE_SIZE: Record<string, { w: number; h: number }> = {
  assistantNode: { w: 280, h: 200 },
  videoGeneratorNode: { w: 320, h: 220 }, // Safe default for 16:9 + controls
  generateNode: { w: 280, h: 280 },       // 1:1 default
  promptNode: { w: 260, h: 130 },
  imageInputNode: { w: 200, h: 160 },
  videoInputNode: { w: 220, h: 180 },
};

export const FALLBACK_SIZE = { w: 280, h: 280 };
