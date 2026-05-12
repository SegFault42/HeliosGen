"use client";
import React, { useCallback, useEffect, useRef, useState, Fragment } from "react";
import { useAnimatedPopup } from "@/lib/useAnimatedPopup";
import { createPortal } from "react-dom";
import GenerateButton from "@/components/nodes/GenerateButton";
import { Handle, Position, NodeProps, Node, useUpdateNodeInternals } from "@xyflow/react";
import CornerResizer from "./CornerResizer";
import NodeActionBar from "./NodeActionBar";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { resolveInputs } from "@/lib/executor";
import { createClient } from "@/lib/supabase/client";
import { VIDEO_MODELS as VIDEO_MODEL_CFG } from "@/lib/modelConfig";
import { useGeneratingPhase } from "@/lib/useGeneratingPhase";
import { useGeneratingBorderAnimation } from "@/lib/useGeneratingBorderAnimation";

type VideoGeneratorNodeType = Node<NodeData, "videoGeneratorNode">;

// ── Handles ───────────────────────────────────────────────────────────────────

type HandleDef = { id: string; label: string; className: string };

const BASE_HANDLES: HandleDef[] = [
  { id: "prompt", label: "Text prompt", className: "node-handle-icon node-handle-icon-prompt" },
  { id: "startFrame", label: "Start frame", className: "node-handle-icon node-handle-icon-image" },
  { id: "endFrame", label: "End frame", className: "node-handle-icon node-handle-icon-image" },
  { id: "resource", label: "Reference images (up to 3)", className: "node-handle-icon node-handle-icon-resource" },
  { id: "videoRef", label: "Reference video", className: "node-handle-icon node-handle-icon-videoref" },
  { id: "referenceVideo", label: "Reference videos (up to 3)", className: "node-handle-icon node-handle-icon-refvideo" },
  { id: "audioRef", label: "Reference audios (up to 3)", className: "node-handle-icon node-handle-icon-audioref" },
];

// Fixed order for bottom-anchored stacking (top-most first, bottom-most last)
const HANDLE_ORDER = ["prompt", "startFrame", "endFrame", "resource", "videoRef", "referenceVideo", "audioRef"];

// Which handle IDs are connectable for each dragged output type
const CONNECTABLE_FOR_TYPE: Record<string, Set<string>> = {
  prompt: new Set(["prompt"]),
  image: new Set(["startFrame", "endFrame", "resource"]),
  video: new Set(["videoRef", "referenceVideo"]),
  audio: new Set(["audioRef"]),
};
const HANDLE_BOTTOM_BASE = 52; // px above node bottom edge
const HANDLE_SPACING = 38; // px between handles

const HANDLE_COLORS: Record<string, string> = {
  prompt: "#ff3df5",
  startFrame: "#818cf8",
  endFrame: "#818cf8",
  resource: "#fb923c",
  videoRef: "#22d3ee",
  referenceVideo: "#38bdf8",
  audioRef: "#a78bfa",
};

const SOURCE_HANDLE_COLORS: Record<string, string> = {
  image: "#818cf8",
  video: "#22d3ee",
  audio: "#a78bfa",
};

const SOURCE_HANDLES = [
  { id: "startFrameOut", type: "image", label: "Start frame", icon: <SrcFrameStartIcon /> },
  { id: "endFrameOut", type: "image", label: "End frame", icon: <SrcFrameEndIcon /> },
  { id: "imagePickOut", type: "image", label: "Image pick", icon: <SrcImagePickIcon /> },
  { id: "videoRefOut", type: "video", label: "Reference video", icon: <SrcVideoIcon /> },
  { id: "audioRefOut", type: "audio", label: "Reference audio", icon: <SrcAudioIcon /> },
] as const;

const STATUS_DOT: Record<string, string> = {
  idle: "bg-[#1E1E1E]",
  running: "bg-amber-400 animate-pulse",
  done: "bg-[#34d399]",
  error: "bg-red-500",
};

// ── @mention → <<<image N>>> replacement (same logic as GenerateNode) ─────────

