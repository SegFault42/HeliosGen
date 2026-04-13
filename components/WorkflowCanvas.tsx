"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  Panel,
  Node,
  NodeChange,
  Connection,
  Edge,
  Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useWorkflowStore, NodeData } from "@/lib/store";
import CuttableEdge from "@/components/edges/CuttableEdge";
import { topoSort, resolveInputs } from "@/lib/executor";
import { NODE_SIZE, FALLBACK_SIZE } from "@/lib/nodeTypes";
import { edgeStyle } from "@/lib/edgeStyles";
import { createClient } from "@/lib/supabase/client";

import PromptNode          from "./nodes/PromptNode";
import ImageInputNode      from "./nodes/ImageInputNode";
import GenerateNode        from "./nodes/GenerateNode";
import VideoGeneratorNode  from "./nodes/VideoGeneratorNode";
import NodePickerMenu, { DropState } from "./NodePickerMenu";
import AuthButton from "./AuthButton";

async function getAccessToken(): Promise<string | undefined> {
  try {
    const { data } = await createClient().auth.getSession();
    return data.session?.access_token;
  } catch {
    return undefined;
  }
}

function authHeaders(token: string | undefined): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

const nodeTypes = {
  promptNode:          PromptNode,
  imageInputNode:      ImageInputNode,
  generateNode:        GenerateNode,
  videoGeneratorNode:  VideoGeneratorNode,
};

