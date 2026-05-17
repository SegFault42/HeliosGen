"use client";
import { useEffect, useRef } from "react";
import { useReactFlow, Node, Edge } from "@xyflow/react";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { edgeStyle, EDGE_COLORS } from "@/lib/edgeStyles";
import { NODES, NODE_SIZE, FALLBACK_SIZE, NODE_META } from "@/lib/nodeTypes";
import { VIDEO_MODELS, IMAGE_MODELS } from "@/lib/modelConfig";

// Extract the aspect ratio as a float from any source node type
function nodeAspectRatioFloat(data: Record<string, unknown> | undefined): number | null {
  if (!data) return null;
  // generateNode / videoGeneratorNode: "W:H"
  const std = data.aspectRatio as string | undefined;
  if (std) { const [w, h] = std.split(":").map(Number); if (w && h) return w / h; }
  // videoInputNode: "W / H" (CSS)
  const vAR = data.videoAspectRatio as string | undefined;
  if (vAR) { const [w, h] = vAR.split("/").map((s) => Number(s.trim())); if (w && h) return w / h; }
  // imageInputNode: "W / H" (natural dimensions)
  const iAR = data.imageNaturalRatio as string | undefined;
  if (iAR) { const [w, h] = iAR.split("/").map((s) => Number(s.trim())); if (w && h) return w / h; }
  return null;
}

// Find the ratio string in candidates closest to the given float value
function closestRatio(ratioFloat: number, candidates: string[]): string | null {
  if (!candidates.length) return null;
  return candidates.reduce((best, r) => {
    const [w, h] = r.split(":").map(Number);
    const [bw, bh] = best.split(":").map(Number);
    return Math.abs(w / h - ratioFloat) < Math.abs(bw / bh - ratioFloat) ? r : best;
  });
}

// Node types whose OUTPUT can feed a given input handle
function sourceNodeTypesFor(targetHandle: string | null): string[] {
  switch (targetHandle) {
    case "prompt":                         return ["promptNode", "assistantNode"];
    case "image":
    case "startFrame":
    case "endFrame":
    case "resource":                       return ["imageInputNode", "generateNode"];
    case "videoRef":
    case "referenceVideo":                 return ["videoInputNode"];
    default:                               return [];
  }
}

// The output handle ID to use on a newly-created source node for a given target handle
function outputHandleForNewNode(newNodeType: string, targetHandle: string): string | undefined {
  if (newNodeType === "videoInputNode") {
    if (targetHandle === "videoRef" || targetHandle === "referenceVideo") return "videoRefOut";
    if (targetHandle === "startFrame") return "startFrameOut";
    if (targetHandle === "endFrame")   return "endFrameOut";
  }
  return undefined;
}

// Y offset (from node top) of an input handle, used to anchor the preview line
function inputHandleTopY(nodeType: string | undefined, handleId: string | null, nodeH: number): number {
  if (nodeType === "generateNode") {
    if (handleId === "prompt") return nodeH - 90; // calc(100% - 90px) for models with supportsImages
    if (handleId === "image")  return nodeH - 52;
  }
  if (nodeType === "videoGeneratorNode") {
    // Handles are bottom-anchored: bottom = 52 + idx * 38 → top = nodeH - that
    const ORDER = ["prompt", "startFrame", "endFrame", "resource", "videoRef", "referenceVideo", "audioRef"];
    const idx = handleId ? ORDER.indexOf(handleId) : 0;
    if (idx >= 0) return nodeH - (52 + idx * 38);
  }
  return nodeH / 2;
}

const NODE_DISPLAY_NAMES: Record<string, string> = {
  videoInputNode:     "VIDEO",
  imageInputNode:     "IMAGE",
  promptNode:         "TEXT",
  generateNode:       "IMAGE GEN",
  videoGeneratorNode: "VIDEO GEN",
  assistantNode:      "ASSISTANT",
};

export interface DropState {
  screenX: number;
  screenY: number;
  sourceNodeId: string;
  sourceNodeType: string | undefined;
  sourceHandleId: string | null;
  /** true when the drag started from a target (input) handle */
  isInputHandle?: boolean;
}

