"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeProps, Node, useReactFlow, NodeResizeControl, NodeToolbar, Position } from "@xyflow/react";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { useReadOnly } from "@/lib/readOnlyContext";
import { arrangeNodes } from "@/lib/arrangeNodes";
import { usePipelineRunner } from "@/lib/usePipelineRunner";
import { makeZip } from "@/lib/makeZip";
import { VIDEO_MODELS } from "@/lib/modelConfig";

export type GroupNodeType = Node<NodeData, "groupNode">;

function collectAncestors(startId: string, allNodes: Node<NodeData>[], edges: { source: string; target: string }[]): string[] {
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const e of edges) {
      if (e.target === current && allNodes.some(n => n.id === e.source)) {
        queue.push(e.source);
      }
    }
  }
  visited.delete(startId);
  return [...visited];
}

const GROUP_COLORS = [
  "#3b82f6", // Blue (default)
  "#0D9488", // Blue-600
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
  onClick, title, danger, active, label, children,
}: {
  onClick: () => void; title: string; danger?: boolean; active?: boolean; label?: string; children: React.ReactNode;
}) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className={`h-7 flex items-center justify-center rounded-full transition-colors duration-150 ${
        label ? "px-2.5 gap-1.5" : "w-7"
      } ${
        active ? "text-white bg-white/15" :
        danger ? "text-white hover:text-red-400 hover:bg-red-400/10" :
                 "text-white hover:bg-white/10"
      }`}
    >
      {children}
      {label && <span className="text-[11px] font-medium leading-none tracking-wide">{label}</span>}
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

// ── Scrolling label (overflows are revealed on hover) ─────────────────────────
function ScrollLabel({ text, color }: { text: string; color?: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);

  const startScroll = () => {
    const c = containerRef.current;
    const t = innerRef.current;
    if (!c || !t) return;
    const overflow = t.scrollWidth - c.clientWidth;
    if (overflow <= 2) return;
    t.style.transition = `transform ${Math.max(800, overflow * 20)}ms linear 350ms`;
    t.style.transform = `translateX(-${overflow}px)`;
  };

  const stopScroll = () => {
    const t = innerRef.current;
    if (!t) return;
    t.style.transition = "transform 180ms ease";
    t.style.transform = "translateX(0)";
  };

  return (
    <span
      ref={containerRef}
      style={{ overflow: "hidden", display: "inline-block", verticalAlign: "middle", maxWidth: 88 }}
      onMouseEnter={startScroll}
      onMouseLeave={stopScroll}
    >
      <span ref={innerRef} style={{ display: "inline-block", whiteSpace: "nowrap", color }}>
        {text}
      </span>
    </span>
  );
}

