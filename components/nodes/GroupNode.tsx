"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { NodeProps, Node, useReactFlow, NodeResizeControl, NodeToolbar, Position } from "@xyflow/react";
import { useWorkflowStore, NodeData } from "@/lib/store";

export type GroupNodeType = Node<NodeData, "groupNode">;

const GROUP_COLORS = [
  "#3b82f6", // Blue (default)
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#ef4444", // Red
  "#f97316", // Orange
  "#eab308", // Yellow
  "#22c55e", // Green
  "#14b8a6", // Teal
  "#06b6d4", // Cyan
  "#9ca3af", // Gray
];

// ── Toolbar button ─────────────────────────────────────────────────────────────
function Btn({
  onClick, title, danger, active, children,
}: {
  onClick: () => void; title: string; danger?: boolean; active?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors duration-150 ${
        active   ? "text-white bg-white/15" :
        danger   ? "text-[#777] hover:text-red-400 hover:bg-red-400/10" :
                   "text-[#777] hover:text-white hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="w-px h-4 bg-white/[0.08] mx-0.5 shrink-0" />;
}

// ── Lock overlay shown on the group itself when locked ─────────────────────────
function LockBadge({ color }: { color: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center"
        style={{ background: `${color}20`, border: `1.5px solid ${color}50` }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function GroupNode({ id, data, selected }: NodeProps<GroupNodeType>) {
  const updateNodeData  = useWorkflowStore((s) => s.updateNodeData);
  const updateNodeSize  = useWorkflowStore((s) => s.updateNodeSize);
  const onNodesChange   = useWorkflowStore((s) => s.onNodesChange);
  const { fitBounds }   = useReactFlow();

  const color  = (data.color  as string)  ?? "#3b82f6";
  const locked = (data.locked as boolean) ?? false;
  const label  = data.label   as string;

  const cardRef = useRef<HTMLDivElement>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  // Keep store's style.width/height in sync as the group is resized.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      updateNodeSize(id, el.offsetWidth, el.offsetHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, updateNodeSize]);

  // Close color picker on click outside
  useEffect(() => {
    if (!colorPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Element)) {
        setColorPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [colorPickerOpen]);
  const toolbarVisible = !!selected;

  // ── Ungroup ──────────────────────────────────────────────────────────────
  const handleUngroup = useCallback(() => {
    const state = useWorkflowStore.getState();
    // Members already hold absolute positions — just remove the group node
    const newNodes = state.nodes.filter((n) => n.id !== id);
    useWorkflowStore.setState((s) => ({
      nodes: newNodes,
      spaces: s.spaces.map((sp) =>
        sp.id === s.activeSpaceId ? { ...sp, nodes: newNodes } : sp
      ),
    }));
  }, [id]);

  // ── Lock / Unlock ─────────────────────────────────────────────────────────
  const handleLock = useCallback(() => {
    updateNodeData(id, { locked: true });
    const state = useWorkflowStore.getState();
    const groupNode = state.nodes.find((n) => n.id === id);
    const memberIdSet = new Set((groupNode?.data?.memberIds as string[] | undefined) ?? []);
    const newNodes = state.nodes.map((n) =>
      memberIdSet.has(n.id) ? { ...n, data: { ...n.data, locked: true } } : n
    );
    useWorkflowStore.setState((s) => ({
      nodes: newNodes,
      spaces: s.spaces.map((sp) =>
        sp.id === s.activeSpaceId ? { ...sp, nodes: newNodes } : sp
      ),
    }));
  }, [id, updateNodeData]);

  const handleUnlock = useCallback(() => {
    updateNodeData(id, { locked: false });
    const state = useWorkflowStore.getState();
    const groupNode = state.nodes.find((n) => n.id === id);
    const memberIdSet = new Set((groupNode?.data?.memberIds as string[] | undefined) ?? []);
    const newNodes = state.nodes.map((n) =>
      memberIdSet.has(n.id) ? { ...n, data: { ...n.data, locked: false } } : n
    );
    useWorkflowStore.setState((s) => ({
      nodes: newNodes,
      spaces: s.spaces.map((sp) =>
        sp.id === s.activeSpaceId ? { ...sp, nodes: newNodes } : sp
      ),
    }));
  }, [id, updateNodeData]);

  // ── Focus view ────────────────────────────────────────────────────────────
  const handleFocus = useCallback(() => {
    const state = useWorkflowStore.getState();
    const groupNode = state.nodes.find((n) => n.id === id);
    if (!groupNode) return;
    const w = groupNode.measured?.width  ?? (groupNode.style?.width  as number | undefined) ?? 400;
    const h = groupNode.measured?.height ?? (groupNode.style?.height as number | undefined) ?? 300;
    fitBounds({ x: groupNode.position.x, y: groupNode.position.y, width: w, height: h }, { duration: 500, padding: 0.15 });
  }, [id, fitBounds]);

  const handleDelete = useCallback(() => {
    const state = useWorkflowStore.getState();
    const groupNode = state.nodes.find((n) => n.id === id);
    const memberIds = (groupNode?.data?.memberIds as string[] | undefined) ?? [];
    const allIds = new Set([id, ...memberIds]);
    onNodesChange([...allIds].map((nid) => ({ type: "remove" as const, id: nid })));
  }, [id, onNodesChange]);

  // ── Duplicate group + members ─────────────────────────────────────────────
  const handleDuplicate = useCallback(() => {
    const state = useWorkflowStore.getState();
    const groupNode = state.nodes.find((n) => n.id === id);
    if (!groupNode) return;

    const memberIds = (groupNode.data?.memberIds as string[] | undefined) ?? [];
    const members = state.nodes.filter((n) => memberIds.includes(n.id));

    const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const newGroupId = genId();
    const idMap: Record<string, string> = { [id]: newGroupId };
    members.forEach((m) => { idMap[m.id] = genId(); });

    const offset = 20;
    const newMemberIds = members.map((m) => idMap[m.id]);
    const groupCount = (state.nodeCounters["groupNode"] ?? 0) + 1;

    const newGroup = {
      ...groupNode,
      id: newGroupId,
      position: { x: groupNode.position.x + offset, y: groupNode.position.y + offset },
      selected: false,
      data: { ...groupNode.data, locked: false, memberIds: newMemberIds, label: `Group #${groupCount}` },
    };

    const newMembers = members.map((m) => ({
      ...m,
      id: idMap[m.id],
      position: { x: m.position.x + offset, y: m.position.y + offset },
      selected: false,
      data: { ...m.data, locked: false },
    }));

    const newEdges = state.edges
      .filter((e) => idMap[e.source] && idMap[e.target])
      .map((e) => ({ ...e, id: genId(), source: idMap[e.source], target: idMap[e.target] }));

    const nodes = [...state.nodes, newGroup, ...newMembers];
    const edges = [...state.edges, ...newEdges];
    const nodeCounters = { ...state.nodeCounters, groupNode: groupCount };

    useWorkflowStore.setState((s) => ({
      nodes,
      edges,
      nodeCounters,
      spaces: s.spaces.map((sp) =>
        sp.id === s.activeSpaceId
          ? { ...sp, nodes, edges, nodeCounters, updatedAt: Date.now() }
          : sp
      ),
    }));
  }, [id]);

  type ResizePos = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top" | "right" | "bottom" | "left";

  // Corner and edge resize handle definitions (colour-matched to the group)
  const resizeHandles: Array<{ position: ResizePos; style: React.CSSProperties }> = [
    // Corners — bracket marks
    { position: "top-left",     style: { width: 10, height: 10, background: "transparent", border: "none", borderTop: `2px solid ${color}`, borderLeft:  `2px solid ${color}`, borderTopLeftRadius:     3, top:    -6, left:   -6, zIndex: 100 } },
    { position: "top-right",    style: { width: 10, height: 10, background: "transparent", border: "none", borderTop: `2px solid ${color}`, borderRight: `2px solid ${color}`, borderTopRightRadius:    3, top:    -6, right:  -6, zIndex: 100 } },
    { position: "bottom-left",  style: { width: 10, height: 10, background: "transparent", border: "none", borderBottom: `2px solid ${color}`, borderLeft:  `2px solid ${color}`, borderBottomLeftRadius:  3, bottom: -6, left:   -6, zIndex: 100 } },
    { position: "bottom-right", style: { width: 10, height: 10, background: "transparent", border: "none", borderBottom: `2px solid ${color}`, borderRight: `2px solid ${color}`, borderBottomRightRadius: 3, bottom: -6, right:  -6, zIndex: 100 } },
    // Edges — small pill handles centred on each side
    { position: "top",    style: { width: 22, height: 4,  border: "none", background: color, borderRadius: 2, opacity: 0.6, top:    -5, left: "50%", transform: "translateX(-50%)", zIndex: 100 } },
    { position: "right",  style: { width: 4,  height: 22, border: "none", background: color, borderRadius: 2, opacity: 0.6, right:  -5, top:  "50%", transform: "translateY(-50%)", zIndex: 100 } },
    { position: "bottom", style: { width: 22, height: 4,  border: "none", background: color, borderRadius: 2, opacity: 0.6, bottom: -5, left: "50%", transform: "translateX(-50%)", zIndex: 100 } },
    { position: "left",   style: { width: 4,  height: 22, border: "none", background: color, borderRadius: 2, opacity: 0.6, left:   -5, top:  "50%", transform: "translateY(-50%)", zIndex: 100 } },
  ];

  return (
    <div
      ref={cardRef}
      className="relative w-full h-full rounded-[10px]"
      style={{
        border: `2px solid ${color}`,
        background: `${color}0d`,
        opacity: locked ? 0.85 : 1,
      }}
    >
      {/* Resize handles — only when selected and unlocked */}
      {selected && !locked && resizeHandles.map(({ position, style }) => (
        <NodeResizeControl
          key={position}
          position={position}
          minWidth={200}
          minHeight={150}
          style={style}
        />
      ))}
      {/* Label — outside top-left */}
      <span
        style={{
          position: "absolute",
          top: -22,
          left: 0,
          fontSize: 11,
          color,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          userSelect: "none",
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>

      {locked && <LockBadge color={color} />}

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <NodeToolbar isVisible={toolbarVisible} position={Position.Top} offset={16}>
      <div
        className="flex items-center gap-0.5 px-1.5 py-1 node-action-bar-enter"
        style={{
          borderRadius: 999,
          background: "rgba(16, 16, 16, 0.96)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.65), 0 1px 4px rgba(0,0,0,0.4)",
          whiteSpace: "nowrap",
        }}
      >
        {locked ? (
          /* Locked: only show unlock */
          <Btn onClick={handleUnlock} title="Unlock group">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </svg>
          </Btn>
        ) : (
          <>
            {/* Focus / center view */}
            <Btn onClick={handleFocus} title="Center view on group">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="7" />
                <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
                <line x1="12" y1="2" x2="12" y2="5" />
                <line x1="12" y1="19" x2="12" y2="22" />
                <line x1="2" y1="12" x2="5" y2="12" />
                <line x1="19" y1="12" x2="22" y2="12" />
              </svg>
            </Btn>

            {/* Ungroup */}
            <Btn onClick={handleUngroup} title="Ungroup">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="8" height="8" rx="1.5" />
                <rect x="14" y="7" width="8" height="8" rx="1.5" />
                <path d="M6 7V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v2" />
              </svg>
            </Btn>

            <Sep />

            {/* Color picker trigger */}
            <div className="relative">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setColorPickerOpen((o) => !o); }}
                title="Change color"
                className="w-7 h-7 flex items-center justify-center rounded-full transition-colors duration-150 hover:bg-white/10"
              >
                <span className="w-3.5 h-3.5 rounded-full border border-white/20" style={{ background: color }} />
              </button>

              {colorPickerOpen && (
                <div
                  ref={colorPickerRef}
                  className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 flex flex-row gap-1.5 p-2"
                  style={{
                    borderRadius: 999,
                    background: "rgba(16,16,16,0.97)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                    whiteSpace: "nowrap",
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {GROUP_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateNodeData(id, { color: c });
                        setColorPickerOpen(false);
                      }}
                      className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 shrink-0"
                      style={{
                        background: c,
                        borderColor: color === c ? "white" : "transparent",
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Lock */}
            <Btn onClick={handleLock} title="Lock group">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </Btn>

            <Sep />

            {/* Duplicate */}
            <Btn onClick={handleDuplicate} title="Duplicate group">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </Btn>

            {/* Delete */}
            <Btn onClick={handleDelete} title="Delete group and nodes" danger>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4h6v2" />
              </svg>
            </Btn>
          </>
        )}
      </div>
      </NodeToolbar>
    </div>
  );
}
