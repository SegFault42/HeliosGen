"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, NodeProps, Node, useUpdateNodeInternals } from "@xyflow/react";
import CornerResizer from "./CornerResizer";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { resolveInputs } from "@/lib/executor";

type GenerateNodeType = Node<NodeData, "generateNode">;

import { IMAGE_MODELS } from "@/lib/modelConfig";

/** Return a Cloudflare-resized URL for display. Falls back to original if not a CF URL. */
function cfImg(url: string, width: number): string {
  try {
    const u = new URL(url);
    return `${u.origin}/cdn-cgi/image/width=${width},quality=75,format=webp${u.pathname}`;
  } catch {
    return url;
  }
}

// Derived from config — no hardcoding needed
const MODELS     = IMAGE_MODELS.map((m) => ({ id: m.id, name: m.name, meta: m.provider }));
const MODEL_CAPS = Object.fromEntries(
  IMAGE_MODELS.map((m) => [m.id, {
    supportsImages:  m.supportsImages,
    supportsQuality: m.supportsQuality,
    ratios:          m.ratios,
    maxImages:       m.maxImages,
    qualityOptions:  m.apiInput.qualityOptions,
  }])
);
const DEFAULT_CAPS = MODEL_CAPS["nano-banana-2"];

// ── Aspect ratios ─────────────────────────────────────────────────────────────

// (each model defines its own subset — see MODEL_CAPS above)

function ratioRect(value: string) {
  const [w, h] = value.split(":").map(Number);
  const maxW = 20, maxH = 14;
  const scale = Math.min(maxW / w, maxH / h);
  const rw = Math.round(w * scale);
  const rh = Math.round(h * scale);
  return { rw, rh, x: Math.round((maxW - rw) / 2), y: Math.round((maxH - rh) / 2) };
}

// ── Status dot ────────────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  idle:    "bg-[#2A1A14]",
  running: "bg-amber-400 animate-pulse",
  done:    "bg-[#77E544]",
  error:   "bg-red-500",
};

// ── Component ────────────────────────────────────────────────────────────────

