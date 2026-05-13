"use client";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { useRef } from "react";
import { useGeneratingBorderAnimation } from "@/lib/useGeneratingBorderAnimation";

type VideoGenNodeType = Node<NodeData, "videoGenNode">;

const VIDEO_MODELS = [
  { value: "wan-t2v", label: "Wan 2.1 Text→Video" },
  { value: "wan-i2v", label: "Wan 2.1 Image→Video" },
  { value: "svd", label: "Stable Video Diffusion" },
];

const STATUS_RING: Record<string, string> = {
  idle: "border-gray-700",
  pending: "border-gray-500",
  running: "border-yellow-500",
  done: "border-emerald-500",
  error: "border-red-500",
};

export default function VideoGenNode({ id, data }: NodeProps<VideoGenNodeType>) {
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
      {/* Input handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        style={{ top: "35%" }}
        className="!w-3 !h-3 !bg-indigo-400 !border-2 !border-indigo-600"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{ top: "65%" }}
        className="!w-3 !h-3 !bg-purple-400 !border-2 !border-purple-600"
      />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-rose-900/60 border-b border-rose-700/50">
        <span className="text-rose-300 text-sm">🎬</span>
        <span className="text-rose-200 font-semibold text-sm">Video Generation</span>
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
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="text-gray-400 text-xs mb-1 block">Model</label>
            <select
              className="w-full bg-gray-800 border border-gray-600 rounded-lg text-gray-100 text-xs px-2 py-1.5 focus:outline-none focus:border-rose-500"
              value={data.model ?? "wan-t2v"}
              onChange={(e) => updateNodeData(id, { model: e.target.value })}
            >
              {VIDEO_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-20">
            <label className="text-gray-400 text-xs mb-1 block">Seconds</label>
            <input
              type="number"
              min={2}
              max={10}
              className="w-full bg-gray-800 border border-gray-600 rounded-lg text-gray-100 text-xs px-2 py-1.5 focus:outline-none focus:border-rose-500"
              value={data.duration ?? 5}
              onChange={(e) =>
                updateNodeData(id, { duration: Number(e.target.value) })
              }
            />
          </div>
        </div>

        <div className="text-gray-600 text-[10px] flex gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />
            Prompt in
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-400 inline-block" />
            Image in (optional)
          </span>
        </div>

        {/* Preview */}
        <div className="rounded-lg overflow-hidden bg-gray-800 border border-gray-700 min-h-[120px] flex items-center justify-center">
          {data.videoUrl ? (
            <video
              src={data.videoUrl}
              controls
              loop
              className="w-full"
              autoPlay
              muted
            />
          ) : (
            <span className="text-gray-600 text-xs">
              {status === "running" ? "Generating video…" : "Output will appear here"}
            </span>
          )}
        </div>

        {data.videoUrl && (
          <a
            href={data.videoUrl}
            target="_blank"
            rel="noreferrer"
            className="block text-center text-xs text-rose-400 hover:text-rose-300"
          >
            Download video ↗
          </a>
        )}
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-rose-400 !border-2 !border-rose-600"
      />
    </div>
  );
}
