"use client";
import { useRef, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import NextImage from "next/image";
import { Handle, Position, NodeProps, Node, useUpdateNodeInternals } from "@xyflow/react";
import CornerResizer from "./CornerResizer";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { sha256Hex } from "@/lib/assetHash";


type ImageInputNodeType = Node<NodeData, "imageInputNode">;

export default function ImageInputNode({ id, data, selected }: NodeProps<ImageInputNodeType>) {
  const updateNodeData  = useWorkflowStore((s) => s.updateNodeData);
  const updateNodeSize  = useWorkflowStore((s) => s.updateNodeSize);
  const edges           = useWorkflowStore((s) => s.edges);
  const sourceConnected = edges.some((e) => e.source === id);
  const fileRef        = useRef<HTMLInputElement>(null);
  const rootRef        = useRef<HTMLDivElement>(null);
  const updateNodeInternals = useUpdateNodeInternals();

  // Persistent ResizeObserver — fires as image aspect ratio drives CSS height changes,
  // keeping group bounds in sync throughout the transition.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      updateNodeSize(id, el.offsetWidth, el.offsetHeight);
      updateNodeInternals(id);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, updateNodeSize, updateNodeInternals]);

  // Instant hide on deselect
  const prevSelectedRef = useRef(selected);
  useEffect(() => {
    const was = prevSelectedRef.current;
    prevSelectedRef.current = selected;
    if (was && !selected && rootRef.current) {
      const el = rootRef.current;
      el.classList.add("handles-no-delay");
      const t = setTimeout(() => el.classList.remove("handles-no-delay"), 200);
      return () => { clearTimeout(t); el.classList.remove("handles-no-delay"); };
    }
  }, [selected]);
  const nodeImgRef     = useRef<HTMLImageElement>(null);
  const [lightboxOpen, setLightboxOpen]           = useState(false);
  const [lightboxVisible, setLightboxVisible]     = useState(false);
  const [lightboxImgLoaded, setLightboxImgLoaded] = useState(false);
  const [blurSrc, setBlurSrc]                     = useState<string | null>(null);

  const openLightbox = useCallback(() => {
    // Grab the currentSrc of the already-rendered node image (cached low-quality URL)
    setBlurSrc(nodeImgRef.current?.currentSrc ?? null);
    setLightboxImgLoaded(false);
    setLightboxOpen(true);
    requestAnimationFrame(() => setLightboxVisible(true));
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxVisible(false);
    setTimeout(() => setLightboxOpen(false), 220);
  }, []);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeLightbox(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxOpen, closeLightbox]);

  const setImage = useCallback(
    (src: string, mimeType?: string) => {
      const img = new window.Image();
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
    async (file: File) => {
      // Read as ArrayBuffer — needed for hashing and direct binary upload
      const bytes = await file.arrayBuffer();
      const hash  = await sha256Hex(bytes);

      const { data: { session } } = await createClient().auth.getSession();
      const authToken = session?.access_token;
      const authHeaders = authToken ? { Authorization: `Bearer ${authToken}` } : {};

      // ── Cache lookup: skip upload if already in R2 ───────────────────────
      try {
        const lookupRes = await fetch(`/api/lookup-asset?hash=${hash}`, { headers: authHeaders });
        const { cdnUrl } = await lookupRes.json() as { cdnUrl: string | null };
        if (cdnUrl) {
          // Already uploaded — use existing URL directly
          const img = new window.Image();
          img.onload = () => updateNodeData(id, {
            inputImage:        cdnUrl,
            imageNaturalRatio: `${img.naturalWidth} / ${img.naturalHeight}`,
            r2Url:             cdnUrl,
          });
          img.src = cdnUrl;
          return;
        }
      } catch {
        // Lookup failed — fall through to normal upload
      }

      // ── Show local preview immediately ────────────────────────────────────
      const blobUrl = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        updateNodeData(id, {
          inputImage:        blobUrl,
          imageNaturalRatio: `${img.naturalWidth} / ${img.naturalHeight}`,
        });
      };
      img.src = blobUrl;

      // ── Upload raw bytes to R2 (hash stored server-side) ──────────────────
      try {
        const uploadHeaders: Record<string, string> = {
          "Content-Type": file.type || "image/jpeg",
          ...authHeaders,
        };
        const res     = await fetch("/api/upload-asset", { method: "POST", headers: uploadHeaders, body: bytes });
        const { cdnUrl } = await res.json() as { cdnUrl?: string };
        if (cdnUrl) {
          updateNodeData(id, { r2Url: cdnUrl, inputImage: cdnUrl });
        }
      } catch {
        // R2 unavailable — blob URL stays as fallback until page reload
      }
    },
    [id, updateNodeData]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file?.type.startsWith("image/")) loadFile(file);
    },
    [loadFile]
  );

  // ── Two-layer crossfade: old image stays visible until new one fades in ─────
  const canonicalSrc = (data.r2Url ?? data.inputImage) as string | undefined;

  // Local uploading state: true from mount (if no r2Url yet) until CDN URL arrives.
  // Using local state avoids any timing gap between store update and derived value.
  const [isUploading, setIsUploading] = useState(!data.r2Url && !!data.inputImage);
  useEffect(() => {
    if (data.r2Url) setIsUploading(false);
  }, [data.r2Url]);

  // The "settled" bottom layer — never changes mid-transition
  const [baseSrc, setBaseSrc] = useState(canonicalSrc);
  // The incoming top layer — fades from 0→1, then gets promoted to base
  const [topSrc, setTopSrc]   = useState<string | undefined>(undefined);
  const [topReady, setTopReady] = useState(false);   // triggers the CSS transition
  const baseSrcRef = useRef(baseSrc);

  useEffect(() => {
    if (!canonicalSrc) {
      // Asset removed — reset crossfade state so the empty state renders
      setBaseSrc(undefined);
      baseSrcRef.current = undefined;
      setTopSrc(undefined);
      setTopReady(false);
      return;
    }
    if (canonicalSrc === baseSrcRef.current) return;

    if (!baseSrcRef.current) {
      // No existing image — set directly, nothing to crossfade over
      setBaseSrc(canonicalSrc);
      baseSrcRef.current = canonicalSrc;
      return;
    }

    // New URL arrived — render it on top at opacity 0; onLoad will trigger the fade
    setTopSrc(canonicalSrc);
    setTopReady(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalSrc]);

  // Uploading = local blob present but CDN URL not yet confirmed
  const hasImage = !!baseSrc;
  // CSS aspect-ratio accepts "width / height" string directly (e.g. "1920 / 1080")
  const ratio    = (data.imageNaturalRatio as string | undefined) ?? "1 / 1";

  const [natW, natH] = (() => {
    const r = data.imageNaturalRatio as string | undefined;
    if (!r) return [0, 0];
    const parts = r.split("/").map((s) => parseInt(s.trim(), 10));
    return parts.length === 2 ? parts : [0, 0];
  })();

  if (hasImage) {
    return (
      // Outer: node-card for border/hover/selected styling + overflow:visible for corner handles.
      // aspect-ratio drives height so ReactFlow ResizeObserver auto-sizes the node.
      <div
        ref={rootRef}
        className={`node-card group${(data.hasError as boolean) ? " node-error-blink" : ""}`}
        style={{
          width: "100%",
          aspectRatio: ratio,
          background: "transparent",
        }}
        onAnimationEnd={(e) => { if (e.animationName === "node-error-blink") updateNodeData(id, { hasError: false }); }}
      >
        <CornerResizer minWidth={60} minHeight={60} keepAspectRatio />
        <span className="node-above-label">{data.label as string}</span>

        {/* Inner: clips image to border-radius */}
        <div
          className="relative w-full h-full"
          style={{ borderRadius: 7, overflow: "hidden" }}
          onDoubleClick={openLightbox}
        >
          {/* Layer 1 — base image */}
          {baseSrc && (
            // Use <NextImage> only for confirmed R2 CDN URLs — third-party URLs skip
            // next/image optimization because /_next/image fetches server-side and fails
            // for URLs that have auth, IP allowlists, or expiry (e.g. Replicate links).
            baseSrc === (data.r2Url as string | undefined) ? (
              <NextImage
                ref={nodeImgRef}
                src={baseSrc}
                alt="Input"
                fill
                quality={30}
                sizes="600px"
                style={{
                  objectFit: "fill", zIndex: 1,
                  animation: isUploading ? "upload-pulse 1.6s ease-in-out infinite" : undefined,
                }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={nodeImgRef}
                src={baseSrc}
                alt="Input"
                style={{
                  position: "absolute", inset: 0, width: "100%", height: "100%",
                  display: "block", objectFit: "fill", zIndex: 1,
                  animation: isUploading ? "upload-pulse 1.6s ease-in-out infinite" : undefined,
                }}
              />
            )
          )}

          {/* Layer 2 — incoming URL fades in on top, then gets promoted to base */}
          {topSrc && (
            <div
              aria-hidden
              onTransitionEnd={() => {
                const oldBase = baseSrcRef.current;
                setBaseSrc(topSrc);
                baseSrcRef.current = topSrc!;
                setTopSrc(undefined);
                setTopReady(false);
                if (oldBase?.startsWith("blob:")) URL.revokeObjectURL(oldBase);
              }}
              style={{
                position: "absolute", inset: 0, zIndex: 2,
                opacity: topReady ? 1 : 0,
                transition: "opacity 450ms ease",
                pointerEvents: "none",
              }}
            >
              {topSrc === (data.r2Url as string | undefined) ? (
                <NextImage
                  src={topSrc}
                  alt=""
                  fill
                  quality={30}
                  sizes="600px"
                  style={{ objectFit: "fill" }}
                  onLoad={() => requestAnimationFrame(() => requestAnimationFrame(() => setTopReady(true)))}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={topSrc}
                  alt=""
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", objectFit: "fill" }}
                  onLoad={() => requestAnimationFrame(() => requestAnimationFrame(() => setTopReady(true)))}
                />
              )}
            </div>
          )}


          {/* Resolution badge */}
          {natW > 0 && natH > 0 && (
            <div
              aria-hidden
              className="absolute top-1.5 right-2 pointer-events-none select-none z-30 tabular-nums px-1.5 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-150 node-slide-reveal"
              style={{ fontSize: 9, lineHeight: 1, color: "#fff", background: "#1a1a1a" }}
            >
              {natW} × {natH}
            </div>
          )}

          {/* Hover overlay */}
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          </div>
          <div className="absolute bottom-2 left-0 right-0 flex justify-center px-2.5 opacity-0 group-hover:opacity-100 transition-opacity node-slide-reveal">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => fileRef.current?.click()}
              className="h-6 px-3 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 text-[10px] text-[#CCCCCC] hover:text-white hover:bg-black/70 transition-colors relative z-10"
            >
              replace
            </button>
          </div>
        </div>

        {/* Handle rendered last so it sits above the image div in stacking order */}
              <Handle
                type="target"
                position={Position.Left}
                style={{ top: 20 }}
                className="node-handle-icon node-handle-icon-image"
                title="Image input"
              >
                <ImageInIcon />
              </Handle>

              <Handle
                type="source"
                position={Position.Right}
                style={{ top: 20 }}
                className={`node-handle-icon node-handle-icon-out-image${sourceConnected ? " node-handle-connected" : ""}`}
                title="Image output"
              >
                <ImageOutIcon />
              </Handle>


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

        {/* Lightbox — full-quality view on double-click */}
        {lightboxOpen && typeof document !== "undefined" && createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-200 ease-in-out"
            style={{ backgroundColor: `rgba(0,0,0,${lightboxVisible ? 0.9 : 0})`, opacity: lightboxVisible ? 1 : 0 }}
            onClick={closeLightbox}
          >
            <div
              className="relative transition-all duration-200 ease-in-out rounded-2xl overflow-hidden"
              style={{
                transform: lightboxVisible ? "scale(1)" : "scale(0.95)",
                boxShadow: "0 0 0 8px #3a3a3a",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Layer 1: full-res image */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={canonicalSrc}
                alt="Full quality"
                className="block max-w-[90vw] max-h-[90vh] object-contain"
                onLoad={() => setLightboxImgLoaded(true)}
              />

              {/* Layer 2: blur overlay — uses the already-cached node image, fades out once full-res loads */}
              {blurSrc && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={blurSrc}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full pointer-events-none"
                  style={{
                    objectFit:  "cover",
                    filter:     "blur(24px)",
                    transform:  "scale(1.1)",
                    opacity:    lightboxImgLoaded ? 0 : 1,
                    transition: "opacity 300ms ease",
                  }}
                />
              )}
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }

  // Empty state — upload card
  return (
    <div
      ref={rootRef}
      className={`node-card w-full${(data.hasError as boolean) ? " node-error-blink" : ""}`}
      style={{ minWidth: 200 }}
      onAnimationEnd={(e) => { if (e.animationName === "node-error-blink") updateNodeData(id, { hasError: false }); }}
    >
      <CornerResizer minWidth={160} minHeight={100} />
      <span className="node-above-label">{data.label as string}</span>

      <Handle
        type="target"
        position={Position.Left}
        style={{ top: 20 }}
        className="node-handle-icon node-handle-icon-image"
        title="Image input"
      >
        <ImageInIcon />
      </Handle>

      <Handle
        type="source"
        position={Position.Right}
        style={{ top: 20 }}
        className={`node-handle-icon node-handle-icon-out-image${sourceConnected ? " node-handle-connected" : ""}`}
        title="Image output"
      >
        <ImageOutIcon />
      </Handle>

      <div className="overflow-hidden rounded-[7px] p-2.5">
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className="border border-dashed border-[#1E2840] hover:border-[#243050] rounded-md cursor-pointer transition-colors py-8 text-center"
        >
          <p className="text-[11px] text-[#A0A0A0]">
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

function ImageOutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" fill="white" stroke="none" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function ImageInIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </svg>
  );
}
