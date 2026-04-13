"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, NodeProps, Node, useUpdateNodeInternals } from "@xyflow/react";
import CornerResizer from "./CornerResizer";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { resolveInputs } from "@/lib/executor";
import { createClient } from "@/lib/supabase/client";
import { VIDEO_MODELS as VIDEO_MODEL_CFG } from "@/lib/modelConfig";

type VideoGeneratorNodeType = Node<NodeData, "videoGeneratorNode">;

// ── Handles ───────────────────────────────────────────────────────────────────

type HandleDef = { id: string; label: string; topPct: number; className: string };

const KLING_HANDLES: HandleDef[] = [
  { id: "prompt", label: "Text prompt", topPct: 26, className: "node-handle-icon node-handle-icon-prompt" },
  { id: "startFrame", label: "Start frame", topPct: 44, className: "node-handle-icon node-handle-icon-image" },
  { id: "endFrame", label: "End frame", topPct: 60, className: "node-handle-icon node-handle-icon-image" },
  { id: "resource", label: "Reference images (up to 3)", topPct: 77, className: "node-handle-icon node-handle-icon-resource" },
];

const HANDLE_COLORS: Record<string, string> = {
  prompt: "#77E544",
  startFrame: "#818cf8",
  endFrame: "#818cf8",
  resource: "#fb923c",
};