// ── Inline warning icon with tooltip ──────────────────────────────────────────
function InlineWarning({ messages }: { messages: string[] }) {
  const [visible, setVisible] = React.useState(false);
  if (messages.length === 0) return null;
  return (
    <span
      style={{ position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0 }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{ display: "block", cursor: "default" }}>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="#ef4444" />
        <line x1="12" y1="9" x2="12" y2="13" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <line x1="12" y1="17" x2="12.01" y2="17" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {visible && (
        <span
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            right: 0,
            background: "#1A1A1A",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 6,
            padding: "4px 8px",
            whiteSpace: "nowrap",
            fontSize: 10,
            color: "#CCCCCC",
            boxShadow: "0 4px 14px rgba(0,0,0,0.55)",
            zIndex: 200,
            pointerEvents: "none",
          }}
        >
          {messages.map((msg, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ color: "#ef4444", fontSize: 7 }}>●</span>
              {msg}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function GroupNode({ id, data, selected }: NodeProps<GroupNodeType>) {
  const readOnly = useReadOnly();
  const updateNodeData  = useWorkflowStore((s) => s.updateNodeData);
  const updateNodeSize  = useWorkflowStore((s) => s.updateNodeSize);
  const onNodesChange   = useWorkflowStore((s) => s.onNodesChange);
  const { fitBounds }   = useReactFlow();

  const color  = (data.color  as string)  ?? "#3b82f6";
  const locked = (data.locked as boolean) ?? false;
  const label  = data.label   as string;

  const memberIds = (data.memberIds as string[] | undefined) ?? [];
  const { run: runPipeline, isRunning: pipelineRunning, genNodeCount } = usePipelineRunner(memberIds);
  const [isDownloading, setIsDownloading] = useState(false);
  const [runDropdownOpen, setRunDropdownOpen] = useState(false);
  const runDropdownRef = useRef<HTMLDivElement>(null);

  const allNodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);

  const jobs = useMemo(() => {
    const genNodes = allNodes.filter(
      (n) => memberIds.includes(n.id) &&
        (n.type === "generateNode" || n.type === "videoGeneratorNode")
    );
    return genNodes.map((genNode) => {
      const incomingEdges = edges.filter((e) => e.target === genNode.id);
      const sourcesById = new Map(
        incomingEdges
          .map((e) => allNodes.find((n) => n.id === e.source))
          .filter((n): n is Node<NodeData> => !!n)
          .map((n) => [n.id, n])
      );
      const allSources = [...sourcesById.values()];

      // Prefer text-type sources (same logic as resolveInputs)
      const textSources = allSources.filter(
        (n) => n.type === "promptNode" || n.type === "assistantNode"
      );
      const sources = textSources.length > 0 ? textSources : allSources;
      const sourceLabel =
        sources.length > 0
          ? sources.map((n) => (n.data.label as string) || n.type).join(", ")
          : "—";

      // Compute missing required inputs
      const missingInputs: string[] = [];
      const promptConnected = incomingEdges.some((e) => e.targetHandle === "prompt");
      if (genNode.type === "generateNode") {
        if (!promptConnected) missingInputs.push("A text node is required");
      } else {
        const videoModelId = (genNode.data.videoModel as string) ?? "kling-3.0";
        const cfg = VIDEO_MODELS.find((m) => m.id === videoModelId) ?? VIDEO_MODELS[0];
        if (!cfg.promptOptional && !promptConnected) missingInputs.push("A text node is required");
      }

      return {
        genNodeId: genNode.id,
        isVideo: genNode.type === "videoGeneratorNode",
        genLabel: (genNode.data.label as string) || (genNode.type === "videoGeneratorNode" ? "Video gen" : "Image gen"),
        sourceLabel,
        missingInputs,
        allAncestorIds: collectAncestors(genNode.id, allNodes, edges),
      };
    });
  }, [allNodes, edges, memberIds]);

  const readyJobCount = useMemo(() => jobs.filter((j) => j.missingInputs.length === 0).length, [jobs]);

  const handleDownload = useCallback(async () => {
    if (isDownloading) return;
    const { nodes } = useWorkflowStore.getState();
    const members = nodes.filter((n) => memberIds.includes(n.id));

    // Collect all output URLs from member nodes
    const assets: { url: string; name: string }[] = [];
    for (const node of members) {
      const nodeLabel = (node.data.label as string | undefined) ?? node.id;
      const ext = node.type === "videoGeneratorNode" ? "mp4" : "png";

      // Prefer the full generations history, fall back to single URL
      const gens = node.data.generations as (string | null | { error: string })[] | undefined;
      if (gens && gens.length > 0) {
        gens.forEach((entry, i) => {
          if (typeof entry === "string") {
            const suffix = gens.length > 1 ? `-${i + 1}` : "";
            assets.push({ url: entry, name: `${nodeLabel}${suffix}.${ext}` });
          }
        });
      } else {
        const url = (node.data.imageUrl ?? node.data.videoUrl) as string | undefined;
        if (url) assets.push({ url, name: `${nodeLabel}.${ext}` });
      }
    }

    if (assets.length === 0) return;
    setIsDownloading(true);
    try {
      const entries = await Promise.all(
        assets.map(async ({ url, name }) => {
          const resp = await fetch(`/api/download?url=${encodeURIComponent(url)}&filename=${name}`);
          const buf = await resp.arrayBuffer();
          return { name, data: new Uint8Array(buf) };
        })
      );
      const blob = makeZip(entries);
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = `${label || "group"}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, memberIds, label]);

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

  const flashNode = useCallback((nodeId: string, anim = "node-identify-blink") => {
    const styleId = `identify-flash-${nodeId}`;
    document.getElementById(styleId)?.remove();
    requestAnimationFrame(() => {
      const styleEl = document.createElement("style");
      styleEl.id = styleId;
      styleEl.textContent = `.react-flow__node[data-id="${CSS.escape(nodeId)}"] .node-card { animation: ${anim} 1.3s ease 1 forwards; }`;
      document.head.appendChild(styleEl);
      setTimeout(() => document.getElementById(styleId)?.remove(), 1400);
    });
  }, []);

  // Close run dropdown on click outside
  useEffect(() => {
    if (!runDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (runDropdownRef.current && !runDropdownRef.current.contains(e.target as Element)) {
        setRunDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [runDropdownOpen]);
  const toolbarVisible = !!selected && !readOnly;

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

  // ── Arrange members ───────────────────────────────────────────────────────
  const handleArrange = useCallback(() => {
    const state = useWorkflowStore.getState();
    const memberIds = (state.nodes.find((n) => n.id === id)?.data?.memberIds as string[] | undefined) ?? [];
    arrangeNodes(memberIds, { groupId: id });
  }, [id]);

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
          zIndex: 10,
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
            <Btn onClick={handleFocus} title="Center view on group" label="Center">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="7" />
                <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
                <line x1="12" y1="2" x2="12" y2="5" />
                <line x1="12" y1="19" x2="12" y2="22" />
                <line x1="2" y1="12" x2="5" y2="12" />
                <line x1="19" y1="12" x2="22" y2="12" />
              </svg>
            </Btn>

            {/* Arrange members */}
            <Btn onClick={handleArrange} title="Auto-arrange nodes in group" label="Arrange">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </Btn>

            {/* Ungroup */}
            <Btn onClick={handleUngroup} title="Ungroup" label="Ungroup">
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

            <Sep />

            {/* Download all outputs */}
            <Btn onClick={handleDownload} title="Download all outputs as ZIP">
              {isDownloading ? (
                <svg width="13" height="13" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite" }}>
                  <circle cx="5" cy="5" r="4" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
                  <path d="M5 1 A4 4 0 0 1 9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              )}
            </Btn>

            {/* Run pipeline — split button with jobs dropdown */}
            <div className="relative" ref={runDropdownRef}>
              <div
                className="h-7 flex items-center rounded-full"
                style={{
                  border: `1px solid ${pipelineRunning ? "rgba(45,212,191,0.5)" : "rgba(45,212,191,0.25)"}`,
                  background: pipelineRunning ? "rgba(45,212,191,0.18)" : "rgba(45,212,191,0.07)",
                  color: readyJobCount === 0 ? "rgba(255,255,255,0.25)" : "rgba(45,212,191,0.9)",
                  opacity: readyJobCount === 0 ? 0.45 : 1,
                }}
              >
                {/* Run part */}
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); runPipeline(); }}
                  title={readyJobCount === 0 ? "No ready generation nodes in group" : `Run ${readyJobCount} generation node${readyJobCount === 1 ? "" : "s"}`}
                  disabled={readyJobCount === 0 || pipelineRunning}
                  className="flex items-center gap-1.5 pl-2.5 pr-2 h-full"
                  style={{ cursor: readyJobCount === 0 || pipelineRunning ? "not-allowed" : "pointer" }}
                >
                  {pipelineRunning ? (
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}>
                      <circle cx="5" cy="5" r="4" stroke="rgba(45,212,191,0.3)" strokeWidth="1.5" />
                      <path d="M5 1 A4 4 0 0 1 9 5" stroke="rgba(45,212,191,0.9)" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" style={{ flexShrink: 0 }}>
                      <path d="M2 1.5 L9 5 L2 8.5 Z" />
                    </svg>
                  )}
                  <span className="text-[11px] font-medium leading-none tracking-wide">Run</span>
                  {readyJobCount > 0 && (
                    <span
                      className="text-[10px] font-semibold leading-none rounded-full px-1.5 py-0.5"
                      style={{ background: "rgba(45,212,191,0.2)" }}
                    >
                      {readyJobCount}
                    </span>
                  )}
                </button>

                {/* Divider */}
                <span
                  className="shrink-0"
                  style={{
                    width: 1, height: 14,
                    background: pipelineRunning ? "rgba(45,212,191,0.4)" : "rgba(45,212,191,0.2)",
                  }}
                />

                {/* Chevron */}
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (jobs.length > 0) setRunDropdownOpen((o) => !o);
                  }}
                  disabled={genNodeCount === 0 || pipelineRunning}
                  title="Show generate jobs"
                  className="flex items-center justify-center px-1.5 h-full"
                  style={{ cursor: genNodeCount === 0 ? "not-allowed" : "pointer" }}
                >
                  <svg
                    width="10" height="10" viewBox="0 0 10 10" fill="none"
                    style={{
                      transform: runDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 150ms ease",
                    }}
                  >
                    <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {/* Jobs dropdown */}
              {runDropdownOpen && jobs.length > 0 && (
                <div
                  className="absolute bottom-full mb-2 right-0 node-action-bar-enter"
                  style={{
                    borderRadius: 10,
                    background: "rgba(14, 14, 14, 0.97)",
                    backdropFilter: "blur(12px)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    boxShadow: "0 4px 24px rgba(0,0,0,0.65), 0 1px 4px rgba(0,0,0,0.4)",
                    minWidth: 200,
                    overflow: "hidden",
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="px-3 py-1.5 border-b border-white/[0.06]">
                    <span className="text-[10px] font-medium text-white/30 uppercase tracking-widest">
                      Generate jobs
                    </span>
                  </div>
                  {jobs.map((job, i) => (
                    <div
                      key={job.genNodeId}
                      className="flex items-center gap-2 px-3 py-2 text-[11px] transition-colors duration-100"
                      style={{
                        borderBottom: i < jobs.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                        cursor: "pointer",
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        flashNode(job.genNodeId);
                        job.allAncestorIds.forEach((aid) => flashNode(aid, "node-identify-input-blink"));
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                    >
                      {/* Source icon */}
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                      <ScrollLabel text={job.sourceLabel} color="rgba(255,255,255,0.5)" />

                      {/* Arrow */}
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                        <path d="M2 6H10M10 6L7 3M10 6L7 9" stroke="rgba(255,255,255,0.2)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>

                      {/* Target icon */}
                      {job.isVideo ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(45,212,191,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <polygon points="23 7 16 12 23 17 23 7" />
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                        </svg>
                      ) : (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(45,212,191,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                      )}
                      <ScrollLabel text={job.genLabel} color="rgba(45,212,191,0.85)" />
                      {job.missingInputs.length > 0 && (
                        <span style={{ marginLeft: "auto" }}>
                          <InlineWarning messages={job.missingInputs} />
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      </NodeToolbar>
    </div>
  );
}
