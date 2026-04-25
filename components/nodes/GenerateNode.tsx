"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAnimatedPopup } from "@/lib/useAnimatedPopup";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Handle, Position, NodeProps, Node, useUpdateNodeInternals } from "@xyflow/react";
import CornerResizer from "./CornerResizer";
import NodeActionBar from "./NodeActionBar";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { resolveInputs } from "@/lib/executor";

type GenerateNodeType = Node<NodeData, "generateNode">;

import { IMAGE_MODELS } from "@/lib/modelConfig";

// Derived from config — no hardcoding needed
const MODELS     = IMAGE_MODELS.map((m) => ({ id: m.id, name: m.name, meta: m.provider }));
const MODEL_CAPS = Object.fromEntries(
  IMAGE_MODELS.map((m) => [m.id, {
    supportsImages:      m.supportsImages,
    supportsQuality:     m.supportsQuality,
    ratios:              m.ratios,
    maxImages:           m.maxImages,
    qualityOptions:      m.apiInput.qualityOptions,
    qualityKey:          m.apiInput.qualityKey,
    azureQualityOptions: m.azureQualityOptions,
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
  idle:    "bg-[#2A1A14]",
  running: "bg-amber-400 animate-pulse",
  done:    "bg-[#77E544]",
  error:   "bg-red-500",
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
  const updateNodeData       = useWorkflowStore((s) => s.updateNodeData);
  const updateNodeSize       = useWorkflowStore((s) => s.updateNodeSize);
  const removeEdgesForHandle = useWorkflowStore((s) => s.removeEdgesForHandle);
  const setAuthModalOpen     = useWorkflowStore((s) => s.setAuthModalOpen);
  const flashEdgeError       = useWorkflowStore((s) => s.flashEdgeError);
  const onNodesChange        = useWorkflowStore((s) => s.onNodesChange);
  const addNode              = useWorkflowStore((s) => s.addNode);
  const insertEdge           = useWorkflowStore((s) => s.insertEdge);
  const nodes                = useWorkflowStore((s) => s.nodes);
  const edges                = useWorkflowStore((s) => s.edges);
  const debugMode            = useWorkflowStore((s) => s.debugMode);
  const parentGroupSelected  = useWorkflowStore((s) => {
    const self = s.nodes.find((n) => n.id === id);
    if (!self?.parentId) return false;
    return s.nodes.find((n) => n.id === self.parentId)?.selected ?? false;
  });
  const multiSelected = useWorkflowStore((s) => s.nodes.filter((n) => n.selected).length > 1);

  const updateNodeInternals = useUpdateNodeInternals();
  const cardRef = useRef<HTMLDivElement>(null);

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

  const [hovering, setHovering]        = useState(false);
  const [isSaving, setIsSaving]        = useState(false);
  const [modelOpen, setModelOpen]     = useState(false);
  const [ratioOpen, setRatioOpen]     = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [azureQualityOpen, setAzureQualityOpen] = useState(false);
  const modelPopup        = useAnimatedPopup(modelOpen && !data.imageUrl);
  const ratioPopup        = useAnimatedPopup(ratioOpen);
  const qualityPopup      = useAnimatedPopup(qualityOpen);
  const azureQualityPopup = useAnimatedPopup(azureQualityOpen);
  const [loading, setLoading]         = useState(false);
  const [hoveredHandle, setHoveredHandle] = useState<"prompt" | "image" | null>(null);
  const [lightboxOpen, setLightboxOpen]       = useState(false);
  const [lightboxVisible, setLightboxVisible] = useState(false);
  const [lightboxImgLoaded, setLightboxImgLoaded] = useState(false);
  const [blurSrc, setBlurSrc] = useState<string | null>(null);
  const nodeImgRef = useRef<HTMLImageElement>(null);

  const openLightbox = useCallback(() => {
    setLightboxImgLoaded(false);
    // Snapshot the already-painted pixels — instant, no network/decode delay
    const imgEl = nodeImgRef.current;
    if (imgEl && imgEl.naturalWidth > 0) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width  = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        canvas.getContext("2d")?.drawImage(imgEl, 0, 0);
        setBlurSrc(canvas.toDataURL());
      } catch {
        // Cross-origin fallback (shouldn't happen with /_next/image)
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

  const model       = (data.model as string) ?? "nano-banana-2";
  const caps        = MODEL_CAPS[model] ?? DEFAULT_CAPS;
  const modelInfo   = MODELS.find((m) => m.id === model) ?? MODELS[0];
  const quality     = (data.quality as string) ?? "1k";
  const status      = data.status ?? "idle";

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

  const promptOverLimit = (() => {
    const promptEdge = edges.find((e) => e.target === id && e.targetHandle === "prompt");
    if (!promptEdge) return false;
    const promptNode = nodes.find((n) => n.id === promptEdge.source);
    const text = (promptNode?.data?.prompt as string) ?? "";
    const limit = (IMAGE_MODELS.find((m) => m.id === model))?.apiInput.promptMaxLength ?? Infinity;
    return text.length > limit;
  })();

  // If current ratio isn't valid for this model, fall back to first valid ratio (or 1:1)
  const rawRatio    = (data.aspectRatio as string) ?? "1:1";
  const aspectRatio = caps.ratios.includes(rawRatio)
    ? rawRatio
    : (caps.ratios[0] ?? "1:1");

  // "auto" has no fixed pixel dimensions — treat as 1:1 for the CSS ratio
  const [rw, rh] = aspectRatio === "auto" ? [1, 1] : aspectRatio.split(":").map(Number);
  const cssRatio = `${rw} / ${rh}`;
  const busy     = loading || status === "running";

  const [natW, natH] = (() => {
    const r = data.imageNaturalRatio as string | undefined;
    if (!r) return [0, 0];
    const parts = r.split("/").map((s) => parseInt(s.trim(), 10));
    return parts.length === 2 ? parts : [0, 0];
  })();

  // ── Generation history ────────────────────────────────────────────────────
  type GenEntry = string | null | { error: string };
  const rawGens     = data.generations;
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
    const curr    = (storeNode?.data?.currentGenIdx as number | undefined) ?? 0;
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
        const res  = await fetch(`/api/job-status?taskId=${taskId}`);
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
  const imageConnected  = edges.some((e) => e.target === id && e.targetHandle === "image");
  const sourceConnected = edges.some((e) => e.source === id);

  // ── Submit generation job ────────────────────────────────────────────────────
  const connectedPromptNodeId = edges.find(
    (e) => e.target === id && e.targetHandle === "prompt"
  )?.source;

  const generate = useCallback(async () => {
    const { data } = await createClient().auth.getSession();
    if (!data.session) { setAuthModalOpen(true); return; }

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
      const trimEnd   = src.data.trimEnd   as number | undefined;
      const extractBody = trimEnd !== undefined
        ? { videoUrl, timeSeconds: trimEnd }
        : { videoUrl, timeSeconds: trimStart ?? 0 };
      try {
        const r = await fetch("/api/extract-frame", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
          body: JSON.stringify(extractBody),
        });
        const j = await r.json();
        if (j.cdnUrl) updateNodeData(src.id, { capturedFrameUrl: j.cdnUrl });
      } catch { /* proceed without */ }
    }

    // Use fresh store state so any newly extracted frames are included
    const upstream  = resolveInputs(id, useWorkflowStore.getState().nodes as Node<NodeData>[], edges);
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

    const payload = {
      model,
      prompt: resolvedPrompt,
      imageUrls: orderedUrls,
      aspectRatio,
      quality,
      ...(isAzure ? { azureBaseUrl, azureDeployment, azureQuality } : {}),
    };

    if (!resolvedPrompt.trim()) {
      if (connectedPromptNodeId) {
        updateNodeData(connectedPromptNodeId, { hasError: true });
        const promptEdge = edges.find((e) => e.target === id && e.targetHandle === "prompt");
        if (promptEdge) flashEdgeError(promptEdge.id);
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
    const prevGens = [...(((useWorkflowStore.getState().nodes.find(n => n.id === id)?.data?.generations) as GenEntry[] | undefined) ?? [])] as GenEntry[];
    const loadingGens = [...prevGens, null] as GenEntry[];
    updateNodeData(id, { status: "running", imageUrl: undefined, imageNaturalRatio: undefined, errorMsg: undefined, taskId: undefined, generations: loadingGens, currentGenIdx: loadingGens.length - 1 });
    try {
      const res  = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session!.access_token}` },
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
  }, [id, nodes, edges, model, aspectRatio, quality, data.azureQuality, debugMode, connectedPromptNodeId, updateNodeData, flashEdgeError]);

  // node-card has position:relative — handles and label position relative to it
  return (
    <div
      ref={cardRef}
      className={`node-card w-full flex flex-col${(data.hasError as boolean) ? " node-error-blink" : ""}`}
      style={{ minWidth: 280, ...(busy ? { animation: "node-pulse-glow 2.4s ease-in-out infinite" } : {}) }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => { setHovering(false); closeDropdowns(); }}
      onAnimationEnd={() => updateNodeData(id, { hasError: false })}
    >
      <CornerResizer minWidth={220} minHeight={80} keepAspectRatio={!!data.imageUrl} />
      <NodeActionBar
        visible={!!selected && !data.locked && !parentGroupSelected && !multiSelected}
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

        {/* ── Icon handles — bottom-anchored, consistent with other nodes ── */}
        {/* prompt is top-most; image is closest to bottom */}
        <Handle
          type="target"
          position={Position.Left}
          id="prompt"
          style={{ top: `calc(100% - ${caps.supportsImages ? 90 : 52}px)` }}
          className={`node-handle-icon node-handle-icon-prompt${promptConnected ? " node-handle-connected" : ""}`}
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
            className={`node-handle-icon node-handle-icon-resource${imageConnected ? " node-handle-connected" : ""}`}
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
              top:       hoveredHandle === "prompt"
                ? `calc(100% - ${caps.supportsImages ? 90 : 52}px)`
                : "calc(100% - 52px)",
              left:      0,
              transform: "translate(calc(-100% - 34px), -50%)",
              background: "#1A1A1A",
              border: `1px solid ${hoveredHandle === "prompt" ? "#77E54433" : "#fb923c33"}`,
              color: "#CCCCCC",
            }}
          >
            <span style={{ color: hoveredHandle === "prompt" ? "#77E544" : "#fb923c" }} className="mr-1.5">●</span>
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
          className={`node-handle-icon node-handle-icon-out-image${sourceConnected ? " node-handle-connected" : ""}`}
          title="Image output"
        >
          <PhotoIcon />
        </Handle>

        {/* ── Image area — top corners clip to card border-radius ───────── */}
        <div
          className="relative bg-[#090B0D] overflow-hidden rounded-t-[7px] group/gen"
          style={{
            aspectRatio: (data.imageNaturalRatio as string | undefined) ?? cssRatio,
            width: "100%",
            transition: "aspect-ratio 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onDoubleClick={() => { if (data.imageUrl) openLightbox(); }}
        >
          {busy && generations[currentGenIdx] === null && (
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
                    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "#090B0D" }}>
                      <div className="w-5 h-5 rounded-full border-2 border-[#2a2a2a] border-t-[#666] animate-spin" />
                    </div>
                  ) : typeof entry === "object" ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center" style={{ background: "#090B0D" }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="10" fill="#1a0a0a" stroke="#5a1a1a" strokeWidth="1.5"/>
                        <path d="M12 7v5" stroke="#c04040" strokeWidth="2" strokeLinecap="round"/>
                        <circle cx="12" cy="16" r="1" fill="#c04040"/>
                      </svg>
                      <p className="text-[10px] text-[#555] leading-snug break-words">{entry.error}</p>
                      <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); handleDeleteSlot(i); }}
                        className="absolute bottom-2 right-2 flex items-center gap-1.5 h-7 px-3 rounded-full z-20 transition-all group/del hover:bg-red-900/60 hover:border-red-500/40"
                        style={{ background: "rgba(0,0,0,0.58)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-white/70 group-hover/del:stroke-red-400 transition-colors">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4h6v2" />
                        </svg>
                        <span className="text-[11px] font-medium text-[#ccc] group-hover/del:text-red-400 transition-colors">Delete</span>
                      </button>
                    </div>
                  ) : (
                    <Image
                      ref={i === currentGenIdx ? nodeImgRef : undefined}
                      src={entry}
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
              <p className="text-[#555] text-[10px] leading-[1.5] break-words">
                {(data.errorMsg as string) ?? "Generation failed"}
              </p>
            </div>
          ) : (
            <div className="w-full h-full" />
          )}

          {natW > 0 && natH > 0 && (
            <div
              aria-hidden
              className="absolute top-1.5 right-2 pointer-events-none select-none z-30 tabular-nums px-1.5 py-0.5 rounded-full opacity-0 group-hover/gen:opacity-100 transition-opacity duration-150 node-slide-reveal"
              style={{ fontSize: 9, lineHeight: 1, color: "#fff", background: "#1a1a1a" }}
            >
              {natW} × {natH}
            </div>
          )}

        </div>

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

            {modelPopup.visible && (
              <div className={`absolute bottom-full left-0 mb-2 w-44 bg-[#0F1214] border border-[#2A1A14] rounded-md overflow-hidden z-50 shadow-2xl ${modelPopup.className}`}>
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

            {ratioPopup.visible && (
              <div className={`absolute bottom-full right-0 mb-2 w-32 bg-[#0F1214] border border-[#2A1A14] rounded-md overflow-hidden z-50 shadow-2xl ${ratioPopup.className}`}>
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

          {caps.supportsQuality && !(caps.azureQualityOptions && isAzureProvider) && (
            <>
              {/* Divider */}
              <span className="w-px h-3 bg-[#2A1A14] shrink-0" />

              {/* Quality / Resolution dropdown */}
              <div className="relative shrink-0">
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => { setQualityOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setAzureQualityOpen(false); }}
                  className="flex items-center gap-1"
                >
                  {caps.qualityKey === "resolution" && (
                    <span className="text-[11px] text-[#4A4A45]">Res</span>
                  )}
                  <span className="text-[11px] text-[#8D8E89] hover:text-white transition-colors uppercase">
                    {quality}
                  </span>
                  <ChevronIcon open={qualityOpen} />
                </button>

                {qualityPopup.visible && (
                  <div className={`absolute bottom-full right-0 mb-2 w-36 bg-[#0F1214] border border-[#2A1A14] rounded-md overflow-hidden z-50 shadow-2xl ${qualityPopup.className}`}>
                    {caps.qualityKey === "resolution" && (
                      <div className="px-3 py-1.5 border-b border-[#1E1410]">
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

          {/* Azure quality — shown only when model has Azure options AND Azure provider is selected */}
          {caps.azureQualityOptions && isAzureProvider && (
            <>
              {/* Divider */}
              <span className="w-px h-3 bg-[#2A1A14] shrink-0" />

              <div className="relative shrink-0">
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => { setAzureQualityOpen((o) => !o); setModelOpen(false); setRatioOpen(false); setQualityOpen(false); }}
                  className="flex items-center gap-1"
                  title="Quality (Azure Foundry)"
                >
                  <span className="text-[11px] text-[#8D8E89] hover:text-white transition-colors capitalize">
                    {(data.azureQuality as string | undefined) ?? "auto"}
                  </span>
                  <ChevronIcon open={azureQualityOpen} />
                </button>

                {azureQualityPopup.visible && (
                  <div className={`absolute bottom-full right-0 mb-2 w-36 bg-[#0F1214] border border-[#2A1A14] rounded-md overflow-hidden z-50 shadow-2xl ${azureQualityPopup.className}`}>
                    <div className="px-3 py-1.5 border-b border-[#1E1410]">
                      <span className="text-[9px] text-[#4A4A45] tracking-wider uppercase font-semibold">Azure Quality</span>
                    </div>
                    {[
                      { id: "auto",   meta: "Model default" },
                      { id: "low",    meta: "Faster, cheaper" },
                      { id: "medium", meta: "Balanced" },
                      { id: "high",   meta: "Best quality" },
                    ].map((q) => {
                      const active = ((data.azureQuality as string | undefined) ?? "auto") === q.id;
                      return (
                        <button
                          key={q.id}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={() => { updateNodeData(id, { azureQuality: q.id }); setAzureQualityOpen(false); }}
                          className={`w-full flex items-center justify-between px-3 py-[7px] text-[11px] hover:bg-[#161214] transition-colors ${
                            active ? "text-white" : "text-[#8D8E89]"
                          }`}
                        >
                          <span className="capitalize font-medium">{q.id}</span>
                          <span className="text-[#4A4A45]">{q.meta}</span>
                        </button>
                      );
                    })}
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
            disabled={busy || promptOverLimit}
            className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-[#77E544] transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[rgba(119,229,68,0.13)]"
            style={{ border: "1px solid #2a4a0f", background: "rgba(119,229,68,0.07)" }}
          >
            <svg width="7" height="7" viewBox="0 0 8 8" fill="currentColor"><polygon points="1,0.5 7.5,4 1,7.5" /></svg>
            Generate
          </button>

        </div>


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
            {/* Blur placeholder — pulses while loading, fades out once full-res is ready */}
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
      <path d="M1 2.5 4 5.5 7 2.5"/>
    </svg>
  );
}