const STATUS_DOT: Record<string, string> = {
  idle: "bg-[#1E1E1E]",
  running: "bg-amber-400 animate-pulse",
  done: "bg-[#34d399]",
  error: "bg-red-500",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function VideoGeneratorNode({ id, data }: NodeProps<VideoGeneratorNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const updateNodeSize = useWorkflowStore((s) => s.updateNodeSize);
  const setAuthModalOpen = useWorkflowStore((s) => s.setAuthModalOpen);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const debugMode = useWorkflowStore((s) => s.debugMode);

  const updateNodeInternals = useUpdateNodeInternals();
  const cardRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(false);
  const [hoveredHand, setHoveredHand] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [durOpen, setDurOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [grokResOpen, setGrokResOpen] = useState(false);

  // ── Data ──────────────────────────────────────────────────────────────────
  const videoModelId = (data.videoModel as string) ?? "kling-3.0";
  const cfg = VIDEO_MODEL_CFG.find((m) => m.id === videoModelId) ?? VIDEO_MODEL_CFG[0];

  const mode = (data.klingMode as string) ?? cfg.defaultMode ?? "";
  const resolution = (data.grokResolution as string) ?? cfg.defaultResolution ?? "";
  const duration = (data.duration as number) ?? cfg.defaultDuration;
  const aspectRatio = (data.aspectRatio as string) ?? cfg.defaultRatio;
  const sound = (data.sound as boolean) ?? false;
  const status = (data.status as string) ?? "idle";
  const prompt = (data.prompt as string) ?? "";
  const busy = loading || status === "running";

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

  // All 4 handle slots always render at fixed positions so anchors never jump.
  // Handles not in cfg.handles are hidden.
  const handles = KLING_HANDLES;
  const activeHandles = new Set<string>(cfg.handles);
  const ratios = cfg.ratios;
  const durations = cfg.durations;

  const closeAll = () => {
    setModelOpen(false); setRatioOpen(false); setDurOpen(false);
    setModeOpen(false); setGrokResOpen(false);
  };

  const textEdge = edges.find((e) => e.target === id && e.targetHandle === "prompt");
  const textNode = textEdge ? nodes.find((n) => n.id === textEdge.source) : undefined;
  const hasResource = edges.some((e) => e.target === id && e.targetHandle === "resource");

  // ── Generate ──────────────────────────────────────────────────────────────
  const generate = useCallback(async () => {
    const { data: authData } = await createClient().auth.getSession();
    if (!authData.session) { setAuthModalOpen(true); return; }

    const upstream = resolveInputs(id, nodes as Node<NodeData>[], edges);
    const finalPrompt = upstream.prompt ?? prompt;

    if (!finalPrompt.trim()) {
      if (textEdge) updateNodeData(textEdge.source, { hasError: true });
      return;
    }

    // Build full payload first so debug log matches what gets sent
    const payload: Record<string, unknown> = {
      videoModel: videoModelId,
      prompt: finalPrompt,
      aspectRatio,
      duration,
      mode,
      resolution,
      sound,
      startFrameUrl: upstream.startFrameUrl,
      endFrameUrl: upstream.endFrameUrl,
      resources: upstream.resources,
      referenceImageUrls: upstream.resources.length > 0
        ? upstream.resources.map((r) => r.url)
        : undefined,
    };

    if (debugMode) {
      console.log(`[DEBUG] videoNode=${id}`, payload);
      setLoading(true);
      await new Promise((r) => setTimeout(r, 3000));
      setLoading(false);
      return;
    }

    setLoading(true);
    updateNodeData(id, { status: "running", videoUrl: undefined, imageNaturalRatio: undefined, errorMsg: undefined });

    try {
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      updateNodeData(id, { status: "done", videoUrl: json.videoUrl });
    } catch (e: unknown) {
      updateNodeData(id, {
        status: "error",
        errorMsg: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [id, nodes, edges, prompt, sound, duration, aspectRatio, videoModelId,
    mode, resolution, cfg, debugMode, textEdge, updateNodeData, setAuthModalOpen]);

  const hoveredDef = hoveredHand && activeHandles.has(hoveredHand)
    ? handles.find((h) => h.id === hoveredHand)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={cardRef}
      className="video-node-card node-card w-full h-full flex flex-col"
      style={{ minWidth: 320, minHeight: 280, ...(busy ? { animation: "video-node-pulse-glow 2.4s ease-in-out infinite" } : {}) }}
      onMouseLeave={closeAll}
    >
      <CornerResizer minWidth={280} minHeight={80} keepAspectRatio={!!data.videoUrl} />

      <span className="node-above-label" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <VideoNodeIcon />
        {data.label as string}
      </span>

      {/* ── Handles ──────────────────────────────────────────────────── */}
      {handles.map((h) => {
        const hidden = !activeHandles.has(h.id);
        return (
          <Handle
            key={h.id}
            type="target"
            position={Position.Left}
            id={h.id}
            style={{ top: `${h.topPct}%`, visibility: hidden ? "hidden" : "visible", pointerEvents: hidden ? "none" : "auto" }}
            className={h.className}
            onMouseEnter={() => { if (!hidden) setHoveredHand(h.id); }}
            onMouseLeave={() => setHoveredHand(null)}
          >
            {h.id === "prompt" && <PromptIcon />}
            {h.id === "startFrame" && <FrameStartIcon />}
            {h.id === "endFrame" && <FrameEndIcon />}
            {h.id === "resource" && <ResourceIcon />}
          </Handle>
        );
      })}

      {/* Handle tooltip */}
      {hoveredDef && (
        <div
          className="absolute pointer-events-none z-[1001] text-[10px] px-2.5 py-1 rounded-lg whitespace-nowrap shadow-xl"
          style={{
            top: `${hoveredDef.topPct}%`,
            left: 0,
            transform: "translate(calc(-100% - 34px), -50%)",
            background: "#1A1A1A",
            border: `1px solid ${HANDLE_COLORS[hoveredDef.id]}33`,
            color: "#CCCCCC",
          }}
        >
          <span style={{ color: HANDLE_COLORS[hoveredDef.id] }} className="mr-1.5">●</span>
          {hoveredDef.label}
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────── */}
      {data.videoUrl ? (
        <div
          className="relative bg-[#090B0D] rounded-t-[7px] overflow-hidden"
          style={{ aspectRatio: (data.imageNaturalRatio as string | undefined) ?? "16 / 9", width: "100%" }}
        >
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={data.videoUrl as string}
            className="w-full h-full object-fill block"
            controls loop playsInline
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (!v.videoWidth || !v.videoHeight) return;
              updateNodeData(id, { imageNaturalRatio: `${v.videoWidth} / ${v.videoHeight}` });
              const nodeWidth = cardRef.current?.offsetWidth ?? 320;
              const videoH = nodeWidth * (v.videoHeight / v.videoWidth);
              updateNodeSize(id, nodeWidth, videoH + 76); // 76 = two control rows
            }}
          />
        </div>
      ) : (
        <div className="relative flex-1 bg-[#090B0D] rounded-t-[7px] overflow-hidden" style={{ minHeight: 160 }}>
          {status === "error" && (
            <p className="absolute top-3 left-0 right-0 text-center text-[10px] text-red-600 px-4 leading-5">
              {(data.errorMsg as string) ?? "Generation failed"}
            </p>
          )}
          {textNode ? (
            <div className="absolute bottom-3 left-4 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#77E544] shrink-0" />
              <span className="text-[11px] text-[#555]">{textNode.data.label as string}</span>
            </div>
          ) : (
            <textarea
              className="absolute bottom-0 left-0 right-0 bg-transparent text-[13px] leading-relaxed resize-none outline-none px-4 pt-3 pb-3 z-10 placeholder-[#3A3A3A]"
              style={{ color: "#666", minHeight: 80 }}
              placeholder="Describe the video you want to generate..."
              value={prompt}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
            />
          )}
        </div>
      )}

      {/* ── Row 1: model · ratio · duration ──────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-[#111]">
        {/* Model selector */}
        <div className="relative">
          <Pill onClick={() => { setModelOpen((o) => !o); setRatioOpen(false); setDurOpen(false); setModeOpen(false); setGrokResOpen(false); }}>
            <span className="text-[11px] text-[#AAAAAA]">{cfg.name}</span>
            <ChevronIcon open={modelOpen} />
          </Pill>
          {modelOpen && (
            <FloatMenu>
              {VIDEO_MODEL_CFG.map((m) => (
                <button
                  key={m.id}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    const validRatio = m.ratios.includes(aspectRatio) ? aspectRatio : m.defaultRatio;
                    const validDur = m.durations.includes(duration) ? duration : m.defaultDuration;
                    updateNodeData(id, { videoModel: m.id, aspectRatio: validRatio, duration: validDur });
                    setModelOpen(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-[11px] hover:bg-[#161A1E] transition-colors ${videoModelId === m.id ? "text-white font-medium" : "text-[#8D8E89]"
                    }`}
                >
                  <span>{m.name}</span>
                  <span className="text-[#4A4A45]">{m.provider}</span>
                </button>
              ))}
            </FloatMenu>
          )}
        </div>

        {/* Aspect ratio */}
        <div className="relative">
          <Pill onClick={() => { setRatioOpen((o) => !o); setModelOpen(false); setDurOpen(false); setModeOpen(false); setGrokResOpen(false); }}>
            <AspectIcon ratio={aspectRatio} />
            <span className="text-[11px] text-[#AAAAAA]">{aspectRatio}</span>
            <ChevronIcon open={ratioOpen} />
          </Pill>
          {ratioOpen && (
            <FloatMenu>
              {(ratios as readonly string[]).map((r) => (
                <FloatItem key={r} active={aspectRatio === r} onClick={() => { updateNodeData(id, { aspectRatio: r }); setRatioOpen(false); }}>
                  {r}
                </FloatItem>
              ))}
            </FloatMenu>
          )}
        </div>

        {/* Duration */}
        <div className="relative flex-1">
          <Pill fullWidth onClick={() => { setDurOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setModeOpen(false); setGrokResOpen(false); }}>
            <span className="text-[11px] text-[#AAAAAA] tabular-nums">{duration}s</span>
            <ChevronIcon open={durOpen} />
          </Pill>
          {durOpen && (
            <FloatMenu fullWidth>
              {(durations as readonly number[]).map((d) => (
                <FloatItem key={d} active={duration === d} onClick={() => { updateNodeData(id, { duration: d }); setDurOpen(false); }}>
                  {d}s
                </FloatItem>
              ))}
            </FloatMenu>
          )}
        </div>
      </div>

      {/* ── Row 2: model-specific controls ───────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-[#111]">
        {/* Mode picker — shown for any model with cfg.modes (Kling: 720p/1080p, Grok: fun/normal/spicy) */}
        {cfg.modes && (
          <div className="relative">
            <Pill onClick={() => { setModeOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setDurOpen(false); setGrokResOpen(false); }}>
              <span className="text-[11px] text-[#AAAAAA]">
                {cfg.modes.find((m) => m.value === mode)?.label ?? mode}
              </span>
              <ChevronIcon open={modeOpen} />
            </Pill>
            {modeOpen && (
              <FloatMenu>
                {cfg.modes.map((m) => (
                  <FloatItem key={m.value} active={mode === m.value} onClick={() => { updateNodeData(id, { klingMode: m.value }); setModeOpen(false); }}>
                    {m.label}
                  </FloatItem>
                ))}
              </FloatMenu>
            )}
          </div>
        )}

        {/* Resolution picker — shown for models with cfg.resolutions (Grok) */}
        {cfg.resolutions && (
          <div className="relative">
            <Pill onClick={() => { setGrokResOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setDurOpen(false); setModeOpen(false); }}>
              <span className="text-[11px] text-[#AAAAAA]">{resolution}</span>
              <ChevronIcon open={grokResOpen} />
            </Pill>
            {grokResOpen && (
              <FloatMenu>
                {cfg.resolutions.map((r) => (
                  <FloatItem key={r} active={resolution === r} onClick={() => { updateNodeData(id, { grokResolution: r }); setGrokResOpen(false); }}>
                    {r}
                  </FloatItem>
                ))}
              </FloatMenu>
            )}
          </div>
        )}

        {/* Sound toggle — shown for models with cfg.sound (Kling) */}
        {cfg.sound && (
          <>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => updateNodeData(id, { sound: !sound })}
              className="flex items-center gap-2 rounded-full px-2.5 py-1.5 transition-colors"
              style={{ background: "#111317" }}
            >
              <ToggleSwitch on={sound} />
              <span className="text-[11px] text-[#AAAAAA]">Sound</span>
            </button>

            <button
              onMouseDown={(e) => e.stopPropagation()}
              className="w-6 h-6 flex items-center justify-center rounded-full text-[#444] hover:text-[#888] transition-colors"
              style={{ background: "#111317" }}
            >
              <GearIcon />
            </button>
          </>
        )}

        {/* Reference image indicator — shown when resource handle is active and connected */}
        {activeHandles.has("resource") && hasResource && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: "#111317" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-[#fb923c] shrink-0" />
            <span className="text-[10px] text-[#AAAAAA]">Img ref</span>
          </div>
        )}

        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ml-auto ${STATUS_DOT[status]}`} />

        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={generate}
          disabled={busy}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white hover:bg-[#E8E8E8] transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
        >
          <svg width="9" height="10" viewBox="0 0 9 10" fill="#0A0C0E">
            <path d="M8.5 4.634a.5.5 0 0 1 0 .732l-7.5 4.5A.5.5 0 0 1 .25 9.5v-9A.5.5 0 0 1 1 .17l7.5 4.464Z" />
          </svg>
        </button>
      </div>

    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Pill({
  children, onClick, interactive = true, fullWidth = false,
}: {
  children: React.ReactNode; onClick?: () => void;
  interactive?: boolean; fullWidth?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onMouseDown={onClick ? (e: React.MouseEvent) => e.stopPropagation() : undefined}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 ${fullWidth ? "w-full justify-between" : ""} ${interactive && onClick ? "hover:brightness-125 transition-all cursor-pointer" : ""
        }`}
      style={{ background: "#111317" }}
    >
      {children}
    </Tag>
  );
}

function FloatMenu({ children, fullWidth = false }: { children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div className={`absolute bottom-full left-0 mb-1.5 bg-[#0F1214] border border-[#222] rounded-xl overflow-hidden z-50 shadow-2xl ${fullWidth ? "w-full" : "min-w-max"}`}>
      {children}
    </div>
  );
}

function FloatItem({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={`w-full px-3 py-2 text-left text-[11px] hover:bg-[#161A1E] transition-colors ${active ? "text-white font-medium" : "text-[#8D8E89]"}`}
    >
      {children}
    </button>
  );
}

function AspectIcon({ ratio }: { ratio: string }) {
  const [w, h] = ratio === "16:9" ? [11, 7] : ratio === "9:16" ? [7, 11] : ratio === "2:3" ? [7, 11] : ratio === "3:2" ? [11, 7] : [9, 9];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" stroke="#666" strokeWidth="1.2">
      <rect x="0.6" y="0.6" width={w - 1.2} height={h - 1.2} rx="0.8" />
    </svg>
  );
}

function ChevronIcon({ open = false }: { open?: boolean }) {
  return (
    <svg width="7" height="7" viewBox="0 0 8 8" fill="none" stroke="#555" strokeWidth="1.5" strokeLinecap="round"
      className={`shrink-0 transition-transform duration-100 ${open ? "rotate-180" : ""}`}>
      <path d="M1 2.5 4 5.5 7 2.5" />
    </svg>
  );
}

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <div className="relative shrink-0 rounded-full transition-colors" style={{ width: 32, height: 18, background: on ? "rgba(119,229,68,0.25)" : "#2A2A2A" }}>
      <div className="absolute top-[3px] rounded-full transition-transform" style={{ width: 12, height: 12, background: on ? "#77E544" : "#555", transform: on ? "translateX(17px)" : "translateX(3px)" }} />
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}


function VideoNodeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect width="18" height="14" x="3" y="5" rx="2" />
      <path d="m16 10-4-2.5v5L16 10z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PromptIcon() {
  return <svg width="12" height="12" viewBox="0 0 16 16" fill="white"><path d="M2 2h12v2.5H9.5V14h-3V4.5H2V2z" /></svg>;
}

function FrameStartIcon() {
  return (
    <svg width="13" height="11" viewBox="0 0 14 12" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0.7" y="0.7" width="12.6" height="10.6" rx="1.3" />
      <path d="M4.5 6h5M7 4l2.5 2L7 8" />
    </svg>
  );
}

function FrameEndIcon() {
  return (
    <svg width="13" height="11" viewBox="0 0 14 12" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0.7" y="0.7" width="12.6" height="10.6" rx="1.3" />
      <path d="M9.5 6h-5M7 4 4.5 6 7 8" />
    </svg>
  );
}

function ResourceIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="8" r="2.5" />
      <circle cx="11" cy="4" r="2.5" />
      <circle cx="11" cy="12" r="2.5" />
      <path d="M7.4 6.9 8.6 5.1M7.4 9.1l1.2 1.8" />
    </svg>
  );
}