const edgeTypes = {
  default: CuttableEdge,
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export default function WorkflowCanvas() {
  const {
    nodes, edges,
    onNodesChange: _onNodesChange, onEdgesChange, onConnect,
    addNode, insertEdge,
    updateNodeData, isRunning, setIsRunning, debugMode, toggleDebug,
  } = useWorkflowStore();

  // Intercept node deletions: when a generateNode is deleted, also delete
  // its paired locked prompt (deletable:false nodes are skipped by React Flow
  // normally, but we want them gone when their generator is removed).
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const removedIds = changes
      .filter((c): c is Extract<NodeChange, { type: "remove" }> => c.type === "remove")
      .map((c) => c.id);

    const removedGenIds = removedIds.filter(
      (id) => nodes.find((n) => n.id === id)?.type === "generateNode"
    );

    // When a generateNode is removed, also remove its locked paired prompt node
    const pairedPromptIds = edges
      .filter(
        (e) =>
          removedGenIds.includes(e.target) &&
          e.targetHandle === "prompt" &&
          e.deletable === false
      )
      .map((e) => e.source)
      // Don't add if already in the changes list
      .filter((id) => !removedIds.includes(id));

    const extra: Extract<NodeChange, { type: "remove" }>[] =
      pairedPromptIds.map((id) => ({ type: "remove", id }));

    _onNodesChange(extra.length > 0 ? [...changes, ...extra] : changes);
  }, [_onNodesChange, nodes, edges]);

  // ── Sidebar drag-and-drop ────────────────────────────────────────────────────
  const wrapperRef  = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/reactflow-node");
    if (!type) return;

    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;

    const { x: panX, y: panY, zoom } = viewportRef.current;
    const position = {
      x: (e.clientX - rect.left - panX) / zoom,
      y: (e.clientY - rect.top  - panY) / zoom,
    };

    if (type === "generateNode") {
      const genId    = `gen-${uid()}`;
      const promptId = `prompt-${uid()}`;

      addNode({
        id: promptId, type: "promptNode",
        position: { x: position.x - 320, y: position.y + 20 },
        deletable: false,
        style: { width: NODE_SIZE.promptNode.w, height: NODE_SIZE.promptNode.h },
        data: { label: "promptNode" },
      });
      addNode({
        id: genId, type: "generateNode",
        position,
        style: { width: NODE_SIZE.generateNode.w, height: NODE_SIZE.generateNode.h },
        data: { label: "generateNode", status: "idle", model: "nano-banana-2", aspectRatio: "1:1" },
      });
      insertEdge({
        id: `edge-${promptId}-${genId}`,
        source: promptId, target: genId, targetHandle: "prompt",
        deletable: false, reconnectable: false, animated: false,
        style: edgeStyle("prompt"),
      });
      return;
    }

    const size = NODE_SIZE[type] ?? FALLBACK_SIZE;
    addNode({
      id: `${type}-${uid()}`,
      type,
      position,
      style: type === "imageInputNode" ? { width: size.w } : { width: size.w, height: size.h },
      data: { label: type, status: "idle" },
    });
  }, [addNode, insertEdge]);

  // ── Copy / Paste ─────────────────────────────────────────────────────────────
  const clipboardRef = useRef<{ nodes: Node<NodeData>[]; edges: Edge[] } | null>(null);
  const mousePosRef  = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleCopy = useCallback(() => {
    const selected = nodes.filter((n) => n.selected);
    if (selected.length === 0) return;
    const selectedIds = new Set(selected.map((n) => n.id));

    // For every selected generateNode, pull in its locked paired prompt node too
    for (const n of selected) {
      if (n.type !== "generateNode") continue;
      const pairedEdge = edges.find(
        (e) => e.target === n.id && e.targetHandle === "prompt" && e.deletable === false
      );
      if (pairedEdge && !selectedIds.has(pairedEdge.source)) {
        selectedIds.add(pairedEdge.source);
      }
    }

    const allNodes = nodes.filter((n) => selectedIds.has(n.id));
    const selectedEdges = edges.filter(
      (e) => selectedIds.has(e.source) && selectedIds.has(e.target)
    );
    clipboardRef.current = { nodes: allNodes, edges: selectedEdges };
  }, [nodes, edges]);

  const handlePaste = useCallback(() => {
    if (!clipboardRef.current) return;
    const { nodes: copied, edges: copiedEdges } = clipboardRef.current;

    // Convert current mouse screen position → canvas position
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { x: panX, y: panY, zoom } = viewportRef.current;
    const cursorCanvas = {
      x: (mousePosRef.current.x - rect.left - panX) / zoom,
      y: (mousePosRef.current.y - rect.top  - panY) / zoom,
    };

    // Find the bounding-box center of the copied group
    const xs = copied.map((n) => n.position.x);
    const ys = copied.map((n) => n.position.y);
    const groupCenter = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };

    const idMap = new Map<string, string>();
    for (const n of copied) {
      const newId = `${n.type}-${uid()}`;
      idMap.set(n.id, newId);
      addNode({
        ...n,
        id: newId,
        selected: false,
        position: {
          x: cursorCanvas.x + (n.position.x - groupCenter.x),
          y: cursorCanvas.y + (n.position.y - groupCenter.y),
        },
        data: { ...n.data, status: n.data.status === "running" ? "idle" : n.data.status },
      });
    }

    for (const e of copiedEdges) {
      const src = idMap.get(e.source);
      const tgt = idMap.get(e.target);
      if (!src || !tgt) continue;
      insertEdge({ ...e, id: `edge-${uid()}`, source: src, target: tgt });
    }
  }, [addNode, insertEdge]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in an input / textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "c") { e.preventDefault(); handleCopy(); }
      if (mod && e.key === "v") { e.preventDefault(); handlePaste(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleCopy, handlePaste]);

  // ── Edge drop → node picker ──────────────────────────────────────────────────
  const [dropState, setDropState] = useState<DropState | null>(null);
  const [log, setLog] = useState<{ text: string; ok: boolean }[]>([]);

  const push = useCallback((text: string, ok = true) => {
    setLog((l) => [...l.slice(-60), { text, ok }]);
  }, []);

  // prompt handle: only promptNode; 1 connection max. image handle: up to 14 (nano-banana-2 limit).
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const source = nodes.find((n) => n.id === connection.source);
      const target = nodes.find((n) => n.id === connection.target);

      // Prompt handles only accept text (prompt) nodes
      if (connection.targetHandle === "prompt" && source?.type !== "promptNode") return false;

      // Image/resource handles do not accept text (prompt) nodes
      if (
        source?.type === "promptNode" &&
        (connection.targetHandle === "image" ||
         connection.targetHandle === "resource" ||
         connection.targetHandle === "startFrame" ||
         connection.targetHandle === "endFrame")
      ) return false;

      if (target?.type === "generateNode") {
        if (connection.targetHandle === "prompt") {
          const taken = edges.some(
            (e) => e.target === connection.target && e.targetHandle === "prompt"
          );
          if (taken) return false;
        }
        if (connection.targetHandle === "image") {
          const count = edges.filter(
            (e) => e.target === connection.target && e.targetHandle === "image"
          ).length;
          if (count >= 14) return false;

          // Same image source cannot be connected twice to the same node
          const duplicate = edges.some(
            (e) =>
              e.source === connection.source &&
              e.target === connection.target &&
              e.targetHandle === "image"
          );
          if (duplicate) return false;
        }
      }

      // Video generator: prompt/startFrame/endFrame accept 1 each; resource accepts up to 3
      if (target?.type === "videoGeneratorNode") {
        if (
          connection.targetHandle === "prompt" ||
          connection.targetHandle === "startFrame" ||
          connection.targetHandle === "endFrame"
        ) {
          const taken = edges.some(
            (e) => e.target === connection.target && e.targetHandle === connection.targetHandle
          );
          if (taken) return false;
        }
        if (connection.targetHandle === "resource") {
          const count = edges.filter(
            (e) => e.target === connection.target && e.targetHandle === "resource"
          ).length;
          if (count >= 3) return false;
          // Same source can't connect twice via resource
          const dup = edges.some(
            (e) => e.source === connection.source && e.target === connection.target && e.targetHandle === "resource"
          );
          if (dup) return false;
        }
      }

      return true;
    },
    [nodes, edges]
  );

  // Show node-picker when an edge is dragged and released on empty canvas
  const onConnectEnd = useCallback(
    (
      event: MouseEvent | TouchEvent,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connectionState: any,
    ) => {
      // toHandle is set whenever the drag landed on any handle (valid or blocked).
      // isValid is true when the connection was accepted.
      // Either condition means the user wasn't dropping on empty canvas → skip picker.
      if (connectionState.toHandle || connectionState.isValid) return;
      // No source node → drag started from canvas, skip
      if (!connectionState.fromNode) return;

      const { clientX, clientY } =
        "changedTouches" in event
          ? (event as TouchEvent).changedTouches[0]
          : (event as MouseEvent);

      setDropState({
        screenX:        clientX,
        screenY:        clientY,
        sourceNodeId:   connectionState.fromNode.id,
        sourceNodeType: connectionState.fromNode.type,
        sourceHandleId: connectionState.fromHandle?.id ?? null,
      });
    },
    [],
  );

  const setAuthModalOpen = useWorkflowStore((s) => s.setAuthModalOpen);

  const runAll = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setAuthModalOpen(true);
      return;
    }

    setIsRunning(true);
    setLog([]);
    push("Running workflow…");
    const order = topoSort(nodes, edges);

    for (const nodeId of order) {
      const node = nodes.find((n) => n.id === nodeId) as Node<NodeData> | undefined;
      if (!node) continue;

      // ── Image generator ─────────────────────────────────────────────────────
      if (node.type === "generateNode") {
        const upstream    = resolveInputs(nodeId, nodes as Node<NodeData>[], edges);
        const prompt      = upstream.prompt;
        const imageUrls   = upstream.imageUrls;
        const aspectRatio = node.data.aspectRatio ?? "1:1";
        const quality     = node.data.quality ?? "1k";
        const payload     = { prompt, imageUrls, model: node.data.model, aspectRatio, quality };

        if (!prompt?.trim()) {
          const promptNodeId = edges.find(
            (e) => e.target === nodeId && e.targetHandle === "prompt"
          )?.source;
          if (promptNodeId) updateNodeData(promptNodeId, { hasError: true });
          push(`[${node.id}] skipped — prompt is empty`, false);
          continue;
        }

        if (debugMode) {
          console.log(`[DEBUG] node=${node.id}`, payload);
          push(`[DEBUG] ${node.id} — logged to console`);
          continue;
        }

        push(`[${node.id}] ${aspectRatio} · ${imageUrls.length} image(s)…`);
        updateNodeData(nodeId, { status: "running", imageUrl: undefined });

        try {
          // Submit job
          const res  = await fetch("/api/generate", {
            method:  "POST",
            headers: authHeaders(token),
            body:    JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);

          const { taskId, referenceImageUrls } = data as {
            taskId: string;
            referenceImageUrls?: string[];
          };

          // If reference images were uploaded to R2, update those nodes immediately
          if (referenceImageUrls?.length) {
            const imageEdges = edges.filter(
              (e) => e.target === nodeId && e.targetHandle === "image"
            );
            referenceImageUrls.forEach((cdnUrl, i) => {
              const srcId = imageEdges[i]?.source;
              if (srcId) updateNodeData(srcId, { r2Url: cdnUrl });
            });
          }

          // Poll /api/job-status until done (image generate is async/callback-based)
          push(`[${node.id}] waiting for result…`);
          let imageUrl: string | undefined;
          for (let attempt = 0; attempt < 120; attempt++) {
            await new Promise((r) => setTimeout(r, 3000));
            const poll   = await fetch(`/api/job-status?taskId=${taskId}`);
            const result = await poll.json();
            if (result.status === "done")  { imageUrl = result.imageUrl; break; }
            if (result.status === "error") throw new Error(result.error ?? "Generation failed");
            if (attempt > 0 && attempt % 5 === 0) push(`[${node.id}] still waiting…`);
          }

          if (!imageUrl) throw new Error("Timed out waiting for generation result");
          updateNodeData(nodeId, { status: "done", imageUrl });
          push(`[${node.id}] done`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          updateNodeData(nodeId, { status: "error", errorMsg: msg });
          push(`[${node.id}] error: ${msg}`, false);
        }
      }

      // ── Video generator (Kling 3.0) ─────────────────────────────────────────
      if (node.type === "videoGeneratorNode") {
        const upstream    = resolveInputs(nodeId, nodes as Node<NodeData>[], edges);
        const prompt      = upstream.prompt ?? "";
        const duration    = node.data.duration    ?? 5;
        const aspectRatio = node.data.aspectRatio ?? "16:9";
        const klingMode = node.data.klingMode ?? "pro";
        const sound     = node.data.sound    ?? false;
        const payload = {
          prompt,
          startFrameUrl: upstream.startFrameUrl,
          endFrameUrl:   upstream.endFrameUrl,
          resources:     upstream.resources,
          sound, duration, aspectRatio,
          mode: klingMode,
        };

        if (!prompt.trim()) {
          const promptNodeId = edges.find(
            (e) => e.target === nodeId && e.targetHandle === "prompt"
          )?.source;
          if (promptNodeId) updateNodeData(promptNodeId, { hasError: true });
          push(`[${node.id}] skipped — prompt is empty`, false);
          continue;
        }

        if (debugMode) {
          console.log(`[DEBUG] videoNode=${node.id}`, payload);
          push(`[DEBUG] ${node.id} — logged to console`);
          continue;
        }

        push(`[${node.id}] Kling 3.0 · ${klingMode} · ${duration}s…`);
        updateNodeData(nodeId, { status: "running", videoUrl: undefined });

        try {
          const res  = await fetch("/api/generate-video", {
            method:  "POST",
            headers: authHeaders(token),
            body:    JSON.stringify(payload),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          updateNodeData(nodeId, { status: "done", videoUrl: data.videoUrl });
          push(`[${node.id}] done`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          updateNodeData(nodeId, { status: "error", errorMsg: msg });
          push(`[${node.id}] error: ${msg}`, false);
        }
      }
    }

    push("Complete");
    setIsRunning(false);
  }, [nodes, edges, updateNodeData, setIsRunning, debugMode, push]);

  const clear = useCallback(() => {
    const { activeSpaceId, spaces } = useWorkflowStore.getState();
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      spaces: spaces.map((sp) =>
        sp.id === activeSpaceId ? { ...sp, nodes: [], edges: [] } : sp
      ),
    });
    setLog([]);
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="flex-1 flex flex-col min-w-0 h-full"
      onMouseMove={(e) => { mousePosRef.current = { x: e.clientX, y: e.clientY }; }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={(_, edge) => onEdgesChange([{ type: "remove", id: edge.id }])}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onMove={(_, vp) => { viewportRef.current = vp; }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.05}
        colorMode="dark"
        className="flex-1"
        // Right-click drag pans; left-click drag draws selection box
        panOnDrag={[2]}
        selectionOnDrag
        deleteKeyCode={["Delete", "Backspace"]}
        multiSelectionKeyCode="Shift"
        panOnScroll
        defaultEdgeOptions={{ animated: false }}
        connectionLineStyle={{
          stroke: "#555555",
          strokeWidth: 2,
          strokeDasharray: "6 3",
          strokeLinecap: "round",
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1.5} color="#333333" />

        {dropState && (
          <NodePickerMenu
            dropState={dropState}
            onClose={() => setDropState(null)}
          />
        )}

        <Controls
          showInteractive={false}
          className="[&>button]:!bg-[#0D1012] [&>button]:!border-[#1A100C] [&>button]:!text-[#8D8E89] [&>button:hover]:!text-white"
        />

        <Panel position="top-right" className="flex items-center gap-2 m-3">
          <AuthButton />

          {/* Debug toggle */}
          <button
            onClick={toggleDebug}
            className={`toolbar-btn flex items-center gap-1.5 ${debugMode ? "!border-amber-500/60 !text-amber-400" : ""}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${debugMode ? "bg-amber-400" : "bg-[#333333]"}`} />
            Debug
          </button>

          {nodes.length > 0 && (
            <button onClick={clear} disabled={isRunning} className="toolbar-btn">
              Clear
            </button>
          )}
          <button
            onClick={runAll}
            disabled={isRunning || !nodes.some((n) => n.type === "generateNode" || n.type === "videoGeneratorNode")}
            className="toolbar-btn-primary"
          >
            {isRunning ? (
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 border border-[#2A1A14] border-t-[#0A0C0E] rounded-full animate-spin" />
                Running
              </span>
            ) : (
              "Run all"
            )}
          </button>
        </Panel>
      </ReactFlow>

      {log.length > 0 && (
        <div className="h-24 bg-[#080A0C] border-t border-[#1A100C] overflow-y-auto px-4 py-2 shrink-0">
          {log.map((l, i) => (
            <p key={i} className={`text-[11px] font-mono leading-5 ${l.ok ? "text-[#8D8E89]" : "text-red-500"}`}>
              {l.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
