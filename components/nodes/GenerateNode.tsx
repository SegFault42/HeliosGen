"use client";
import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import { useAnimatedPopup } from "@/lib/useAnimatedPopup";
import { createPortal } from "react-dom";
import GenerateButton from "@/components/nodes/GenerateButton";
import Image from "next/image";
import { Handle, Position, NodeProps, Node, useUpdateNodeInternals } from "@xyflow/react";
import CornerResizer from "./CornerResizer";
import NodeActionBar from "./NodeActionBar";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { resolveInputs } from "@/lib/executor";
import { useReadOnly } from "@/lib/readOnlyContext";

type GenerateNodeType = Node<NodeData, "generateNode">;

import { ShieldBan } from "lucide-react";
import { IMAGE_MODELS } from "@/lib/modelConfig";
import { useGeneratingBorderAnimation } from "@/lib/useGeneratingBorderAnimation";
import MissingInputWarning from "./MissingInputWarning";

// Derived from config — no hardcoding needed
const MODELS = IMAGE_MODELS.map((m) => ({ id: m.id, name: m.name, meta: m.provider }));
const MODEL_CAPS = Object.fromEntries(
  IMAGE_MODELS.map((m) => [m.id, {
    supportsImages: m.supportsImages,
    supportsQuality: m.supportsQuality,
    ratios: m.ratios,
    maxImages: m.maxImages,
    qualityOptions: m.apiInput.qualityOptions,
    qualityKey: m.apiInput.qualityKey,
    azureQualityOptions: m.azureQualityOptions,
    azureResolutionOptions: m.azureResolutionOptions,
  }])
);
const DEFAULT_CAPS = MODEL_CAPS["nano-banana-2"];

// ── Aspect ratios ─────────────────────────────────────────────────────────────

// (each model defines its own subset — see MODEL_CAPS above)

function ratioRect(value: string) {
  // "auto" doesn't have a fixed ratio — render as a square preview
  if (value === "auto") return { rw: 14, rh: 14, x: 3, y: 0 };
  const [w, h] = value.split(":").map(Number);
  const maxW = 20, maxH = 14;
  const scale = Math.min(maxW / w, maxH / h);
  const rw = Math.round(w * scale);
  const rh = Math.round(h * scale);
  return { rw, rh, x: Math.round((maxW - rw) / 2), y: Math.round((maxH - rh) / 2) };
}

// ── Status dot ────────────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  idle: "bg-[#1E2840]",
  pending: "bg-gray-500",
  running: "bg-amber-400 animate-pulse",
  done: "bg-[#2DD4BF]",
  error: "bg-red-500",
};

/**
 * Replace @mentions with <<<image N>>> placeholders AND reorder imageUrls so
 * that imageUrls[N-1] always corresponds to <<<image N>>> in the prompt.
 *
 * Numbers are assigned by left-to-right appearance in the prompt, not by the
 * order images were connected. This ensures "<<<image 1>>>" always refers to
 * the first @tag the user typed, regardless of edge creation order.
 *
 * Algorithm:
 *  1. Find every @mention position using known labels (longest-first) then
 *     the "@Word #N" / "@word" fallback pattern.
 *  2. Sort all matches by position → assign <<<image 1>>>, <<<image 2>>>, …
 *  3. Build orderedUrls so orderedUrls[i] is the URL for <<<image i+1>>>.
 */
