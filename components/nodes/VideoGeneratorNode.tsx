"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAnimatedPopup } from "@/lib/useAnimatedPopup";
import { createPortal } from "react-dom";
import { Handle, Position, NodeProps, Node, useUpdateNodeInternals } from "@xyflow/react";
import CornerResizer from "./CornerResizer";
import NodeActionBar from "./NodeActionBar";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { resolveInputs } from "@/lib/executor";
import { createClient } from "@/lib/supabase/client";
import { VIDEO_MODELS as VIDEO_MODEL_CFG } from "@/lib/modelConfig";

type VideoGeneratorNodeType = Node<NodeData, "videoGeneratorNode">;

// ── Handles ───────────────────────────────────────────────────────────────────

type HandleDef = { id: string; label: string; className: string };

const BASE_HANDLES: HandleDef[] = [
  { id: "prompt",         label: "Text prompt",                className: "node-handle-icon node-handle-icon-prompt" },
  { id: "startFrame",     label: "Start frame",                className: "node-handle-icon node-handle-icon-image" },
  { id: "endFrame",       label: "End frame",                  className: "node-handle-icon node-handle-icon-image" },
  { id: "resource",       label: "Reference images (up to 3)", className: "node-handle-icon node-handle-icon-resource" },
  { id: "videoRef",       label: "Reference video",            className: "node-handle-icon node-handle-icon-videoref" },
  { id: "referenceVideo", label: "Reference videos (up to 3)", className: "node-handle-icon node-handle-icon-refvideo" },
  { id: "audioRef",       label: "Reference audios (up to 3)", className: "node-handle-icon node-handle-icon-audioref" },
];

// Fixed order for bottom-anchored stacking (top-most first, bottom-most last)
const HANDLE_ORDER = ["prompt", "startFrame", "endFrame", "resource", "videoRef", "referenceVideo", "audioRef"];

// Which handle IDs are connectable for each dragged output type
const CONNECTABLE_FOR_TYPE: Record<string, Set<string>> = {
  prompt:  new Set(["prompt"]),
  image:   new Set(["startFrame", "endFrame", "resource"]),
  video:   new Set(["videoRef", "referenceVideo"]),
  audio:   new Set(["audioRef"]),
};
const HANDLE_BOTTOM_BASE = 52; // px above node bottom edge
const HANDLE_SPACING     = 38; // px between handles

const HANDLE_COLORS: Record<string, string> = {
  prompt:         "#77E544",
  startFrame:     "#818cf8",
  endFrame:       "#818cf8",
  resource:       "#fb923c",
  videoRef:       "#22d3ee",
  referenceVideo: "#38bdf8",
  audioRef:       "#a78bfa",
};

const SOURCE_HANDLE_COLORS: Record<string, string> = {
  image: "#818cf8",
  video: "#22d3ee",
  audio: "#a78bfa",
};