function resolveMentions(
  prompt: string,
  labels: string[],
  imageUrls: string[],
  tagFormat: "default" | "grok" = "default",
): { resolvedPrompt: string; orderedUrls: string[] } {
  if (!labels.length) return { resolvedPrompt: prompt, orderedUrls: imageUrls };

  type Span = { start: number; end: number; labelIdx: number | null };
  const spans: Span[] = [];
  const claimed = new Set<number>();

  const sortedLabels = labels
    .map((label, i) => ({ label, i }))
    .filter(({ label }) => !!label)
    .sort((a, b) => b.label.length - a.label.length);

  for (const { label, i } of sortedLabels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`@${escaped}`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt)) !== null) {
      if (!claimed.has(m.index)) {
        spans.push({ start: m.index, end: m.index + m[0].length, labelIdx: i });
        claimed.add(m.index);
      }
    }
  }

  const fallback = /@\S+(?:\s+#\d+)?/g;
  let fm: RegExpExecArray | null;
  while ((fm = fallback.exec(prompt)) !== null) {
    if (!claimed.has(fm.index)) {
      spans.push({ start: fm.index, end: fm.index + fm[0].length, labelIdx: null });
      claimed.add(fm.index);
    }
  }

  spans.sort((a, b) => a.start - b.start);
  if (spans.length === 0) return { resolvedPrompt: prompt, orderedUrls: imageUrls };

  const spanUrls: (string | null)[] = [];
  const usedIdxs = new Set<number>();

  for (const span of spans) {
    let url: string | null = null;
    if (span.labelIdx !== null && !usedIdxs.has(span.labelIdx) && imageUrls[span.labelIdx]) {
      url = imageUrls[span.labelIdx];
      usedIdxs.add(span.labelIdx);
    } else {
      const next = imageUrls.findIndex((_, j) => !usedIdxs.has(j));
      if (next !== -1) { url = imageUrls[next]; usedIdxs.add(next); }
      // No fallback to imageUrls[0] — unresolvable @mentions stay as plain text
    }
    spanUrls.push(url);
  }

  const orderedUrls = spanUrls.filter((u): u is string => u !== null);

  let resolvedPrompt = "";
  let lastEnd = 0;
  let imageNum = 1;
  for (let i = 0; i < spans.length; i++) {
    resolvedPrompt += prompt.slice(lastEnd, spans[i].start);
    if (spanUrls[i] !== null) {
      resolvedPrompt += tagFormat === "grok" ? `@image${imageNum++} ` : `<<<image ${imageNum++}>>>`;
    } else {
      resolvedPrompt += prompt.slice(spans[i].start, spans[i].end);
    }
    lastEnd = spans[i].end;
  }
  resolvedPrompt += prompt.slice(lastEnd);

  return { resolvedPrompt, orderedUrls };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VideoGeneratorNode({ id, data, selected }: NodeProps<VideoGeneratorNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const updateNodeSize = useWorkflowStore((s) => s.updateNodeSize);
  const setAuthModalOpen = useWorkflowStore((s) => s.setAuthModalOpen);
  const killEdgesForHandles = useWorkflowStore((s) => s.killEdgesForHandles);
  const remapTargetHandle = useWorkflowStore((s) => s.remapTargetHandle);
  const flashEdgeError = useWorkflowStore((s) => s.flashEdgeError);
  const addToast  = useWorkflowStore((s) => s.addToast);
  const kieKeySet = useWorkflowStore((s) => s.kieKeySet);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const addNode = useWorkflowStore((s) => s.addNode);
  const insertEdge = useWorkflowStore((s) => s.insertEdge);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const debugMode = useWorkflowStore((s) => s.debugMode);
  const connectingHandleType = useWorkflowStore((s) => s.connectingHandleType);
  const parentGroupSelected = useWorkflowStore((s) => {
    const self = s.nodes.find((n) => n.id === id);
    if (!self?.parentId) return false;
    return s.nodes.find((n) => n.id === self.parentId)?.selected ?? false;
  });
  const multiSelected = useWorkflowStore((s) => s.nodes.filter((n) => n.selected).length > 1);

  const updateNodeInternals = useUpdateNodeInternals();
  const cardRef = useRef<HTMLDivElement>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Instant hide on deselect — no delay when clicking outside the node
  const prevSelectedRef = useRef(selected);
  useEffect(() => {
    const was = prevSelectedRef.current;
    prevSelectedRef.current = selected;
    if (was && !selected && cardRef.current) {
      const el = cardRef.current;
      el.classList.add("handles-no-delay");
      const t = setTimeout(() => el.classList.remove("handles-no-delay"), 200);
      return () => { clearTimeout(t); el.classList.remove("handles-no-delay"); };
    }
  }, [selected]);

  const [loading, setLoading] = useState(false);
  const [hoveredHand, setHoveredHand] = useState<string | null>(null);
  const [hoveredSourceHandle, setHoveredSourceHandle] = useState<string | null>(null);
  const [errorHandles, setErrorHandles] = useState<Set<string>>(new Set());
  const [modelOpen, setModelOpen] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [durOpen, setDurOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [grokResOpen, setGrokResOpen] = useState(false);
  const muted = useWorkflowStore((s) => s.globalMuted);
  const setGlobalMuted = useWorkflowStore((s) => s.setGlobalMuted);
  const [hovering, setHovering] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scrubPos, setScrubPos] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [captureErr, setCaptureErr] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"video" | "frame">("video");
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map());
  const durLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anyOpen = modelOpen || ratioOpen || durOpen || modeOpen || grokResOpen;
    if (!anyOpen) return;
    const handler = (e: MouseEvent) => {
      if (controlBarRef.current && !controlBarRef.current.contains(e.target as unknown as globalThis.Node)) {
        setModelOpen(false); setRatioOpen(false); setDurOpen(false);
        setModeOpen(false); setGrokResOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelOpen, ratioOpen, durOpen, modeOpen, grokResOpen]);

  const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // ── Lightbox ──────────────────────────────────────────────────────────────
  const openLightbox = useCallback(() => {
    if (!(data.videoUrl as string | undefined)) return;
    setLightboxOpen(true);
    requestAnimationFrame(() => setLightboxVisible(true));
  }, [data.videoUrl]);

  const closeLightbox = useCallback(() => {
    setLightboxVisible(false);
    setTimeout(() => setLightboxOpen(false), 220);
  }, []);

  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeLightbox(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxOpen, closeLightbox]);

  // ── Toolbar actions ───────────────────────────────────────────────────────
  const handleDelete = useCallback(() => {
    onNodesChange([{ type: "remove", id }]);
  }, [id, onNodesChange]);

  const handleDuplicate = useCallback(() => {
    const state = useWorkflowStore.getState();
    const src = state.nodes.find((n) => n.id === id);
    if (!src) return;
    const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    onNodesChange([{ type: "select", id, selected: false }]);
    addNode({
      ...src,
      id: newId,
      position: { x: src.position.x + 20, y: src.position.y + 20 },
      selected: true,
      data: { ...src.data, status: "idle" as const, taskId: undefined, hasError: false },
    });
    state.edges
      .filter((e) => (e.source === id || e.target === id) && e.deletable !== false)
      .forEach((e) => insertEdge({
        ...e,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        source: e.source === id ? newId : e.source,
        target: e.target === id ? newId : e.target,
      }));
  }, [id, addNode, insertEdge, onNodesChange]);

  const handleSave = useCallback(async () => {
    const url = data.videoUrl as string | undefined;
    if (!url || isSaving) return;
    const filename = `video-${Date.now()}.mp4`;
    setIsSaving(true);
    try {
      const resp = await fetch(`/api/download?url=${encodeURIComponent(url)}&filename=${filename}`);
      const blob = await resp.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(obj);
    } finally {
      setIsSaving(false);
    }
  }, [data.videoUrl, isSaving]);

  const deleteGen = useCallback((idx: number) => {
    const storeNode = useWorkflowStore.getState().nodes.find((n) => n.id === id);
    const gens = [...((storeNode?.data?.generations as GenEntry[] | undefined) ?? [])] as GenEntry[];
    const meta = [...((storeNode?.data?.generationsMeta as (GenMeta | null)[] | undefined) ?? [])];
    const cur = (storeNode?.data?.currentGenIdx as number | undefined) ?? Math.max(0, gens.length - 1);
    gens.splice(idx, 1);
    meta.splice(idx, 1);
    if (gens.length === 0) {
      updateNodeData(id, { generations: [], generationsMeta: [], currentGenIdx: 0, videoUrl: undefined, status: "idle", errorMsg: undefined });
      return;
    }
    const newIdx = Math.max(0, Math.min(gens.length - 1, idx <= cur ? cur - 1 : cur));
    const entry = gens[newIdx];
    updateNodeData(id, {
      generations: gens,
      generationsMeta: meta,
      currentGenIdx: newIdx,
      videoUrl: typeof entry === "string" ? entry : undefined,
      status: typeof entry === "string" ? "done" : typeof entry === "object" && entry !== null ? "error" : "idle",
      errorMsg: typeof entry === "object" && entry !== null ? (entry as { error: string }).error : undefined,
    });
  }, [id, updateNodeData]);

  const handleCancel = useCallback(() => {
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    setLoading(false);
    const storeNode = useWorkflowStore.getState().nodes.find((n) => n.id === id);
    const rawGens = (storeNode?.data?.generations as GenEntry[] | undefined) ?? [];
    const rawMeta = (storeNode?.data?.generationsMeta as (GenMeta | null)[] | undefined) ?? [];
    const gens = rawGens.filter((g): g is string | { error: string } => g !== null);
    const meta = rawMeta.filter((_, i) => rawGens[i] !== null);
    const newIdx = Math.max(0, gens.length - 1);
    const lastEntry = gens[newIdx];
    updateNodeData(id, {
      status: gens.length > 0 ? "done" : "idle",
      taskId: undefined,
      generations: gens,
      generationsMeta: meta,
      currentGenIdx: newIdx,
      videoUrl: typeof lastEntry === "string" ? lastEntry : undefined,
      errorMsg: undefined,
    });
  }, [id, updateNodeData]);

  // ── Data ──────────────────────────────────────────────────────────────────
  const videoModelId = (data.videoModel as string) ?? "kling-3.0";
  const cfg = VIDEO_MODEL_CFG.find((m) => m.id === videoModelId) ?? VIDEO_MODEL_CFG[0];

  const mode = (data.klingMode as string) ?? cfg.defaultMode ?? "";
  const resolution = (data.grokResolution as string) ?? cfg.defaultResolution ?? "";
  const duration = (data.duration as number) ?? cfg.defaultDuration;
  const aspectRatio = (data.aspectRatio as string) ?? cfg.defaultRatio;
  const sound = (data.sound as boolean) ?? false;
  const seed = (data.seed as number | undefined) ?? 0;
  const status = (data.status as string) ?? "idle";
  const prompt = (data.prompt as string) ?? "";
  const isPending = status === "pending";
  const animBusy = loading || status === "running";
  const busy = animBusy || isPending;
  const phaseLabel = useGeneratingPhase(animBusy);

  useGeneratingBorderAnimation(cardRef, animBusy);
  const videoUrl = data.videoUrl as string | undefined;

  const promptOverLimit = (() => {
    const promptEdge = edges.find((e) => e.target === id && e.targetHandle === "prompt");
    if (!promptEdge) return false;
    const promptNode = nodes.find((n) => n.id === promptEdge.source);
    const text = (promptNode?.data?.prompt as string) ?? "";
    const limit = cfg.apiInput.promptMaxLength ?? Infinity;
    return text.length > limit;
  })();

  // ── Generation history ────────────────────────────────────────────────────
  type GenEntry = string | null | { error: string };
  type GenMeta = { videoModel: string; aspectRatio: string; duration: number; klingMode: string; grokResolution: string; sound: boolean };

  const generations: GenEntry[] = Array.isArray(data.generations)
    ? (data.generations as GenEntry[])
    : (videoUrl ? [videoUrl] : []);
  const generationsMeta: (GenMeta | null)[] = Array.isArray(data.generationsMeta)
    ? (data.generationsMeta as (GenMeta | null)[])
    : [];
  const currentGenIdx = Math.min((data.currentGenIdx as number | undefined) ?? Math.max(0, generations.length - 1), Math.max(0, generations.length - 1));
  const generationsRef = useRef(generations);
  generationsRef.current = generations;

  const goToGen = useCallback((idx: number) => {
    const gens = generationsRef.current;
    const clamped = Math.max(0, Math.min(gens.length - 1, idx));
    const entry = gens[clamped];
    // Restore the settings used for this generation slot
    const meta = (useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data?.generationsMeta as (GenMeta | null)[] | undefined)?.[clamped];
    const metaUpdate = meta ? {
      videoModel: meta.videoModel,
      aspectRatio: meta.aspectRatio,
      duration: meta.duration,
      klingMode: meta.klingMode,
      grokResolution: meta.grokResolution,
      sound: meta.sound,
    } : {};
    if (entry === null) {
      updateNodeData(id, { currentGenIdx: clamped, videoUrl: undefined, status: "running", errorMsg: undefined, ...metaUpdate });
    } else if (typeof entry === "object") {
      updateNodeData(id, { currentGenIdx: clamped, videoUrl: undefined, status: "error", errorMsg: entry.error, ...metaUpdate });
    } else {
      updateNodeData(id, { currentGenIdx: clamped, videoUrl: entry, status: "done", errorMsg: undefined, ...metaUpdate });
    }
  }, [id, updateNodeData]);

  // Play current, pause all others
  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (i === currentGenIdx) v.play().catch(() => { });
      else v.pause();
    });
  }, [currentGenIdx]);

  const handleVideoMeta = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (!v.videoWidth || !v.videoHeight) return;
    updateNodeData(id, { imageNaturalRatio: `${v.videoWidth} / ${v.videoHeight}` });
    // Sizing is handled by the useEffect below once the DOM reflects the new state
  };

  // Persistent ResizeObserver — fires throughout CSS transitions so group
  // expansion in the store always gets the final measured dimensions.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      updateNodeSize(id, el.offsetWidth, el.offsetHeight);
      updateNodeInternals(id);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, updateNodeSize, updateNodeInternals]);

  // When the model changes the active handle set and their CSS positions change.
  // React Flow needs updateNodeInternals after the DOM has repainted with the new layout.
  useEffect(() => {
    const raf = requestAnimationFrame(() => updateNodeInternals(id));
    return () => cancelAnimationFrame(raf);
  }, [id, videoModelId, updateNodeInternals]);

  // ── Poll job-status while a taskId is pending ────────────────────────────
  useEffect(() => {
    const taskId = data.taskId as string | undefined;
    if (!taskId || status !== "running") return;

    let cancelled = false;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/job-status?taskId=${taskId}`);
        const json = await res.json();
        if (cancelled) return;

        if (json.status === "done" && json.videoUrl) {
          const storeNode = useWorkflowStore.getState().nodes.find((n) => n.id === id);
          const gens = [...((storeNode?.data?.generations as GenEntry[] | undefined) ?? [])] as GenEntry[];
          const slot = storeNode?.data?.currentGenIdx as number ?? gens.length - 1;
          gens[slot] = json.videoUrl as string;
          updateNodeData(id, { status: "done", videoUrl: json.videoUrl, taskId: undefined, generations: gens, currentGenIdx: slot });
          clearInterval(interval);
        } else if (json.status === "error") {
          const storeNode = useWorkflowStore.getState().nodes.find((n) => n.id === id);
          const gens = [...((storeNode?.data?.generations as GenEntry[] | undefined) ?? [])] as GenEntry[];
          const slot = storeNode?.data?.currentGenIdx as number ?? gens.length - 1;
          gens[slot] = { error: json.error ?? "Generation failed" };
          updateNodeData(id, { status: "error", errorMsg: json.error, taskId: undefined, generations: gens, currentGenIdx: slot });
          clearInterval(interval);
        } else if (json.status === "not_found") {
          const storeNode = useWorkflowStore.getState().nodes.find((n) => n.id === id);
          const gens = [...((storeNode?.data?.generations as GenEntry[] | undefined) ?? [])] as GenEntry[];
          const slot = storeNode?.data?.currentGenIdx as number ?? gens.length - 1;
          gens[slot] = { error: "Job lost (server restarted)" };
          updateNodeData(id, { status: "error", errorMsg: "Job lost (server restarted)", taskId: undefined, generations: gens, currentGenIdx: slot });
          clearInterval(interval);
        }
        // "pending" → keep polling
      } catch {
        // network hiccup — keep polling
      }
    }, 5000);

    return () => { cancelled = true; clearInterval(interval); };
  }, [data.taskId, status, id, updateNodeData]);

  const activeHandles = new Set<string>(cfg.handles);
  const connectedHandles = new Set(
    edges.filter((e) => e.target === id).map((e) => e.targetHandle).filter(Boolean) as string[]
  );

  // HappyHorse: startFrame and resource are mutually exclusive — hide the other once one is connected
  if (cfg.id === "happyhorse") {
    if (connectedHandles.has("startFrame")) activeHandles.delete("resource");
    if (connectedHandles.has("resource"))   activeHandles.delete("startFrame");
  }

  // When the mutual-exclusion above shifts handle positions, edges stay anchored to stale
  // coords until React Flow re-measures. Re-measure after the DOM repaints.
  const hhConnKey = `${connectedHandles.has("startFrame") ? 1 : 0}${connectedHandles.has("resource") ? 1 : 0}`;
  useEffect(() => {
    const raf = requestAnimationFrame(() => updateNodeInternals(id));
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hhConnKey, updateNodeInternals]);

  // Compute bottom-anchored positions — active handles stack together with no gaps.
  const activeInOrder = HANDLE_ORDER.filter((hid) => activeHandles.has(hid));
  const N = activeInOrder.length;
  const handleBottomMap = new Map(
    activeInOrder.map((hid, idx) => [hid, HANDLE_BOTTOM_BASE + (N - 1 - idx) * HANDLE_SPACING])
  );

  // Apply model-specific label/class overrides.
  const handles = BASE_HANDLES.map((h) => {
    let label = h.label;
    let className = h.className;
    if (h.id === "resource" && cfg.maxResources)
      label = cfg.id === "happyhorse"
        ? `Characters (up to ${cfg.maxResources})`
        : `Reference images (up to ${cfg.maxResources})`;
    if (h.id === "referenceVideo" && cfg.maxReferenceVideos)
      label = `Reference videos (up to ${cfg.maxReferenceVideos})`;
    if (h.id === "audioRef" && cfg.maxReferenceAudios)
      label = `Reference audios (up to ${cfg.maxReferenceAudios})`;
    if (h.id === "startFrame" && cfg.id === "kling-2.6-motion-control") {
      label = "Character";
      className = "node-handle-icon node-handle-icon-character";
    }
    return { ...h, label, className };
  });
  const ratios = cfg.ratios;
  const durations = cfg.durations;

  const closeAll = () => {
    setModelOpen(false); setRatioOpen(false); setDurOpen(false);
    setModeOpen(false); setGrokResOpen(false);
    setHovering(false);
  };

  // Auto-open picker when connected to a downstream image handle via imagePickOut
  const IMAGE_HANDLES = new Set(["startFrame", "endFrame", "resource", "image"]);
  const imagePickEdges = edges.filter(
    (e) => e.source === id &&
           (IMAGE_HANDLES.has(e.targetHandle as string) || !e.targetHandle) &&
           e.sourceHandle === "imagePickOut"
  );
  const imagePickEdgeCount = imagePickEdges.length;
  const prevEdgeCountRef = useRef(imagePickEdgeCount);
  const lastEdgeIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (imagePickEdgeCount > prevEdgeCountRef.current) {
      const v = videoRef.current;
      if (v) { v.pause(); setScrubPos(v.currentTime / (v.duration || 1)); }
      setPickerOpen(true);
      // Track the ID of the edge that just triggered the picker
      lastEdgeIdRef.current = imagePickEdges[imagePickEdges.length - 1]?.id ?? null;
    }
    prevEdgeCountRef.current = imagePickEdgeCount;
  }, [imagePickEdgeCount, imagePickEdges]);

  useEffect(() => {
    if (!imagePickEdgeCount) {
      setPickerOpen(false);
      setViewMode("video");
    }
  }, [imagePickEdgeCount]);

  const openPicker = useCallback(() => {
    const v = videoRef.current;
    if (v) {
      v.pause();
      setScrubPos(v.currentTime / (v.duration || 1));
    }
    setPickerOpen(true);
  }, []);

  const captureFrame = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    setCaptureErr(null);
    setCapturing(true);
    try {
      const seekTime = v.currentTime;
      const srcUrl   = v.src;
      if (!srcUrl) throw new Error("No video source");

      const token = await (async () => {
        try {
          const { data } = await (await import("@/lib/supabase/client")).createClient().auth.getSession();
          return data.session?.access_token;
        } catch { return undefined; }
      })();

      const res = await fetch("/api/extract-frame", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ videoUrl: srcUrl, timeSeconds: seekTime }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Extraction failed");

      if (j.cdnUrl) {
        updateNodeData(id, { capturedFrameUrl: j.cdnUrl });
        setViewMode("frame");
        // Also update any connected ImageInputNodes
        const pickEdges = edges.filter((e) => e.source === id && e.sourceHandle === "imagePickOut");
        for (const pe of pickEdges) {
          const tgt = nodes.find((n) => n.id === pe.target);
          if (tgt?.type === "imageInputNode") {
            updateNodeData(tgt.id, { r2Url: j.cdnUrl, inputImage: j.cdnUrl });
          }
        }
      }
      setPickerOpen(false);
    } catch (e: any) {
      setCaptureErr(e.message || "Failed to capture frame");
    } finally {
      setCapturing(false);
    }
  }, [id, updateNodeData, edges, nodes]);

  const textEdge = edges.find((e) => e.target === id && e.targetHandle === "prompt");
  const textNode = textEdge ? nodes.find((n) => n.id === textEdge.source) : undefined;
  const hasResource = edges.some((e) => e.target === id && e.targetHandle === "resource");

  // ── Generate ──────────────────────────────────────────────────────────────
  const generate = useCallback(async () => {
    const { data: authData } = await createClient().auth.getSession();
    if (!authData.session) { setAuthModalOpen(true); return; }

    const upstream = resolveInputs(id, nodes as Node<NodeData>[], edges);
    const maxRes = cfg.maxResources ?? 3;
    const maxRefVideos = cfg.maxReferenceVideos ?? 3;
    const maxRefAudios = cfg.maxReferenceAudios ?? 3;
    const limitedResources = upstream.resources.slice(0, maxRes);
    const { resolvedPrompt, orderedUrls } = resolveMentions(
      upstream.prompt ?? prompt,
      limitedResources.map((r) => r.label),
      limitedResources.map((r) => r.url),
      cfg.resourceTagFormat ?? "default",
    );
    const finalPrompt = resolvedPrompt;
    const orderedResources = orderedUrls.map(
      (url) => limitedResources.find((r) => r.url === url) ?? { url, label: "element" }
    );

    if (!cfg.promptOptional && !finalPrompt.trim()) {
      setErrorHandles(new Set(["prompt"]));
      setTimeout(() => setErrorHandles(new Set()), 1400);
      updateNodeData(id, { hasError: true });
      addToast("A prompt is required to generate a video.", "error");
      if (textEdge) {
        updateNodeData(textEdge.source, { hasError: true });
        flashEdgeError(textEdge.id);
      }
      return;
    }

    // ── Motion-control: validate mandatory image + video handles ──────────────
    if (cfg.apiInput.useMotionControl) {
      const imageEdge = edges.find((e) => e.target === id && e.targetHandle === "startFrame");
      const videoEdge = edges.find((e) => e.target === id && e.targetHandle === "videoRef");

      const flashSet = new Set<string>();
      let hasError = false;

      // startFrame: not connected → flash handle; connected but empty → flash handle + edge + source node
      if (!imageEdge) {
        flashSet.add("startFrame");
        hasError = true;
      } else if (!upstream.startFrameUrl) {
        flashSet.add("startFrame");
        const srcNode = nodes.find((n) => n.id === imageEdge.source);
        if (srcNode) updateNodeData(srcNode.id, { hasError: true });
        flashEdgeError(imageEdge.id);
        hasError = true;
      }

      // videoRef: not connected → flash handle; connected but empty → flash handle + edge + source node
      if (!videoEdge) {
        flashSet.add("videoRef");
        hasError = true;
      } else if (!upstream.videoRefUrl) {
        flashSet.add("videoRef");
        const srcNode = nodes.find((n) => n.id === videoEdge.source);
        if (srcNode) updateNodeData(srcNode.id, { hasError: true });
        flashEdgeError(videoEdge.id);
        hasError = true;
      }

      if (flashSet.size > 0) {
        setErrorHandles(flashSet);
        setTimeout(() => setErrorHandles(new Set()), 1400);
      }
      if (hasError) {
        updateNodeData(id, { hasError: true });
        addToast("Connect all required inputs for this model.", "error");
        return;
      }
    }

    // All models: any connected handle whose source has no content → block + blink.
    // Linked = required, regardless of whether the handle is optional when unlinked.
    {
      type HandleSpec = { handle: string; getUrl: (d: Record<string, unknown>) => string | undefined };
      const handleSpecs: HandleSpec[] = [
        { handle: "startFrame",     getUrl: (d) => (d.capturedFrameUrl ?? d.r2Url ?? d.inputImage ?? d.imageUrl) as string | undefined },
        { handle: "endFrame",       getUrl: (d) => (d.capturedFrameUrl ?? d.r2Url ?? d.inputImage ?? d.imageUrl) as string | undefined },
        { handle: "resource",       getUrl: (d) => (d.capturedFrameUrl ?? d.r2Url ?? d.inputImage ?? d.imageUrl) as string | undefined },
        { handle: "videoRef",       getUrl: (d) => (d.videoUrl) as string | undefined },
        { handle: "referenceVideo", getUrl: (d) => (d.videoUrl ?? d.r2Url) as string | undefined },
        { handle: "audioRef",       getUrl: (d) => (d.audioUrl ?? d.r2Url) as string | undefined },
      ];

      const flashSet = new Set<string>();
      let hasEmpty = false;

      for (const { handle, getUrl } of handleSpecs) {
        const emptyEdges = edges
          .filter((e) => e.target === id && e.targetHandle === handle)
          .filter((e) => {
            const src = nodes.find((n) => n.id === e.source);
            return !src || !getUrl(src.data as Record<string, unknown>);
          });
        if (emptyEdges.length > 0) {
          flashSet.add(handle);
          for (const e of emptyEdges) {
            const src = nodes.find((n) => n.id === e.source);
            if (src) updateNodeData(src.id, { hasError: true });
            flashEdgeError(e.id);
          }
          hasEmpty = true;
        }
      }

      if (flashSet.size > 0) {
        setErrorHandles(flashSet);
        setTimeout(() => setErrorHandles(new Set()), 1400);
      }
      if (hasEmpty) {
        updateNodeData(id, { hasError: true });
        addToast("Some connected inputs have no content yet.", "error");
        return;
      }
    }

    // Trim videoRef if the source node has trim points applied
    let finalVideoRefUrl = upstream.videoRefUrl;
    if (finalVideoRefUrl) {
      const videoRefEdge = edges.find((e) => e.target === id && e.targetHandle === "videoRef");
      if (videoRefEdge) {
        const videoSrcNode = nodes.find((n) => n.id === videoRefEdge.source);
        const tStart = videoSrcNode?.data.trimStart as number | undefined;
        const tEnd = videoSrcNode?.data.trimEnd as number | undefined;
        if (tStart !== undefined && tEnd !== undefined) {
          try {
            const { data: authData } = await createClient().auth.getSession();
            const token = authData.session?.access_token;
            const trimRes = await fetch("/api/trim-video", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ videoUrl: finalVideoRefUrl, startTime: tStart, endTime: tEnd }),
            });
            if (trimRes.ok) {
              const trimJson = await trimRes.json();
              if (trimJson.cdnUrl) finalVideoRefUrl = trimJson.cdnUrl;
            }
          } catch {
            // trim failed — proceed with original URL
          }
        }
      }
    }

    // Extract first/last frames from VideoInputNode sources connected via startFrameOut/endFrameOut
    let finalStartFrameUrl = upstream.startFrameUrl;
    let finalEndFrameUrl = upstream.endFrameUrl;
    const frameToken = authData.session?.access_token;
    const frameHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(frameToken ? { Authorization: `Bearer ${frameToken}` } : {}),
    };

    const sfEdge = edges.find((e) => e.target === id && e.targetHandle === "startFrame" && e.sourceHandle === "startFrameOut");
    if (sfEdge) {
      const sfSrc = nodes.find((n) => n.id === sfEdge.source);
      if (sfSrc?.type === "videoInputNode") {
        const vUrl = sfSrc.data.videoUrl as string | undefined;
        if (vUrl && !vUrl.startsWith("blob:")) {
          const timeSeconds = (sfSrc.data.trimStart as number | undefined) ?? 0;
          try {
            const r = await fetch("/api/extract-frame", { method: "POST", headers: frameHeaders, body: JSON.stringify({ videoUrl: vUrl, timeSeconds }) });
            const j = await r.json();
            if (j.cdnUrl) finalStartFrameUrl = j.cdnUrl;
          } catch { /* proceed without */ }
        }
      }
    }

    const efEdge = edges.find((e) => e.target === id && e.targetHandle === "endFrame" && e.sourceHandle === "endFrameOut");
    if (efEdge) {
      const efSrc = nodes.find((n) => n.id === efEdge.source);
      if (efSrc?.type === "videoInputNode") {
        const vUrl = efSrc.data.videoUrl as string | undefined;
        if (vUrl && !vUrl.startsWith("blob:")) {
          const trimEnd = efSrc.data.trimEnd as number | undefined;
          try {
            const r = await fetch("/api/extract-frame", { method: "POST", headers: frameHeaders, body: JSON.stringify({ videoUrl: vUrl, ...(trimEnd !== undefined ? { timeSeconds: trimEnd } : { lastFrame: true }) }) });
            const j = await r.json();
            if (j.cdnUrl) finalEndFrameUrl = j.cdnUrl;
          } catch { /* proceed without */ }
        }
      }
    }

    // Build full payload first so debug log matches what gets sent
    const payload: Record<string, unknown> = {
      videoModel: videoModelId,
      prompt: finalPrompt,
      aspectRatio,
      duration,
      ...(cfg.modes?.length ? { mode } : {}),
      resolution,
      ...(cfg.sound ? { sound } : {}),
      startFrameUrl: finalStartFrameUrl,
      endFrameUrl: finalEndFrameUrl,
      videoRefUrl: finalVideoRefUrl,
      resources: orderedResources,
      referenceImageUrls: orderedResources.length > 0
        ? orderedResources.map((r) => r.url)
        : undefined,
      referenceVideoUrls: upstream.referenceVideoUrls.slice(0, maxRefVideos),
      referenceAudioUrls: upstream.referenceAudioUrls.slice(0, maxRefAudios),
      ...(cfg.supportsSeeds && seed ? { seed } : {}),
    };

    if (debugMode) {
      setLoading(true);
      try {
        const res = await fetch("/api/generate-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, debugOnly: true }),
        });
        const json = await res.json();
        console.log(`[DEBUG] videoNode=${id} — kie.ai payload:`, json.debugPayload ?? json);
      } catch (e) {
        console.log(`[DEBUG] videoNode=${id} — app payload (API unreachable):`, payload);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Set PENDING state — gives user 3 seconds to cancel before the API call
    const storeNode0 = useWorkflowStore.getState().nodes.find((n) => n.id === id);
    const prevGens2 = [...((storeNode0?.data?.generations as GenEntry[] | undefined) ?? [])] as GenEntry[];
    const prevMeta2 = [...((storeNode0?.data?.generationsMeta as (GenMeta | null)[] | undefined) ?? [])];
    const loadingGens2 = [...prevGens2, null] as GenEntry[];
    const thisMeta: GenMeta = { videoModel: videoModelId, aspectRatio, duration, klingMode: mode, grokResolution: resolution, sound };
    const loadingMeta2 = [...prevMeta2, thisMeta];
    updateNodeData(id, { status: "pending", videoUrl: undefined, imageNaturalRatio: undefined, errorMsg: undefined, taskId: undefined, generations: loadingGens2, generationsMeta: loadingMeta2, currentGenIdx: loadingGens2.length - 1 });

    const accessToken = authData.session!.access_token;
    pendingTimerRef.current = setTimeout(async () => {
      pendingTimerRef.current = null;
      setLoading(true);
      updateNodeData(id, { status: "running" });
      try {
        const res = await fetch("/api/generate-video", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        let json: { taskId?: string; error?: string } = {};
        try { json = JSON.parse(text); } catch { throw new Error(res.ok ? "Invalid server response" : `Server error ${res.status}`); }
        if (!res.ok) throw new Error(json.error ?? `Server error ${res.status}`);
        // Store taskId — the polling useEffect above will wait for completion
        updateNodeData(id, { taskId: json.taskId });
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const storeNode = useWorkflowStore.getState().nodes.find((n) => n.id === id);
        const gens = [...((storeNode?.data?.generations as GenEntry[] | undefined) ?? [])] as GenEntry[];
        const slot = (storeNode?.data?.currentGenIdx as number | undefined) ?? Math.max(0, gens.length - 1);
        gens[slot] = { error: errMsg };
        updateNodeData(id, { status: "error", errorMsg: errMsg, generations: gens, currentGenIdx: slot });
      } finally {
        setLoading(false);
      }
    }, 3000);
  }, [id, nodes, edges, prompt, sound, seed, duration, aspectRatio, videoModelId,
    mode, resolution, cfg, debugMode, textEdge, updateNodeData, setAuthModalOpen, flashEdgeError, kieKeySet, addToast]);

  // Pipeline runner trigger — called by Run Pipeline button
  const generateRef = useRef(generate);
  useEffect(() => { generateRef.current = generate; }, [generate]);
  useEffect(() => {
    if (!data.pendingGenerate) return;
    updateNodeData(id, { pendingGenerate: false });
    generateRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.pendingGenerate]);

  const hoveredDef = hoveredHand && activeHandles.has(hoveredHand)
    ? handles.find((h) => h.id === hoveredHand)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={cardRef}
      className={`video-node-card node-card w-full${animBusy ? " node-generating" : ""}${(data.hasError as boolean) ? " node-error-blink" : ""}`}
      style={{ minWidth: 320, minHeight: 280 }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={closeAll}
      onAnimationEnd={(e) => { if (e.animationName === "node-error-blink") updateNodeData(id, { hasError: false }); }}
    >
      <CornerResizer minWidth={280} minHeight={80} keepAspectRatio={!!data.videoUrl} />
      <NodeActionBar
        visible={!!selected && !data.locked && !parentGroupSelected && !multiSelected}
        hasContent={!!data.videoUrl}
        isSaving={isSaving}
        onPreview={openLightbox}
        onDelete={handleDelete}
        onSave={handleSave}
        onDuplicate={handleDuplicate}
      />
      {data.locked && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20" style={{ borderRadius: 8 }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
        </div>
      )}

      <span className="node-above-label" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <VideoNodeIcon />
        {data.label as string}
      </span>

      {/* ── Source (output) handles — top-right ──────────────────────── */}
      {SOURCE_HANDLES.map((h, i) => (
        <Handle
          key={h.id}
          type="source"
          position={Position.Right}
          id={h.id}
          style={{ top: 20 + i * 32 }}
          className={`node-handle-icon node-handle-icon-out-${h.type}${edges.some((e) => e.source === id && e.sourceHandle === h.id) ? " node-handle-connected" : ""}${(data.hasError as boolean) ? " node-handle-error" : ""}`}
          onMouseEnter={() => setHoveredSourceHandle(h.id)}
          onMouseLeave={() => setHoveredSourceHandle(null)}
        >
          {h.icon}
        </Handle>
      ))}

      {/* Source handle tooltip */}
      {hoveredSourceHandle && (() => {
        const idx = SOURCE_HANDLES.findIndex((h) => h.id === hoveredSourceHandle);
        const def = SOURCE_HANDLES[idx];
        if (!def) return null;
        const color = SOURCE_HANDLE_COLORS[def.type];
        return (
          <div
            className="absolute pointer-events-none z-[1001] text-[10px] px-2.5 py-1 rounded-lg whitespace-nowrap shadow-xl"
            style={{
              top: 20 + idx * 32,
              right: 0,
              transform: "translate(calc(100% + 34px), -50%)",
              background: "#1A1A1A",
              border: `1px solid ${color}33`,
              color: "#CCCCCC",
            }}
          >
            <span style={{ color }} className="mr-1.5">●</span>
            {def.label}
          </div>
        );
      })()}

      {/* ── Handles ──────────────────────────────────────────────────── */}
      {handles.map((h) => {
        const hidden = !activeHandles.has(h.id);
        const bottomPx = handleBottomMap.get(h.id) ?? 0;
        const isMotionStartFrame = h.id === "startFrame" && cfg.id === "kling-2.6-motion-control";
        const compatible = !connectingHandleType
          || (CONNECTABLE_FOR_TYPE[connectingHandleType]?.has(h.id) ?? false);
        const connectable = !hidden && compatible;
        return (
          <Handle
            key={h.id}
            type="target"
            position={Position.Left}
            id={h.id}
            isConnectable={connectable}
            style={{ top: `calc(100% - ${bottomPx}px)`, visibility: hidden ? "hidden" : undefined, pointerEvents: hidden ? "none" : undefined }}
            className={`${h.className}${errorHandles.has(h.id) ? " node-handle-error" : ""}${connectedHandles.has(h.id) ? " node-handle-connected" : ""}`}
            onMouseEnter={() => { if (!hidden && compatible) setHoveredHand(h.id); }}
            onMouseLeave={() => setHoveredHand(null)}
          >
            {h.id === "prompt" && <PromptIcon />}
            {h.id === "startFrame" && !isMotionStartFrame && <FrameStartIcon />}
            {isMotionStartFrame && <CharacterIcon />}
            {h.id === "endFrame" && <FrameEndIcon />}
            {h.id === "resource" && <ResourceIcon />}
            {h.id === "videoRef" && <VideoRefIcon />}
            {h.id === "referenceVideo" && <RefVideoIcon />}
            {h.id === "audioRef" && <AudioRefIcon />}
          </Handle>
        );
      })}

      {/* Handle tooltip */}
      {hoveredDef && (() => {
        const bottomPx = handleBottomMap.get(hoveredDef.id) ?? 0;
        const tooltipColor =
          hoveredDef.id === "startFrame" && cfg.id === "kling-2.6-motion-control"
            ? "#f472b6"
            : HANDLE_COLORS[hoveredDef.id] ?? "#888";
        return (
          <div
            className="absolute pointer-events-none z-[1001] text-[10px] px-2.5 py-1 rounded-lg whitespace-nowrap shadow-xl"
            style={{
              top: `calc(100% - ${bottomPx}px)`,
              left: 0,
              transform: "translate(calc(-100% - 34px), -50%)",
              background: "#1A1A1A",
              border: `1px solid ${tooltipColor}33`,
              color: "#CCCCCC",
            }}
          >
            <span style={{ color: tooltipColor }} className="mr-1.5">●</span>
            {hoveredDef.label}
          </div>
        );
      })()}

      {/* ── Full-card media container — all controls overlaid inside ── */}
      <div
        className="relative bg-[#090B0D] overflow-hidden rounded-[8px] group/player group/gen"
        style={{ aspectRatio: (data.imageNaturalRatio as string | undefined) ?? aspectRatio.replace(":", " / "), width: "100%", transition: "aspect-ratio 0.35s cubic-bezier(0.4, 0, 0.2, 1)" }}
      >
        {/* Video carousel strip */}
        {generations.length > 0 ? (
          <div
            style={{
              display: "flex",
              height: "100%",
              transform: `translateX(${-currentGenIdx * 100}%)`,
              transition: "transform 320ms cubic-bezier(0.4, 0, 0.2, 1)",
              willChange: "transform",
            }}
          >
            {generations.map((entry, i) => (
              <div key={i} style={{ minWidth: "100%", height: "100%", flexShrink: 0, position: "relative", background: "#090B0D" }}>
                {entry === null ? (
                  <div className="absolute inset-0" style={{ background: "#090B0D" }} />
                ) : typeof entry === "object" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center z-20">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" fill="#1a0a0a" stroke="#5a1a1a" strokeWidth="1.5" />
                      <path d="M12 7v5" stroke="#c04040" strokeWidth="2" strokeLinecap="round" />
                      <circle cx="12" cy="16" r="1" fill="#c04040" />
                    </svg>
                    <p className="text-[10px] text-[#555] leading-snug break-words">{entry.error}</p>
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); deleteGen(i); }}
                      className="flex items-center gap-1.5 h-7 px-3 rounded-full transition-all hover:bg-red-900/60"
                      style={{ background: "rgba(40,0,0,0.7)", backdropFilter: "blur(10px)", border: "1px solid rgba(200,50,50,0.35)" }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-red-400">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                      <span className="text-[11px] font-medium text-red-400">Delete</span>
                    </button>
                  </div>
                ) : (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    ref={(el) => {
                      if (el) { videoRefs.current.set(i, el); if (i === currentGenIdx) (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el; }
                      else videoRefs.current.delete(i);
                    }}
                    src={entry}
                    className="w-full h-full block"
                    style={{ objectFit: "fill" }}
                    loop
                    playsInline
                    muted={i !== currentGenIdx || muted || !hovering}
                    onPlay={i === currentGenIdx ? () => setIsPlaying(true) : undefined}
                    onPause={i === currentGenIdx ? () => setIsPlaying(false) : undefined}
                    onLoadedMetadata={i === currentGenIdx ? handleVideoMeta : undefined}
                    onTimeUpdate={i === currentGenIdx ? (e) => {
                      const v = e.currentTarget;
                      setCurrentSec(v.currentTime);
                      if (v.duration) setProgress(v.currentTime / v.duration);
                    } : undefined}
                  />
                )}
              </div>
            ))}
          </div>
        ) : status === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-5 gap-2.5 text-center">
            <div className="flex items-center gap-2.5">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="shrink-0">
                <circle cx="12" cy="12" r="10" fill="#1a0a0a" stroke="#5a1a1a" strokeWidth="1.5" />
                <path d="M12 7v5" stroke="#c04040" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="16" r="1" fill="#c04040" />
              </svg>
              <span className="text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ border: "1px solid rgba(74,222,128,0.2)", color: "#4ade80", background: "rgba(74,222,128,0.07)" }}>
                Credits refunded
              </span>
            </div>
            <p className="text-white text-[12px] font-semibold leading-snug">Oops! Something went wrong.</p>
            <p className="text-[#555] text-[10px] leading-[1.5] break-words">{(data.errorMsg as string) ?? "Generation failed"}</p>
          </div>
        ) : (
          <div className="w-full h-full">
            {textNode && (
              <div className="absolute bottom-12 left-4 flex items-center gap-1.5 z-10">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ff3df5] shrink-0" />
                <span className="text-[11px] text-[#555]">{textNode.data.label as string}</span>
              </div>
            )}
          </div>
        )}

        {/* Frame view overlay — shown when toggle is set to "frame" */}
        {viewMode === "frame" && (data.capturedFrameUrl as string | undefined) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.capturedFrameUrl as string}
            alt="Captured frame"
            className="absolute inset-0 w-full h-full block"
            style={{ objectFit: "fill", zIndex: 5 }}
          />
        )}

        {/* ── Normal player controls (hidden while picker is open) ── */}
        {!pickerOpen && (
          <>
            {/* Video / Frame toggle switch — top-left, visible on hover */}
            {!busy && (data.capturedFrameUrl as string | undefined) && (
              <div
                className="absolute top-2 left-2 z-10 flex items-center p-1 rounded-full gap-0.5 opacity-0 group-hover/player:opacity-100 transition-opacity node-slide-reveal"
                style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {/* Sliding active indicator */}
                <div style={{
                  position: "absolute",
                  top: 4, left: 4,
                  width: 28, height: 28,
                  borderRadius: "50%",
                  background: viewMode === "frame" ? "transparent" : "rgba(255,255,255,0.18)",
                  border: "1.5px solid rgba(255,255,255,0.45)",
                  transform: `translateX(${viewMode === "frame" ? 30 : 0}px)`,
                  transition: "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                  pointerEvents: "none",
                  zIndex: 20,
                }} />
                <button
                  onClick={(e) => { e.stopPropagation(); setViewMode("video"); }}
                  className="w-7 h-7 rounded-full flex items-center justify-center relative z-10"
                  title="Show video"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={viewMode === "video" ? "white" : "#777"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 220ms" }}>
                    <rect width="15" height="14" x="2" y="5" rx="2" />
                    <path d="m17 8 5-3v14l-5-3V8Z" />
                  </svg>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setViewMode("frame"); }}
                  className="w-7 h-7 rounded-full flex items-center justify-center relative z-10"
                  title="Show frame"
                >
                  <div style={{
                    width: 20, height: 20, borderRadius: "50%",
                    backgroundImage: `url(${data.capturedFrameUrl as string})`,
                    backgroundSize: "cover", backgroundPosition: "center",
                    flexShrink: 0,
                    border: "1px solid rgba(255,255,255,0.15)",
                  }} />
                </button>
              </div>
            )}

            {/* Mute button — top right, shown on hover when video is ready */}
            {typeof generations[currentGenIdx] === "string" && (
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setGlobalMuted(!muted); }}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/player:opacity-100 transition-opacity pointer-events-auto z-20 node-slide-reveal"
                title={muted ? "Unmute" : "Mute"}
              >
                {muted ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5L6 9H2V15H6L11 19V5Z" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
              </button>
            )}

            {/* Carousel indicators */}
            {generations.length > 1 && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-20 pointer-events-none opacity-0 group-hover/player:opacity-100 transition-opacity duration-200">
                {generations.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 rounded-full transition-all duration-300 ${i === currentGenIdx ? "w-4 bg-white" : "w-1 bg-white/30"}`}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Frame picker overlay ─────────────────────────────────── */}
        {pickerOpen && (
          <div
            className="nodrag absolute inset-0 flex flex-col z-30 bg-transparent"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {/* Scrubber + time */}
            <div className="mt-auto px-3 pb-3 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white font-mono tabular-nums">{fmtTime(currentSec)}</span>
                {captureErr
                  ? <span className="text-[10px] text-red-400">{captureErr}</span>
                  : <span className="text-[10px] text-white/40">drag to seek</span>
                }
              </div>
              <input
                type="range" min={0} max={1} step={0.0001}
                value={scrubPos}
                onChange={(e) => {
                  const pct = parseFloat(e.target.value);
                  setScrubPos(pct);
                  const v = videoRef.current;
                  if (v && v.duration) v.currentTime = pct * v.duration;
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="nodrag w-full cursor-pointer accent-white"
              />
              <div className="flex gap-2">
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); captureFrame(); }}
                  disabled={capturing}
                  className="nodrag flex-1 h-7 rounded-full bg-white/90 text-black text-[11px] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {capturing ? (
                    <>
                      <svg width="11" height="11" viewBox="0 0 22 22" fill="none" style={{ animation: "spin 0.9s linear infinite" }}>
                        <circle cx="11" cy="11" r="8" stroke="#333" strokeWidth="2.5" />
                        <path d="M11 3A8 8 0 0 1 19 11" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
                      </svg>
                      Capturing…
                    </>
                  ) : (
                    <>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="3" /><path d="M20 7h-3.2L15 5H9L7.2 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
                      </svg>
                      Use this frame
                    </>
                  )}
                </button>
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    videoRef.current?.play().catch(() => {});
                    if (lastEdgeIdRef.current) onEdgesChange([{ type: "remove", id: lastEdgeIdRef.current }]);
                    setPickerOpen(false);
                    lastEdgeIdRef.current = null;
                  }}
                  className="nodrag h-7 px-3 rounded-full bg-white/10 text-white text-[11px] flex items-center justify-center cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Generating badge + cancel */}
        {busy && generations[currentGenIdx] === null && (
          <>
            <div
              className="absolute top-2 left-2 flex items-center gap-1.5 h-7 px-3 rounded-full z-20 pointer-events-none select-none"
              style={{ background: "rgba(0,0,0,0.58)", backdropFilter: "blur(10px)", border: isPending ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(168,85,247,0.25)" }}
            >
              {isPending ? (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}>
                  <circle cx="5" cy="5" r="4" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
                  <path d="M5 1 A4 4 0 0 1 9 5" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}>
                  <circle cx="5" cy="5" r="4" stroke="rgba(168,85,247,0.25)" strokeWidth="1.5" />
                  <path d="M5 1 A4 4 0 0 1 9 5" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
              <span className="text-[11px] font-medium" style={{ color: isPending ? "#888" : "#a855f7" }}>
                {isPending ? "Pending" : (phaseLabel || "Generating…")}
              </span>
            </div>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); handleCancel(); }}
              className="absolute top-2 right-2 flex items-center gap-1.5 h-7 px-3 rounded-full z-20 transition-colors hover:bg-white/10"
              style={{ background: "rgba(0,0,0,0.58)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="m6 6 12 12" />
              </svg>
              <span className="text-[11px] text-[#ccc] font-medium">Cancel</span>
            </button>
          </>
        )}

        {/* Mute button — top right, shown on hover when video is ready */}
        {typeof generations[currentGenIdx] === "string" && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setGlobalMuted(!muted); }}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/player:opacity-100 transition-opacity pointer-events-auto z-20 node-slide-reveal"
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>
        )}

        {/* Player bar — timer + progress + play/pause at very bottom */}
        {typeof generations[currentGenIdx] === "string" && (
          <div
            className="absolute bottom-0 left-0 right-0 flex items-center gap-2 px-2.5 h-9 opacity-0 group-hover/player:opacity-100 transition-opacity z-20"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span className="text-[10px] text-white/60 font-mono tabular-nums shrink-0">{fmtTime(currentSec)}</span>
            <div
              className="flex-1 h-[2px] bg-white/15 rounded-full cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                const v = videoRef.current;
                if (v && v.duration) v.currentTime = pct * v.duration;
              }}
            >
              <div className="h-full bg-white/60 rounded-full transition-none" style={{ width: `${progress * 100}%` }} />
            </div>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                const v = videoRef.current;
                if (!v) return;
                if (v.paused) v.play().catch(() => {}); else v.pause();
              }}
              className="shrink-0 pointer-events-auto opacity-70 hover:opacity-100 transition-opacity"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                  <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>
          </div>
        )}

        {/* ── Bottom overlay control bar ── */}
        {(() => {
          const modePicker = cfg.modes ? (
            <div className="relative shrink-0">
              <div className="flex items-center rounded-full" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => { setModeOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setDurOpen(false); setGrokResOpen(false); }}
                  className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 hover:brightness-125 transition-all whitespace-nowrap"
                >
                  <span className="text-[11px] text-white/70">{cfg.modes.find((m) => m.value === mode)?.label ?? mode}</span>
                  <ChevronIcon open={modeOpen} />
                </button>
                {cfg.apiInput.useMotionControl && (
                  <>
                    <span className="w-px h-3 bg-white/10 shrink-0" />
                    <div className="relative group/orient-info flex items-center px-1.5 py-1">
                      <div className="w-3.5 h-3.5 rounded-full border border-white/20 flex items-center justify-center text-white/40 hover:text-white/70 hover:border-white/40 transition-colors cursor-default select-none">
                        <span className="text-[8px] font-semibold leading-none">i</span>
                      </div>
                      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 px-3 py-2 rounded-lg text-[10px] leading-[1.6] text-[#AAA] opacity-0 group-hover/orient-info:opacity-100 transition-opacity z-50 node-slide-reveal" style={{ background: "#111317", border: "1px solid #2A2A2A" }}>
                        When Character Orientation matches the video, complex motions perform better; when it matches the image, camera movements are better supported.
                      </div>
                    </div>
                  </>
                )}
              </div>
              <FloatMenu open={modeOpen}>
                {cfg.modes.map((m) => (
                  <FloatItem key={m.value} active={mode === m.value} onClick={() => { updateNodeData(id, { klingMode: m.value }); setModeOpen(false); }}>
                    {m.label}
                  </FloatItem>
                ))}
              </FloatMenu>
            </div>
          ) : null;

          const resPicker = cfg.resolutions ? (
            <div className="relative shrink-0">
              <Pill onClick={() => { setGrokResOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setDurOpen(false); setModeOpen(false); }}>
                <span className="text-[11px] text-white/70">{resolution}</span>
                <ChevronIcon open={grokResOpen} />
              </Pill>
              <FloatMenu open={grokResOpen}>
                {cfg.resolutions.map((r) => (
                  <FloatItem key={r} active={resolution === r} onClick={() => { updateNodeData(id, { grokResolution: r }); setGrokResOpen(false); }}>
                    {r}
                  </FloatItem>
                ))}
              </FloatMenu>
            </div>
          ) : null;

          return (
            <div
              ref={controlBarRef}
              className={`absolute left-0 right-0 flex items-end gap-2 px-2.5 pb-2 pt-1 z-10 transition-opacity duration-150 ${hovering || selected ? "opacity-100" : "opacity-0 pointer-events-none"}`}
              style={{ bottom: 36 }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* Pills — wrap freely */}
              <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">

              {/* Model */}
              <div className="relative">
                <Pill onClick={() => { setModelOpen((o) => !o); setRatioOpen(false); setDurOpen(false); setModeOpen(false); setGrokResOpen(false); }}>
                  <span className="shrink-0 text-white/60" style={{ lineHeight: 0 }}>
                    <NodeProviderIcon provider={cfg.provider} />
                  </span>
                  <span className="text-[11px] text-white/70">{cfg.name}</span>
                  <ChevronIcon open={modelOpen} />
                </Pill>
                <FloatMenu open={modelOpen}>
                  {[...new Set(VIDEO_MODEL_CFG.map(m => m.provider))].map((provider, pi) => (
                    <Fragment key={provider}>
                      {pi > 0 && <div className="border-t border-white/[0.06] mx-2 my-0.5" />}
                      {VIDEO_MODEL_CFG.filter(m => m.provider === provider).map(m => (
                        <button
                          key={m.id}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => {
                            const validRatio = m.ratios.includes(aspectRatio) ? aspectRatio : m.defaultRatio;
                            const validDur = m.durations.includes(duration) ? duration : m.defaultDuration;
                            updateNodeData(id, { videoModel: m.id, aspectRatio: validRatio, duration: validDur });
                            const removedHandles = (cfg.handles as string[]).filter((h) => !(m.handles as string[]).includes(h));
                            const wasMotionControl = cfg.id === "kling-2.6-motion-control";
                            const isMotionControl = m.id === "kling-2.6-motion-control";
                            if (wasMotionControl !== isMotionControl && !removedHandles.includes("startFrame")) {
                              removedHandles.push("startFrame");
                            }
                            const oldHasVideoRef = (cfg.handles as string[]).includes("videoRef");
                            const newHasVideoRef = (m.handles as string[]).includes("videoRef");
                            const oldHasRefVideo = (cfg.handles as string[]).includes("referenceVideo");
                            const newHasRefVideo = (m.handles as string[]).includes("referenceVideo");
                            if (oldHasVideoRef && !newHasVideoRef && newHasRefVideo) {
                              remapTargetHandle(id, "videoRef", "referenceVideo");
                              removedHandles.splice(removedHandles.indexOf("videoRef"), 1);
                            } else if (oldHasRefVideo && !newHasRefVideo && newHasVideoRef) {
                              remapTargetHandle(id, "referenceVideo", "videoRef");
                              removedHandles.splice(removedHandles.indexOf("referenceVideo"), 1);
                            }
                            if (removedHandles.length) killEdgesForHandles(id, removedHandles);
                            setModelOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-[#161A1E] transition-colors ${videoModelId === m.id ? "text-white font-medium" : "text-[#8D8E89]"}`}
                        >
                          <span className="shrink-0 text-white/50" style={{ lineHeight: 0 }}>
                            <NodeProviderIcon provider={m.provider} />
                          </span>
                          <span className="flex-1 text-left">{m.name}</span>
                          <span className="text-[#4A4A45]">{m.provider}</span>
                        </button>
                      ))}
                    </Fragment>
                  ))}
                </FloatMenu>
              </div>

              {/* Duration */}
              {durations.length > 0 && (
                <div className="relative">
                  <Pill onClick={() => { setDurOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setModeOpen(false); setGrokResOpen(false); }}>
                    <span className="text-[11px] text-white/70 tabular-nums">{duration}s</span>
                    <ChevronIcon open={durOpen} />
                  </Pill>
                  <FloatMenu open={durOpen}>
                    <div className="p-3 min-w-[200px]" onMouseDown={(e) => e.stopPropagation()}>
                      <p className="text-[12px] text-white font-medium mb-2.5">Choose duration</p>
                      <div
                        className="nodrag flex items-center gap-2.5 pl-3 pr-4 py-2 rounded-lg"
                        style={{ background: "#161A1E" }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <span className="text-[11px] text-[#AAA] tabular-nums shrink-0 w-6">{duration}s</span>
                        <div className="w-px h-3.5 shrink-0" style={{ background: "#2A2A2A" }} />
                        <input
                          type="range"
                          min={0}
                          max={(durations as readonly number[]).length - 1}
                          step={1}
                          value={Math.max(0, (durations as readonly number[]).indexOf(duration))}
                          onChange={(e) => {
                            const idx = parseInt(e.target.value);
                            updateNodeData(id, { duration: (durations as readonly number[])[idx] });
                          }}
                          className="dur-slider"
                        />
                      </div>
                    </div>
                  </FloatMenu>
                </div>
              )}

              {/* Ratio */}
              {ratios.length > 0 && (
                <div className="relative">
                  <Pill onClick={() => { setRatioOpen((o) => !o); setModelOpen(false); setDurOpen(false); setModeOpen(false); setGrokResOpen(false); }}>
                    <AspectIcon ratio={aspectRatio} />
                    <span className="text-[11px] text-white/70">{aspectRatio}</span>
                    <ChevronIcon open={ratioOpen} />
                  </Pill>
                  <FloatMenu open={ratioOpen}>
                    {(ratios as readonly string[]).map((r) => (
                      <FloatItem key={r} active={aspectRatio === r} onClick={() => { updateNodeData(id, { aspectRatio: r }); setRatioOpen(false); }}>
                        {r}
                      </FloatItem>
                    ))}
                  </FloatMenu>
                </div>
              )}

              {modePicker}
              {resPicker}

              {/* Sound toggle */}
              {cfg.sound && (
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => updateNodeData(id, { sound: !sound })}
                  className="flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors"
                  style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <ToggleSwitch on={sound} />
                  <span className="text-[11px] text-white/70">Sound</span>
                </button>
              )}

              {/* Seed input */}
              {cfg.supportsSeeds && (
                <div
                  className="flex items-center gap-1.5 rounded-full px-2 py-1"
                  style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)" }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <span className="text-[11px] text-white/70 shrink-0 select-none">Seed</span>
                  <input
                    type="number"
                    min={0}
                    max={2147483647}
                    placeholder="—"
                    value={seed}
                    onChange={(e) => {
                      const v = e.target.value === "" ? 0 : Math.max(0, Math.min(2147483647, parseInt(e.target.value, 10)));
                      updateNodeData(id, { seed: isNaN(v) ? 0 : v });
                    }}
                    className="nodrag w-12 bg-transparent border-none outline-none text-[11px] text-white/90 text-right tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </div>
              )}

              {/* Img ref indicator */}
              {activeHandles.has("resource") && hasResource && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-full" style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#fb923c] shrink-0" />
                  <span className="text-[10px] text-white/60">Img ref</span>
                </div>
              )}

              </div>{/* end pills wrapper */}

              {/* Generate button — always right */}
              <GenerateButton onClick={generate} busy={animBusy} disabled={promptOverLimit || kieKeySet === false || busy} />
            </div>
          );
        })()}
      </div>

      {/* ── Carousel nav — floats below the node card ── */}
      {generations.length > 1 && (
        <div
          className="absolute left-0 right-0 flex items-center justify-center gap-1.5"
          style={{ top: "calc(100% + 16px)" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => { e.stopPropagation(); goToGen(currentGenIdx - 1); }}
            disabled={currentGenIdx === 0}
            className="absolute left-0 w-7 h-7 flex items-center justify-center rounded-full transition-opacity disabled:opacity-20"
            style={{ background: "rgba(0,0,0,0.45)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          {generations.length <= 8 ? generations.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); goToGen(i); }}
              className={`rounded-full transition-all ${i === currentGenIdx ? "w-3 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/40 hover:bg-white/70"}`}
            />
          )) : (
            <span className="text-[10px] text-white/60 font-mono tabular-nums">
              {currentGenIdx + 1} / {generations.length}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); goToGen(currentGenIdx + 1); }}
            disabled={currentGenIdx === generations.length - 1}
            className="absolute right-0 w-7 h-7 flex items-center justify-center rounded-full transition-opacity disabled:opacity-20"
            style={{ background: "rgba(0,0,0,0.45)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>
      )}

      {/* ── Video lightbox ───────────────────────────────────────────── */}
      {lightboxOpen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center transition-opacity duration-200 ease-in-out"
          style={{ backgroundColor: `rgba(0,0,0,${lightboxVisible ? 0.9 : 0})`, opacity: lightboxVisible ? 1 : 0 }}
          onClick={closeLightbox}
        >
          <div
            className="relative transition-all duration-200 ease-in-out rounded-2xl overflow-hidden"
            style={{ transform: lightboxVisible ? "scale(1)" : "scale(0.95)", boxShadow: "0 0 0 8px #3a3a3a" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={data.videoUrl as string}
              controls
              autoPlay
              loop
              playsInline
              className="block max-w-[90vw] max-h-[90vh]"
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Pill({
  children, onClick, interactive = true, fullWidth = false, disabled = false,
}: {
  children: React.ReactNode; onClick?: () => void;
  interactive?: boolean; fullWidth?: boolean; disabled?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onMouseDown={onClick ? (e: React.MouseEvent) => e.stopPropagation() : undefined}
      onClick={disabled ? undefined : onClick}
      disabled={disabled && Tag === "button" ? true : undefined}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 whitespace-nowrap shrink-0 ${fullWidth ? "w-full justify-between" : ""} ${disabled ? "opacity-40 cursor-not-allowed" : interactive && onClick ? "hover:brightness-125 transition-all cursor-pointer" : ""
        }`}
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      {children}
    </Tag>
  );
}

function FloatMenu({ children, fullWidth = false, open }: { children: React.ReactNode; fullWidth?: boolean; open: boolean }) {
  const { visible, className } = useAnimatedPopup(open);
  if (!visible) return null;
  return (
    <div className={`absolute bottom-full left-0 mb-1.5 bg-[#0F1214] border border-[#222] rounded-xl overflow-hidden z-50 shadow-2xl ${fullWidth ? "w-full" : "min-w-max"} ${className}`}>
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
    <div className="relative shrink-0 rounded-full transition-colors" style={{ width: 32, height: 18, background: on ? "#3A3A3A" : "#2A2A2A" }}>
      <div className="absolute top-[3px] rounded-full transition-transform" style={{ width: 12, height: 12, background: on ? "#4ade80" : "#555", transform: on ? "translateX(17px)" : "translateX(3px)" }} />
    </div>
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
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="white">
      <path d="M1.5 2h11v2H8.5v8H5.5V4H1.5V2z" />
    </svg>
  );
}

function VideoRefIcon() {
  return (
    <svg width="13" height="11" viewBox="0 0 14 12" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0.7" y="0.7" width="12.6" height="10.6" rx="1.3" />
      <path d="M5.5 4.5v3l3-1.5-3-1.5z" fill="white" stroke="none" />
    </svg>
  );
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" fill="white" stroke="none" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function RefVideoIcon() {
  return (
    <svg width="13" height="11" viewBox="0 0 14 12" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0.7" y="0.7" width="12.6" height="10.6" rx="1.3" />
      <path d="M5.5 4.5v3l3-1.5-3-1.5z" fill="white" stroke="none" />
      <path d="M11.5 3v1.5M11.5 7.5v1.5" strokeWidth="1.1" />
    </svg>
  );
}

function AudioRefIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5v4M4.5 3v8M7 4.5v5M9.5 3v8M12 5v4" />
    </svg>
  );
}

function CharacterIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="4.5" r="2.5" />
      <path d="M1.5 13c0-2.8 2.46-5 5.5-5s5.5 2.2 5.5 5" />
    </svg>
  );
}

function SrcFrameStartIcon() {
  return (
    <svg width="13" height="11" viewBox="0 0 14 12" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0.7" y="0.7" width="12.6" height="10.6" rx="1.3" />
      <path d="M4.5 6h5M7 4l2.5 2L7 8" />
    </svg>
  );
}

function SrcFrameEndIcon() {
  return (
    <svg width="13" height="11" viewBox="0 0 14 12" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0.7" y="0.7" width="12.6" height="10.6" rx="1.3" />
      <path d="M9.5 6h-5M7 4 4.5 6 7 8" />
    </svg>
  );
}

function SrcImagePickIcon() {
  return (
    <svg width="13" height="11" viewBox="0 0 14 12" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0.7" y="0.7" width="12.6" height="10.6" rx="1.3" />
      <circle cx="4.5" cy="4" r="1.2" fill="white" stroke="none" />
      <path d="m0.7 9 3.5-3.5 2.5 2.5 2-2 5 4" />
    </svg>
  );
}

function SrcVideoIcon() {
  return (
    <svg width="13" height="11" viewBox="0 0 14 12" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <rect x="0.7" y="0.7" width="12.6" height="10.6" rx="1.3" />
      <path d="M5.5 4.5v3l3-1.5-3-1.5z" fill="white" stroke="none" />
    </svg>
  );
}

function SrcAudioIcon() {
  return (
    <svg width="12" height="11" viewBox="0 0 13 12" fill="none" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4v4M4.5 2v8M6.5 3.5v5M9 2v8M11 4v4" />
    </svg>
  );
}

function NodeProviderIcon({ provider }: { provider: string }) {
  switch (provider) {
    case "OpenAI":
      return <svg className="text-purple-400" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M22.408 9.80741C22.9487 8.17778 22.7685 6.37037 21.8974 4.88889C20.5758 2.60741 17.9024 1.45185 15.2891 1.98519C14.1477 0.711111 12.4656 0 10.7234 0C8.0501 0 5.70717 1.68889 4.86612 4.17778C3.15398 4.53333 1.68214 5.57037 0.811051 7.08148C-0.510601 9.36296 -0.210226 12.2074 1.56199 14.163C1.02131 15.8222 1.23158 17.6 2.10267 19.0815C3.42432 21.363 6.09766 22.5481 8.71093 21.9852C9.88239 23.2593 11.5345 24 13.2766 24C15.95 24 18.2929 22.3111 19.134 19.8222C20.8461 19.4667 22.3179 18.4296 23.189 16.9185C24.5107 14.637 24.2103 11.763 22.408 9.80741ZM13.2766 22.4296C12.1953 22.4296 11.174 22.0741 10.363 21.3926C10.393 21.363 10.4831 21.3333 10.5132 21.3037L15.3492 18.5481C15.5895 18.4 15.7397 18.163 15.7397 17.8667V11.1407L17.7823 12.2963C17.8123 12.2963 17.8123 12.3259 17.8123 12.3556V17.9259C17.8423 20.4148 15.7998 22.4296 13.2766 22.4296ZM3.48439 18.3111C2.94372 17.3926 2.76349 16.3259 2.94372 15.2889C2.97375 15.3185 3.03383 15.3481 3.0939 15.3778L7.92995 18.1333C8.17025 18.2815 8.47063 18.2815 8.71093 18.1333L14.6283 14.7556V17.0963C14.6283 17.1259 14.6283 17.1556 14.5983 17.1556L9.70216 19.9407C7.53946 21.1852 4.74597 20.4444 3.48439 18.3111ZM2.22282 7.88148C2.76349 6.96296 3.60454 6.28148 4.59578 5.8963V11.5852C4.59578 11.8519 4.74597 12.1185 4.98627 12.2667L10.9037 15.6444L8.86111 16.8C8.83108 16.8 8.80104 16.8296 8.80104 16.8L3.90492 14.0148C1.68214 12.7704 0.961239 10.0148 2.22282 7.88148ZM19.0438 11.7333L13.1264 8.35556L15.169 7.2C15.199 7.2 15.2291 7.17037 15.2291 7.2L20.1252 9.98519C22.3179 11.2296 23.0388 13.9852 21.7773 16.1185C21.2366 17.037 20.3955 17.7185 19.4043 18.0741V12.4148C19.4343 12.1481 19.2841 11.8815 19.0438 11.7333ZM21.0564 8.71111C21.0263 8.68148 20.9662 8.65185 20.9062 8.62222L16.0701 5.86667C15.8298 5.71852 15.5294 5.71852 15.2891 5.86667L9.37175 9.24444V6.9037C9.37175 6.87407 9.37175 6.84444 9.40179 6.84444L14.2979 4.05926C16.4906 2.81481 19.2541 3.55556 20.5157 5.71852C21.0564 6.60741 21.2366 7.67407 21.0564 8.71111ZM8.26036 12.8593L6.21781 11.7037C6.18777 11.7037 6.18777 11.6741 6.18777 11.6444V6.07407C6.18777 3.58519 8.23032 1.57037 10.7535 1.57037C11.8348 1.57037 12.8561 1.92593 13.6671 2.60741C13.6371 2.63704 13.577 2.66667 13.5169 2.6963L8.68089 5.45185C8.44059 5.6 8.2904 5.83704 8.2904 6.13333V12.8593H8.26036ZM9.37175 10.4889L12.0151 8.97778L14.6584 10.4889V13.4815L12.0151 14.9926L9.37175 13.4815V10.4889Z" /></svg>;
    case "Google":
      return <svg className="text-purple-400" width="11" height="11" viewBox="0 0 20 20" fill="currentColor"><path d="M2.55464 6.25768C3.24798 4.87705 4.31161 3.71644 5.62666 2.90557C6.94171 2.0947 8.45636 1.66553 10.0013 1.66602C12.2471 1.66602 14.1338 2.49102 15.5763 3.83685L13.1871 6.22685C12.323 5.40102 11.2246 4.98018 10.0013 4.98018C7.83047 4.98018 5.99297 6.44685 5.3388 8.41602C5.17214 8.91602 5.07714 9.44935 5.07714 9.99935C5.07714 10.5493 5.17214 11.0827 5.3388 11.5827C5.9938 13.5527 7.83047 15.0185 10.0013 15.0185C11.1221 15.0185 12.0763 14.7227 12.823 14.2227C13.2558 13.9377 13.6264 13.5679 13.9123 13.1356C14.1982 12.7033 14.3935 12.2176 14.4863 11.7077H10.0013V8.48435H17.8496C17.948 9.02935 18.0013 9.59768 18.0013 10.1885C18.0013 12.7268 17.093 14.8635 15.5163 16.3135C14.138 17.5868 12.2513 18.3327 10.0013 18.3327C8.90683 18.3331 7.823 18.1179 6.81176 17.6992C5.80051 17.2806 4.88168 16.6668 4.10777 15.8929C3.33386 15.119 2.72005 14.2001 2.30141 13.1889C1.88278 12.1777 1.66753 11.0938 1.66797 9.99935C1.66797 8.65435 1.98964 7.38268 2.55464 6.25768Z" /></svg>;
    case "Seedream":
      return <svg className="text-purple-400" width="11" height="11" viewBox="0 0 14 14" fill="currentColor"><path d="M2.7601 10.635L0.466553 11.2084V1.04883L2.7601 1.62222V10.635Z" /><path d="M13.8448 11.2295L11.5469 11.8029V0.454102L13.8448 1.02324V11.2295Z" /><path d="M6.39853 10.9452L4.10498 11.5186V5.53418L6.39853 6.10752V10.9452Z" /><path d="M7.89722 4.64663L10.1952 4.07324V10.0577L7.89722 9.48433V4.64663Z" /></svg>;
    case "Z-AI":
      return <svg className="text-purple-400" width="11" height="11" viewBox="0 0 20 20" fill="currentColor"><path d="M19.9361 12.1411L17.6243 8.09523L17.3525 7.61735L18.5771 5.47657C18.6187 5.4023 18.6411 5.32158 18.6411 5.23763C18.6411 5.15367 18.6187 5.07295 18.5771 4.99868L17.215 2.61896C17.1735 2.5447 17.1127 2.48658 17.0424 2.4446C16.972 2.40262 16.8921 2.38002 16.8058 2.38002H11.6323L10.4077 0.236011C10.3245 0.0874804 10.1679 -0.00292969 9.9984 -0.00292969H7.27738C7.19425 -0.00292969 7.11111 0.0196728 7.04077 0.0616489C6.97042 0.103625 6.90967 0.161746 6.86811 0.236011L4.55316 4.28509L4.28138 4.75974H1.83213C1.749 4.75974 1.66587 4.78235 1.59552 4.82432C1.52518 4.8663 1.46443 4.92442 1.42286 4.99868L0.0639488 7.38164C0.0223821 7.4559 0 7.53663 0 7.62058C0 7.70453 0.0223821 7.78525 0.0639488 7.85952L2.65068 12.3833L1.42606 14.5273C1.38449 14.6015 1.36211 14.6823 1.36211 14.7662C1.36211 14.8502 1.38449 14.9309 1.42606 15.0051L2.78817 17.3849C2.82974 17.4591 2.89049 17.5173 2.96083 17.5592C3.03118 17.6012 3.11111 17.6238 3.19744 17.6238H8.36771L9.59233 19.7678C9.67546 19.9163 9.83214 20.0068 10.0016 20.0068H12.7226C12.8058 20.0068 12.8889 19.9842 12.9592 19.9422C13.0296 19.9002 13.0903 19.8421 13.1319 19.7678L15.7186 15.2441H18.1679C18.251 15.2441 18.3341 15.2215 18.4045 15.1795C18.4748 15.1375 18.5356 15.0794 18.5771 15.0051L19.9393 12.6254C19.9808 12.5512 20.0032 12.4704 20.0032 12.3865C20.0032 12.3025 19.9808 12.2218 19.9393 12.1475L19.9361 12.1411ZM7.27738 0.474952L8.63949 2.8579L7.27738 5.23763H18.1679L16.8058 7.61735H6.45883L4.82494 4.75974L7.27738 0.474952ZM8.09273 17.1395H3.19424L4.55636 14.7565H7.27738L1.83213 5.23763H4.55316L5.91527 7.61735L9.72662 14.2851L8.09273 17.1427V17.1395ZM16.8058 12.3768L15.4468 9.99707L10.0016 19.5224L8.63949 17.1427L10.0016 14.763L13.813 8.09523H17.0807L19.53 12.38H16.8058V12.3768Z" /></svg>;
    case "X":
      return <svg className="text-purple-400" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9.23842 15.4055L17.3051 9.26292C17.7006 8.9618 18.2658 9.07925 18.4543 9.54702C19.446 12.0138 19.0029 14.9784 17.0297 17.0138C15.0566 19.0492 12.3111 19.4955 9.80163 18.4789L7.06027 19.7882C10.9922 22.5604 15.7667 21.8748 18.7504 18.795C21.117 16.3538 21.8499 13.0262 21.1646 10.0254L21.1708 10.0318C20.1769 5.62354 21.4151 3.86151 23.9515 0.258408C23.9702 0.231693 23.9351 0.202703 23.9123 0.226139L20.7939 3.44289V3.43221L9.23842 15.4055Z" /><path d="M7.65167 7.33217C5.24368 9.81392 4.75711 14.1176 7.57924 16.8984L7.57713 16.9005L0.0792788 23.8097C0.0528384 23.834 0.0162235 23.8015 0.0377551 23.7728C0.487937 23.1707 1.01883 22.595 1.54932 22.0198L1.57777 21.9889C3.28214 20.1411 4.97141 18.3097 3.93926 15.7216C2.55615 12.2552 3.36158 8.19287 5.9228 5.55089C8.58547 2.80639 12.507 2.1144 15.7826 3.5048C16.5072 3.78245 17.1388 4.17758 17.6315 4.54493L14.8964 5.84777C12.3497 4.7457 9.43229 5.49537 7.65167 7.33217Z" /></svg>;
    case "Kling":
      return <svg className="text-purple-400" width="11" height="11" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M16.7522 2.86984L16.818 2.93745L16.8199 2.93552C18.087 4.25441 17.7236 6.90443 15.8863 9.90864L19.5 13.6567L19.3447 13.9703C18.7372 15.1986 17.9147 16.2992 16.9193 17.216C15.608 18.43 14.0251 19.2853 12.3143 19.7044L12.2522 19.7198L12.1634 19.7417L12.0994 19.7565L11.9584 19.7887L11.8416 19.8126L11.754 19.8299C11.6609 19.8493 11.5634 19.8673 11.4683 19.884L11.3888 19.8963L11.3286 19.904C11.2429 19.916 11.1576 19.9272 11.0727 19.9375C9.64831 20.1036 8.20616 19.9376 6.8516 19.4517C5.49703 18.9658 4.2643 18.1723 3.24348 17.1291L3.18385 17.0692C1.91429 15.7503 2.27391 13.0983 4.11366 10.0922L0.5 6.34416L0.65528 6.03054C1.26118 4.80131 2.0846 3.70115 3.08261 2.78741C4.10242 1.8473 5.28649 1.11848 6.57081 0.640344C6.86894 0.528933 7.18075 0.431691 7.48696 0.34926C7.73931 0.279139 7.9944 0.220054 8.25155 0.172163C8.33851 0.154131 8.43665 0.135456 8.53168 0.118712C10.0139 -0.12084 11.5297 0.00325476 12.9574 0.481036C14.385 0.958817 15.6847 1.77698 16.7522 2.86984ZM15.5304 3.03083H15.5267L15.5304 3.03276C14.3025 2.63864 12.354 3.27555 10.2944 4.68267C11.8615 4.22994 13.377 4.46435 14.3565 5.48057C15.2845 6.44462 15.5385 7.90777 15.187 9.44497C15.1704 9.52697 15.1497 9.61005 15.1248 9.69419C16.8062 7.05706 17.3441 4.58993 16.2795 3.48807C16.262 3.4682 16.2433 3.44949 16.2236 3.43204L16.2155 3.42431L16.2037 3.41336L16.1683 3.38503C16.153 3.37215 16.1371 3.3597 16.1205 3.34768L16.0944 3.32836C15.9242 3.19657 15.7334 3.09594 15.5304 3.03083ZM14.6876 8.95876C14.4708 10.2995 13.7559 11.6545 12.672 12.777C11.5913 13.9001 10.282 14.642 8.98696 14.8687C7.77516 15.0812 6.72981 14.8043 6.04472 14.0959C5.36149 13.3868 5.09441 12.3069 5.29938 11.044C5.51615 9.7045 6.22919 8.3489 7.30807 7.22771C7.30807 7.22771 7.30994 7.22771 7.31429 7.22127L7.31801 7.21483C8.40062 6.09944 9.70497 5.3595 10.9969 5.13539C12.2087 4.92287 13.2516 5.1985 13.9391 5.90818C14.6224 6.61657 14.8894 7.69847 14.6845 8.9594H14.6882L14.6876 8.95876ZM3.70621 3.51061C2.88113 4.26712 2.1865 5.16395 1.65217 6.16255L1.64596 6.16449L4.78137 9.40762C5.04127 9.02837 5.31475 8.65932 5.60124 8.30124C5.70311 8.17567 5.80807 8.04558 5.91553 7.91614L5.95652 7.86784L6.10559 7.69525C6.10994 7.69139 6.11429 7.68301 6.11429 7.68301L6.14161 7.65082L6.1559 7.63343L6.23292 7.54456C6.27226 7.49819 6.31284 7.45247 6.35466 7.40739C6.35466 7.40288 6.36087 7.39644 6.36087 7.39644L6.42795 7.32045L6.47578 7.26893C6.47785 7.26592 6.4795 7.26507 6.4795 7.26507C6.48385 7.26249 6.48385 7.25863 6.48385 7.25863C6.48675 7.25562 6.48965 7.25176 6.49255 7.24703L6.50124 7.23609C6.50882 7.23006 6.51569 7.22314 6.52174 7.21548L6.53354 7.2026C6.55901 7.17619 6.58944 7.14528 6.61677 7.11437C6.63126 7.09591 6.64783 7.07745 6.66646 7.05899L6.69193 7.03194C6.69627 7.0255 6.70807 7.01326 6.70807 7.01326L6.7559 6.96432L6.84907 6.86901L6.88012 6.83488L6.91491 6.79688C7.5863 6.09838 8.30377 5.44917 9.06211 4.85397L9.16149 4.77862H9.16211V4.77798L9.16335 4.77733L9.26273 4.70134C9.37371 4.61505 9.48551 4.53068 9.59814 4.44825C9.71822 4.36325 9.8383 4.27953 9.95838 4.1971C11.587 3.0714 13.182 2.39586 14.4839 2.26191C12.7422 1.17239 10.6864 0.752921 8.6764 1.07697C8.58944 1.09114 8.50621 1.10595 8.41677 1.12462C8.36025 1.13493 8.31118 1.14523 8.26149 1.15554L8.23168 1.16198C7.77515 1.25942 7.3258 1.39004 6.88696 1.55288C5.71551 1.9877 4.63519 2.65238 3.70621 3.51061ZM3.87888 16.6531C4.05279 16.7905 4.25093 16.8949 4.47329 16.9661H4.46894C5.70497 17.3577 7.64596 16.7188 9.69814 15.3156C8.13292 15.7664 6.6205 15.532 5.64099 14.5157C4.71739 13.5562 4.46335 12.0885 4.81304 10.5513C4.83043 10.4693 4.85093 10.3863 4.87453 10.3021C3.19379 12.9399 2.65714 15.4064 3.7205 16.5089C3.77062 16.56 3.8235 16.6082 3.87888 16.6531ZM18.346 13.8389V13.8402C17.8108 14.8373 17.1168 15.7333 16.2932 16.4902C15.0606 17.625 13.5707 18.4173 11.9627 18.7931L11.9429 18.7983L11.8894 18.8112C11.8291 18.8281 11.7679 18.8418 11.7062 18.8524C11.666 18.8614 11.6251 18.8693 11.5832 18.8762C11.4967 18.8936 11.4097 18.9087 11.3224 18.9213L11.2497 18.9342L11.1671 18.9451C11.1008 18.9545 11.0329 18.9631 10.9634 18.9709C9.06697 19.1922 7.15308 18.7592 5.51801 17.7389C6.77143 17.6108 8.29752 16.9764 9.86273 15.9274L9.95217 15.8668L10.0416 15.8057L10.1634 15.7206H10.164L10.3994 15.5545C10.5128 15.4721 10.6246 15.3877 10.7348 15.3014C10.8035 15.2503 10.871 15.1994 10.9373 15.1488C11.6946 14.5518 12.4122 13.9025 13.0851 13.2052C13.1012 13.1881 13.1164 13.1713 13.1304 13.155L13.1491 13.1331C13.1822 13.1009 13.2133 13.0693 13.2422 13.0384L13.2894 12.9895C13.2894 12.9895 13.3019 12.9766 13.3037 12.9702L13.3217 12.9521L13.3292 12.9438L13.3832 12.8884L13.4248 12.8433C13.4389 12.8296 13.4528 12.815 13.4665 12.7995L13.4776 12.7866C13.4837 12.7792 13.4906 12.7725 13.4981 12.7667L13.5075 12.7551L13.5161 12.7441C13.5161 12.7441 13.5224 12.7377 13.5261 12.7358L13.5429 12.7171L13.5596 12.6984L13.5758 12.6823C13.5584 12.7012 13.5418 12.7209 13.5261 12.7416L13.5646 12.6997L13.5652 12.6984C13.5921 12.6684 13.6188 12.6396 13.6453 12.6121C13.6453 12.6121 13.6453 12.6057 13.6516 12.6057C13.688 12.5653 13.7234 12.5245 13.7578 12.4833L13.828 12.4022C13.8372 12.396 13.8447 12.3873 13.8497 12.3771L13.8894 12.3275L13.8994 12.3152C13.9478 12.2616 13.9952 12.2073 14.0416 12.1523L14.0901 12.0943C14.1679 12.0003 14.2453 11.9057 14.3224 11.8103L14.4155 11.6951L14.4447 11.6577C14.482 11.6092 14.5188 11.562 14.5553 11.516C14.5863 11.4774 14.6168 11.4379 14.6466 11.3975C14.8451 11.1367 15.0377 10.8711 15.2242 10.6009L18.346 13.8389ZM18.346 13.8389C18.346 13.8368 18.3472 13.835 18.3497 13.8338V13.8441L18.346 13.8402H18.3472L18.346 13.8389Z" /></svg>;
    case "Bytedance":
      return <svg className="text-purple-400" width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M3.1544 12.1539L0.533203 12.8092V1.19824L3.1544 1.85354V12.1539Z" /><path d="M15.8225 12.8333L13.1963 13.4886V0.518555L15.8225 1.169V12.8333Z" /><path d="M7.31261 12.5083L4.69141 13.1636V6.32422L7.31261 6.97947V12.5083Z" /><path d="M9.02539 5.3096L11.6516 4.6543V11.4937L9.02539 10.8384V5.3096Z" /></svg>;
    case "Alibaba":
      return <svg className="text-purple-400" width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M9.39589 9.99064C10.2791 8.81304 11.9431 7.16184 11.9943 5.99704C12.0967 4.48664 10.5735 3.98744 8.99909 4.00024C7.89829 4.01304 6.77189 4.33304 6.00389 4.60184C3.32869 5.54904 1.66469 7.04664 0.60229 8.72344C-0.51131 10.3746 -0.14011 11.949 2.21509 12.0002C4.01989 11.9234 5.19749 11.4242 6.42629 10.797C6.43909 10.797 3.03429 11.7698 1.79269 11.053C1.66469 10.9762 1.52389 10.8738 1.48549 10.5922C1.47269 10.0034 2.45829 9.38904 3.00869 9.19704V8.17304C3.41829 8.32664 3.85349 8.41624 4.31429 8.41624C5.19749 8.41624 6.00389 8.09624 6.63109 7.57144C6.65669 7.66104 6.66949 7.76344 6.65669 7.86584H6.89989C6.92549 7.59704 6.78469 7.39224 6.78469 7.39224C6.56709 7.03384 6.17029 7.04664 6.17029 7.04664C6.17029 7.04664 6.37509 7.13624 6.52869 7.35384C5.95269 7.84024 5.21029 8.12184 4.40389 8.12184C4.05829 8.12184 3.72549 8.07064 3.41829 7.96824L4.22469 7.16184L4.00709 6.57304C5.63269 6.00984 6.98949 5.57464 9.21669 5.17784L8.70469 4.80664L8.96069 4.65304C10.3047 5.02424 11.1879 5.29304 11.1367 6.00984C11.1111 6.12504 11.0727 6.26584 11.0087 6.41944C10.6247 7.18744 9.45989 8.48024 8.98629 9.01784C8.67909 9.37624 8.37189 9.72184 8.15429 10.0546C7.93669 10.3874 7.79589 10.7074 7.78309 11.0018C7.80869 13.3442 14.6695 9.91384 16.0007 9.00504C14.0423 9.84984 11.9303 10.6562 9.60069 10.8098C8.94789 10.8482 9.02469 10.5026 9.39589 9.99064Z"/></svg>;
    default:
      return null;
  }
}