function resolveMentions(
  prompt: string,
  labels: string[],
  imageUrls: string[],
): { resolvedPrompt: string; orderedUrls: string[] } {
  if (!labels.length) return { resolvedPrompt: prompt, orderedUrls: imageUrls };

  type Span = { start: number; end: number; labelIdx: number | null };
  const spans: Span[] = [];
  const claimed = new Set<number>();

  // Pass 1 — find known-label matches (longest label first, case-insensitive)
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

  // Pass 2 — fallback: any remaining @Word #N or @word
  const fallback = /@\S+(?:\s+#\d+)?/g;
  let fm: RegExpExecArray | null;
  while ((fm = fallback.exec(prompt)) !== null) {
    if (!claimed.has(fm.index)) {
      spans.push({ start: fm.index, end: fm.index + fm[0].length, labelIdx: null });
      claimed.add(fm.index);
    }
  }

  // Sort spans by position in the prompt (left → right)
  spans.sort((a, b) => a.start - b.start);

  // No @mentions in prompt — pass all images through as-is
  if (spans.length === 0) return { resolvedPrompt: prompt, orderedUrls: imageUrls };

  // Assign orderedUrls in prompt appearance order; track per-span URL (null = unresolvable)
  const spanUrls: (string | null)[] = [];
  const usedIdxs = new Set<number>();

  for (const span of spans) {
    let url: string | null = null;
    if (span.labelIdx !== null && !usedIdxs.has(span.labelIdx) && imageUrls[span.labelIdx]) {
      url = imageUrls[span.labelIdx];
      usedIdxs.add(span.labelIdx);
    } else {
      const next = imageUrls.findIndex((_, j) => !usedIdxs.has(j));
      if (next !== -1) {
        url = imageUrls[next];
        usedIdxs.add(next);
      }
      // No fallback to imageUrls[0] — unresolvable @mentions stay as plain text
    }
    spanUrls.push(url);
  }

  const orderedUrls = spanUrls.filter((u): u is string => u !== null);

  // Build resolved prompt: spans with a URL become <<<image N>>>, others keep original text
  let resolvedPrompt = "";
  let lastEnd = 0;
  let imageNum = 1;
  for (let i = 0; i < spans.length; i++) {
    resolvedPrompt += prompt.slice(lastEnd, spans[i].start);
    if (spanUrls[i] !== null) {
      resolvedPrompt += `<<<image ${imageNum++}>>>`;
    } else {
      resolvedPrompt += prompt.slice(spans[i].start, spans[i].end);
    }
    lastEnd = spans[i].end;
  }
  resolvedPrompt += prompt.slice(lastEnd);

  return { resolvedPrompt, orderedUrls };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function GenerateNode({ id, data, selected }: NodeProps<GenerateNodeType>) {
  const readOnly = useReadOnly();
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const updateNodeSize = useWorkflowStore((s) => s.updateNodeSize);
  const removeEdgesForHandle = useWorkflowStore((s) => s.removeEdgesForHandle);
  const setAuthModalOpen = useWorkflowStore((s) => s.setAuthModalOpen);
  const flashEdgeError = useWorkflowStore((s) => s.flashEdgeError);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const addNode = useWorkflowStore((s) => s.addNode);
  const insertEdge = useWorkflowStore((s) => s.insertEdge);
  const addToast   = useWorkflowStore((s) => s.addToast);
  const kieKeySet  = useWorkflowStore((s) => s.kieKeySet);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const debugMode = useWorkflowStore((s) => s.debugMode);
  const parentGroupSelected = useWorkflowStore((s) => {
    const self = s.nodes.find((n) => n.id === id);
    if (!self?.parentId) return false;
    return s.nodes.find((n) => n.id === self.parentId)?.selected ?? false;
  });
  const multiSelected = useWorkflowStore((s) => s.nodes.filter((n) => n.selected).length > 1);

  const updateNodeInternals = useUpdateNodeInternals();
  const cardRef = useRef<HTMLDivElement>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Instant hide on deselect
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

  const [hovering, setHovering] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [azureQualityOpen, setAzureQualityOpen] = useState(false);
  const [azureResolutionOpen, setAzureResolutionOpen] = useState(false);
  const modelPopup = useAnimatedPopup(modelOpen && !data.imageUrl);
  const ratioPopup = useAnimatedPopup(ratioOpen);
  const qualityPopup = useAnimatedPopup(qualityOpen);
  const azureQualityPopup = useAnimatedPopup(azureQualityOpen);
  const azureResolutionPopup = useAnimatedPopup(azureResolutionOpen);
  const [loading, setLoading] = useState(false);
  const [errorHandles, setErrorHandles] = useState<Set<string>>(new Set());
  const [hoveredHandle, setHoveredHandle] = useState<"prompt" | "image" | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxImgLoaded, setLightboxImgLoaded] = useState(false);
  const [blurSrc, setBlurSrc] = useState<string | null>(null);
  const nodeImgRef = useRef<HTMLImageElement>(null);
  const controlBarRef = useRef<HTMLDivElement>(null);

  // ── Elevate the RF node z-index while any dropdown is open ──────────────────
  useEffect(() => {
    const rfNode = cardRef.current?.closest<HTMLElement>(".react-flow__node");
    if (!rfNode) return;
    const anyOpen = modelOpen || ratioOpen || qualityOpen || azureQualityOpen || azureResolutionOpen;
    if (anyOpen) {
      rfNode.style.zIndex = "10000";
    } else {
      rfNode.style.zIndex = "";
    }
    return () => { rfNode.style.zIndex = ""; };
  }, [modelOpen, ratioOpen, qualityOpen, azureQualityOpen]);

  useEffect(() => {
    const anyOpen = modelOpen || ratioOpen || qualityOpen || azureQualityOpen || azureResolutionOpen;
    if (!anyOpen) return;
    const handler = (e: MouseEvent) => {
      if (controlBarRef.current && !controlBarRef.current.contains(e.target as unknown as globalThis.Node)) {
        setModelOpen(false); setRatioOpen(false); setQualityOpen(false); setAzureQualityOpen(false); setAzureResolutionOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelOpen, ratioOpen, qualityOpen, azureQualityOpen]);

  const openLightbox = useCallback(() => {
    setLightboxImgLoaded(false);
    const imgEl = nodeImgRef.current;
    if (imgEl && imgEl.naturalWidth > 0) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        canvas.getContext("2d")?.drawImage(imgEl, 0, 0);
        setBlurSrc(canvas.toDataURL());
      } catch {
        setBlurSrc(imgEl.currentSrc ?? null);
      }
    } else {
      setBlurSrc(null);
    }
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
    const url = data.imageUrl as string | undefined;
    if (!url || isSaving) return;
    const filename = `image-${Date.now()}.png`;
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
  }, [data.imageUrl, isSaving]);

  const handleCancel = useCallback(() => {
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    setLoading(false);
    const storeNode = useWorkflowStore.getState().nodes.find((n) => n.id === id);
    const gens = ((storeNode?.data?.generations as GenEntry[] | undefined) ?? [])
      .filter((g): g is string | { error: string } => g !== null);
    const newIdx = Math.max(0, gens.length - 1);
    const lastEntry = gens[newIdx];
    updateNodeData(id, {
      status: gens.length > 0 ? "done" : "idle",
      taskId: undefined,
      generations: gens,
      currentGenIdx: newIdx,
      imageUrl: typeof lastEntry === "string" ? lastEntry : undefined,
      errorMsg: undefined,
    });
  }, [id, updateNodeData]);

  const handleDeleteSlot = useCallback((idx: number) => {
    const storeNode = useWorkflowStore.getState().nodes.find((n) => n.id === id);
    const gens = ((storeNode?.data?.generations as GenEntry[] | undefined) ?? []);
    const next = gens.filter((_, i) => i !== idx);
    const newIdx = Math.max(0, Math.min(idx, next.length - 1));
    const newEntry = next[newIdx];
    updateNodeData(id, {
      generations: next,
      currentGenIdx: next.length > 0 ? newIdx : 0,
      status: next.length > 0 ? "done" : "idle",
      imageUrl: typeof newEntry === "string" ? newEntry : undefined,
    });
  }, [id, updateNodeData]);

  const model = (data.model as string) ?? "nano-banana-2";
  const caps = MODEL_CAPS[model] ?? DEFAULT_CAPS;
  const modelInfo = MODELS.find((m) => m.id === model) ?? MODELS[0];
  const quality = (data.quality as string) ?? "1k";
  const status = data.status ?? "idle";

  const [isAzureProvider, setIsAzureProvider] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        const providers = JSON.parse(localStorage.getItem("aiui-model-providers") ?? "{}");
        setIsAzureProvider((providers[model] ?? "kie") === "azure");
      } catch { setIsAzureProvider(false); }
    };
    read();
    window.addEventListener("storage", read);
    window.addEventListener("aiui-providers-changed", read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener("aiui-providers-changed", read);
    };
  }, [model]);

  const promptInfo = (() => {
    const promptEdge = edges.find((e) => e.target === id && e.targetHandle === "prompt");
    if (!promptEdge) return null;
    const promptNode = nodes.find((n) => n.id === promptEdge.source);
    const text = (promptNode?.data?.prompt as string) ?? "";
    const cfg = IMAGE_MODELS.find((m) => m.id === model);
    const hasImages = edges.some((e) => e.target === id && e.targetHandle === "image");
    const limit = (!hasImages && cfg?.textOnlyPromptMaxLength)
      ? cfg.textOnlyPromptMaxLength
      : (cfg?.apiInput.promptMaxLength ?? Infinity);
    return { len: text.length, limit, over: text.length > limit };
  })();
  const promptOverLimit = promptInfo?.over ?? false;

  // If current ratio isn't valid for this model, fall back to first valid ratio (or 1:1)
  const rawRatio = (data.aspectRatio as string) ?? "9:16";
  const aspectRatio = caps.ratios.includes(rawRatio)
    ? rawRatio
    : (caps.ratios[0] ?? "1:1");

  // "auto" has no fixed pixel dimensions — treat as 1:1 for the CSS ratio
  const [rw, rh] = aspectRatio === "auto" ? [1, 1] : aspectRatio.split(":").map(Number);
  const cssRatio = `${rw} / ${rh}`;
  const isPending = status === "pending";
  const animBusy = loading || status === "running";
  const busy = animBusy || isPending;
  const isQueued = !busy && !!data.pipelineQueued;
  useGeneratingBorderAnimation(cardRef, animBusy);

  const [natW, natH] = (() => {
    const r = data.imageNaturalRatio as string | undefined;
    if (!r) return [0, 0];
    const parts = r.split("/").map((s) => parseInt(s.trim(), 10));
    return parts.length === 2 ? parts : [0, 0];
  })();

  // ── Generation history ────────────────────────────────────────────────────
  type GenEntry = string | null | { error: string };
  const rawGens = data.generations;
  const generations: GenEntry[] = Array.isArray(rawGens)
    ? (rawGens as GenEntry[])
    : (data.imageUrl ? [data.imageUrl as string] : []);
  const currentGenIdx = Math.min(
    (data.currentGenIdx as number | undefined) ?? Math.max(0, generations.length - 1),
    Math.max(0, generations.length - 1)
  );

  const slideDir = useRef<"left" | "right">("right");

  const goToGen = useCallback((idx: number) => {
    const storeNode = useWorkflowStore.getState().nodes.find(n => n.id === id);
    const gens: GenEntry[] = Array.isArray(storeNode?.data?.generations)
      ? storeNode!.data.generations as GenEntry[]
      : generations;
    const curr = (storeNode?.data?.currentGenIdx as number | undefined) ?? 0;
    const clamped = Math.max(0, Math.min(gens.length - 1, idx));
    slideDir.current = idx > curr ? "right" : "left";
    const entry = gens[clamped];
    if (entry === null) {
      updateNodeData(id, { currentGenIdx: clamped, imageUrl: undefined, status: "running", errorMsg: undefined });
    } else if (typeof entry === "object") {
      updateNodeData(id, { currentGenIdx: clamped, imageUrl: undefined, status: "error", errorMsg: entry.error });
    } else {
      updateNodeData(id, { currentGenIdx: clamped, imageUrl: entry, status: "done", errorMsg: undefined });
    }
  }, [id, updateNodeData, generations]);

  // Probe original URL for true pixel dimensions (Next.js Image serves a reduced copy)
  useEffect(() => {
    const url = data.imageUrl as string | undefined;
    if (!url) return;
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled) updateNodeData(id, { imageNaturalRatio: `${img.naturalWidth} / ${img.naturalHeight}` });
    };
    img.src = url;
    return () => { cancelled = true; };
  }, [data.imageUrl, id, updateNodeData]);

  // Re-sync edge anchor positions on every resize — including during CSS transitions
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

  const closeDropdowns = () => {
    setModelOpen(false);
    setRatioOpen(false);
    setQualityOpen(false);
    setAzureQualityOpen(false);
  };

  // ── Poll /api/job-status while a taskId is pending ──────────────────────────
  useEffect(() => {
    const taskId = data.taskId as string | undefined;
    if (!taskId || status !== "running") return;

    let cancelled = false;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/job-status?taskId=${taskId}`);
        const json = await res.json();
        if (cancelled) return;

        if (json.status === "done") {
          const storeNode = useWorkflowStore.getState().nodes.find(n => n.id === id);
          const gens = [...((storeNode?.data?.generations as GenEntry[] | undefined) ?? [])] as GenEntry[];
          const slot = storeNode?.data?.currentGenIdx as number ?? gens.length - 1;
          gens[slot] = json.imageUrl as string;
          updateNodeData(id, { status: "done", imageUrl: json.imageUrl, taskId: undefined, generations: gens, currentGenIdx: slot });
          clearInterval(interval);
        } else if (json.status === "error") {
          const storeNode = useWorkflowStore.getState().nodes.find(n => n.id === id);
          const gens = [...((storeNode?.data?.generations as GenEntry[] | undefined) ?? [])] as GenEntry[];
          const slot = storeNode?.data?.currentGenIdx as number ?? gens.length - 1;
          gens[slot] = { error: json.error ?? "Generation failed" };
          updateNodeData(id, { status: "error", errorMsg: json.error, taskId: undefined, generations: gens, currentGenIdx: slot });
          clearInterval(interval);
        } else if (json.status === "not_found") {
          const storeNode = useWorkflowStore.getState().nodes.find(n => n.id === id);
          const gens = [...((storeNode?.data?.generations as GenEntry[] | undefined) ?? [])] as GenEntry[];
          const slot = storeNode?.data?.currentGenIdx as number ?? gens.length - 1;
          gens[slot] = { error: "Job expired or unknown" };
          updateNodeData(id, { status: "error", errorMsg: "Job expired or unknown", taskId: undefined, generations: gens, currentGenIdx: slot });
          clearInterval(interval);
        }
        // "pending" → keep polling
      } catch {
        // network hiccup — keep polling
      }
    }, 3000);

    return () => { cancelled = true; clearInterval(interval); };
  }, [data.taskId, status, id, updateNodeData]);

  const promptConnected = edges.some((e) => e.target === id && e.targetHandle === "prompt");
  const imageConnected = edges.some((e) => e.target === id && e.targetHandle === "image");
  const sourceConnected = edges.some((e) => e.source === id);
  const hasFailedImageInput = edges.some(
    (e) => e.target === id && e.targetHandle === "image" &&
      (nodes.find((n) => n.id === e.source)?.data?.status as string | undefined) === "error"
  );

  // ── Submit generation job ────────────────────────────────────────────────────
  const connectedPromptNodeId = edges.find(
    (e) => e.target === id && e.targetHandle === "prompt"
  )?.source;

  const generate = useCallback(async () => {
    let accessToken: string;
    if (process.env.NEXT_PUBLIC_GUEST_MODE === "true") {
      accessToken = "guest";
    } else {
      const { data: authData } = await createClient().auth.getSession();
      if (!authData.session) { setAuthModalOpen(true); return; }
      accessToken = authData.session.access_token;
    }

    // Extract frames from VideoInputNodes on the image handle that lack a capturedFrameUrl.
    // Uses trimEnd if set (end frame), otherwise trimStart ?? 0 (start / first frame).
    const videoImageEdges = edges.filter(
      (e) => e.target === id && e.targetHandle === "image" &&
        nodes.find((n) => n.id === e.source)?.type === "videoInputNode"
    );
    for (const edge of videoImageEdges) {
      const src = nodes.find((n) => n.id === edge.source);
      if (!src || (src.data.capturedFrameUrl as string | undefined)) continue;
      const videoUrl = (src.data.videoUrl ?? src.data.r2Url) as string | undefined;
      if (!videoUrl || videoUrl.startsWith("blob:")) continue;
      const trimStart = src.data.trimStart as number | undefined;
      const trimEnd = src.data.trimEnd as number | undefined;
      const extractBody = trimEnd !== undefined
        ? { videoUrl, timeSeconds: trimEnd }
        : { videoUrl, timeSeconds: trimStart ?? 0 };
      try {
        const r = await fetch("/api/extract-frame", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(extractBody),
        });
        const j = await r.json();
        if (j.cdnUrl) updateNodeData(src.id, { capturedFrameUrl: j.cdnUrl });
      } catch { /* proceed without */ }
    }

    // Block if any wired image source has no output yet
    {
      const emptyImageEdges = edges.filter((e) => e.target === id && e.targetHandle === "image").filter((e) => {
        const src = useWorkflowStore.getState().nodes.find((n) => n.id === e.source);
        if (!src) return true;
        const url = (src.data.capturedFrameUrl ?? src.data.r2Url ?? src.data.inputImage ?? src.data.imageUrl) as string | undefined;
        return !url;
      });
      if (emptyImageEdges.length > 0) {
        setErrorHandles(new Set(["image"]));
        setTimeout(() => setErrorHandles(new Set()), 1400);
        updateNodeData(id, { hasError: true });
        addToast("Some connected image inputs have no content yet.", "error");
        for (const e of emptyImageEdges) {
          const src = useWorkflowStore.getState().nodes.find((n) => n.id === e.source);
          if (src) updateNodeData(src.id, { hasError: true });
          flashEdgeError(e.id);
        }
        return;
      }
    }

    // Use fresh store state so any newly extracted frames are included
    const upstream = resolveInputs(id, useWorkflowStore.getState().nodes as Node<NodeData>[], edges);
    const { resolvedPrompt, orderedUrls } = resolveMentions(
      upstream.prompt ?? "",
      upstream.imageNodeLabels,
      upstream.imageUrls,
    );

    // Read Azure settings from localStorage (client-side, safe in useCallback)
    const azureBaseUrl = (() => {
      try { return localStorage.getItem("aiui-azure-base-url") ?? ""; }
      catch { return ""; }
    })();
    const azureDeployment = (() => {
      try { return JSON.parse(localStorage.getItem("aiui-azure-endpoints") ?? "{}")[model] ?? ""; }
      catch { return ""; }
    })();
    const isAzure = !!(azureBaseUrl && azureDeployment && (() => {
      try { return (JSON.parse(localStorage.getItem("aiui-model-providers") ?? "{}")[model] ?? "kie") === "azure"; }
      catch { return false; }
    })());
    const azureQuality = (data.azureQuality as string | undefined) ?? "auto";
    const azureResolution = (data.azureResolution as string | undefined) ?? "1k";

    const payload = {
      model,
      prompt: resolvedPrompt,
      imageUrls: orderedUrls,
      aspectRatio,
      quality,
      ...(isAzure ? { azureBaseUrl, azureDeployment, azureQuality, azureResolution } : {}),
    };

    if (!resolvedPrompt.trim()) {
      updateNodeData(id, { hasError: true });
      setErrorHandles(new Set(["prompt"]));
      setTimeout(() => setErrorHandles(new Set()), 1400);
      addToast("A prompt is required to generate an image.", "error");
      if (connectedPromptNodeId) {
        updateNodeData(connectedPromptNodeId, { hasError: true });
        const promptEdge = edges.find((e) => e.target === id && e.targetHandle === "prompt");
        if (promptEdge) flashEdgeError(promptEdge.id);
      }
      return;
    }

    if (debugMode) {
      setLoading(true);
      try {
        await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, debugOnly: true }),
        });
        await new Promise((r) => setTimeout(r, 5000));
      } finally {
        setLoading(false);
      }
      return;
    }

    // Set PENDING state — gives user 3 seconds to cancel before the API call
    const prevGens = [...(((useWorkflowStore.getState().nodes.find(n => n.id === id)?.data?.generations) as GenEntry[] | undefined) ?? [])] as GenEntry[];
    const loadingGens = [...prevGens, null] as GenEntry[];
    updateNodeData(id, { status: "pending", imageUrl: undefined, imageNaturalRatio: undefined, errorMsg: undefined, taskId: undefined, generations: loadingGens, currentGenIdx: loadingGens.length - 1 });

    pendingTimerRef.current = setTimeout(async () => {
      pendingTimerRef.current = null;
      setLoading(true);
      updateNodeData(id, { status: "running" });
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);

        // Both Kie and Azure now return { taskId } — polling useEffect handles the rest
        updateNodeData(id, { taskId: json.taskId });
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        const storeNode = useWorkflowStore.getState().nodes.find(n => n.id === id);
        const gens = [...((storeNode?.data?.generations as GenEntry[] | undefined) ?? [])] as GenEntry[];
        const slot = storeNode?.data?.currentGenIdx as number ?? gens.length - 1;
        gens[slot] = { error: errMsg };
        updateNodeData(id, { status: "error", errorMsg: errMsg, generations: gens, currentGenIdx: slot });
      } finally {
        setLoading(false);
      }
    }, 3000);
  }, [id, nodes, edges, model, aspectRatio, quality, data.azureQuality, debugMode, connectedPromptNodeId, updateNodeData, flashEdgeError, kieKeySet, addToast]);

  // Pipeline runner trigger — called by Run Pipeline button
  const generateRef = useRef(generate);
  useEffect(() => { generateRef.current = generate; }, [generate]);
  useEffect(() => {
    if (!data.pendingGenerate) return;
    updateNodeData(id, { pendingGenerate: false });
    generateRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.pendingGenerate]);

  // node-card has position:relative — handles and label position relative to it
  return (
    <div
      ref={cardRef}
      className={`node-card w-full${animBusy ? " node-generating" : ""}${isQueued ? " node-queued" : ""}${(data.hasError as boolean) ? " node-error-blink" : ""}`}
      style={{
        minWidth: 280,
        aspectRatio: (data.imageNaturalRatio as string | undefined) ?? cssRatio,
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => { setHovering(false); closeDropdowns(); }}
      onAnimationEnd={() => updateNodeData(id, { hasError: false })}
    >
      <CornerResizer minWidth={220} minHeight={80} keepAspectRatio={!!data.imageUrl} />
      <NodeActionBar
        visible={!!selected && !data.locked && !parentGroupSelected && !multiSelected && !readOnly}
        hasContent={!!data.imageUrl}
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
      <span className="node-above-label">{data.label as string}</span>
      {(!promptConnected || hasFailedImageInput) && status !== "running" && !data.locked && (
        <MissingInputWarning messages={[
          ...(!promptConnected ? ["A text node is required"] : []),
          ...(hasFailedImageInput ? ["The connected image input has no valid content"] : []),
        ]} />
      )}

      {/* ── Icon handles — bottom-anchored, consistent with other nodes ── */}
      {/* prompt is top-most; image is closest to bottom */}
      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        style={{ top: `calc(100% - ${caps.supportsImages ? 90 : 52}px)` }}
        className={`node-handle-icon node-handle-icon-prompt${promptConnected ? " node-handle-connected" : ""}${errorHandles.has("prompt") ? " node-handle-error" : ""}`}
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
          style={{ top: "calc(100% - 52px)" }}
          className={`node-handle-icon node-handle-icon-resource${imageConnected ? " node-handle-connected" : ""}${errorHandles.has("image") ? " node-handle-error" : ""}`}
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
            top: hoveredHandle === "prompt"
              ? `calc(100% - ${caps.supportsImages ? 90 : 52}px)`
              : "calc(100% - 52px)",
            left: 0,
            transform: "translate(calc(-100% - 34px), -50%)",
            background: "#1A1A1A",
            border: `1px solid ${hoveredHandle === "prompt" ? "#2DD4BF33" : "#fb923c33"}`,
            color: "#CCCCCC",
          }}
        >
          <span style={{ color: hoveredHandle === "prompt" ? "#2DD4BF" : "#fb923c" }} className="mr-1.5">●</span>
          {hoveredHandle === "prompt"
            ? "Text prompt"
            : caps.maxImages > 0
              ? `Reference image (up to ${caps.maxImages})`
              : "Reference image"
          }
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        style={{ top: 20 }}
        className={`node-handle-icon node-handle-icon-out-image${sourceConnected ? " node-handle-connected" : ""}${(data.hasError as boolean) ? " node-handle-error" : ""}`}
        title="Image output"
      >
        <PhotoIcon />
      </Handle>

      {/* ── Full-card media container — all controls overlaid inside ── */}
      <div
        className="relative bg-[#2a2d35] group/gen"
        style={{
          aspectRatio: (data.imageNaturalRatio as string | undefined) ?? cssRatio,
          width: "100%",
          transition: "aspect-ratio 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
        onDoubleClick={() => { if (data.imageUrl) openLightbox(); }}
      >
        {/* Clipped media layer */}
        <div className="absolute inset-0 overflow-hidden rounded-[8px] z-0">
          {isQueued && (
            <div
              className="absolute top-2 left-2 flex items-center gap-1.5 h-7 px-3 rounded-full z-20 pointer-events-none select-none"
              style={{ background: "rgba(0,0,0,0.58)", backdropFilter: "blur(10px)", border: "1px solid rgba(148,163,184,0.2)" }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(148,163,184,0.65)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 3" />
              </svg>
              <span className="text-[11px] font-medium" style={{ color: "rgba(148,163,184,0.8)" }}>Queued</span>
            </div>
          )}
          {busy && generations[currentGenIdx] === null && (
            <div className="absolute top-2 left-2 right-2 flex flex-wrap gap-1.5 z-20" style={{ alignItems: "flex-start" }}>
              <div
                className="flex items-center gap-1.5 h-7 px-3 rounded-full pointer-events-none select-none"
                style={{ background: "rgba(0,0,0,0.58)", backdropFilter: "blur(10px)", border: isPending ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(45,212,191,0.25)", flexShrink: 0 }}
              >
                {isPending ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}>
                    <circle cx="5" cy="5" r="4" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
                    <path d="M5 1 A4 4 0 0 1 9 5" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}>
                    <circle cx="5" cy="5" r="4" stroke="rgba(45,212,191,0.25)" strokeWidth="1.5" />
                    <path d="M5 1 A4 4 0 0 1 9 5" stroke="#2DD4BF" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                )}
                <span className="text-[11px] font-medium" style={{ color: isPending ? "#888" : "#2DD4BF" }}>
                  {isPending ? "Pending" : "Generating…"}
                </span>
              </div>
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); handleCancel(); }}
                className="ml-auto flex items-center gap-1.5 h-7 px-3 rounded-full transition-colors hover:bg-white/10"
                style={{ background: "rgba(0,0,0,0.58)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="m6 6 12 12" />
                </svg>
                <span className="text-[11px] text-[#ccc] font-medium">Cancel</span>
              </button>
            </div>
          )}
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
                <div key={i} style={{ minWidth: "100%", height: "100%", position: "relative", flexShrink: 0 }}>
                  {entry === null ? (
                    <div className="absolute inset-0" style={{ background: "#2a2d35" }} />
                  ) : typeof entry === "object" && !Array.isArray(entry) ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center z-20" style={{ background: "#2a2427" }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" fill="#1a0a0a" stroke="#5a1a1a" strokeWidth="1.5" />
                        <path d="M12 7v5" stroke="#c04040" strokeWidth="2" strokeLinecap="round" />
                        <circle cx="12" cy="16" r="1" fill="#c04040" />
                      </svg>
                      {(entry.error === "moderation_blocked" || entry.error?.includes?.("moderation_blocked") || entry.error?.includes?.("flagged as sensitive")) ? (
                        <div className="flex items-center justify-center gap-1.5 text-[10px] text-[#f87171]">
                          <ShieldBan size={12} strokeWidth={1.5} className="shrink-0" />
                          <span>NSFW content detected</span>
                        </div>
                      ) : (
                        <p className="text-[10px] text-[#f87171] leading-snug break-words">{entry.error}</p>
                      )}
                      <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); handleDeleteSlot(i); }}
                        className="flex items-center gap-1.5 h-7 px-3 rounded-full transition-all hover:bg-red-900/60"
                        style={{ background: "rgba(40,0,0,0.7)", backdropFilter: "blur(10px)", border: "1px solid rgba(200,50,50,0.35)" }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-red-400">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4h6v2" />
                        </svg>
                        <span className="text-[11px] font-medium text-red-400">Delete</span>
                      </button>
                    </div>
                  ) : (
                    <Image
                      ref={i === currentGenIdx ? nodeImgRef : undefined}
                      src={entry as string}
                      alt="Generated"
                      fill
                      quality={30}
                      sizes="400px"
                      style={{ objectFit: "fill" }}
                      onLoad={i === currentGenIdx ? () => {
                        requestAnimationFrame(() => {
                          if (!cardRef.current) return;
                          const w = cardRef.current.offsetWidth;
                          const h = cardRef.current.offsetHeight;
                          if (w > 0 && h > 0) updateNodeSize(id, w, h);
                        });
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
              <p className="text-white text-[12px] font-semibold leading-snug">
                Oops! Something went wrong.
              </p>
              {(() => {
                const msg = (data.errorMsg as string) ?? "Generation failed";
                const isNsfw = msg === "moderation_blocked" || msg.includes("moderation_blocked") || msg.includes("flagged as sensitive");
                return isNsfw ? (
                  <div className="flex items-center gap-1.5 text-[#f87171] text-[10px]">
                    <ShieldBan size={12} strokeWidth={1.5} className="shrink-0" />
                    <span>NSFW content detected</span>
                  </div>
                ) : (
                  <p className="text-[#f87171] text-[10px] leading-[1.5] break-words">{msg}</p>
                );
              })()}
            </div>
          ) : (
            <div className="w-full h-full" />
          )}
        </div>

        {natW > 0 && natH > 0 && (
          <div
            aria-hidden
            className="absolute top-1.5 right-2 pointer-events-none select-none z-30 tabular-nums px-1.5 py-0.5 rounded-full opacity-0 group-hover/gen:opacity-100 transition-opacity duration-150 node-slide-reveal"
            style={{ fontSize: 9, lineHeight: 1, color: "#fff", background: "#1a1a1a" }}
          >
            {natW} × {natH}
          </div>
        )}

        {/* ── Bottom floating controls ── */}
        <div
          ref={controlBarRef}
          className={`absolute bottom-0 left-0 right-0 flex items-end gap-2 px-2.5 pb-2.5 pt-1 z-[1001] transition-opacity duration-150 ${hovering || selected ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Pills — wrap freely */}
          <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">

          {/* Model pill */}
          <div className="relative shrink-0">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (data.imageUrl) return;
                setModelOpen((o) => !o); setRatioOpen(false); setQualityOpen(false);
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all ${data.imageUrl ? "cursor-default" : "hover:brightness-125"}`}
              style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)" }}
              title={data.imageUrl ? "Clear the image to change model" : undefined}
            >
              <span className="shrink-0 text-white/60" style={{ lineHeight: 0 }}>
                <NodeProviderIcon provider={modelInfo.meta} />
              </span>
              <span className={`text-[11px] transition-colors ${data.imageUrl ? "text-white/30" : "text-white/70"}`}>
                {modelInfo.name}
              </span>
              {!data.imageUrl && <ChevronIcon open={modelOpen} />}
            </button>
            {modelPopup.visible && (
              <div className={`absolute bottom-full left-0 mb-2 w-48 bg-[#111622] border border-[#1E2840] rounded-md overflow-hidden z-[1002] shadow-2xl ${modelPopup.className}`}>
                {[...new Set(MODELS.map(m => m.meta))].map((provider, pi) => (
                  <Fragment key={provider}>
                    {pi > 0 && <div className="border-t border-white/[0.06] mx-2 my-0.5" />}
                    {MODELS.filter(m => m.meta === provider).map(m => (
                      <button
                        key={m.id}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          const newCaps = MODEL_CAPS[m.id] ?? DEFAULT_CAPS;
                          const validRatio = newCaps.ratios.includes(aspectRatio) ? aspectRatio : "1:1";
                          const validQuality = newCaps.qualityOptions && !newCaps.qualityOptions.includes(quality as "1k" | "2k" | "4k")
                            ? newCaps.qualityOptions[0]
                            : quality;
                          updateNodeData(id, { model: m.id, aspectRatio: validRatio, quality: validQuality });
                          if (!newCaps.supportsImages) removeEdgesForHandle(id, "image");
                          setModelOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-[7px] text-[11px] hover:bg-[#141C28] transition-colors ${model === m.id ? "text-white" : "text-[#A0A0A0]"}`}
                      >
                        <span className="shrink-0 text-white/50" style={{ lineHeight: 0 }}>
                          <NodeProviderIcon provider={m.meta} />
                        </span>
                        <span className="flex-1 text-left">{m.name}</span>
                        <span className="text-[#4A4A45]">{m.meta}</span>
                      </button>
                    ))}
                  </Fragment>
                ))}
              </div>
            )}
          </div>

          {/* Ratio pill */}
          <div className="relative shrink-0">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { setRatioOpen((o) => !o); setModelOpen(false); setQualityOpen(false); }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full hover:brightness-125 transition-all"
              style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <span className="text-[11px] text-white/70 tabular-nums">{aspectRatio}</span>
              <ChevronIcon open={ratioOpen} />
            </button>
            {ratioPopup.visible && (
              <div className={`absolute bottom-full left-0 mb-2 w-32 bg-[#111622] border border-[#1E2840] rounded-md overflow-hidden z-[1002] shadow-2xl ${ratioPopup.className}`}>
                {caps.ratios.map((r) => {
                  const { rw: iw, rh: ih, x, y } = ratioRect(r);
                  const active = r === aspectRatio;
                  return (
                    <button
                      key={r}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => { updateNodeData(id, { aspectRatio: r }); setRatioOpen(false); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-[7px] text-[11px] hover:bg-[#141C28] transition-colors ${active ? "text-white" : "text-[#A0A0A0]"}`}
                    >
                      <svg width="20" height="14" viewBox="0 0 20 14" className="shrink-0">
                        <rect x={x} y={y} width={iw} height={ih} rx="1" fill={active ? "#FFFFFF" : "none"} stroke={active ? "#FFFFFF" : "#5A5A55"} strokeWidth="1" />
                      </svg>
                      <span className="tabular-nums">{r}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quality pill */}
          {caps.supportsQuality && !(caps.azureQualityOptions && isAzureProvider) && (
            <div className="relative shrink-0">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => { setQualityOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setAzureQualityOpen(false); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full hover:brightness-125 transition-all"
                style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                {caps.qualityKey === "resolution" && <span className="text-[11px] text-white/30">Res</span>}
                <span className="text-[11px] text-white/70 uppercase">{quality}</span>
                <ChevronIcon open={qualityOpen} />
              </button>
              {qualityPopup.visible && (
                <div className={`absolute bottom-full left-0 mb-2 w-36 bg-[#111622] border border-[#1E2840] rounded-md overflow-hidden z-[1002] shadow-2xl ${qualityPopup.className}`}>
                  {caps.qualityKey === "resolution" && (
                    <div className="px-3 py-1.5 border-b border-[#1C2436]">
                      <span className="text-[9px] text-[#4A4A45] tracking-wider uppercase font-semibold">Resolution</span>
                    </div>
                  )}
                  {[
                    { id: "1k", label: "1K", meta: "Standard" },
                    { id: "2k", label: "2K", meta: "High" },
                    { id: "4k", label: "4K", meta: "Maximum" },
                  ].filter((q) => !caps.qualityOptions || caps.qualityOptions.includes(q.id as "1k" | "2k" | "4k")).map((q) => (
                    <button
                      key={q.id}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => { updateNodeData(id, { quality: q.id }); setQualityOpen(false); }}
                      className={`w-full flex items-center justify-between px-3 py-[7px] text-[11px] hover:bg-[#141C28] transition-colors ${quality === q.id ? "text-white" : "text-[#A0A0A0]"}`}
                    >
                      <span className="uppercase font-medium">{q.label}</span>
                      <span className="text-[#4A4A45]">{q.meta}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Azure Quality pill */}
          {caps.azureQualityOptions && isAzureProvider && (
            <div className="relative shrink-0">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => { setAzureQualityOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setQualityOpen(false); setAzureResolutionOpen(false); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full hover:brightness-125 transition-all"
                style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)" }}
                title="Quality (Azure Foundry)"
              >
                <span className="text-[11px] text-white/70 capitalize">
                  {(data.azureQuality as string | undefined) ?? "auto"}
                </span>
                <ChevronIcon open={azureQualityOpen} />
              </button>
              {azureQualityPopup.visible && (
                <div className={`absolute bottom-full left-0 mb-2 w-36 bg-[#111622] border border-[#1E2840] rounded-md overflow-hidden z-[1002] shadow-2xl ${azureQualityPopup.className}`}>
                  <div className="px-3 py-1.5 border-b border-[#1C2436]">
                    <span className="text-[9px] text-[#4A4A45] tracking-wider uppercase font-semibold">Azure Quality</span>
                  </div>
                  {[
                    { id: "auto", meta: "Model default" },
                    { id: "low", meta: "Faster, cheaper" },
                    { id: "medium", meta: "Balanced" },
                    { id: "high", meta: "Best quality" },
                  ].map((q) => {
                    const active = ((data.azureQuality as string | undefined) ?? "auto") === q.id;
                    return (
                      <button
                        key={q.id}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => { updateNodeData(id, { azureQuality: q.id }); setAzureQualityOpen(false); }}
                        className={`w-full flex items-center justify-between px-3 py-[7px] text-[11px] hover:bg-[#141C28] transition-colors ${active ? "text-white" : "text-[#A0A0A0]"}`}
                      >
                        <span className="capitalize font-medium">{q.id}</span>
                        <span className="text-[#4A4A45]">{q.meta}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Azure Resolution pill — shown alongside Azure Quality for gpt-image-2 */}
          {caps.azureResolutionOptions && isAzureProvider && (
            <div className="relative shrink-0">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => { setAzureResolutionOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setQualityOpen(false); setAzureQualityOpen(false); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full hover:brightness-125 transition-all"
                style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.07)" }}
                title="Resolution (Azure)"
              >
                <span className="text-[11px] text-white/30">Res</span>
                <span className="text-[11px] text-white/70 uppercase">
                  {(data.azureResolution as string | undefined) ?? "1k"}
                </span>
                <ChevronIcon open={azureResolutionOpen} />
              </button>
              {azureResolutionPopup.visible && (
                <div className={`absolute bottom-full left-0 mb-2 w-36 bg-[#111622] border border-[#1E2840] rounded-md overflow-hidden z-[1002] shadow-2xl ${azureResolutionPopup.className}`}>
                  <div className="px-3 py-1.5 border-b border-[#1C2436]">
                    <span className="text-[9px] text-[#4A4A45] tracking-wider uppercase font-semibold">Resolution</span>
                  </div>
                  {[
                    { id: "1k", label: "1K", meta: "Standard" },
                    { id: "2k", label: "2K", meta: "High" },
                    { id: "4k", label: "4K", meta: "Maximum" },
                  ].map((r) => {
                    const active = ((data.azureResolution as string | undefined) ?? "1k") === r.id;
                    return (
                      <button
                        key={r.id}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => { updateNodeData(id, { azureResolution: r.id }); setAzureResolutionOpen(false); }}
                        className={`w-full flex items-center justify-between px-3 py-[7px] text-[11px] hover:bg-[#141C28] transition-colors ${active ? "text-white" : "text-[#A0A0A0]"}`}
                      >
                        <span className="uppercase font-medium">{r.label}</span>
                        <span className="text-[#4A4A45]">{r.meta}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}


          </div>{/* end pills wrapper */}

          {/* Generate button — always right */}
          {!readOnly && <GenerateButton onClick={generate} busy={animBusy} disabled={promptOverLimit || kieKeySet === false || busy || hasFailedImageInput} warningMessages={hasFailedImageInput ? ["The connected image input has no valid content"] : undefined} />}
        </div>
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
              className={`rounded-full transition-all ${i === currentGenIdx ? "w-3 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/30 hover:bg-white/60"}`}
            />
          )) : (
            <span className="text-[10px] text-white/50 font-mono tabular-nums">
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

      {/* ── Lightbox — blur-up full-quality view on double-click ─────── */}
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
            {/* Full-res image */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.imageUrl as string}
              alt="Full quality"
              className="block max-w-[90vw] max-h-[90vh] object-contain"
              onLoad={() => setLightboxImgLoaded(true)}
            />
            {/* Blur placeholder */}
            {blurSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={blurSrc}
                alt=""
                aria-hidden
                className={`absolute inset-0 w-full h-full object-contain${lightboxImgLoaded ? "" : " lightbox-blur-pulse"}`}
                style={{
                  transform: "scale(1.05)",
                  opacity: lightboxImgLoaded ? 0 : undefined,
                  transition: lightboxImgLoaded ? "opacity 380ms ease" : undefined,
                  pointerEvents: "none",
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

// ── Small helpers ─────────────────────────────────────────────────────────────

function PromptIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="white">
      <path d="M1.5 2h11v2H8.5v8H5.5V4H1.5V2z" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" fill="white" stroke="none" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
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
      <path d="M1 2.5 4 5.5 7 2.5" />
    </svg>
  );
}

function NodeProviderIcon({ provider }: { provider: string }) {
  switch (provider) {
    case "OpenAI":
      return <svg className="text-[#2DD4BF]" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M22.408 9.80741C22.9487 8.17778 22.7685 6.37037 21.8974 4.88889C20.5758 2.60741 17.9024 1.45185 15.2891 1.98519C14.1477 0.711111 12.4656 0 10.7234 0C8.0501 0 5.70717 1.68889 4.86612 4.17778C3.15398 4.53333 1.68214 5.57037 0.811051 7.08148C-0.510601 9.36296 -0.210226 12.2074 1.56199 14.163C1.02131 15.8222 1.23158 17.6 2.10267 19.0815C3.42432 21.363 6.09766 22.5481 8.71093 21.9852C9.88239 23.2593 11.5345 24 13.2766 24C15.95 24 18.2929 22.3111 19.134 19.8222C20.8461 19.4667 22.3179 18.4296 23.189 16.9185C24.5107 14.637 24.2103 11.763 22.408 9.80741ZM13.2766 22.4296C12.1953 22.4296 11.174 22.0741 10.363 21.3926C10.393 21.363 10.4831 21.3333 10.5132 21.3037L15.3492 18.5481C15.5895 18.4 15.7397 18.163 15.7397 17.8667V11.1407L17.7823 12.2963C17.8123 12.2963 17.8123 12.3259 17.8123 12.3556V17.9259C17.8423 20.4148 15.7998 22.4296 13.2766 22.4296ZM3.48439 18.3111C2.94372 17.3926 2.76349 16.3259 2.94372 15.2889C2.97375 15.3185 3.03383 15.3481 3.0939 15.3778L7.92995 18.1333C8.17025 18.2815 8.47063 18.2815 8.71093 18.1333L14.6283 14.7556V17.0963C14.6283 17.1259 14.6283 17.1556 14.5983 17.1556L9.70216 19.9407C7.53946 21.1852 4.74597 20.4444 3.48439 18.3111ZM2.22282 7.88148C2.76349 6.96296 3.60454 6.28148 4.59578 5.8963V11.5852C4.59578 11.8519 4.74597 12.1185 4.98627 12.2667L10.9037 15.6444L8.86111 16.8C8.83108 16.8 8.80104 16.8296 8.80104 16.8L3.90492 14.0148C1.68214 12.7704 0.961239 10.0148 2.22282 7.88148ZM19.0438 11.7333L13.1264 8.35556L15.169 7.2C15.199 7.2 15.2291 7.17037 15.2291 7.2L20.1252 9.98519C22.3179 11.2296 23.0388 13.9852 21.7773 16.1185C21.2366 17.037 20.3955 17.7185 19.4043 18.0741V12.4148C19.4343 12.1481 19.2841 11.8815 19.0438 11.7333ZM21.0564 8.71111C21.0263 8.68148 20.9662 8.65185 20.9062 8.62222L16.0701 5.86667C15.8298 5.71852 15.5294 5.71852 15.2891 5.86667L9.37175 9.24444V6.9037C9.37175 6.87407 9.37175 6.84444 9.40179 6.84444L14.2979 4.05926C16.4906 2.81481 19.2541 3.55556 20.5157 5.71852C21.0564 6.60741 21.2366 7.67407 21.0564 8.71111ZM8.26036 12.8593L6.21781 11.7037C6.18777 11.7037 6.18777 11.6741 6.18777 11.6444V6.07407C6.18777 3.58519 8.23032 1.57037 10.7535 1.57037C11.8348 1.57037 12.8561 1.92593 13.6671 2.60741C13.6371 2.63704 13.577 2.66667 13.5169 2.6963L8.68089 5.45185C8.44059 5.6 8.2904 5.83704 8.2904 6.13333V12.8593H8.26036ZM9.37175 10.4889L12.0151 8.97778L14.6584 10.4889V13.4815L12.0151 14.9926L9.37175 13.4815V10.4889Z" /></svg>;
    case "Google":
      return <svg className="text-[#2DD4BF]" width="11" height="11" viewBox="0 0 20 20" fill="currentColor"><path d="M2.55464 6.25768C3.24798 4.87705 4.31161 3.71644 5.62666 2.90557C6.94171 2.0947 8.45636 1.66553 10.0013 1.66602C12.2471 1.66602 14.1338 2.49102 15.5763 3.83685L13.1871 6.22685C12.323 5.40102 11.2246 4.98018 10.0013 4.98018C7.83047 4.98018 5.99297 6.44685 5.3388 8.41602C5.17214 8.91602 5.07714 9.44935 5.07714 9.99935C5.07714 10.5493 5.17214 11.0827 5.3388 11.5827C5.9938 13.5527 7.83047 15.0185 10.0013 15.0185C11.1221 15.0185 12.0763 14.7227 12.823 14.2227C13.2558 13.9377 13.6264 13.5679 13.9123 13.1356C14.1982 12.7033 14.3935 12.2176 14.4863 11.7077H10.0013V8.48435H17.8496C17.948 9.02935 18.0013 9.59768 18.0013 10.1885C18.0013 12.7268 17.093 14.8635 15.5163 16.3135C14.138 17.5868 12.2513 18.3327 10.0013 18.3327C8.90683 18.3331 7.823 18.1179 6.81176 17.6992C5.80051 17.2806 4.88168 16.6668 4.10777 15.8929C3.33386 15.119 2.72005 14.2001 2.30141 13.1889C1.88278 12.1777 1.66753 11.0938 1.66797 9.99935C1.66797 8.65435 1.98964 7.38268 2.55464 6.25768Z" /></svg>;
    case "Seedream":
      return <svg className="text-[#2DD4BF]" width="11" height="11" viewBox="0 0 14 14" fill="currentColor"><path d="M2.7601 10.635L0.466553 11.2084V1.04883L2.7601 1.62222V10.635Z" /><path d="M13.8448 11.2295L11.5469 11.8029V0.454102L13.8448 1.02324V11.2295Z" /><path d="M6.39853 10.9452L4.10498 11.5186V5.53418L6.39853 6.10752V10.9452Z" /><path d="M7.89722 4.64663L10.1952 4.07324V10.0577L7.89722 9.48433V4.64663Z" /></svg>;
    case "Z-AI":
      return <svg className="text-[#2DD4BF]" width="11" height="11" viewBox="0 0 20 20" fill="currentColor"><path d="M19.9361 12.1411L17.6243 8.09523L17.3525 7.61735L18.5771 5.47657C18.6187 5.4023 18.6411 5.32158 18.6411 5.23763C18.6411 5.15367 18.6187 5.07295 18.5771 4.99868L17.215 2.61896C17.1735 2.5447 17.1127 2.48658 17.0424 2.4446C16.972 2.40262 16.8921 2.38002 16.8058 2.38002H11.6323L10.4077 0.236011C10.3245 0.0874804 10.1679 -0.00292969 9.9984 -0.00292969H7.27738C7.19425 -0.00292969 7.11111 0.0196728 7.04077 0.0616489C6.97042 0.103625 6.90967 0.161746 6.86811 0.236011L4.55316 4.28509L4.28138 4.75974H1.83213C1.749 4.75974 1.66587 4.78235 1.59552 4.82432C1.52518 4.8663 1.46443 4.92442 1.42286 4.99868L0.0639488 7.38164C0.0223821 7.4559 0 7.53663 0 7.62058C0 7.70453 0.0223821 7.78525 0.0639488 7.85952L2.65068 12.3833L1.42606 14.5273C1.38449 14.6015 1.36211 14.6823 1.36211 14.7662C1.36211 14.8502 1.38449 14.9309 1.42606 15.0051L2.78817 17.3849C2.82974 17.4591 2.89049 17.5173 2.96083 17.5592C3.03118 17.6012 3.11111 17.6238 3.19744 17.6238H8.36771L9.59233 19.7678C9.67546 19.9163 9.83214 20.0068 10.0016 20.0068H12.7226C12.8058 20.0068 12.8889 19.9842 12.9592 19.9422C13.0296 19.9002 13.0903 19.8421 13.1319 19.7678L15.7186 15.2441H18.1679C18.251 15.2441 18.3341 15.2215 18.4045 15.1795C18.4748 15.1375 18.5356 15.0794 18.5771 15.0051L19.9393 12.6254C19.9808 12.5512 20.0032 12.4704 20.0032 12.3865C20.0032 12.3025 19.9808 12.2218 19.9393 12.1475L19.9361 12.1411ZM7.27738 0.474952L8.63949 2.8579L7.27738 5.23763H18.1679L16.8058 7.61735H6.45883L4.82494 4.75974L7.27738 0.474952ZM8.09273 17.1395H3.19424L4.55636 14.7565H7.27738L1.83213 5.23763H4.55316L5.91527 7.61735L9.72662 14.2851L8.09273 17.1427V17.1395ZM16.8058 12.3768L15.4468 9.99707L10.0016 19.5224L8.63949 17.1427L10.0016 14.763L13.813 8.09523H17.0807L19.53 12.38H16.8058V12.3768Z" /></svg>;
    case "X":
      return <svg className="text-[#2DD4BF]" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M9.23842 15.4055L17.3051 9.26292C17.7006 8.9618 18.2658 9.07925 18.4543 9.54702C19.446 12.0138 19.0029 14.9784 17.0297 17.0138C15.0566 19.0492 12.3111 19.4955 9.80163 18.4789L7.06027 19.7882C10.9922 22.5604 15.7667 21.8748 18.7504 18.795C21.117 16.3538 21.8499 13.0262 21.1646 10.0254L21.1708 10.0318C20.1769 5.62354 21.4151 3.86151 23.9515 0.258408C23.9702 0.231693 23.9351 0.202703 23.9123 0.226139L20.7939 3.44289V3.43221L9.23842 15.4055Z" /><path d="M7.65167 7.33217C5.24368 9.81392 4.75711 14.1176 7.57924 16.8984L7.57713 16.9005L0.0792788 23.8097C0.0528384 23.834 0.0162235 23.8015 0.0377551 23.7728C0.487937 23.1707 1.01883 22.595 1.54932 22.0198L1.57777 21.9889C3.28214 20.1411 4.97141 18.3097 3.93926 15.7216C2.55615 12.2552 3.36158 8.19287 5.9228 5.55089C8.58547 2.80639 12.507 2.1144 15.7826 3.5048C16.5072 3.78245 17.1388 4.17758 17.6315 4.54493L14.8964 5.84777C12.3497 4.7457 9.43229 5.49537 7.65167 7.33217Z" /></svg>;
    case "Kling":
      return <svg className="text-[#2DD4BF]" width="11" height="11" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M16.7522 2.86984L16.818 2.93745L16.8199 2.93552C18.087 4.25441 17.7236 6.90443 15.8863 9.90864L19.5 13.6567L19.3447 13.9703C18.7372 15.1986 17.9147 16.2992 16.9193 17.216C15.608 18.43 14.0251 19.2853 12.3143 19.7044L12.2522 19.7198L12.1634 19.7417L12.0994 19.7565L11.9584 19.7887L11.8416 19.8126L11.754 19.8299C11.6609 19.8493 11.5634 19.8673 11.4683 19.884L11.3888 19.8963L11.3286 19.904C11.2429 19.916 11.1576 19.9272 11.0727 19.9375C9.64831 20.1036 8.20616 19.9376 6.8516 19.4517C5.49703 18.9658 4.2643 18.1723 3.24348 17.1291L3.18385 17.0692C1.91429 15.7503 2.27391 13.0983 4.11366 10.0922L0.5 6.34416L0.65528 6.03054C1.26118 4.80131 2.0846 3.70115 3.08261 2.78741C4.10242 1.8473 5.28649 1.11848 6.57081 0.640344C6.86894 0.528933 7.18075 0.431691 7.48696 0.34926C7.73931 0.279139 7.9944 0.220054 8.25155 0.172163C8.33851 0.154131 8.43665 0.135456 8.53168 0.118712C10.0139 -0.12084 11.5297 0.00325476 12.9574 0.481036C14.385 0.958817 15.6847 1.77698 16.7522 2.86984ZM15.5304 3.03083H15.5267L15.5304 3.03276C14.3025 2.63864 12.354 3.27555 10.2944 4.68267C11.8615 4.22994 13.377 4.46435 14.3565 5.48057C15.2845 6.44462 15.5385 7.90777 15.187 9.44497C15.1704 9.52697 15.1497 9.61005 15.1248 9.69419C16.8062 7.05706 17.3441 4.58993 16.2795 3.48807C16.262 3.4682 16.2433 3.44949 16.2236 3.43204L16.2155 3.42431L16.2037 3.41336L16.1683 3.38503C16.153 3.37215 16.1371 3.3597 16.1205 3.34768L16.0944 3.32836C15.9242 3.19657 15.7334 3.09594 15.5304 3.03083ZM14.6876 8.95876C14.4708 10.2995 13.7559 11.6545 12.672 12.777C11.5913 13.9001 10.282 14.642 8.98696 14.8687C7.77516 15.0812 6.72981 14.8043 6.04472 14.0959C5.36149 13.3868 5.09441 12.3069 5.29938 11.044C5.51615 9.7045 6.22919 8.3489 7.30807 7.22771C7.30807 7.22771 7.30994 7.22771 7.31429 7.22127L7.31801 7.21483C8.40062 6.09944 9.70497 5.3595 10.9969 5.13539C12.2087 4.92287 13.2516 5.1985 13.9391 5.90818C14.6224 6.61657 14.8894 7.69847 14.6845 8.9594H14.6882L14.6876 8.95876ZM3.70621 3.51061C2.88113 4.26712 2.1865 5.16395 1.65217 6.16255L1.64596 6.16449L4.78137 9.40762C5.04127 9.02837 5.31475 8.65932 5.60124 8.30124C5.70311 8.17567 5.80807 8.04558 5.91553 7.91614L5.95652 7.86784L6.10559 7.69525C6.10994 7.69139 6.11429 7.68301 6.11429 7.68301L6.14161 7.65082L6.1559 7.63343L6.23292 7.54456C6.27226 7.49819 6.31284 7.45247 6.35466 7.40739C6.35466 7.40288 6.36087 7.39644 6.36087 7.39644L6.42795 7.32045L6.47578 7.26893C6.47785 7.26592 6.4795 7.26507 6.4795 7.26507C6.48385 7.26249 6.48385 7.25863 6.48385 7.25863C6.48675 7.25562 6.48965 7.25176 6.49255 7.24703L6.50124 7.23609C6.50882 7.23006 6.51569 7.22314 6.52174 7.21548L6.53354 7.2026C6.55901 7.17619 6.58944 7.14528 6.61677 7.11437C6.63126 7.09591 6.64783 7.07745 6.66646 7.05899L6.69193 7.03194C6.69627 7.0255 6.70807 7.01326 6.70807 7.01326L6.7559 6.96432L6.84907 6.86901L6.88012 6.83488L6.91491 6.79688C7.5863 6.09838 8.30377 5.44917 9.06211 4.85397L9.16149 4.77862H9.16211V4.77798L9.16335 4.77733L9.26273 4.70134C9.37371 4.61505 9.48551 4.53068 9.59814 4.44825C9.71822 4.36325 9.8383 4.27953 9.95838 4.1971C11.587 3.0714 13.182 2.39586 14.4839 2.26191C12.7422 1.17239 10.6864 0.752921 8.6764 1.07697C8.58944 1.09114 8.50621 1.10595 8.41677 1.12462C8.36025 1.13493 8.31118 1.14523 8.26149 1.15554L8.23168 1.16198C7.77515 1.25942 7.3258 1.39004 6.88696 1.55288C5.71551 1.9877 4.63519 2.65238 3.70621 3.51061ZM3.87888 16.6531C4.05279 16.7905 4.25093 16.8949 4.47329 16.9661H4.46894C5.70497 17.3577 7.64596 16.7188 9.69814 15.3156C8.13292 15.7664 6.6205 15.532 5.64099 14.5157C4.71739 13.5562 4.46335 12.0885 4.81304 10.5513C4.83043 10.4693 4.85093 10.3863 4.87453 10.3021C3.19379 12.9399 2.65714 15.4064 3.7205 16.5089C3.77062 16.56 3.8235 16.6082 3.87888 16.6531ZM18.346 13.8389V13.8402C17.8108 14.8373 17.1168 15.7333 16.2932 16.4902C15.0606 17.625 13.5707 18.4173 11.9627 18.7931L11.9429 18.7983L11.8894 18.8112C11.8291 18.8281 11.7679 18.8418 11.7062 18.8524C11.666 18.8614 11.6251 18.8693 11.5832 18.8762C11.4967 18.8936 11.4097 18.9087 11.3224 18.9213L11.2497 18.9342L11.1671 18.9451C11.1008 18.9545 11.0329 18.9631 10.9634 18.9709C9.06697 19.1922 7.15308 18.7592 5.51801 17.7389C6.77143 17.6108 8.29752 16.9764 9.86273 15.9274L9.95217 15.8668L10.0416 15.8057L10.1634 15.7206H10.164L10.3994 15.5545C10.5128 15.4721 10.6246 15.3877 10.7348 15.3014C10.8035 15.2503 10.871 15.1994 10.9373 15.1488C11.6946 14.5518 12.4122 13.9025 13.0851 13.2052C13.1012 13.1881 13.1164 13.1713 13.1304 13.155L13.1491 13.1331C13.1822 13.1009 13.2133 13.0693 13.2422 13.0384L13.2894 12.9895C13.2894 12.9895 13.3019 12.9766 13.3037 12.9702L13.3217 12.9521L13.3292 12.9438L13.3832 12.8884L13.4248 12.8433C13.4389 12.8296 13.4528 12.815 13.4665 12.7995L13.4776 12.7866C13.4837 12.7792 13.4906 12.7725 13.4981 12.7667L13.5075 12.7551L13.5161 12.7441C13.5161 12.7441 13.5224 12.7377 13.5261 12.7358L13.5429 12.7171L13.5596 12.6984L13.5758 12.6823C13.5584 12.7012 13.5418 12.7209 13.5261 12.7416L13.5646 12.6997L13.5652 12.6984C13.5921 12.6684 13.6188 12.6396 13.6453 12.6121C13.6453 12.6121 13.6453 12.6057 13.6516 12.6057C13.688 12.5653 13.7234 12.5245 13.7578 12.4833L13.828 12.4022C13.8372 12.396 13.8447 12.3873 13.8497 12.3771L13.8894 12.3275L13.8994 12.3152C13.9478 12.2616 13.9952 12.2073 14.0416 12.1523L14.0901 12.0943C14.1679 12.0003 14.2453 11.9057 14.3224 11.8103L14.4155 11.6951L14.4447 11.6577C14.482 11.6092 14.5188 11.562 14.5553 11.516C14.5863 11.4774 14.6168 11.4379 14.6466 11.3975C14.8451 11.1367 15.0377 10.8711 15.2242 10.6009L18.346 13.8389ZM18.346 13.8389C18.346 13.8368 18.3472 13.835 18.3497 13.8338V13.8441L18.346 13.8402H18.3472L18.346 13.8389Z" /></svg>;
    case "Bytedance":
      return <svg className="text-[#2DD4BF]" width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M3.1544 12.1539L0.533203 12.8092V1.19824L3.1544 1.85354V12.1539Z" /><path d="M15.8225 12.8333L13.1963 13.4886V0.518555L15.8225 1.169V12.8333Z" /><path d="M7.31261 12.5083L4.69141 13.1636V6.32422L7.31261 6.97947V12.5083Z" /><path d="M9.02539 5.3096L11.6516 4.6543V11.4937L9.02539 10.8384V5.3096Z" /></svg>;
    default:
      return null;
  }
}

