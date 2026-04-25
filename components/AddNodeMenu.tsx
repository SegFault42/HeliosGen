"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useWorkflowStore } from "@/lib/store";
import { NODES, NODE_SIZE, FALLBACK_SIZE, NODE_META } from "@/lib/nodeTypes";

/* Width of the left toolbar + gap so node lands just to its right */
const TOOLBAR_OFFSET_PX = 80;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ─── Sections shown in the menu ────────────────────────────────────────────── */

const SECTIONS: Array<{
  id: string;
  label: string;
  nodeTypes: string[];
}> = [
  {
    id: "generators",
    label: "GENERATORS",
    nodeTypes: ["generateNode", "videoGeneratorNode", "assistantNode"],
  },
  {
    id: "resources",
    label: "INPUTS",
    nodeTypes: ["promptNode", "imageInputNode", "videoInputNode"],
  },
];

/* ─── Props ─────────────────────────────────────────────────────────────────── */

interface AddNodeMenuProps {
  /** Screen-space anchor — the + button's bounding rect */
  anchorRect: DOMRect;
  onClose: () => void;
}

/* ─── Component ─────────────────────────────────────────────────────────────── */

export default function AddNodeMenu({ anchorRect, onClose }: AddNodeMenuProps) {
  const { screenToFlowPosition, setCenter } = useReactFlow();
  const addNode = useWorkflowStore((s) => s.addNode);

  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState<string | null>(null);

  /* Focus search on mount */
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  /* Close on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [onClose]);

  /* Close on Escape */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  /* Filter nodes by search query */
  const q = query.trim().toLowerCase();
  const allNodes = NODES;
  const filtered = q
    ? allNodes.filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.description.toLowerCase().includes(q)
      )
    : null;

  /* Returns true if two axis-aligned rects (with padding) overlap */
  function rectsOverlap(
    ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number,
    pad = 0,
  ) {
    return (
      ax - pad < bx + bw &&
      ax + aw + pad > bx &&
      ay - pad < by + bh &&
      ay + ah + pad > by
    );
  }

  /* Add a node next to the nearest existing node, with overlap avoidance.
   * Falls back to the toolbar edge when the canvas is empty.              */
  const addNextToToolbar = useCallback(
    (type: string) => {
      const container = document.querySelector(".react-flow") as HTMLElement | null;
      const rect = container?.getBoundingClientRect();

      const size = NODE_SIZE[type] ?? FALLBACK_SIZE;
      const GAP = 40; // flow-space gap between nodes

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
        // ── Empty canvas: place next to toolbar ────────────────────────────
        const screenX = (rect?.left ?? 0) + TOOLBAR_OFFSET_PX;
        const screenY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
        const flowPos = screenToFlowPosition({ x: screenX, y: screenY });
        nodeX = flowPos.x;
        nodeY = flowPos.y - size.h / 2;
      } else {
        // ── Find the node nearest to the current viewport centre ───────────
        const vpCentreScreen = {
          x: rect ? rect.left + rect.width  / 2 : window.innerWidth  / 2,
          y: rect ? rect.top  + rect.height / 2 : window.innerHeight / 2,
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

        // ── Start candidate: right side of nearest node, vertically aligned ─
        let candidateX = nearest.position.x + nearestSize.w + GAP;
        const candidateY = nearest.position.y + nearestSize.h / 2 - size.h / 2;

        // ── Slide right until no overlap with any existing node ────────────
        const MAX_ATTEMPTS = 40;
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
          const overlapping = nodesNow.some((n) => {
            const s = NODE_SIZE[n.type ?? ""] ?? FALLBACK_SIZE;
            return rectsOverlap(
              candidateX, candidateY, size.w, size.h,
              n.position.x, n.position.y, s.w, s.h,
              GAP / 2,
            );
          });
          if (!overlapping) break;
          candidateX += size.w + GAP;
        }

        nodeX = candidateX;
        nodeY = candidateY;
      }

      addNode({
        id: `${type}-${uid()}`,
        type,
        position: { x: nodeX, y: nodeY },
        style:
          type === "imageInputNode" || type === "videoInputNode"
            ? { width: size.w }
            : { width: size.w, height: size.h },
        data: { label, status: "idle" },
      });

      // ── Fly viewport: centre on the new node at ~25 % viewport width zoom ─
      const vpW = rect?.width ?? window.innerWidth;
      const targetZoom = (vpW * 0.25) / size.w;
      const nodeCentreX = nodeX + size.w / 2;
      const nodeCentreY = nodeY + size.h / 2;
      const toolbarOffsetInFlow = TOOLBAR_OFFSET_PX / targetZoom;
      setCenter(nodeCentreX + toolbarOffsetInFlow / 2, nodeCentreY, {
        zoom: targetZoom,
        duration: 500,
      });

      onClose();
    },
    [addNode, screenToFlowPosition, setCenter, onClose]
  );

  /* Menu position — open to the right of the anchor button */
  const MENU_W = 280;
  const MENU_MAX_H = 460;
  const left = anchorRect.right + 10;
  const topRaw = anchorRect.top + anchorRect.height / 2 - MENU_MAX_H / 2;
  const top = Math.max(12, Math.min(topRaw, window.innerHeight - MENU_MAX_H - 12));

  /* Render a single node row */
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
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          width: "100%",
          padding: "9px 14px",
          background: isHovered ? "rgba(255,255,255,0.05)" : "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          transition: "background 120ms ease",
          borderRadius: "8px",
        }}
      >
        {/* Icon badge */}
        <span
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "34px",
            height: "34px",
            borderRadius: "9px",
            background: meta?.bg ?? "rgba(255,255,255,0.06)",
            color: meta?.accent ?? "#aaa",
            border: `1px solid ${meta?.accent ?? "#333"}28`,
          }}
        >
          {meta?.bigIcon ?? node.icon}
        </span>

        {/* Label + description */}
        <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
          <span
            style={{
              fontSize: "13px",
              fontWeight: 500,
              color: isHovered ? "#fff" : "rgba(255,255,255,0.82)",
              lineHeight: 1.2,
              transition: "color 120ms ease",
            }}
          >
            {node.label}
          </span>
          <span
            style={{
              fontSize: "11px",
              color: "rgba(255,255,255,0.3)",
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {node.description}
          </span>
        </span>

        {/* Enter hint on hover */}
        {isHovered && (
          <span
            style={{
              marginLeft: "auto",
              flexShrink: 0,
              fontSize: "10px",
              color: "rgba(255,255,255,0.25)",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "4px",
              padding: "2px 5px",
              fontFamily: "monospace",
            }}
          >
            ↵
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      id="add-node-menu"
      ref={menuRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left,
        top,
        width: MENU_W,
        maxHeight: MENU_MAX_H,
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        background: "rgba(12, 13, 15, 0.97)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "14px",
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

      {/* ── Search bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={searchRef}
          id="add-node-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes…"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "rgba(255,255,255,0.82)",
            fontSize: "13px",
            caretColor: "#77E544",
          }}
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "rgba(255,255,255,0.3)",
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* ── Node list ── */}
      <div style={{ overflowY: "auto", flex: 1, padding: "8px" }}>
        {filtered ? (
          /* Search results — flat list */
          filtered.length === 0 ? (
            <p
              style={{
                fontSize: "12px",
                color: "rgba(255,255,255,0.25)",
                textAlign: "center",
                padding: "24px 0",
              }}
            >
              No nodes match &ldquo;{query}&rdquo;
            </p>
          ) : (
            filtered.map((n) => <NodeRow key={n.type} nodeType={n.type} />)

          )
        ) : (
          /* Grouped sections */
          SECTIONS.map((section) => (
            <div key={section.id} style={{ marginBottom: "4px" }}>
              <p
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  color: "rgba(255,255,255,0.25)",
                  padding: "8px 14px 4px",
                  margin: 0,
                }}
              >
                {section.label}
              </p>
              {section.nodeTypes.map((t) => (
                <NodeRow key={t} nodeType={t} />
              ))}
            </div>
          ))
        )}
      </div>

      {/* ── Bottom hint bar ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "8px 14px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: "11px",
          color: "rgba(255,255,255,0.25)",
        }}
      >
        <span>
          <kbd style={{ fontFamily: "monospace", opacity: 0.7 }}>↑↓</kbd>{" "}
          Navigate
        </span>
        <span>
          <kbd style={{ fontFamily: "monospace", opacity: 0.7 }}>↵</kbd>{" "}
          Insert
        </span>
        <span style={{ marginLeft: "auto" }}>
          <kbd style={{ fontFamily: "monospace", opacity: 0.7 }}>Esc</kbd>{" "}
          Close
        </span>
      </div>
    </div>
  );
}