export default function GenerateNode({ id, data }: NodeProps<GenerateNodeType>) {
  const updateNodeData       = useWorkflowStore((s) => s.updateNodeData);
  const updateNodeSize       = useWorkflowStore((s) => s.updateNodeSize);
  const removeEdgesForHandle = useWorkflowStore((s) => s.removeEdgesForHandle);
  const setAuthModalOpen     = useWorkflowStore((s) => s.setAuthModalOpen);
  const nodes                = useWorkflowStore((s) => s.nodes);
  const edges                = useWorkflowStore((s) => s.edges);
  const debugMode            = useWorkflowStore((s) => s.debugMode);

  const updateNodeInternals = useUpdateNodeInternals();
  const cardRef = useRef<HTMLDivElement>(null);

  const [modelOpen, setModelOpen]     = useState(false);
  const [ratioOpen, setRatioOpen]     = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [hoveredHandle, setHoveredHandle] = useState<"prompt" | "image" | null>(null);

  const model       = (data.model as string) ?? "nano-banana-2";
  const caps        = MODEL_CAPS[model] ?? DEFAULT_CAPS;
  const modelInfo   = MODELS.find((m) => m.id === model) ?? MODELS[0];
  const quality     = (data.quality as string) ?? "1k";
  const status      = data.status ?? "idle";

  // If current ratio isn't valid for this model, fall back to 1:1
  const rawRatio  = (data.aspectRatio as string) ?? "1:1";
  const aspectRatio = caps.ratios.includes(rawRatio) ? rawRatio : "1:1";

  const [rw, rh] = aspectRatio.split(":").map(Number);
  const cssRatio = `${rw} / ${rh}`;
  const busy     = loading || status === "running";

  // Re-sync edge anchor positions whenever the node resizes
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (cardRef.current) {
        const { offsetWidth, offsetHeight } = cardRef.current;
        updateNodeSize(id, offsetWidth, offsetHeight);
      }
      updateNodeInternals(id);
    });
    return () => cancelAnimationFrame(raf);
  }, [id, aspectRatio, data.imageNaturalRatio, updateNodeSize, updateNodeInternals]);

  const closeDropdowns = () => {
    setModelOpen(false);
    setRatioOpen(false);
    setQualityOpen(false);
  };

  // ── Poll /api/job-status while a taskId is pending ──────────────────────────
  useEffect(() => {
    const taskId = data.taskId as string | undefined;
    if (!taskId || status !== "running") return;

    let cancelled = false;

    const interval = setInterval(async () => {
      try {
        const res  = await fetch(`/api/job-status?taskId=${taskId}`);
        const json = await res.json();
        if (cancelled) return;

        if (json.status === "done") {
          updateNodeData(id, { status: "done", imageUrl: json.imageUrl, taskId: undefined });
          clearInterval(interval);
        } else if (json.status === "error") {
          updateNodeData(id, { status: "error", errorMsg: json.error, taskId: undefined });
          clearInterval(interval);
        } else if (json.status === "not_found") {
          // Server restarted and lost the job — mark as error
          updateNodeData(id, { status: "error", errorMsg: "Job lost (server restarted)", taskId: undefined });
          clearInterval(interval);
        }
        // "pending" → keep polling
      } catch {
        // network hiccup — keep polling
      }
    }, 3000);

    return () => { cancelled = true; clearInterval(interval); };
  }, [data.taskId, status, id, updateNodeData]);

  // ── Submit generation job ────────────────────────────────────────────────────
  // Returns the source node id of the connected prompt handle, or undefined
  const connectedPromptNodeId = edges.find(
    (e) => e.target === id && e.targetHandle === "prompt"
  )?.source;

  const generate = useCallback(async () => {
    const { data } = await createClient().auth.getSession();
    if (!data.session) { setAuthModalOpen(true); return; }

    const upstream  = resolveInputs(id, nodes as Node<NodeData>[], edges);
    const prompt    = upstream.prompt;
    const imageUrls = upstream.imageUrls;
    const payload   = { model, prompt, imageUrls, aspectRatio, quality };

    if (!prompt.trim()) {
      if (connectedPromptNodeId) {
        updateNodeData(connectedPromptNodeId, { hasError: true });
      }
      return;
    }

    if (debugMode) {
      console.log(`[DEBUG] node=${id}`, payload);
      setLoading(true);
      await new Promise((r) => setTimeout(r, 3000));
      setLoading(false);
      return;
    }

    setLoading(true);
    updateNodeData(id, { status: "running", imageUrl: undefined, imageNaturalRatio: undefined, errorMsg: undefined, taskId: undefined });
    try {
      const res  = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      // Store taskId — the useEffect above will poll until done
      updateNodeData(id, { taskId: json.taskId });
    } catch (e: unknown) {
      updateNodeData(id, { status: "error", errorMsg: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, [id, nodes, edges, model, aspectRatio, quality, debugMode, connectedPromptNodeId, updateNodeData]);

  // node-card has position:relative — handles and label position relative to it
  return (
    <div
      ref={cardRef}
      className="node-card w-full flex flex-col"
      style={{ minWidth: 280, ...(busy ? { animation: "node-pulse-glow 2.4s ease-in-out infinite" } : {}) }}
      onMouseLeave={closeDropdowns}
    >
      <CornerResizer minWidth={220} minHeight={80} keepAspectRatio={!!data.imageUrl} />
      <span className="node-above-label">{data.label as string}</span>

        {/* ── Icon handles ──────────────────────────────────────────────── */}
        <Handle
          type="target"
          position={Position.Left}
          id="prompt"
          style={{ top: "36%" }}
          className="node-handle-icon node-handle-icon-prompt"
          onMouseEnter={() => setHoveredHandle("prompt")}
          onMouseLeave={() => setHoveredHandle(null)}
        >
          <PromptIcon />
        </Handle>

        {caps.supportsImages && (
          <Handle
            type="target"
            position={Position.Left}
            id="image"
            style={{ top: "72%" }}
            className="node-handle-icon node-handle-icon-resource"
            onMouseEnter={() => setHoveredHandle("image")}
            onMouseLeave={() => setHoveredHandle(null)}
          >
            <PhotoIcon />
          </Handle>
        )}

        {/* ── Handle tooltip ────────────────────────────────────────────── */}
        {hoveredHandle && (
          <div
            className="absolute pointer-events-none z-[1001] text-[10px] px-2.5 py-1 rounded-lg whitespace-nowrap shadow-xl"
            style={{
              top:       hoveredHandle === "prompt" ? "36%" : "72%",
              left:      0,
              transform: "translate(calc(-100% - 34px), -50%)",
              background: "#1A1A1A",
              border: `1px solid ${hoveredHandle === "prompt" ? "#77E54433" : "#fb923c33"}`,
              color: "#CCCCCC",
            }}
          >
            <span
              style={{ color: hoveredHandle === "prompt" ? "#77E544" : "#fb923c" }}
              className="mr-1.5"
            >●</span>
            {hoveredHandle === "prompt"
              ? "Text prompt"
              : caps.maxImages > 0
                ? `Reference image (up to ${caps.maxImages})`
                : "Reference image"
            }
          </div>
        )}

        <Handle type="source" position={Position.Right} className="node-handle node-handle-source" />

        {/* ── Image area — top corners clip to card border-radius ───────── */}
        <div
          className="relative bg-[#090B0D] overflow-hidden rounded-t-[7px]"
          style={{
            aspectRatio: (data.imageNaturalRatio as string | undefined) ?? cssRatio,
            width: "100%",
          }}
        >
          {data.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cfImg(data.imageUrl as string, 800)}
              alt="Generated"
              className="w-full h-full object-fill block"
              onLoad={(e) => {
                const img = e.currentTarget;
                const nw = img.naturalWidth, nh = img.naturalHeight;
                updateNodeData(id, { imageNaturalRatio: `${nw} / ${nh}` });
                // Sync node stored size to the rendered card dimensions so
                // ReactFlow and keepAspectRatio work from the correct base.
                requestAnimationFrame(() => {
                  if (!cardRef.current) return;
                  const w = cardRef.current.offsetWidth;
                  const h = cardRef.current.offsetHeight;
                  if (w > 0 && h > 0) updateNodeSize(id, w, h);
                });
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {status === "error" && (
                <p className="text-red-800 text-[10px] px-4 text-center leading-5">
                  {(data.errorMsg as string) ?? "Generation failed"}
                </p>
              )}
            </div>
          )}

        </div>

        {/* ── Control bar ─────────────────────────────────────────────────
             Lives outside the image area — dropdowns open freely.          */}
        <div className="flex items-center gap-2 px-2.5 py-[7px] border-t border-[#1E1410] shrink-0">
          {/* Status dot */}
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[status]}`} />

          {/* Model dropdown — locked once a result exists */}
          <div className="relative flex-1 min-w-0">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (data.imageUrl) return;
                setModelOpen((o) => !o); setRatioOpen(false); setQualityOpen(false);
              }}
              className={`flex items-center gap-1 w-full text-left ${data.imageUrl ? "cursor-default" : ""}`}
              title={data.imageUrl ? "Clear the image to change model" : undefined}
            >
              <span className={`text-[11px] truncate transition-colors ${data.imageUrl ? "text-[#555]" : "text-[#8D8E89] hover:text-white"}`}>
                {modelInfo.name}
              </span>
              {!data.imageUrl && <ChevronIcon open={modelOpen} />}
            </button>

            {modelOpen && !data.imageUrl && (
              <div className="absolute bottom-full left-0 mb-2 w-44 bg-[#0F1214] border border-[#2A1A14] rounded-md overflow-hidden z-50 shadow-2xl">
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      const newCaps     = MODEL_CAPS[m.id] ?? DEFAULT_CAPS;
                      const validRatio  = newCaps.ratios.includes(aspectRatio) ? aspectRatio : "1:1";
                      const validQuality = newCaps.qualityOptions && !newCaps.qualityOptions.includes(quality as "1k" | "2k" | "4k")
                        ? newCaps.qualityOptions[0]
                        : quality;
                      updateNodeData(id, { model: m.id, aspectRatio: validRatio, quality: validQuality });
                      // Unlink any attached images if the new model doesn't support them
                      if (!newCaps.supportsImages) removeEdgesForHandle(id, "image");
                      setModelOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-[7px] text-[11px] hover:bg-[#161214] transition-colors ${
                      model === m.id ? "text-white" : "text-[#8D8E89]"
                    }`}
                  >
                    <span>{m.name}</span>
                    <span className="text-[#4A4A45]">{m.meta}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Divider */}
          <span className="w-px h-3 bg-[#2A1A14] shrink-0" />

          {/* Aspect ratio dropdown */}
          <div className="relative shrink-0">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { setRatioOpen((o) => !o); setModelOpen(false); setQualityOpen(false); }}
              className="flex items-center gap-1"
            >
              <span className="text-[11px] text-[#8D8E89] hover:text-white transition-colors tabular-nums">
                {aspectRatio}
              </span>
              <ChevronIcon open={ratioOpen} />
            </button>

            {ratioOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-32 bg-[#0F1214] border border-[#2A1A14] rounded-md overflow-hidden z-50 shadow-2xl">
                {caps.ratios.map((r) => {
                  const { rw: iw, rh: ih, x, y } = ratioRect(r);
                  const active = r === aspectRatio;
                  return (
                    <button
                      key={r}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => { updateNodeData(id, { aspectRatio: r }); setRatioOpen(false); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-[7px] text-[11px] hover:bg-[#161214] transition-colors ${
                        active ? "text-white" : "text-[#8D8E89]"
                      }`}
                    >
                      <svg width="20" height="14" viewBox="0 0 20 14" className="shrink-0">
                        <rect
                          x={x} y={y} width={iw} height={ih} rx="1"
                          fill={active ? "#FFFFFF" : "none"}
                          stroke={active ? "#FFFFFF" : "#5A5A55"}
                          strokeWidth="1"
                        />
                      </svg>
                      <span className="tabular-nums">{r}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {caps.supportsQuality && (
            <>
              {/* Divider */}
              <span className="w-px h-3 bg-[#2A1A14] shrink-0" />

              {/* Quality dropdown */}
              <div className="relative shrink-0">
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => { setQualityOpen((o) => !o); setModelOpen(false); setRatioOpen(false); }}
                  className="flex items-center gap-1"
                >
                  <span className="text-[11px] text-[#8D8E89] hover:text-white transition-colors uppercase">
                    {quality}
                  </span>
                  <ChevronIcon open={qualityOpen} />
                </button>

                {qualityOpen && (
                  <div className="absolute bottom-full right-0 mb-2 w-36 bg-[#0F1214] border border-[#2A1A14] rounded-md overflow-hidden z-50 shadow-2xl">
                    {[
                      { id: "1k", label: "1K", meta: "Standard" },
                      { id: "2k", label: "2K", meta: "High" },
                      { id: "4k", label: "4K", meta: "Maximum" },
                    ].filter((q) => !caps.qualityOptions || caps.qualityOptions.includes(q.id as "1k" | "2k" | "4k")).map((q) => (
                      <button
                        key={q.id}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => { updateNodeData(id, { quality: q.id }); setQualityOpen(false); }}
                        className={`w-full flex items-center justify-between px-3 py-[7px] text-[11px] hover:bg-[#161214] transition-colors ${
                          quality === q.id ? "text-white" : "text-[#8D8E89]"
                        }`}
                      >
                        <span className="uppercase font-medium">{q.label}</span>
                        <span className="text-[#4A4A45]">{q.meta}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Divider */}
          <span className="w-px h-3 bg-[#2A1A14] shrink-0" />

          {/* Generate button */}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={generate}
            disabled={busy}
            className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full border border-[#2A1A14] hover:border-[#77E544] text-[#8D8E89] hover:text-[#77E544] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg width="7" height="8" viewBox="0 0 7 8" fill="currentColor">
              <path d="M6.5 3.634a.5.5 0 0 1 0 .732L1 7.83A.5.5 0 0 1 .25 7.464V.536A.5.5 0 0 1 1 .17l5.5 3.464Z"/>
            </svg>
          </button>

        </div>

      {busy && <SpinnerOverlay />}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function SpinnerOverlay() {
  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex",
      alignItems: "center", justifyContent: "center",
      pointerEvents: "none", zIndex: 20,
    }}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ animation: "spin 0.9s linear infinite" }}>
        <circle cx="14" cy="14" r="11" stroke="#333" strokeWidth="2.5" />
        <path d="M14 3 A11 11 0 0 1 25 14" stroke="#77E544" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function PromptIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="white">
      <path d="M2 2h12v2.5H9.5V14h-3V4.5H2V2z" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg width="15" height="13" viewBox="0 0 18 15" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="16" height="13" rx="2" />
      <circle cx="5.5" cy="5" r="1.5" fill="white" stroke="none" />
      <path d="m1 11 4.5-4.5 3 3 2.5-2.5 6 4" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="8" height="8" viewBox="0 0 8 8" fill="none"
      stroke="#5A5A55" strokeWidth="1.5" strokeLinecap="round"
      className={`shrink-0 transition-transform duration-100 ${open ? "rotate-180" : ""}`}
    >
      <path d="M1 2.5 4 5.5 7 2.5"/>
    </svg>
  );
}

function Spinner({ size = "md" }: { size?: "sm" | "md" }) {
  const cls = size === "sm" ? "w-2.5 h-2.5" : "w-5 h-5";
  return (
    <span className={`${cls} border border-[#2A1A14] border-t-[#77E544] rounded-full animate-spin inline-block`} />
  );
}
