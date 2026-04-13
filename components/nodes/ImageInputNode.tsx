"use client";
import { useRef, useCallback } from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import CornerResizer from "./CornerResizer";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";

type ImageInputNodeType = Node<NodeData, "imageInputNode">;

export default function ImageInputNode({ id, data }: NodeProps<ImageInputNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const fileRef        = useRef<HTMLInputElement>(null);

  const setImage = useCallback(
    (src: string, mimeType?: string) => {
      const img = new Image();
      img.onload = () => {
        updateNodeData(id, {
          inputImage: src,
          imageNaturalRatio: `${img.naturalWidth} / ${img.naturalHeight}`,
        });

        // Upload to R2 in the background; swap inputImage for the durable CDN URL
        if (src.startsWith("data:") || src.startsWith("http")) {
          (async () => {
            try {
              const { data: { session } } = await createClient().auth.getSession();
              const headers: Record<string, string> = { "Content-Type": "application/json" };
              if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

              const r = await fetch("/api/upload-to-r2", {
                method: "POST",
                headers,
                body: JSON.stringify({ dataUrl: src, folder: "uploads", mimeType }),
              });
              const { cdnUrl } = await r.json();
              if (cdnUrl) updateNodeData(id, { r2Url: cdnUrl });
            } catch {
              // R2 unavailable — base64 stays as fallback
            }
          })();
        }
      };
      img.src = src;
    },
    [id, updateNodeData]
  );

  const loadFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => setImage(e.target?.result as string, file.type);
      reader.readAsDataURL(file);
    },
    [setImage]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file?.type.startsWith("image/")) loadFile(file);
    },
    [loadFile]
  );

  // Prefer the durable R2 CDN URL; fall back to base64 in the current session
  const imageSrc = (data.r2Url ?? data.inputImage) as string | undefined;
  const hasImage = !!imageSrc;
  // CSS aspect-ratio accepts "width / height" string directly (e.g. "1920 / 1080")
  const ratio    = (data.imageNaturalRatio as string | undefined) ?? "1 / 1";

  if (hasImage) {
    return (
      // Outer: node-card for border/hover/selected styling + overflow:visible for corner handles.
      // aspect-ratio drives height so ReactFlow ResizeObserver auto-sizes the node.
      <div
        className="node-card group"
        style={{
          width: "100%",
          aspectRatio: ratio,
          background: "transparent",
        }}
      >
        <CornerResizer minWidth={60} minHeight={60} keepAspectRatio />
        <span className="node-above-label">{data.label as string}</span>

        {/* Inner: clips image to border-radius */}
        <div className="relative w-full h-full" style={{ borderRadius: 7, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc}
            alt="Input"
            style={{ width: "100%", height: "100%", display: "block", objectFit: "fill" }}
          />

          {/* Hover overlay */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          </div>
          <div className="absolute bottom-2 left-0 right-0 flex justify-between px-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => fileRef.current?.click()}
              className="text-[10px] text-[#8D8E89] hover:text-white transition-colors relative z-10"
            >
              replace
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => updateNodeData(id, { inputImage: undefined, imageNaturalRatio: undefined })}
              className="text-[10px] text-[#8D8E89] hover:text-white transition-colors relative z-10"
            >
              remove
            </button>
          </div>
        </div>

        {/* Handle rendered last so it sits above the image div in stacking order */}
        <Handle type="source" position={Position.Right} className="node-handle node-handle-source" />

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
          }}
        />
      </div>
    );
  }

  // Empty state — upload card
  return (
    <div className="node-card w-full" style={{ minWidth: 200 }}>
      <CornerResizer minWidth={160} minHeight={100} />
      <span className="node-above-label">{data.label as string}</span>
      <Handle type="source" position={Position.Right} className="node-handle node-handle-source" />

      <div className="overflow-hidden rounded-[7px] p-2.5">
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className="border border-dashed border-[#2A1A14] hover:border-[#3A2820] rounded-md cursor-pointer transition-colors py-8 text-center"
        >
          <p className="text-[11px] text-[#8D8E89]">
            Drop image or{" "}
            <span className="underline underline-offset-2 text-white">browse</span>
          </p>
        </div>
        <input
          type="text"
          className="node-input mt-2"
          placeholder="or paste image URL…"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v) setImage(v);
          }}
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
        }}
      />
    </div>
  );
}