const SOURCE_HANDLES = [
  { id: "startFrameOut", type: "image", label: "Start frame",      icon: <SrcFrameStartIcon /> },
  { id: "endFrameOut",   type: "image", label: "End frame",        icon: <SrcFrameEndIcon /> },
  { id: "imagePickOut",  type: "image", label: "Image pick",       icon: <SrcImagePickIcon /> },
  { id: "videoRefOut",   type: "video", label: "Reference video",  icon: <SrcVideoIcon /> },
  { id: "audioRefOut",   type: "audio", label: "Reference audio",  icon: <SrcAudioIcon /> },
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

  const orderedUrls: string[] = [];
  const usedIdxs = new Set<number>();

  for (const span of spans) {
    if (span.labelIdx !== null && !usedIdxs.has(span.labelIdx) && imageUrls[span.labelIdx]) {
      orderedUrls.push(imageUrls[span.labelIdx]);
      usedIdxs.add(span.labelIdx);
    } else {
      const next = imageUrls.findIndex((_, j) => !usedIdxs.has(j));
      if (next !== -1) { orderedUrls.push(imageUrls[next]); usedIdxs.add(next); }
      else if (imageUrls.length > 0) orderedUrls.push(imageUrls[0]);
    }
  }

  let resolvedPrompt = "";
  let lastEnd = 0;
  for (let i = 0; i < spans.length; i++) {
    resolvedPrompt += prompt.slice(lastEnd, spans[i].start);
    resolvedPrompt += tagFormat === "grok" ? `@image${i + 1} ` : `<<<image ${i + 1}>>>`;
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
  const killEdgesForHandles  = useWorkflowStore((s) => s.killEdgesForHandles);
  const remapTargetHandle    = useWorkflowStore((s) => s.remapTargetHandle);
  const flashEdgeError = useWorkflowStore((s) => s.flashEdgeError);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
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
  const [muted, setMuted]       = useState(true);
  const [hovering, setHovering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [isSaving, setIsSaving]               = useState(false);
  const [lightboxOpen, setLightboxOpen]       = useState(false);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const videoRef        = useRef<HTMLVideoElement>(null);
  const videoRefs       = useRef<Map<number, HTMLVideoElement>>(new Map());
  const durLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!durOpen) return;
    const handler = (e: MouseEvent) => {
      if (durRef.current && !durRef.current.contains(e.target as Node)) setDurOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [durOpen]);

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
  const status = (data.status as string) ?? "idle";
  const prompt = (data.prompt as string) ?? "";
  const busy = loading || status === "running";
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
  type GenMeta  = { videoModel: string; aspectRatio: string; duration: number; klingMode: string; grokResolution: string; sound: boolean };

  const generations: GenEntry[] = Array.isArray(data.generations)
    ? (data.generations as GenEntry[])
    : (videoUrl ? [videoUrl] : []);
  const generationsMeta: (GenMeta | null)[] = Array.isArray(data.generationsMeta)
    ? (data.generationsMeta as (GenMeta | null)[])
    : [];
  const currentGenIdx  = Math.min((data.currentGenIdx as number | undefined) ?? Math.max(0, generations.length - 1), Math.max(0, generations.length - 1));
  const generationsRef = useRef(generations);
  generationsRef.current = generations;

  const goToGen = useCallback((idx: number) => {
    const gens    = generationsRef.current;
    const clamped = Math.max(0, Math.min(gens.length - 1, idx));
    const entry   = gens[clamped];
    // Restore the settings used for this generation slot
    const meta    = (useWorkflowStore.getState().nodes.find((n) => n.id === id)?.data?.generationsMeta as (GenMeta | null)[] | undefined)?.[clamped];
    const metaUpdate = meta ? {
      videoModel:      meta.videoModel,
      aspectRatio:     meta.aspectRatio,
      duration:        meta.duration,
      klingMode:       meta.klingMode,
      grokResolution:  meta.grokResolution,
      sound:           meta.sound,
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
      if (i === currentGenIdx) v.play().catch(() => {});
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
        const res  = await fetch(`/api/job-status?taskId=${taskId}`);
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
      label = `Reference images (up to ${cfg.maxResources})`;
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

  const textEdge = edges.find((e) => e.target === id && e.targetHandle === "prompt");
  const textNode = textEdge ? nodes.find((n) => n.id === textEdge.source) : undefined;
  const hasResource = edges.some((e) => e.target === id && e.targetHandle === "resource");

  // ── Generate ──────────────────────────────────────────────────────────────
  const generate = useCallback(async () => {
    const { data: authData } = await createClient().auth.getSession();
    if (!authData.session) { setAuthModalOpen(true); return; }

    const upstream = resolveInputs(id, nodes as Node<NodeData>[], edges);
    const maxRes       = cfg.maxResources       ?? 3;
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

      // startFrame: not connected → flash handle; connected but empty → flash edge + source node
      if (!imageEdge) {
        flashSet.add("startFrame");
        hasError = true;
      } else if (!upstream.startFrameUrl) {
        const srcNode = nodes.find((n) => n.id === imageEdge.source);
        if (srcNode) updateNodeData(srcNode.id, { hasError: true });
        flashEdgeError(imageEdge.id);
        hasError = true;
      }

      // videoRef: not connected → flash handle; connected but empty → flash edge + source node
      if (!videoEdge) {
        flashSet.add("videoRef");
        hasError = true;
      } else if (!upstream.videoRefUrl) {
        const srcNode = nodes.find((n) => n.id === videoEdge.source);
        if (srcNode) updateNodeData(srcNode.id, { hasError: true });
        flashEdgeError(videoEdge.id);
        hasError = true;
      }

      if (flashSet.size > 0) {
        setErrorHandles(flashSet);
        setTimeout(() => setErrorHandles(new Set()), 1400);
      }
      if (hasError) return;
    }

    // Trim videoRef if the source node has trim points applied
    let finalVideoRefUrl = upstream.videoRefUrl;
    if (finalVideoRefUrl) {
      const videoRefEdge = edges.find((e) => e.target === id && e.targetHandle === "videoRef");
      if (videoRefEdge) {
        const videoSrcNode = nodes.find((n) => n.id === videoRefEdge.source);
        const tStart = videoSrcNode?.data.trimStart as number | undefined;
        const tEnd   = videoSrcNode?.data.trimEnd   as number | undefined;
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
    let finalEndFrameUrl   = upstream.endFrameUrl;
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
      mode,
      resolution,
      sound,
      startFrameUrl:      finalStartFrameUrl,
      endFrameUrl:        finalEndFrameUrl,
      videoRefUrl:        finalVideoRefUrl,
      resources:          orderedResources,
      referenceImageUrls: orderedResources.length > 0
        ? orderedResources.map((r) => r.url)
        : undefined,
      referenceVideoUrls: upstream.referenceVideoUrls.slice(0, maxRefVideos),
      referenceAudioUrls: upstream.referenceAudioUrls.slice(0, maxRefAudios),
    };

    if (debugMode) {
      setLoading(true);
      try {
        const res  = await fetch("/api/generate-video", {
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

    setLoading(true);
    const storeNode0   = useWorkflowStore.getState().nodes.find((n) => n.id === id);
    const prevGens2    = [...((storeNode0?.data?.generations    as GenEntry[]           | undefined) ?? [])] as GenEntry[];
    const prevMeta2    = [...((storeNode0?.data?.generationsMeta as (GenMeta | null)[]  | undefined) ?? [])];
    const loadingGens2 = [...prevGens2, null] as GenEntry[];
    const thisMeta: GenMeta = { videoModel: videoModelId, aspectRatio, duration, klingMode: mode, grokResolution: resolution, sound };
    const loadingMeta2 = [...prevMeta2, thisMeta];
    updateNodeData(id, { status: "running", videoUrl: undefined, imageNaturalRatio: undefined, errorMsg: undefined, taskId: undefined, generations: loadingGens2, generationsMeta: loadingMeta2, currentGenIdx: loadingGens2.length - 1 });

    try {
      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
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
  }, [id, nodes, edges, prompt, sound, duration, aspectRatio, videoModelId,
    mode, resolution, cfg, debugMode, textEdge, updateNodeData, setAuthModalOpen, flashEdgeError]);

  const hoveredDef = hoveredHand && activeHandles.has(hoveredHand)
    ? handles.find((h) => h.id === hoveredHand)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={cardRef}
      className={`video-node-card node-card w-full flex flex-col${(data.hasError as boolean) ? " node-error-blink" : ""}`}
      style={{ minWidth: 320, minHeight: 280, ...(busy ? { animation: "video-node-pulse-glow 2.4s ease-in-out infinite" } : {}) }}
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
          className={`node-handle-icon node-handle-icon-out-${h.type}${edges.some((e) => e.source === id && e.sourceHandle === h.id) ? " node-handle-connected" : ""}`}
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
            {h.id === "prompt"                          && <PromptIcon />}
            {h.id === "startFrame" && !isMotionStartFrame && <FrameStartIcon />}
            {isMotionStartFrame                         && <CharacterIcon />}
            {h.id === "endFrame"                        && <FrameEndIcon />}
            {h.id === "resource"                        && <ResourceIcon />}
            {h.id === "videoRef"                        && <VideoRefIcon />}
            {h.id === "referenceVideo"                  && <RefVideoIcon />}
            {h.id === "audioRef"                        && <AudioRefIcon />}
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

      {/* ── Main content ─────────────────────────────────────────────── */}
      {generations.length > 0 ? (
        <div
          className="relative bg-[#090B0D] rounded-t-[7px] overflow-hidden group/player group/gen"
          style={{ aspectRatio: (data.imageNaturalRatio as string | undefined) ?? aspectRatio.replace(":", " / "), width: "100%", transition: "aspect-ratio 0.35s cubic-bezier(0.4, 0, 0.2, 1)" }}
        >
          {/* Sliding strip — same approach as image carousel */}
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
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-5 h-5 rounded-full border-2 border-[#2a2a2a] border-t-[#666] animate-spin" />
                  </div>
                ) : typeof entry === "object" ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" fill="#1a0a0a" stroke="#5a1a1a" strokeWidth="1.5"/>
                      <path d="M12 7v5" stroke="#c04040" strokeWidth="2" strokeLinecap="round"/>
                      <circle cx="12" cy="16" r="1" fill="#c04040"/>
                    </svg>
                    <p className="text-[10px] text-[#555] leading-snug break-words">{entry.error}</p>
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); deleteGen(i); }}
                      className="absolute bottom-2 right-2 flex items-center gap-1.5 h-7 px-3 rounded-full z-20 transition-colors hover:bg-white/10"
                      style={{ background: "rgba(0,0,0,0.58)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                      <span className="text-[11px] text-[#ccc] font-medium">Delete</span>
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

          {/* Generating badge + cancel — visible while busy */}
          {busy && (
            <>
              <div
                className="absolute top-2 left-2 flex items-center gap-1.5 h-7 px-3 rounded-full z-20 pointer-events-none select-none"
                style={{ background: "rgba(0,0,0,0.58)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}>
                  <circle cx="5" cy="5" r="4" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
                  <path d="M5 1 A4 4 0 0 1 9 5" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="text-[11px] text-[#ccc] font-medium">Generating</span>
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

          {/* Overlay controls — only visible when current slot is a done video */}
          {typeof generations[currentGenIdx] === "string" && <>
          {/* Timer badge — top-left, visible on hover */}
          <div className="absolute top-2 left-2 h-7 px-2 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/player:opacity-100 transition-opacity z-10 pointer-events-none node-slide-reveal">
            <span className="text-[11px] text-white font-mono tabular-nums">{fmtTime(currentSec)}</span>
          </div>

          {/* Mute / unmute button — top-right, visible on hover */}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/player:opacity-100 transition-opacity pointer-events-auto z-10 node-slide-reveal"
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>

          {/* Progress bar — bottom, visible on hover */}
          <div
            className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10 opacity-0 group-hover/player:opacity-100 transition-opacity"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              const v = videoRef.current;
              if (v && v.duration) v.currentTime = pct * v.duration;
            }}
            style={{ cursor: "pointer" }}
          >
            <div
              className="h-full bg-white/70 transition-none"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          </>}

        </div>
      ) : (
        <div className="relative bg-[#090B0D] rounded-t-[7px] overflow-hidden" style={{ aspectRatio: aspectRatio.replace(":", " / "), width: "100%", transition: "aspect-ratio 0.35s cubic-bezier(0.4, 0, 0.2, 1)" }}>
          {status === "error" && (
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
              <p className="text-[#555] text-[10px] leading-[1.5] break-words">
                {(data.errorMsg as string) ?? "Generation failed"}
              </p>
            </div>
          )}
          {textNode && !status.includes("error") && (
            <div className="absolute bottom-3 left-4 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#77E544] shrink-0" />
              <span className="text-[11px] text-[#555]">{textNode.data.label as string}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Carousel nav — always visible when multiple generations exist ── */}
      {generations.length > 1 && (
        <div
          className="flex items-center justify-between px-2 border-t border-[#1E1410] shrink-0"
          style={{ height: 30 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => { e.stopPropagation(); goToGen(currentGenIdx - 1); }}
            disabled={currentGenIdx === 0}
            className="w-6 h-6 flex items-center justify-center rounded transition-opacity disabled:opacity-20"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex items-center gap-1.5">
            {generations.length <= 8 ? generations.map((_, i) => (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); goToGen(i); }}
                className={`rounded-full transition-all ${i === currentGenIdx ? "w-3 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/40 hover:bg-white/70"}`}
              />
            )) : (
              <span className="text-[10px] text-white/50 font-mono tabular-nums">
                {currentGenIdx + 1} / {generations.length}
              </span>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); goToGen(currentGenIdx + 1); }}
            disabled={currentGenIdx === generations.length - 1}
            className="w-6 h-6 flex items-center justify-center rounded transition-opacity disabled:opacity-20"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      )}

      {(() => {
        // When a model has no ratio/duration options (e.g. motion control), collapse
        // both rows into one and show mode+resolution inline with the model selector.
        // Reusable mode picker — composite pill with optional i tooltip inside
        const modePicker = cfg.modes ? (
          <div className="relative shrink-0">
            <div className="flex items-center rounded-full" style={{ background: "#111317" }}>
              {/* Dropdown trigger */}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => { setModeOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setDurOpen(false); setGrokResOpen(false); }}
                className="flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 hover:brightness-125 transition-all whitespace-nowrap"
              >
                <span className="text-[11px] text-[#AAAAAA]">
                  {cfg.modes.find((m) => m.value === mode)?.label ?? mode}
                </span>
                <ChevronIcon open={modeOpen} />
              </button>

              {/* i info icon — only for motion-control character_orientation */}
              {cfg.apiInput.useMotionControl && (
                <>
                  <span className="w-px h-3 bg-[#252525] shrink-0" />
                  <div className="relative group/orient-info flex items-center px-2 py-1.5">
                    <div className="w-3.5 h-3.5 rounded-full border border-[#383838] flex items-center justify-center text-[#555] hover:text-[#AAA] hover:border-[#555] transition-colors cursor-default select-none">
                      <span className="text-[8px] font-semibold leading-none">i</span>
                    </div>
                    <div
                      className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 px-3 py-2 rounded-lg text-[10px] leading-[1.6] text-[#AAAAAA] opacity-0 group-hover/orient-info:opacity-100 transition-opacity z-50 node-slide-reveal"
                      style={{ background: "#111317", border: "1px solid #2A2A2A" }}
                    >
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

        // Reusable resolution picker
        const resPicker = cfg.resolutions ? (
          <div className="relative shrink-0">
            <Pill onClick={() => { setGrokResOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setDurOpen(false); setModeOpen(false); }}>
              <span className="text-[11px] text-[#AAAAAA]">{resolution}</span>
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

        // Status dot + generate button (always shown)
        const actionControls = (
          <>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ml-auto ${STATUS_DOT[status]}`} />
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={generate}
              disabled={busy || promptOverLimit}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white hover:bg-[#E8E8E8] transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              <svg width="9" height="10" viewBox="0 0 9 10" fill="#0A0C0E">
                <path d="M8.5 4.634a.5.5 0 0 1 0 .732l-7.5 4.5A.5.5 0 0 1 .25 9.5v-9A.5.5 0 0 1 1 .17l7.5 4.464Z" />
              </svg>
            </button>
          </>
        );

        return (
          <div className="flex items-center flex-wrap gap-1.5 px-3 py-2 border-t border-[#111]">
            {/* Model selector */}
            <div className="relative">
              <Pill
                onClick={() => { setModelOpen((o) => !o); setRatioOpen(false); setDurOpen(false); setModeOpen(false); setGrokResOpen(false); }}
              >
                <span className="text-[11px] text-[#AAAAAA]">{cfg.name}</span>
                <ChevronIcon open={modelOpen} />
              </Pill>
              <FloatMenu open={modelOpen}>
                {VIDEO_MODEL_CFG.map((m) => (
                  <button
                    key={m.id}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      const validRatio = m.ratios.includes(aspectRatio) ? aspectRatio : m.defaultRatio;
                      const validDur = m.durations.includes(duration) ? duration : m.defaultDuration;
                      updateNodeData(id, { videoModel: m.id, aspectRatio: validRatio, duration: validDur });
                      const removedHandles = (cfg.handles as string[]).filter((h) => !(m.handles as string[]).includes(h));
                      const wasMotionControl = cfg.id === "kling-2.6-motion-control";
                      const isMotionControl  = m.id   === "kling-2.6-motion-control";
                      if (wasMotionControl !== isMotionControl && !removedHandles.includes("startFrame")) {
                        removedHandles.push("startFrame");
                      }
                      // Migrate videoRef ↔ referenceVideo edges instead of killing them
                      const oldHasVideoRef  = (cfg.handles as string[]).includes("videoRef");
                      const newHasVideoRef  = (m.handles   as string[]).includes("videoRef");
                      const oldHasRefVideo  = (cfg.handles as string[]).includes("referenceVideo");
                      const newHasRefVideo  = (m.handles   as string[]).includes("referenceVideo");
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
                    className={`w-full flex items-center justify-between px-3 py-2 text-[11px] hover:bg-[#161A1E] transition-colors ${videoModelId === m.id ? "text-white font-medium" : "text-[#8D8E89]"}`}
                  >
                    <span>{m.name}</span>
                    <span className="text-[#4A4A45]">{m.provider}</span>
                  </button>
                ))}
              </FloatMenu>
            </div>

            {/* Ratio */}
            {ratios.length > 0 && (
              <div className="relative">
                <Pill onClick={() => { setRatioOpen((o) => !o); setModelOpen(false); setDurOpen(false); setModeOpen(false); setGrokResOpen(false); }}>
                  <AspectIcon ratio={aspectRatio} />
                  <span className="text-[11px] text-[#AAAAAA]">{aspectRatio}</span>
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

            {/* Duration */}
            {durations.length > 0 && (
              <div ref={durRef} className="relative">
                <Pill onClick={() => { setDurOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setModeOpen(false); setGrokResOpen(false); }}>
                  <span className="text-[11px] text-[#AAAAAA] tabular-nums">{duration}s</span>
                  <ChevronIcon open={durOpen} />
                </Pill>
                <FloatMenu open={durOpen} fullWidth>
                  <div
                    className="p-3"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <p className="text-[12px] text-white font-medium mb-2.5">Choose duration</p>
                    <div
                      className="nodrag flex items-center gap-2.5 pl-3 pr-4 py-2 rounded-lg"
                      style={{ background: "#161A1E" }}
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <span className="text-[11px] text-[#AAAAAA] tabular-nums shrink-0 w-6">{duration}s</span>
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

            {modePicker}
            {resPicker}

            {/* Sound toggle */}
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

            {/* Reference image indicator */}
            {activeHandles.has("resource") && hasResource && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: "#111317" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#fb923c] shrink-0" />
                <span className="text-[10px] text-[#AAAAAA]">Img ref</span>
              </div>
            )}

            {actionControls}
          </div>
        );
      })()}

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

function SpinnerOverlay({ color = "#77E544" }: { color?: string }) {
  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex",
      alignItems: "center", justifyContent: "center",
      pointerEvents: "none", zIndex: 20,
    }}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ animation: "spin 0.9s linear infinite" }}>
        <circle cx="14" cy="14" r="11" stroke="#333" strokeWidth="2.5" />
        <path d="M14 3 A11 11 0 0 1 25 14" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

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
      style={{ background: "#111317" }}
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
    <svg width="15" height="13" viewBox="0 0 18 15" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="16" height="13" rx="2" />
      <circle cx="5.5" cy="5" r="1.5" fill="white" stroke="none" />
      <path d="m1 11 4.5-4.5 3 3 2.5-2.5 6 4" />
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
