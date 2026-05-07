"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { NODES, NODE_SIZE, FALLBACK_SIZE, NODE_META } from "@/lib/nodeTypes";
import { getToken } from "@/lib/galleryUtils";
import { MediaPickerModal } from "@/components/MediaPickerModal";

const TOOLBAR_OFFSET_PX = 80;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* Node types replaced by Upload/Assets — hide from search results */
const HIDDEN_FROM_MENU = new Set(["imageInputNode", "videoInputNode"]);

const SECTIONS: Array<{ id: string; label: string; nodeTypes: string[] }> = [
  {
    id: "generators",
    label: "GENERATORS",
    nodeTypes: ["generateNode", "videoGeneratorNode", "assistantNode"],
  },
  {
    id: "resources",
    label: "INPUTS",
    nodeTypes: ["promptNode"],
  },
];

interface AddNodeMenuProps {
  anchorRect: DOMRect;
  onClose: () => void;
}

export default function AddNodeMenu({ anchorRect, onClose }: AddNodeMenuProps) {
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useWorkflowStore((s) => s.addNode);

  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerOpen) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [onClose, pickerOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { if (pickerOpen) setPickerOpen(false); else onClose(); } };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, pickerOpen]);

  const q = query.trim().toLowerCase();
  const allNodes = NODES.filter((n) => !HIDDEN_FROM_MENU.has(n.type));
  const filtered = q
    ? allNodes.filter((n) => n.label.toLowerCase().includes(q) || n.description.toLowerCase().includes(q))
    : null;

  function rectsOverlap(
    ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number,
    pad = 0,
  ) {
    return ax - pad < bx + bw && ax + aw + pad > bx && ay - pad < by + bh && ay + ah + pad > by;
  }

  /* Calculate position and label for a new node, then add it. Returns the nodeId. */
  const addNextToToolbar = useCallback(
    (type: string, extraData?: Partial<NodeData>): string => {
      const container = document.querySelector(".react-flow") as HTMLElement | null;
      const rect = container?.getBoundingClientRect();
      const size = NODE_SIZE[type] ?? FALLBACK_SIZE;
      const GAP = 40;

      const nodesNow = useWorkflowStore.getState().nodes;
      const count = nodesNow.filter((n) => n.type === type).length + 1;

      const DISPLAY: Record<string, string> = {
        promptNode: "TEXT",
        imageInputNode: "IMAGE",
        videoInputNode: "VIDEO",
        generateNode: "IMAGE GEN",
        videoGeneratorNode: "VIDEO GEN",
        assistantNode: "ASSISTANT",
      };
      const label = `${DISPLAY[type] ?? type} #${count}`;

      let nodeX: number;
      let nodeY: number;

      if (nodesNow.length === 0) {
        const screenX = (rect?.left ?? 0) + TOOLBAR_OFFSET_PX;
        const screenY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
        const flowPos = screenToFlowPosition({ x: screenX, y: screenY });
        nodeX = flowPos.x;
        nodeY = flowPos.y - size.h / 2;
      } else {
        const vpCentreScreen = {
          x: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
          y: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
        };
        const vpCentreFlow = screenToFlowPosition(vpCentreScreen);

        let nearest = nodesNow[0];
        let nearestDist = Infinity;
        for (const n of nodesNow) {
          const s = NODE_SIZE[n.type ?? ""] ?? FALLBACK_SIZE;
          const cx = n.position.x + s.w / 2;
          const cy = n.position.y + s.h / 2;
          const d = Math.hypot(cx - vpCentreFlow.x, cy - vpCentreFlow.y);
          if (d < nearestDist) { nearestDist = d; nearest = n; }
        }

        const nearestSize = NODE_SIZE[nearest.type ?? ""] ?? FALLBACK_SIZE;
        let candidateX = nearest.position.x + nearestSize.w + GAP;
        const candidateY = nearest.position.y + nearestSize.h / 2 - size.h / 2;

        const MAX_ATTEMPTS = 40;
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
          const overlapping = nodesNow.some((n) => {
            const s = NODE_SIZE[n.type ?? ""] ?? FALLBACK_SIZE;
            return rectsOverlap(candidateX, candidateY, size.w, size.h, n.position.x, n.position.y, s.w, s.h, GAP / 2);
          });
          if (!overlapping) break;
          candidateX += size.w + GAP;
        }

        nodeX = candidateX;
        nodeY = candidateY;
      }

      const nodeId = `${type}-${uid()}`;
      addNode({
        id: nodeId,
        type,
        position: { x: nodeX, y: nodeY },
        style:
          type === "imageInputNode" || type === "videoInputNode"
            ? { width: size.w }
            : { width: size.w, height: size.h },
        data: { label, status: "idle", ...extraData },
      });

      onClose();
      return nodeId;
    },
    [addNode, screenToFlowPosition, onClose],
  );

  /* Handle file selected via the Upload button */
  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = "";

      const isVideo = file.type.startsWith("video/");
      const type = isVideo ? "videoInputNode" : "imageInputNode";
      const blobUrl = URL.createObjectURL(file);

      const nodeId = addNextToToolbar(type, isVideo ? { videoUrl: blobUrl } : { inputImage: blobUrl });

      if (!isVideo) {
        const img = new window.Image();
        img.onload = () => {
          useWorkflowStore.getState().updateNodeData(nodeId, {
            imageNaturalRatio: `${img.naturalWidth} / ${img.naturalHeight}`,
          });
        };
        img.src = blobUrl;
      }

      const bytes = await file.arrayBuffer();
      const token = await getToken();
      const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
      try {
        const res = await fetch("/api/upload-asset", {
          method: "POST",
          headers: { "Content-Type": file.type || (isVideo ? "video/mp4" : "image/jpeg"), ...authHeaders },
          body: bytes,
        });
        const { cdnUrl } = await res.json() as { cdnUrl?: string };
        if (cdnUrl) {
          URL.revokeObjectURL(blobUrl);
          useWorkflowStore.getState().updateNodeData(
            nodeId,
            isVideo ? { videoUrl: cdnUrl } : { inputImage: cdnUrl, r2Url: cdnUrl },
          );
        }
      } catch {
        // blob URL stays as fallback until page reload
      }
    },
    [addNextToToolbar],
  );

  /* Handle asset selected from the picker */
  const handleAssetPick = useCallback(
    (url: string, mediaType: "image" | "video") => {
      setPickerOpen(false);
      if (mediaType === "image") {
        addNextToToolbar("imageInputNode", { inputImage: url, r2Url: url });
      } else {
        addNextToToolbar("videoInputNode", { videoUrl: url });
      }
    },
    [addNextToToolbar],
  );

  /* Menu position */
  const MENU_W = 280;
  const MENU_MAX_H = 460;
  const left = anchorRect.right + 10;
  const topRaw = anchorRect.top + anchorRect.height / 2 - MENU_MAX_H / 2;
  const top = Math.max(12, Math.min(topRaw, window.innerHeight - MENU_MAX_H - 12));

  const ROW_STYLE = (isHovered: boolean) => ({
    display: "flex" as const,
    alignItems: "center" as const,
    gap: "12px",
    width: "100%",
    padding: "9px 14px",
    background: isHovered ? "rgba(255,255,255,0.05)" : "transparent",
    border: "none",
    cursor: "pointer",
    textAlign: "left" as const,
    transition: "background 120ms ease",
    borderRadius: "8px",
  });

  function NodeRow({ nodeType }: { nodeType: string }) {
    const node = allNodes.find((n) => n.type === nodeType);
    if (!node) return null;
    const meta = NODE_META[nodeType];
    const isHovered = focused === nodeType;

    return (
      <button
        key={nodeType}
        id={`add-node-${nodeType}`}
        onMouseEnter={() => setFocused(nodeType)}
        onMouseLeave={() => setFocused(null)}
        onClick={() => addNextToToolbar(nodeType)}
        style={ROW_STYLE(isHovered)}
      >
        <span style={{
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          width: "34px", height: "34px", borderRadius: "9px",
          background: meta?.bg ?? "rgba(255,255,255,0.06)",
          color: meta?.accent ?? "#aaa",
          border: `1px solid ${meta?.accent ?? "#333"}28`,
        }}>
          {meta?.bigIcon ?? node.icon}
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
          <span style={{ fontSize: "13px", fontWeight: 500, color: isHovered ? "#fff" : "rgba(255,255,255,0.82)", lineHeight: 1.2, transition: "color 120ms ease" }}>
            {node.label}
          </span>
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {node.description}
          </span>
        </span>
        {isHovered && (
          <span style={{ marginLeft: "auto", flexShrink: 0, fontSize: "10px", color: "rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "4px", padding: "2px 5px", fontFamily: "monospace" }}>
            ↵
          </span>
        )}
      </button>
    );
  }

  function CustomRow({
    id,
    icon,
    accent,
    bg,
    label,
    description,
    onClick,
  }: {
    id: string;
    icon: React.ReactNode;
    accent: string;
    bg: string;
    label: string;
    description: string;
    onClick: () => void;
  }) {
    const isHovered = focused === id;
    return (
      <button
        onMouseEnter={() => setFocused(id)}
        onMouseLeave={() => setFocused(null)}
        onClick={onClick}
        style={ROW_STYLE(isHovered)}
      >
        <span style={{
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          width: "34px", height: "34px", borderRadius: "9px",
          background: bg, color: accent,
          border: `1px solid ${accent}28`,
        }}>
          {icon}
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
          <span style={{ fontSize: "13px", fontWeight: 500, color: isHovered ? "#fff" : "rgba(255,255,255,0.82)", lineHeight: 1.2, transition: "color 120ms ease" }}>
            {label}
          </span>
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {description}
          </span>
        </span>
      </button>
    );
  }

  return (
    <>
      {/* Hidden file input for Upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileSelected}
      />

      <div
        id="add-node-menu"
        ref={menuRef}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed", left, top, width: MENU_W, maxHeight: MENU_MAX_H, zIndex: 10000,
          display: "flex", flexDirection: "column",
          background: "rgba(12, 13, 15, 0.97)",
          backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.7), 0 4px 16px rgba(0,0,0,0.5)",
          overflow: "hidden",
          animation: "addMenuIn 140ms cubic-bezier(0.22,1,0.36,1) both",
        }}
      >
        <style>{`
          @keyframes addMenuIn {
            from { opacity: 0; transform: translateX(-8px) scale(0.97); }
            to   { opacity: 1; transform: translateX(0) scale(1); }
          }
        `}</style>

        {/* Search bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={searchRef}
            id="add-node-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes…"
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "rgba(255,255,255,0.82)", fontSize: "13px", caretColor: "#ff3df5" }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 0, lineHeight: 1 }}>×</button>
          )}
        </div>

        {/* Node list */}
        <div style={{ overflowY: "auto", flex: 1, padding: "8px" }}>
          {filtered ? (
            filtered.length === 0 ? (
              <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.25)", textAlign: "center", padding: "24px 0" }}>
                No nodes match &ldquo;{query}&rdquo;
              </p>
            ) : (
              filtered.map((n) => <NodeRow key={n.type} nodeType={n.type} />)
            )
          ) : (
            SECTIONS.map((section) => (
              <div key={section.id} style={{ marginBottom: "4px" }}>
                <p style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", color: "rgba(255,255,255,0.25)", padding: "8px 14px 4px", margin: 0 }}>
                  {section.label}
                </p>
                {section.nodeTypes.map((t) => <NodeRow key={t} nodeType={t} />)}
                {section.id === "resources" && (
                  <>
                    <CustomRow
                      id="upload"
                      label="Upload"
                      description="Image or video — auto-detects type"
                      accent="#34d399"
                      bg="#052e16"
                      icon={
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                      }
                      onClick={() => fileInputRef.current?.click()}
                    />
                    <CustomRow
                      id="assets"
                      label="Assets"
                      description="Browse your generations & uploads"
                      accent="#60a5fa"
                      bg="#0c1a3b"
                      icon={
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="7" height="7" rx="1" />
                          <rect x="14" y="3" width="7" height="7" rx="1" />
                          <rect x="3" y="14" width="7" height="7" rx="1" />
                          <rect x="14" y="14" width="7" height="7" rx="1" />
                        </svg>
                      }
                      onClick={() => setPickerOpen(true)}
                    />
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* Bottom hint bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "8px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>
          <span><kbd style={{ fontFamily: "monospace", opacity: 0.7 }}>↑↓</kbd> Navigate</span>
          <span><kbd style={{ fontFamily: "monospace", opacity: 0.7 }}>↵</kbd> Insert</span>
          <span style={{ marginLeft: "auto" }}><kbd style={{ fontFamily: "monospace", opacity: 0.7 }}>Esc</kbd> Close</span>
        </div>
      </div>

      <MediaPickerModal
        open={pickerOpen}
        mediaKind="any"
        onClose={() => setPickerOpen(false)}
        onPickUrl={handleAssetPick}
      />
    </>
  );
}