interface Props {
  dropState: DropState;
  onClose: () => void;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function targetHandleFor(
  sourceNodeType: string | undefined,
  targetNodeType: string,
  sourceHandleId: string | null,
): string | null {
  // Typed output handles take priority
  if (sourceHandleId) {
    switch (sourceHandleId) {
      case "textOut":
        return "prompt";
      case "startFrameOut":
      case "imagePickOut":
        if (targetNodeType === "videoGeneratorNode") return "startFrame";
        if (targetNodeType === "generateNode")       return "image";
        return null;
      case "endFrameOut":
        if (targetNodeType === "videoGeneratorNode") return "endFrame";
        if (targetNodeType === "generateNode")       return "image";
        return null;
      case "videoRefOut":
        if (targetNodeType === "videoGeneratorNode") return "videoRef";
        return null;
      case "audioRefOut":
        if (targetNodeType === "videoGeneratorNode") return "audioRef";
        return null;
    }
  }
  // Single-output nodes — fall back to node-type routing
  if (sourceNodeType === "promptNode" || sourceNodeType === "assistantNode") return "prompt";
  if (sourceNodeType === "imageInputNode" || sourceNodeType === "generateNode") {
    if (targetNodeType === "videoGeneratorNode") return "startFrame";
    if (targetNodeType === "generateNode")       return "image";
  }
  if (sourceNodeType === "videoInputNode") {
    if (targetNodeType === "videoGeneratorNode") return "videoRef";
  }
  return null;
}

export default function NodePickerMenu({ dropState, onClose }: Props) {
  const { screenToFlowPosition, flowToScreenPosition, getInternalNode } = useReactFlow();
  const addNode    = useWorkflowStore((s) => s.addNode);
  const insertEdge = useWorkflowStore((s) => s.insertEdge);

  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handle, true);
    return () => document.removeEventListener("mousedown", handle, true);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);

  const handleSelect = (type: string) => {
    const flowPos = screenToFlowPosition({ x: dropState.screenX, y: dropState.screenY });
    const size    = NODE_SIZE[type] ?? FALLBACK_SIZE;
    const isInput = dropState.isInputHandle === true;

    const position = {
      x: isInput ? flowPos.x - size.w - 20 : flowPos.x + 20,
      y: flowPos.y - size.h / 2,
    };

    const nodesInStore = useWorkflowStore.getState().nodes;
    const count  = nodesInStore.filter((n) => n.type === type).length + 1;
    const label  = `${NODE_DISPLAY_NAMES[type] ?? type} #${count}`;

    const nodeStyle = ["imageInputNode", "videoInputNode", "generateNode", "videoGeneratorNode"].includes(type)
      ? { width: size.w }
      : { width: size.w, height: size.h };

    // Inherit aspect ratio from source node (output-handle direction only)
    const sourceNode    = nodesInStore.find((n) => n.id === dropState.sourceNodeId);
    const srcRatioFloat = isInput ? null : nodeAspectRatioFloat(sourceNode?.data as Record<string, unknown> | undefined);

    const extraData: Record<string, unknown> = {};

    if (!isInput) {
      const targetHandle = targetHandleFor(dropState.sourceNodeType, type, dropState.sourceHandleId);
      if (type === "videoGeneratorNode" && targetHandle) {
        const compatible = VIDEO_MODELS.find((m) => (m.handles as string[]).includes(targetHandle));
        if (compatible) {
          extraData.videoModel = compatible.id;
          if (srcRatioFloat !== null) {
            const r = closestRatio(srcRatioFloat, compatible.ratios);
            if (r) extraData.aspectRatio = r;
          }
        }
      } else if (type === "generateNode" && srcRatioFloat !== null) {
        const defaultModel = IMAGE_MODELS.find((m) => m.id === "nano-banana-2") ?? IMAGE_MODELS[0];
        const r = closestRatio(srcRatioFloat, defaultModel.ratios);
        if (r) extraData.aspectRatio = r;
      }
    }

    const nodeId = `${type}-${uid()}`;
    addNode({
      id:   nodeId,
      type,
      position,
      style: nodeStyle,
      data: { label, status: "idle", ...extraData },
    });

    if (isInput) {
      // New node is the SOURCE; existing node is the TARGET
      const srcHandle = outputHandleForNewNode(type, dropState.sourceHandleId ?? "");
      const edge: Edge = {
        id:           `edge-${nodeId}-${dropState.sourceNodeId}`,
        source:       nodeId,
        sourceHandle: srcHandle,
        target:       dropState.sourceNodeId,
        targetHandle: dropState.sourceHandleId ?? undefined,
        animated:     false,
        style:        edgeStyle(dropState.sourceHandleId),
      };
      insertEdge(edge);
    } else {
      const targetHandle = targetHandleFor(dropState.sourceNodeType, type, dropState.sourceHandleId);
      if (targetHandle) {
        const edge: Edge = {
          id:           `edge-${dropState.sourceNodeId}-${nodeId}`,
          source:       dropState.sourceNodeId,
          sourceHandle: dropState.sourceHandleId ?? undefined,
          target:       nodeId,
          targetHandle: targetHandle ?? undefined,
          animated:     false,
          style:        edgeStyle(targetHandle),
        };
        insertEdge(edge);
      }
    }

    onClose();
  };

  // ── Pending connection line ──────────────────────────────────────────────────
  const isInput = dropState.isInputHandle === true;
  const internal = getInternalNode(dropState.sourceNodeId);
  const absX  = internal?.internals?.positionAbsolute?.x ?? 0;
  const absY  = internal?.internals?.positionAbsolute?.y ?? 0;
  const nodeW = internal?.measured?.width  ?? (NODE_SIZE[dropState.sourceNodeType ?? ""] ?? FALLBACK_SIZE).w;
  const nodeH = internal?.measured?.height ?? (NODE_SIZE[dropState.sourceNodeType ?? ""] ?? FALLBACK_SIZE).h;

  let src: { x: number; y: number };
  if (isInput) {
    // Line goes from the INPUT handle (left side of node) to the drop point
    const hy = inputHandleTopY(dropState.sourceNodeType, dropState.sourceHandleId, nodeH);
    src = flowToScreenPosition({ x: absX, y: absY + hy });
  } else {
    // Line goes from the OUTPUT handle (right side of node) to the drop point
    const MULTI_OUT_IDS = ["startFrameOut", "endFrameOut", "imagePickOut", "videoRefOut", "audioRefOut"];
    const multiIdx = dropState.sourceHandleId ? MULTI_OUT_IDS.indexOf(dropState.sourceHandleId) : -1;
    const hy = multiIdx >= 0 ? 20 + multiIdx * 32 : 20;
    src = flowToScreenPosition({ x: absX + nodeW, y: absY + hy });
  }
  const dst = { x: dropState.screenX, y: dropState.screenY };

  // Bezier control points — horizontal pull matching React Flow's default edge style
  const dx = Math.abs(dst.x - src.x) * 0.5;
  // For input handles the curve flows right-to-left, so flip the control points
  const svgPath = isInput
    ? [`M ${src.x} ${src.y}`, `C ${src.x - dx} ${src.y}, ${dst.x + dx} ${dst.y}, ${dst.x} ${dst.y}`].join(" ")
    : [`M ${src.x} ${src.y}`, `C ${src.x + dx} ${src.y}, ${dst.x - dx} ${dst.y}, ${dst.x} ${dst.y}`].join(" ");

  // ── Node list ────────────────────────────────────────────────────────────────
  const HANDLE_ONLY_VIDEO_GEN = new Set(["videoRefOut", "audioRefOut"]);
  const linkable = isInput
    ? (() => {
        const allowed = new Set(sourceNodeTypesFor(dropState.sourceHandleId));
        return NODES.filter((n) => allowed.has(n.type));
      })()
    : NODES.filter((n) => {
        if (!n.canReceiveConnection) return false;
        if (dropState.sourceHandleId && HANDLE_ONLY_VIDEO_GEN.has(dropState.sourceHandleId)) {
          return n.type === "videoGeneratorNode";
        }
        return true;
      });

  // Preview line color
  const lineColor = isInput
    ? EDGE_COLORS[dropState.sourceHandleId ?? "default"] ?? EDGE_COLORS.default
    : EDGE_COLORS[targetHandleFor(dropState.sourceNodeType, linkable[0]?.type ?? "", dropState.sourceHandleId) ?? "default"] ?? EDGE_COLORS.default;

  const menuW = 224;
  const menuH = linkable.length * 58 + 36;
  const left  = isInput
    ? Math.max(dropState.screenX - menuW - 16, 16)
    : Math.min(dropState.screenX + 16, window.innerWidth - menuW - 16);
  const top   = Math.min(dropState.screenY - 10, window.innerHeight - menuH - 16);

  return (
    <>
      {/* Animated dashed preview line from source handle to drop point */}
      <svg
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
          pointerEvents: "none",
          zIndex: 999,
          overflow: "visible",
        }}
      >
        <path
          d={svgPath}
          fill="none"
          stroke={lineColor}
          strokeWidth={2}
          strokeDasharray="6 3"
          strokeDashoffset={0}
          strokeLinecap="round"
          className="pending-edge-line"
          opacity={0.75}
        />
      </svg>

      {/* Node picker */}
      <div
        ref={menuRef}
        style={{ position: "fixed", left, top, zIndex: 1000 }}
        className="w-56 bg-[#0F1214] border border-[#2A2A2A] rounded-lg shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b border-[#1E1E1E]">
          <p className="text-[10px] text-[#4A4A45] uppercase tracking-widest font-medium">
            Connect to
          </p>
        </div>

        {linkable.map((n) => {
          const meta = NODE_META[n.type];
          return (
            <button
              key={n.type}
              onClick={() => handleSelect(n.type)}
              onMouseDown={(e) => e.stopPropagation()}
              className="w-full text-left px-3 py-2.5 hover:bg-[#161A1E] transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <span
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "30px",
                    height: "30px",
                    borderRadius: "8px",
                    background: meta?.bg ?? "rgba(255,255,255,0.06)",
                    color: meta?.accent ?? "#aaa",
                    border: `1px solid ${meta?.accent ?? "#333"}28`,
                  }}
                >
                  {meta?.bigIcon ?? n.icon}
                </span>
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[13px] text-white font-medium leading-none">
                    {n.label}
                  </span>
                  <span className="text-[10px] text-[#4A4A45] leading-none">
                    {n.description}
                  </span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
