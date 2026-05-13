"use client";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { useRef } from "react";
import { useGeneratingBorderAnimation } from "@/lib/useGeneratingBorderAnimation";

type ImageGenNodeType = Node<NodeData, "imageGenNode">;

const IMAGE_MODELS = [
  { value: "flux-schnell", label: "Flux Schnell (fast)" },
  { value: "flux-dev", label: "Flux Dev (quality)" },
  { value: "sdxl", label: "Stable Diffusion XL" },
];

const STATUS_RING: Record<string, string> = {
  idle: "border-gray-700",
  pending: "border-gray-500",
  running: "border-yellow-500",
  done: "border-emerald-500",
  error: "border-red-500",
};

export default function ImageGenNode({ id, data }: NodeProps<ImageGenNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const status = data.status ?? "idle";
  const cardRef = useRef<HTMLDivElement>(null);
  const busy = status === "running";

  useGeneratingBorderAnimation(cardRef, busy);

  return (
    <div
      ref={cardRef}
      className={`node-card bg-gray-900 border-2 rounded-xl w-72 shadow-lg overflow-hidden ${STATUS_RING[status]} ${busy ? "node-generating" : ""}`}
    >
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        className="!w-3 !h-3 !bg-indigo-400 !border-2 !border-indigo-600"
      />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-purple-900/60 border-b border-purple-700/50">
        <span className="text-purple-300 text-sm">🎨</span>
        <span className="text-purple-200 font-semibold text-sm">Image Generation</span>
        {status === "running" && (
          <span className="ml-auto text-yellow-400 text-xs animate-pulse">Generating…</span>
        )}
        {status === "done" && (
          <span className="ml-auto text-emerald-400 text-xs">Done</span>
        )}
        {status === "error" && (
          <span className="ml-auto text-red-400 text-xs">Error</span>
        )}
      </div>

      {/* Body */}
      <div className="p-3 space-y-2">
        <div>
          <label className="text-gray-400 text-xs mb-1 block">Model</label>
          <select
            className="w-full bg-gray-800 border border-gray-600 rounded-lg text-gray-100 text-xs px-2 py-1.5 focus:outline-none focus:border-purple-500"
            value={data.model ?? "flux-schnell"}
            onChange={(e) => updateNodeData(id, { model: e.target.value })}
          >
            {IMAGE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Preview */}
        <div className="rounded-lg overflow-hidden bg-gray-800 border border-gray-700 min-h-[120px] flex items-center justify-center">
          {data.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.imageUrl}
              alt="Generated"
              className="w-full object-cover"
            />
          ) : (
            <span className="text-gray-600 text-xs">
              {status === "running" ? "Generating image…" : "Output will appear here"}
            </span>
          )}
        </div>

        {data.imageUrl && (
          <a
            href={data.imageUrl}
            target="_blank"
            rel="noreferrer"
            className="block text-center text-xs text-purple-400 hover:text-purple-300"
          >
            Open full size ↗
          </a>
        )}
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-purple-400 !border-2 !border-purple-600"
      />
    </div>
  );
}
