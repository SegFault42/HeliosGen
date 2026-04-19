"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useReactFlow, Node } from "@xyflow/react";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { edgeStyle } from "@/lib/edgeStyles";

const GROUP_PADDING = 24;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function getAbsoluteBounds(nodes: Node[]) {
  if (!nodes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const w = (n.measured?.width  ?? n.width  ?? 240);
    const h = (n.measured?.height ?? n.height ?? 160);
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function Btn({
  onClick, title, danger, children,
}: {
  onClick: () => void; title: string; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors duration-150 ${
        danger ? "text-[#777] hover:text-red-400 hover:bg-red-400/10"
               : "text-[#777] hover:text-white hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="w-px h-4 bg-white/[0.08] mx-0.5 shrink-0" />;
}

// Runs inside the ReactFlow provider
export default function SelectionToolbar() {
  const { flowToScreenPosition } = useReactFlow();
  const nodes      = useWorkflowStore((s) => s.nodes);
  const edges      = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const addNode    = useWorkflowStore((s) => s.addNode);
  const insertEdge = useWorkflowStore((s) => s.insertEdge);

  // Selected non-group nodes — hide entirely when a group is selected (group has its own toolbar)
  const anyGroupSelected = nodes.some((n) => n.selected && n.type === "groupNode");
  const selected = nodes.filter((n) => n.selected && n.type !== "groupNode");
  const visible  = selected.length >= 2 && !anyGroupSelected;

  // For smooth animation we track mounted
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (visible) {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    } else {
      setShown(false);
    }
  }, [visible]);

  // Compute screen position (top-center of selection bounding box)
  const bounds = getAbsoluteBounds(selected);
  const screenPos = bounds
    ? flowToScreenPosition({ x: bounds.x + bounds.width / 2, y: bounds.y })
    : null;

  // ── Group ───────────────────────────────────────────────────────────────────
  const handleGroup = useCallback(() => {
    const state = useWorkflowStore.getState();
    const sel   = state.nodes.filter((n) => n.selected && n.type !== "groupNode");
    if (sel.length === 0) return;

    const b = getAbsoluteBounds(sel);
    if (!b) return;

    const gx = b.x - GROUP_PADDING;
    const gy = b.y - GROUP_PADDING;
    const gw = b.width  + GROUP_PADDING * 2;
    const gh = b.height + GROUP_PADDING * 2;
    const groupId = uid();

    const memberIds = sel.map((n) => n.id);
    const groupCount = (state.nodeCounters["groupNode"] ?? 0) + 1;

    // Create group node — members stay at absolute positions (no parentId)
    const groupNode: Node<NodeData> = {
      id:       groupId,
      type:     "groupNode",
      position: { x: gx, y: gy },
      style:    { width: gw, height: gh, zIndex: -1 },
      data:     { label: `Group #${groupCount}`, color: "#3b82f6", locked: false, memberIds } as NodeData,
      selected: true,
      zIndex:   -1,
    };

    // Deselect member nodes; they keep absolute positions — no parentId
    const newNodes = state.nodes.map((n) => ({ ...n, selected: false }));

    // Insert group at front so it renders behind members
    const nodesWithGroup = [groupNode, ...newNodes];

    useWorkflowStore.setState((s) => ({
      nodes: nodesWithGroup,
      nodeCounters: { ...s.nodeCounters, groupNode: groupCount },
      spaces: s.spaces.map((sp) =>
        sp.id === s.activeSpaceId
          ? { ...sp, nodes: nodesWithGroup, nodeCounters: { ...s.nodeCounters, groupNode: groupCount } }
          : sp
      ),
    }));
  }, []);

  // ── Delete selection ────────────────────────────────────────────────────────
  const handleDelete = useCallback(() => {
    const state = useWorkflowStore.getState();
    const ids   = state.nodes.filter((n) => n.selected && n.type !== "groupNode").map((n) => n.id);
    onNodesChange(ids.map((id) => ({ type: "remove" as const, id })));
  }, [onNodesChange]);

  // ── Duplicate selection ─────────────────────────────────────────────────────
  const handleDuplicate = useCallback(() => {
    const state  = useWorkflowStore.getState();
    const sel    = state.nodes.filter((n) => n.selected && n.type !== "groupNode");
    const idMap: Record<string, string> = {};
    sel.forEach((n) => { idMap[n.id] = uid(); });

    // Deselect originals
    onNodesChange(sel.map((n) => ({ type: "select" as const, id: n.id, selected: false })));

    sel.forEach((n) => {
      addNode({
        ...n,
        id:       idMap[n.id],
        position: { x: n.position.x + 20, y: n.position.y + 20 },
        selected: true,
        data:     { ...n.data, status: "idle" as const, taskId: undefined, hasError: false },
      });
    });

    // Copy edges within the selection
    state.edges
      .filter((e) => idMap[e.source] && idMap[e.target])
      .forEach((e) => insertEdge({
        ...e,
        id:     uid(),
        source: idMap[e.source],
        target: idMap[e.target],
      }));
  }, [onNodesChange, addNode, insertEdge]);

  if (!screenPos) return null;

  return (
    <div
      style={{
        position: "fixed",
        left:     screenPos.x,
        top:      screenPos.y - 52,
        transform: `translateX(-50%) translateY(${shown ? "0px" : "6px"})`,
        opacity:   shown ? 1 : 0,
        transition: "opacity 180ms ease, transform 180ms ease",
        zIndex:    9998,
        pointerEvents: shown ? "auto" : "none",
      }}
    >
      <div
        className="flex items-center gap-0.5 px-1.5 py-1"
        style={{
          borderRadius: 999,
          background:   "rgba(16, 16, 16, 0.96)",
          backdropFilter: "blur(12px)",
          border:       "1px solid rgba(255,255,255,0.07)",
          boxShadow:    "0 4px 24px rgba(0,0,0,0.65), 0 1px 4px rgba(0,0,0,0.4)",
          whiteSpace:   "nowrap",
        }}
      >
        {/* Group */}
        <Btn onClick={handleGroup} title="Group selected nodes">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="8" height="8" rx="1.5" />
            <rect x="14" y="7" width="8" height="8" rx="1.5" />
            <path d="M6 7V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2" />
          </svg>
        </Btn>

        <Sep />

        {/* Duplicate */}
        <Btn onClick={handleDuplicate} title="Duplicate selection">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </Btn>

        {/* Delete */}
        <Btn onClick={handleDelete} title="Delete selection" danger>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4h6v2" />
          </svg>
        </Btn>
      </div>
    </div>
  );
}
