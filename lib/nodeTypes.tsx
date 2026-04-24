// Shared node type definitions — imported by both Sidebar and NodePickerMenu

export type NodeCategory = "generators" | "resources";

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
    canReceiveConnection: true,
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M8 10h8M8 14h5" strokeLinecap="round" />
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
    description: "Kling 3.0 · text or image to video",
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

// Rough pixel footprint per node type — used for placement + collision detection
export const NODE_SIZE: Record<string, { w: number; h: number }> = {
  assistantNode:      { w: 280, h: 200 },
  videoGeneratorNode: { w: 300, h: 480 },
  generateNode:       { w: 280, h: 340 },
  promptNode:         { w: 260, h: 130 },
  imageInputNode:     { w: 200, h: 160 },
  videoInputNode:     { w: 220, h: 180 },
};

export const FALLBACK_SIZE = { w: 280, h: 280 };
