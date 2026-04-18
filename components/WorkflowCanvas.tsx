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
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useWorkflowStore, NodeData } from "@/lib/store";
import { VIDEO_MODELS } from "@/lib/modelConfig";
import CuttableEdge from "@/components/edges/CuttableEdge";
import { topoSort, resolveInputs } from "@/lib/executor";
import { NODE_SIZE, FALLBACK_SIZE } from "@/lib/nodeTypes";
import { edgeStyle } from "@/lib/edgeStyles";
import { createClient } from "@/lib/supabase/client";
import { sha256Hex } from "@/lib/assetHash";

import PromptNode          from "./nodes/PromptNode";
import ImageInputNode      from "./nodes/ImageInputNode";
import VideoInputNode      from "./nodes/VideoInputNode";
import GenerateNode        from "./nodes/GenerateNode";
import VideoGeneratorNode  from "./nodes/VideoGeneratorNode";
import NodePickerMenu, { DropState } from "./NodePickerMenu";
import AuthButton from "./AuthButton";
import CreditBalance from "./CreditBalance";

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
  videoInputNode:      VideoInputNode,
  generateNode:        GenerateNode,
  videoGeneratorNode:  VideoGeneratorNode,
};

const edgeTypes = {
  default: CuttableEdge,
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const SNAP_THRESHOLD = 8; // canvas units

interface SnapGuide { type: "h" | "v"; canvasPos: number }

// Runs inside the ReactFlow provider so it can call useReactFlow()
function ViewportSyncer() {
  const { setViewport } = useReactFlow();
  const activeSpaceId   = useWorkflowStore((s) => s.activeSpaceId);
  const spaces          = useWorkflowStore((s) => s.spaces);

  useEffect(() => {
    const space = spaces.find((sp) => sp.id === activeSpaceId);
    if (space?.viewport) {
      setViewport(space.viewport, { duration: 0 });
    } else {
      // No saved viewport — let ReactFlow keep its current state (fitView handled elsewhere)
      setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 0 });
    }
    // Only run when the active space changes, not on every spaces update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSpaceId]);

  return null;
}

/** Human-readable label with auto-incrementing counter per type */
function nodeLabel(type: string, existingNodes: Node<NodeData>[]): string {
  const count = existingNodes.filter((n) => n.type === type).length + 1;
  const names: Record<string, string> = {
    videoInputNode:     "VIDEO",
    imageInputNode:     "IMAGE",
    promptNode:         "TEXT",
    generateNode:       "IMAGE GEN",
    videoGeneratorNode: "VIDEO GEN",
  };
  return `${names[type] ?? type} #${count}`;
}

export default function WorkflowCanvas() {
  const {
    nodes, edges,
    onNodesChange: _onNodesChange, onEdgesChange, onConnect,
    addNode, insertEdge,
    updateNodeData, isRunning, setIsRunning, debugMode, toggleDebug,
    saveViewport,
  } = useWorkflowStore();
  const updateNodeDataRef = useRef(updateNodeData);
  updateNodeDataRef.current = updateNodeData;

  const [dyingEdgeIds, setDyingEdgeIds]       = useState<Set<string>>(new Set());
  const [ancestorIds, setAncestorIds]         = useState<Set<string>>(new Set());
  const [ancestorEdgeIds, setAncestorEdgeIds] = useState<Set<string>>(new Set());
  // Ref so the nodes map always reads the latest selected IDs in the same render
  const selectedIdsRef = useRef<Set<string>>(new Set());

  // Walk edges upstream from selected nodes, collecting all ancestor node + edge IDs
  const onSelectionChange = useCallback(
    ({ nodes: selected }: { nodes: Node[] }) => {
      // Update ref synchronously — visible to the render triggered by setAncestorIds below
      selectedIdsRef.current = new Set(selected.map((n) => n.id));

      if (selected.length === 0) {
        setAncestorIds(new Set());
        setAncestorEdgeIds(new Set());
        return;
      }
      const selectedIds = selectedIdsRef.current;
      const visitedNodes = new Set<string>();
      const visitedEdges = new Set<string>();
      const queue = [...selectedIds];
      while (queue.length > 0) {
        const id = queue.shift()!;
        for (const edge of edges) {
          if (edge.target !== id) continue;
          visitedEdges.add(edge.id);
          if (!selectedIds.has(edge.source) && !visitedNodes.has(edge.source)) {
            visitedNodes.add(edge.source);
            queue.push(edge.source);
          }
        }
      }
      setAncestorIds(visitedNodes);
      setAncestorEdgeIds(visitedEdges);
    },
    [edges],
  );

  const handleEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setDyingEdgeIds((prev) => new Set([...prev, edge.id]));
    setTimeout(() => {
      onEdgesChange([{ type: "remove", id: edge.id }]);
      setDyingEdgeIds((prev) => { const s = new Set(prev); s.delete(edge.id); return s; });
    }, 450);
  }, [onEdgesChange]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // ── Paired-prompt deletion ─────────────────────────────────────────────────
    const removedIds = changes
      .filter((c): c is Extract<NodeChange, { type: "remove" }> => c.type === "remove")
      .map((c) => c.id);

    const removedGenIds = removedIds.filter(
      (id) => nodes.find((n) => n.id === id)?.type === "generateNode"
    );

    const pairedPromptIds = edges
      .filter(
        (e) =>
          removedGenIds.includes(e.target) &&
          e.targetHandle === "prompt" &&
          e.deletable === false
      )
      .map((e) => e.source)
      .filter((id) => !removedIds.includes(id));

    const extra: Extract<NodeChange, { type: "remove" }>[] =
      pairedPromptIds.map((id) => ({ type: "remove", id }));

    const allChanges = extra.length > 0 ? [...changes, ...extra] : changes;

    // ── Alignment snap (edge-to-edge + center magnetic effect) ─────────────────
    const newGuides: SnapGuide[] = [];

    const snappedChanges = allChanges.map((change) => {
      if (change.type !== "position" || !change.position) return change;

      // On drag-stop: lock in the last snapped position
      if (!change.dragging) {
        const t = snapTargetRef.current;
        if (t && t.id === change.id) return { ...change, position: { x: t.x, y: t.y } };
        return change;
      }

      const dragged = nodes.find((n) => n.id === change.id);
      if (!dragged) return change;

      const dw = dragged.measured?.width  ?? (NODE_SIZE[dragged.type ?? ""] ?? FALLBACK_SIZE).w;
      const dh = dragged.measured?.height ?? (NODE_SIZE[dragged.type ?? ""] ?? FALLBACK_SIZE).h;
      const { x, y } = change.position;

      let snapX: number | null = null, guideX: number | null = null, minDX = SNAP_THRESHOLD;
      let snapY: number | null = null, guideY: number | null = null, minDY = SNAP_THRESHOLD;

      for (const other of nodes) {
        if (other.id === change.id) continue;
        const ow = other.measured?.width  ?? (NODE_SIZE[other.type ?? ""] ?? FALLBACK_SIZE).w;
        const oh = other.measured?.height ?? (NODE_SIZE[other.type ?? ""] ?? FALLBACK_SIZE).h;

        // Check left / right borders of dragged vs left / right borders of other
        for (const [dx, offsetX] of [[x, 0], [x + dw, dw]] as [number, number][]) {
          for (const ox of [other.position.x, other.position.x + ow]) {
            const dist = Math.abs(dx - ox);
            if (dist < minDX) { minDX = dist; snapX = ox - offsetX; guideX = ox; }
          }
        }

        // Check top / bottom borders of dragged vs top / bottom borders of other
        for (const [dy, offsetY] of [[y, 0], [y + dh, dh]] as [number, number][]) {
          for (const oy of [other.position.y, other.position.y + oh]) {
            const dist = Math.abs(dy - oy);
            if (dist < minDY) { minDY = dist; snapY = oy - offsetY; guideY = oy; }
          }
        }
      }

      if (guideX !== null) newGuides.push({ type: "v", canvasPos: guideX });
      if (guideY !== null) newGuides.push({ type: "h", canvasPos: guideY });

      const snappedX = snapX ?? x;
      const snappedY = snapY ?? y;
      snapTargetRef.current = (guideX !== null || guideY !== null)
        ? { id: change.id, x: snappedX, y: snappedY }
        : null;

      return { ...change, position: { x: snappedX, y: snappedY } };
    });

    setSnapGuides(newGuides);
    _onNodesChange(snappedChanges);
  }, [nodes, edges, _onNodesChange]);

  // ── Sidebar drag-and-drop ────────────────────────────────────────────────────
  const wrapperRef  = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const hasFiles = e.dataTransfer.types.includes("Files");
    e.dataTransfer.dropEffect = hasFiles ? "copy" : "copy";
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();

    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { x: panX, y: panY, zoom } = viewportRef.current;

    // ── File drop (images / videos dragged from OS or browser) ─────────────
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    if (files.length > 0) {
      const dropX = (e.clientX - rect.left - panX) / zoom;
      const dropY = (e.clientY - rect.top  - panY) / zoom;

      // Lay out multiple files in a row, centred on the drop point.
      // Gap between node edges (canvas units).
      const GAP = 24;

      // First pass: compute per-file node type + size so we can centre the row.
      const fileMeta = files.map((f) => {
        const type = f.type.startsWith("image/") ? "imageInputNode" : "videoInputNode";
        const size = NODE_SIZE[type] ?? FALLBACK_SIZE;
        return { file: f, type, size } as { file: File; type: string; size: { w: number; h: number } };
      });

      const totalWidth = fileMeta.reduce((sum, m, i) =>
        sum + m.size.w + (i < fileMeta.length - 1 ? GAP : 0), 0
      );
      let cursorX = dropX - totalWidth / 2;

      for (const { file, type, size } of fileMeta) {
        const nodeId  = `${type}-${uid()}`;
        const current = useWorkflowStore.getState().nodes;
        const blobUrl = URL.createObjectURL(file);
        const posX    = cursorX;
        const posY    = dropY - size.h / 2;
        cursorX      += size.w + GAP;

        if (type === "imageInputNode") {
          // Add node immediately with blob URL so the image shows at once
          addNode({
            id: nodeId, type,
            position: { x: posX, y: posY },
            style: { width: size.w },
            data: { label: nodeLabel(type, current), status: "idle", inputImage: blobUrl },
          });

          // Measure natural dimensions
          const img = new window.Image();
          img.onload = () =>
            updateNodeDataRef.current(nodeId, {
              imageNaturalRatio: `${img.naturalWidth} / ${img.naturalHeight}`,
            });
          img.src = blobUrl;

          // Hash + lookup + upload in background
          (async () => {
            try {
              const bytes = await file.arrayBuffer();
              const hash  = await sha256Hex(bytes);
              const { data: authData } = await (await import("@/lib/supabase/client")).createClient().auth.getSession();
              const token = authData.session?.access_token;
              const authHdr = token ? { Authorization: `Bearer ${token}` } : {};

              try {
                const lk = await fetch(`/api/lookup-asset?hash=${hash}`, { headers: authHdr });
                const { cdnUrl } = await lk.json() as { cdnUrl: string | null };
                if (cdnUrl) { updateNodeDataRef.current(nodeId, { inputImage: cdnUrl, r2Url: cdnUrl }); return; }
              } catch { /* fall through */ }

              const res = await fetch("/api/upload-asset", {
                method: "POST",
                headers: { "Content-Type": file.type || "image/jpeg", ...authHdr },
                body: bytes,
              });
              const { cdnUrl } = await res.json() as { cdnUrl?: string };
              if (cdnUrl) updateNodeDataRef.current(nodeId, { inputImage: cdnUrl, r2Url: cdnUrl });
            } catch { /* blob URL stays as fallback */ }
          })();

        } else {
          // videoInputNode
          addNode({
            id: nodeId, type,
            position: { x: posX, y: posY },
            style: { width: size.w },
            data: { label: nodeLabel(type, current), status: "idle", videoUrl: blobUrl },
          });

          (async () => {
            try {
              const bytes = await file.arrayBuffer();
              const hash  = await sha256Hex(bytes);
              const { data: authData } = await (await import("@/lib/supabase/client")).createClient().auth.getSession();
              const token = authData.session?.access_token;
              const authHdr = token ? { Authorization: `Bearer ${token}` } : {};

              try {
                const lk = await fetch(`/api/lookup-asset?hash=${hash}`, { headers: authHdr });
                const { cdnUrl } = await lk.json() as { cdnUrl: string | null };
                if (cdnUrl) { updateNodeDataRef.current(nodeId, { videoUrl: cdnUrl }); return; }
              } catch { /* fall through */ }

              const res = await fetch("/api/upload-asset", {
                method: "POST",
                headers: { "Content-Type": file.type || "video/mp4", ...authHdr },
                body: bytes,
              });
              const { cdnUrl } = await (await res.json()) as { cdnUrl?: string };
              if (cdnUrl) updateNodeDataRef.current(nodeId, { videoUrl: cdnUrl });
            } catch { /* blob URL stays as fallback */ }
          })();
        }
      }
      return;
    }

    // ── Sidebar node-type drop ───────────────────────────────────────────────
    const type = e.dataTransfer.getData("application/reactflow-node");
    if (!type) return;

    const position = {
      x: (e.clientX - rect.left - panX) / zoom,
      y: (e.clientY - rect.top  - panY) / zoom,
    };

    if (type === "generateNode") {
      const genId    = `gen-${uid()}`;
      const promptId = `prompt-${uid()}`;

      const freshNodes = useWorkflowStore.getState().nodes;
      addNode({
        id: promptId, type: "promptNode",
        position: { x: position.x - 320, y: position.y + 20 },
        deletable: false,
        style: { width: NODE_SIZE.promptNode.w, height: NODE_SIZE.promptNode.h },
        data: { label: nodeLabel("promptNode", freshNodes) },
      });
      addNode({
        id: genId, type: "generateNode",
        position,
        style: { width: NODE_SIZE.generateNode.w, height: NODE_SIZE.generateNode.h },
        data: { label: nodeLabel("generateNode", freshNodes), status: "idle", model: "nano-banana-2", aspectRatio: "1:1" },
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
    // Read nodes fresh from the store (not from stale closure)
    const currentNodes = useWorkflowStore.getState().nodes;
    const label = nodeLabel(type, currentNodes);
    addNode({
      id: `${type}-${uid()}`,
      type,
      position,
      style: type === "imageInputNode" || type === "videoInputNode" ? { width: size.w } : { width: size.w, height: size.h },
      data: { label, status: "idle" },
    });
  }, [addNode, insertEdge]);

  // ── Copy / Paste ─────────────────────────────────────────────────────────────
  const clipboardRef = useRef<{ nodes: Node<NodeData>[]; edges: Edge[] } | null>(null);
  // Written to the OS clipboard when nodes are copied, so Ctrl+V can tell the
  // difference between "paste my nodes" and "paste real external text".
  const nodeSentinelRef = useRef<string | null>(null);
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
    // Write a sentinel to the OS clipboard so Ctrl+V knows this was a node copy,
    // not real external text the user wants to paste as a prompt node.
    const sentinel = `__rf_nodes_${Date.now()}__`;
    nodeSentinelRef.current = sentinel;
    navigator.clipboard.writeText(sentinel).catch(() => {});
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
      if (mod && e.key === "v") {
        e.preventDefault();
        // OS clipboard text takes priority — if it has content, create a prompt node.
        // Fall back to internal node clipboard only when the OS clipboard is empty.
        navigator.clipboard.readText?.().then((raw) => {
          const text = raw.trim();
          // If the OS clipboard contains our node-copy sentinel, paste nodes.
          // Otherwise treat non-empty text as external content → prompt node.
          if (text && text !== nodeSentinelRef.current) {
            const rect = wrapperRef.current?.getBoundingClientRect();
            if (!rect) return;
            const { x: panX, y: panY, zoom } = viewportRef.current;
            const cx = (mousePosRef.current.x - rect.left - panX) / zoom;
            const cy = (mousePosRef.current.y - rect.top  - panY) / zoom;
            const size = NODE_SIZE["promptNode"] ?? FALLBACK_SIZE;
            const currentNodes = useWorkflowStore.getState().nodes;
            addNode({
              id: `promptNode-${uid()}`,
              type: "promptNode",
              position: { x: cx - size.w / 2, y: cy - size.h / 2 },
              style: { width: size.w, height: size.h },
              data: { label: nodeLabel("promptNode", currentNodes), prompt: text },
            });
          } else if (clipboardRef.current) {
            handlePaste();
          }
        }).catch(() => {
          // Clipboard read denied (e.g. no permission) — fall back to node paste
          if (clipboardRef.current) handlePaste();
        });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleCopy, handlePaste, addNode]);

  // ── Auto-trim: check video duration vs model max on new connections ──────────
  const handleConnect = useCallback((connection: Connection) => {
    onConnect(connection);

    const h = connection.targetHandle;
    if (h !== "resource" && h !== "videoRef") return;

    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);
    if (sourceNode?.type !== "videoInputNode") return;
    if (targetNode?.type !== "videoGeneratorNode") return;

    const videoModelId = (targetNode.data?.videoModel as string | undefined) ?? "kling-3.0";
    const cfg = VIDEO_MODELS.find((m) => m.id === videoModelId);
    if (!cfg) return;

    // Pick the right cap: videoRef uses videoRefMaxDuration, resource uses durationMax
    const maxDuration = h === "videoRef"
      ? cfg.apiInput.videoRefMaxDuration
      : cfg.apiInput.durationMax > 0 ? cfg.apiInput.durationMax : undefined;
    if (!maxDuration) return;

    const videoDuration = sourceNode.data?.videoDuration as number | undefined;
    if (!videoDuration) return;

    // If a trim is already applied, use the trimmed duration — not the full video length
    const trimStart = sourceNode.data?.trimStart as number | undefined;
    const trimEnd   = sourceNode.data?.trimEnd   as number | undefined;
    const effectiveDuration = (trimStart !== undefined && trimEnd !== undefined)
      ? trimEnd - trimStart
      : videoDuration;

    if (effectiveDuration <= maxDuration) return;

    // Video exceeds model limit — ask the VideoInputNode to open the trimmer
    updateNodeData(connection.source, { triggerTrimMaxDuration: maxDuration });
  }, [onConnect, nodes, updateNodeData]);

  // ── Edge drop → node picker ──────────────────────────────────────────────────
  const [isConnecting, setIsConnecting]   = useState(false);
  const [dropState, setDropState] = useState<DropState | null>(null);
  const [log, setLog] = useState<{ text: string; ok: boolean }[]>([]);

  // ── Alignment snap guides ─────────────────────────────────────────────────────
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const snapTargetRef = useRef<{ id: string; x: number; y: number } | null>(null);

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

      // videoRef handle only accepts video nodes
      if (connection.targetHandle === "videoRef") {
        if (source?.type !== "videoInputNode" && source?.type !== "videoGeneratorNode") return false;
      }

      // Image/resource handles do not accept text (prompt) nodes
      if (
        source?.type === "promptNode" &&
        (connection.targetHandle === "image" ||
         connection.targetHandle === "resource" ||
         connection.targetHandle === "startFrame" ||
         connection.targetHandle === "endFrame" ||
         connection.targetHandle === "videoRef")
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
        const videoModelId = (target.data?.videoModel as string | undefined) ?? "kling-3.0";
        const videoCfg = VIDEO_MODELS.find((m) => m.id === videoModelId);
        const isMotionControl = videoCfg?.apiInput.useMotionControl === true;

        // Only allow handles that the selected model actually supports
        if (connection.targetHandle && !videoCfg?.handles.includes(connection.targetHandle as never)) {
          return false;
        }

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
          // Motion control uses videoRef instead — resource is blocked above via handles check
          const maxResources = isMotionControl ? 0 : 3;
          const count = edges.filter(
            (e) => e.target === connection.target && e.targetHandle === "resource"
          ).length;
          if (count >= maxResources) return false;
          // Same source can't connect twice via resource
          const dup = edges.some(
            (e) => e.source === connection.source && e.target === connection.target && e.targetHandle === "resource"
          );
          if (dup) return false;
        }
        if (connection.targetHandle === "videoRef") {
          // Motion control: only 1 reference video allowed
          const taken = edges.some(
            (e) => e.target === connection.target && e.targetHandle === "videoRef"
          );
          if (taken) return false;
        }
      }

      return true;
    },
    [nodes, edges]
  );

  // Tag the ReactFlow container with the output handle type so CSS can filter compatible inputs
  const onConnectStart = useCallback((event: MouseEvent | TouchEvent) => {
    const handle = (event.target as HTMLElement)?.closest?.(".react-flow__handle") as HTMLElement | null;
    const rf     = (event.target as HTMLElement)?.closest?.(".react-flow") as HTMLElement | null;
    if (!handle || !rf) return;
    let type = "unknown";
    if (handle.classList.contains("node-handle-prompt")) type = "prompt";
    else if (handle.classList.contains("node-handle-source")) type = "image";
    else if (handle.classList.contains("node-handle-video"))  type = "video";
    rf.setAttribute("data-connecting-type", type);
    setIsConnecting(true);
  }, []);

  // Show node-picker when an edge is dragged and released on empty canvas
  const onConnectEnd = useCallback(
    (
      event: MouseEvent | TouchEvent,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connectionState: any,
    ) => {
      // Remove connecting-type tag
      const rf = (event.target as HTMLElement)?.closest?.(".react-flow") as HTMLElement | null;
      rf?.removeAttribute("data-connecting-type");
      setIsConnecting(false);

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

  // ── Place a node at the viewport center (used by the empty-state picker) ────
  const addNodeAtCenter = useCallback((type: string) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { x: panX, y: panY, zoom } = viewportRef.current;
    const cx = (rect.width  / 2 - panX) / zoom;
    const cy = (rect.height / 2 - panY) / zoom;
    const size = NODE_SIZE[type] ?? FALLBACK_SIZE;

    if (type === "generateNode") {
      const genId    = `gen-${uid()}`;
      const promptId = `prompt-${uid()}`;
      const freshNodes = useWorkflowStore.getState().nodes;
      addNode({
        id: promptId, type: "promptNode",
        position: { x: cx - size.w / 2 - 320, y: cy - size.h / 2 + 20 },
        deletable: false,
        style: { width: NODE_SIZE.promptNode.w, height: NODE_SIZE.promptNode.h },
        data: { label: nodeLabel("promptNode", freshNodes) },
      });
      addNode({
        id: genId, type: "generateNode",
        position: { x: cx - size.w / 2, y: cy - size.h / 2 },
        style: { width: size.w, height: size.h },
        data: { label: nodeLabel("generateNode", freshNodes), status: "idle", model: "nano-banana-2", aspectRatio: "1:1" },
      });
      insertEdge({
        id: `edge-${promptId}-${genId}`,
        source: promptId, target: genId, targetHandle: "prompt",
        deletable: false, reconnectable: false, animated: false,
        style: edgeStyle("prompt"),
      });
      return;
    }

    const currentNodes = useWorkflowStore.getState().nodes;
    addNode({
      id: `${type}-${uid()}`,
      type,
      position: { x: cx - size.w / 2, y: cy - size.h / 2 },
      style: type === "imageInputNode" || type === "videoInputNode"
        ? { width: size.w }
        : { width: size.w, height: size.h },
      data: { label: nodeLabel(type, currentNodes), status: "idle" },
    });
  }, [addNode, insertEdge]);

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

  const handleNodeDragStop = useCallback(() => {
    setSnapGuides([]);
    snapTargetRef.current = null;
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="relative flex-1 flex flex-col min-w-0 h-full"
      onMouseMove={(e) => { mousePosRef.current = { x: e.clientX, y: e.clientY }; }}
    >
      <ReactFlow
        nodes={(() => {
          const selIds = selectedIdsRef.current;
          const anySelected = selIds.size > 0;
          return nodes.map((n) => {
            const isHighlighted = selIds.has(n.id) || ancestorIds.has(n.id);
            const isDimmed = anySelected && !isHighlighted && !isConnecting;
            const ancestorClass = ancestorIds.has(n.id) ? "node-ancestor" : null;
            return {
              ...n,
              className: [n.className, ancestorClass].filter(Boolean).join(" ") || undefined,
              style: {
                ...n.style,
                opacity:    isDimmed ? 0.25 : undefined,
                transition: anySelected ? "opacity 150ms" : undefined,
              },
            };
          });
        })()}
        edges={(() => {
          const selIds = selectedIdsRef.current;
          const anySelected = selIds.size > 0;
          return edges.map((e) => {
            const isAncestorEdge = ancestorEdgeIds.has(e.id);
            const isDimmed = anySelected && !isAncestorEdge;
            return {
              ...e,
              className: isAncestorEdge ? [e.className, "edge-ancestor"].filter(Boolean).join(" ") : e.className,
              data: { ...e.data, dying: dyingEdgeIds.has(e.id) || e.data?.dying === true, dimmed: isDimmed },
            };
          });
        })()}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={handleEdgeClick}
        onSelectionChange={onSelectionChange}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onMove={(_, vp) => { viewportRef.current = vp; saveViewport(vp); }}
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
        <ViewportSyncer />

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
          <CreditBalance />
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

      {/* ── Alignment guide lines ────────────────────────────────────────────── */}
      {snapGuides.length > 0 && (
        <svg
          className="absolute inset-0 pointer-events-none z-20"
          style={{ width: "100%", height: "100%" }}
        >
          {snapGuides.map((guide, i) => {
            const { x: panX, y: panY, zoom } = viewportRef.current;
            if (guide.type === "h") {
              const sy = guide.canvasPos * zoom + panY;
              return (
                <line key={i} x1={-100000} y1={sy} x2={100000} y2={sy}
                  stroke="#555" strokeWidth={1} opacity={0.8} />
              );
            }
            const sx = guide.canvasPos * zoom + panX;
            return (
              <line key={i} x1={sx} y1={-100000} x2={sx} y2={100000}
                stroke="#555" strokeWidth={1} opacity={0.8} />
            );
          })}
        </svg>
      )}

      {/* ── Empty state picker ──────────────────────────────────────────────── */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
          {/* Ambient radial glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(ellipse 80% 55% at 50% 54%, rgba(255,160,80,0.045) 0%, transparent 65%)",
            }}
          />

          <div className="flex flex-col items-center gap-10">
            <div className="flex flex-col items-center gap-2.5 pointer-events-none">
              <h2
                className="text-[26px] font-semibold tracking-tight leading-none"
                style={{
                  background: "linear-gradient(160deg, #e8e8e8 30%, #666 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                Your space is ready
              </h2>
              <p className="text-[#3E3E3E] text-sm">Pick a node to start building</p>
            </div>

            <div className="flex items-stretch gap-3 pointer-events-auto">
              {[
                {
                  type: "imageInputNode",
                  label: "Image",
                  desc: "Import a photo",
                  icon: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none" />
                      <path d="m3 15 5-5 4 4 3-3 6 5" />
                    </svg>
                  ),
                  accent: "#fb923c",
                },
                {
                  type: "videoInputNode",
                  label: "Video",
                  desc: "Import a clip",
                  icon: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="5" width="15" height="14" rx="2" />
                      <path d="m17 8 5-3v14l-5-3V8Z" />
                    </svg>
                  ),
                  accent: "#60a5fa",
                },
                {
                  type: "generateNode",
                  label: "Image Gen",
                  desc: "AI image generation",
                  icon: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15.5 2H8.6c-.4 0-.8.2-1.1.5L2.5 7.6c-.3.3-.5.7-.5 1.1V19a2 2 0 0 0 2 2h11.5a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z" />
                      <path d="M3 8h4a1 1 0 0 0 1-1V3" />
                      <path d="M11 12h4M13 10v4" />
                    </svg>
                  ),
                  accent: "#77E544",
                },
                {
                  type: "videoGeneratorNode",
                  label: "Video Gen",
                  desc: "AI video generation",
                  icon: (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="5" width="15" height="14" rx="2" />
                      <path d="m17 8 5-3v14l-5-3V8Z" />
                      <path d="M7 12h4M9 10v4" />
                    </svg>
                  ),
                  accent: "#a78bfa",
                },
              ].map(({ type, label, desc, icon, accent }) => (
                <button
                  key={type}
                  onClick={() => addNodeAtCenter(type)}
                  className="group relative flex flex-col items-center justify-center gap-4 w-36 py-8 rounded-2xl border border-[#1A1A1A] bg-[#090B0D]"
                  style={{ transition: "box-shadow 200ms ease, border-color 200ms ease, background 200ms ease" }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget;
                    el.style.boxShadow = `0 0 32px ${accent}20, 0 0 0 1px ${accent}30`;
                    el.style.borderColor = `${accent}35`;
                    el.style.background = "#0D1012";
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget;
                    el.style.boxShadow = "";
                    el.style.borderColor = "#1A1A1A";
                    el.style.background = "#090B0D";
                  }}
                >
                  <span
                    className="flex items-center justify-center w-11 h-11 rounded-xl"
                    style={{
                      background: `${accent}14`,
                      color: accent,
                      border: `1px solid ${accent}28`,
                      transition: "background 200ms ease",
                    }}
                  >
                    {icon}
                  </span>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[#c0c0c0] group-hover:text-white text-[13px] font-medium transition-colors duration-150">
                      {label}
                    </span>
                    <span className="text-[#333] text-[11px] transition-colors duration-150 group-hover:text-[#555]">
                      {desc}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <p className="text-[#252525] text-[11px] tracking-wide pointer-events-none select-none">
              or drag &amp; drop images and videos onto the canvas
            </p>
          </div>
        </div>
      )}

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
