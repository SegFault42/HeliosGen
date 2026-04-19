"use client";
import { useRef, useCallback, useState, useEffect } from "react";
import NextImage from "next/image";
import { Handle, Position, NodeProps, Node, useReactFlow, useUpdateNodeInternals } from "@xyflow/react";
import CornerResizer from "./CornerResizer";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { VIDEO_MODELS } from "@/lib/modelConfig";
import { createClient } from "@/lib/supabase/client";
import { sha256Hex } from "@/lib/assetHash";

type VideoInputNodeType = Node<NodeData, "videoInputNode">;

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB
const IMAGE_HANDLES = new Set(["startFrame", "endFrame", "resource", "image"]);

export default function VideoInputNode({ id, data, selected }: NodeProps<VideoInputNodeType>) {
  const updateNodeData  = useWorkflowStore((s) => s.updateNodeData);
  const edges           = useWorkflowStore((s) => s.edges);
  const nodes           = useWorkflowStore((s) => s.nodes);
  const { deleteElements } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    const raf = requestAnimationFrame(() => updateNodeInternals(id));
    return () => cancelAnimationFrame(raf);
  }, [id, data.videoAspectRatio, updateNodeInternals]);
  const fileRef        = useRef<HTMLInputElement>(null);
  const videoRef       = useRef<HTMLVideoElement>(null);
  const topVideoRef    = useRef<HTMLVideoElement>(null);
  const localUrlRef    = useRef<string | null>(null);
  const rootRef        = useRef<HTMLDivElement>(null);

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

  const [uploading, setUploading]   = useState(false);
  const [uploadErr, setUploadErr]   = useState<string | null>(null);
  const [muted, setMuted]           = useState(true);
  const [hovering, setHovering]     = useState(false);
  const [progress, setProgress]     = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [pickerOpen, setPickerOpen]             = useState(false);
  const [capturing, setCapturing]               = useState(false);
  const [captureErr, setCaptureErr]             = useState<string | null>(null);
  const [scrubPos, setScrubPos]                 = useState(0);
  const [showFramePreview, setShowFramePreview]       = useState(false);
  const [framePreviewVisible, setFramePreviewVisible] = useState(false);
  const [frameBlurVisible, setFrameBlurVisible]       = useState(true);
  const [trimOpen, setTrimOpen]                 = useState(false);
  const [isPlaying, setIsPlaying]               = useState(false);
  const [videoDuration, setVideoDuration]       = useState(0);
  const [localTrimStart, setLocalTrimStart]     = useState(0);
  const [localTrimEnd, setLocalTrimEnd]         = useState(0);

  const videoDurationRef    = useRef(0);
  const localTrimStartRef   = useRef(0);
  const localTrimEndRef     = useRef(0);
  const trimMaxAllowedRef   = useRef<number | undefined>(undefined);
  const trimBarRef          = useRef<HTMLDivElement>(null);

  const trimOpenRef           = useRef(false);
  const committedTrimStartRef = useRef<number | undefined>(undefined);
  const committedTrimEndRef   = useRef<number | undefined>(undefined);
  trimOpenRef.current             = trimOpen;
  committedTrimStartRef.current   = data.trimStart as number | undefined;
  committedTrimEndRef.current     = data.trimEnd   as number | undefined;
  videoDurationRef.current        = videoDuration;
  localTrimStartRef.current       = localTrimStart;
  localTrimEndRef.current         = localTrimEnd;

  // ── Two-layer crossfade: base video keeps playing while new URL loads on top ─
  const videoUrl = data.videoUrl as string | undefined;
  const [baseVideoUrl, setBaseVideoUrl] = useState(videoUrl);
  const [topVideoUrl,  setTopVideoUrl]  = useState<string | undefined>(undefined);
  const [topVideoReady, setTopVideoReady] = useState(false);
  const baseVideoUrlRef = useRef(baseVideoUrl);

  useEffect(() => {
    if (!videoUrl) {
      // Asset removed — reset crossfade state so the empty state renders
      setBaseVideoUrl(undefined);
      baseVideoUrlRef.current = undefined;
      setTopVideoUrl(undefined);
      setTopVideoReady(false);
      return;
    }
    if (videoUrl === baseVideoUrlRef.current) return;
    if (!baseVideoUrlRef.current) {
      setBaseVideoUrl(videoUrl);
      baseVideoUrlRef.current = videoUrl;
      return;
    }
    setTopVideoUrl(videoUrl);
    setTopVideoReady(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  // Uploading: internal loadFile sets `uploading`; canvas drop detected via blob URL
  const isUploading = uploading || !!baseVideoUrl?.startsWith("blob:");

  const fmtTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // Is this node wired to any downstream image handle?
  const imageEdge = edges.find(
    (e) => e.source === id && IMAGE_HANDLES.has(e.targetHandle as string)
  );
  const connectedToImageHandle = !!imageEdge;
  const sourceConnected = edges.some((e) => e.source === id);
  const capturedFrameUrl = data.capturedFrameUrl as string | undefined;
  const capturedFrameRef  = useRef(capturedFrameUrl);
  capturedFrameRef.current = capturedFrameUrl;

  // ── Frame picker ────────────────────────────────────────────────────────────

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
      const w = v.videoWidth  || 1280;
      const h = v.videoHeight || 720;

      // Use a temporary off-screen video via our CORS proxy so the canvas isn't tainted.
      // Blob URLs (local uploads) are same-origin and don't need a proxy.
      const proxyUrl = srcUrl.startsWith("blob:")
        ? srcUrl
        : `/api/video-proxy?url=${encodeURIComponent(srcUrl)}`;

      let blurDataUrl = "";
      const blob: Blob = await new Promise((resolve, reject) => {
        const tmp = document.createElement("video");
        tmp.crossOrigin = "anonymous";
        tmp.muted       = true;
        tmp.preload     = "metadata";
        tmp.src         = proxyUrl;

        const cleanup = () => { tmp.src = ""; tmp.remove(); };

        tmp.addEventListener("error", () => { cleanup(); reject(new Error("Could not load video for capture")); }, { once: true });
        tmp.addEventListener("loadedmetadata", () => { tmp.currentTime = seekTime; }, { once: true });
        tmp.addEventListener("seeked", () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width  = w;
            canvas.height = h;
            canvas.getContext("2d")!.drawImage(tmp, 0, 0, w, h);

            // Generate tiny blur placeholder (16px wide)
            const tw = 16, th = Math.max(1, Math.round(16 * h / w));
            const tiny = document.createElement("canvas");
            tiny.width = tw; tiny.height = th;
            tiny.getContext("2d")!.drawImage(tmp, 0, 0, tw, th);
            blurDataUrl = tiny.toDataURL("image/jpeg", 0.5);

            canvas.toBlob((b) => {
              cleanup();
              if (b) resolve(b);
              else reject(new Error("Canvas capture returned empty"));
            }, "image/jpeg", 0.95);
          } catch (e) {
            cleanup();
            reject(e);
          }
        }, { once: true });
      });

      const bytes = await blob.arrayBuffer();
      const { data: authData } = await createClient().auth.getSession();
      const token = authData.session?.access_token;
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      const res  = await fetch("/api/upload-asset", {
        method: "POST",
        headers: { "Content-Type": "image/jpeg", ...authHeaders },
        body: bytes,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");

      updateNodeData(id, { capturedFrameUrl: json.cdnUrl, capturedFrameBlurUrl: blurDataUrl });
      setPickerOpen(false);
      setShowFramePreview(false);
      videoRef.current?.play().catch(() => {});
    } catch (err) {
      setCaptureErr(err instanceof Error ? err.message : "Capture failed");
    } finally {
      setCapturing(false);
    }
  }, [id, updateNodeData]);

  // Auto-open picker when connected; close picker + unlock when edge is cut
  const imageEdgeId = imageEdge?.id ?? null;
  useEffect(() => {
    if (imageEdgeId && !capturedFrameRef.current) {
      const v = videoRef.current;
      if (v) { v.pause(); setScrubPos(v.currentTime / (v.duration || 1)); }
      setPickerOpen(true);
    }
    if (!imageEdgeId) {
      setPickerOpen(false);
      if (capturedFrameRef.current) updateNodeData(id, { capturedFrameUrl: undefined });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageEdgeId]);

  // ── Video upload ─────────────────────────────────────────────────────────────

  const loadFile = useCallback(async (file: File) => {
    setUploadErr(null);

    if (!file.type.startsWith("video/")) { setUploadErr("Please select a video file"); return; }
    if (file.size > MAX_BYTES) { setUploadErr("Video exceeds the 100 MB limit"); return; }

    const bytes = await file.arrayBuffer();
    const hash  = await sha256Hex(bytes);
    const { data: authData } = await createClient().auth.getSession();
    const token = authData.session?.access_token;
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

    try {
      const lookupRes = await fetch(`/api/lookup-asset?hash=${hash}`, { headers: authHeaders });
      const { cdnUrl: cached } = await lookupRes.json() as { cdnUrl: string | null };
      if (cached) {
        updateNodeData(id, { videoUrl: cached, videoAspectRatio: undefined, capturedFrameUrl: undefined });
        return;
      }
    } catch { /* fall through */ }

    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    const blobUrl = URL.createObjectURL(file);
    localUrlRef.current = blobUrl;
    updateNodeData(id, { videoUrl: blobUrl, videoAspectRatio: undefined, capturedFrameUrl: undefined });
    setUploading(true);

    try {
      const res  = await fetch("/api/upload-asset", {
        method: "POST",
        headers: { "Content-Type": file.type || "video/mp4", ...authHeaders },
        body: bytes,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      URL.revokeObjectURL(blobUrl);
      localUrlRef.current = null;
      updateNodeData(id, { videoUrl: json.cdnUrl });
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [id, updateNodeData]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith("video/")) loadFile(file);
  }, [loadFile]);

  const onHoverPlay  = useCallback(() => setHovering(true), []);
  const onHoverPause = useCallback(() => setHovering(false), []);

  // ── Trim ─────────────────────────────────────────────────────────────────────

  // Returns the strictest max-duration constraint imposed by any connected model, or undefined
  const getConnectedMaxDuration = useCallback((): number | undefined => {
    const outgoingEdges = edges.filter(
      (e) => e.source === id && (e.targetHandle === "resource" || e.targetHandle === "videoRef")
    );
    let strictest: number | undefined;
    for (const edge of outgoingEdges) {
      const target = nodes.find((n) => n.id === edge.target);
      if (target?.type !== "videoGeneratorNode") continue;
      const modelId = (target.data?.videoModel as string | undefined) ?? "kling-3.0";
      const cfg = VIDEO_MODELS.find((m) => m.id === modelId);
      if (!cfg) continue;
      const cap = edge.targetHandle === "videoRef"
        ? cfg.apiInput.videoRefMaxDuration
        : cfg.apiInput.durationMax > 0 ? cfg.apiInput.durationMax : undefined;
      if (cap !== undefined && (strictest === undefined || cap < strictest)) strictest = cap;
    }
    return strictest;
  }, [id, edges, nodes]);

  const openFramePreview = useCallback(() => {
    videoRef.current?.pause();
    setFrameBlurVisible(true);
    setShowFramePreview(true);
    // rAF so the element is painted before the transition starts
    requestAnimationFrame(() => setFramePreviewVisible(true));
  }, []);

  const closeFramePreview = useCallback(() => {
    setFramePreviewVisible(false);
    setTimeout(() => {
      setShowFramePreview(false);
      videoRef.current?.play().catch(() => {});
    }, 240);
  }, []);

  const openTrim = useCallback(() => {
    // Always read duration straight from the DOM — state may not be set yet
    const dur = videoRef.current?.duration || videoDurationRef.current || 0;
    setVideoDuration(dur);
    videoDurationRef.current = dur;

    const cap   = getConnectedMaxDuration();
    const start = (data.trimStart as number | undefined) ?? 0;
    const end   = (data.trimEnd   as number | undefined) ?? dur;
    // Clamp end to cap if constraint exists
    const clampedEnd = cap !== undefined ? Math.min(end || dur, start + cap) : (end || dur);

    trimMaxAllowedRef.current = cap;
    setLocalTrimStart(start);
    setLocalTrimEnd(clampedEnd);
    setPickerOpen(false);
    setShowFramePreview(false);
    videoRef.current?.pause();
    if (videoRef.current) videoRef.current.currentTime = start;
    setTrimOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.trimStart, data.trimEnd, getConnectedMaxDuration]);

  const applyTrim = useCallback(() => {
    updateNodeData(id, { trimStart: localTrimStartRef.current, trimEnd: localTrimEndRef.current });
    trimMaxAllowedRef.current = undefined;
    setTrimOpen(false);
    if (videoRef.current) {
      videoRef.current.currentTime = localTrimStartRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [id, updateNodeData]);

  const resetTrim = useCallback(() => {
    updateNodeData(id, { trimStart: undefined, trimEnd: undefined });

    const dur = videoDurationRef.current;
    const cap = getConnectedMaxDuration();

    if (cap !== undefined && dur > cap) {
      // Video still exceeds the model limit — keep trimmer open with constraint
      trimMaxAllowedRef.current = cap;
      setLocalTrimStart(0);
      setLocalTrimEnd(Math.min(dur, cap));
      if (videoRef.current) videoRef.current.currentTime = 0;
      // trimOpen stays true
    } else {
      trimMaxAllowedRef.current = undefined;
      setTrimOpen(false);
    }
  }, [id, updateNodeData, getConnectedMaxDuration]);

  const cancelTrim = useCallback(() => {
    trimMaxAllowedRef.current = undefined;
    const cap = getConnectedMaxDuration();
    const dur = videoDurationRef.current;
    // If video exceeds the connected model limit and no trim is committed, auto-apply [0, cap]
    if (cap !== undefined && dur > cap && committedTrimStartRef.current === undefined) {
      updateNodeData(id, { trimStart: 0, trimEnd: cap });
    }
    setTrimOpen(false);
    videoRef.current?.play().catch(() => {});
  }, [id, updateNodeData, getConnectedMaxDuration]);

  const startHandleDrag = useCallback((e: React.PointerEvent, which: "start" | "end") => {
    e.preventDefault();
    e.stopPropagation();
    const bar = trimBarRef.current;
    if (!bar) return;

    const MIN_DURATION = 3;
    const onMove = (ev: PointerEvent) => {
      const rect   = bar.getBoundingClientRect();
      const pct    = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const time   = pct * videoDurationRef.current;
      const maxSel = trimMaxAllowedRef.current;
      if (which === "start") {
        let clamped = Math.max(0, Math.min(time, localTrimEndRef.current - MIN_DURATION));
        if (maxSel !== undefined) clamped = Math.max(clamped, localTrimEndRef.current - maxSel);
        setLocalTrimStart(clamped);
        if (videoRef.current) videoRef.current.currentTime = clamped;
      } else {
        let clamped = Math.min(videoDurationRef.current, Math.max(time, localTrimStartRef.current + MIN_DURATION));
        if (maxSel !== undefined) clamped = Math.min(clamped, localTrimStartRef.current + maxSel);
        setLocalTrimEnd(clamped);
        if (videoRef.current) videoRef.current.currentTime = clamped;
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const startSelectionDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const bar = trimBarRef.current;
    if (!bar) return;

    const startX   = e.clientX;
    const barWidth = bar.getBoundingClientRect().width;
    const initStart = localTrimStartRef.current;
    const initEnd   = localTrimEndRef.current;
    const duration  = initEnd - initStart;

    const onMove = (ev: PointerEvent) => {
      const dx      = ev.clientX - startX;
      const dtSec   = (dx / barWidth) * videoDurationRef.current;
      const newStart = Math.max(0, Math.min(initStart + dtSec, videoDurationRef.current - duration));
      const newEnd   = newStart + duration;
      setLocalTrimStart(newStart);
      setLocalTrimEnd(newEnd);
      if (videoRef.current) videoRef.current.currentTime = newStart;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  useEffect(() => {
    const lbl = data.label as string | undefined;
    if (!lbl || lbl === "videoInputNode") updateNodeData(id, { label: "VIDEO #1" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-open trimmer when a connected model requires a shorter video
  useEffect(() => {
    const maxDur = data.triggerTrimMaxDuration as number | undefined;
    if (!maxDur) return;
    // Clear the flag immediately so it doesn't fire again
    updateNodeData(id, { triggerTrimMaxDuration: undefined });

    const dur = videoRef.current?.duration || videoDurationRef.current || 0;
    if (!dur) return;

    trimMaxAllowedRef.current = maxDur;
    setVideoDuration(dur);
    videoDurationRef.current = dur;
    setLocalTrimStart(0);
    setLocalTrimEnd(Math.min(dur, maxDur));
    setPickerOpen(false);
    setShowFramePreview(false);
    videoRef.current?.pause();
    if (videoRef.current) videoRef.current.currentTime = 0;
    setTrimOpen(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.triggerTrimMaxDuration]);


  const hasError    = data.hasError as boolean | undefined;
  const aspectRatio = (data.videoAspectRatio as string | undefined) ?? "16 / 9";

  const handleAnimEnd = (e: React.AnimationEvent) => {
    if (e.animationName === "node-error-blink") updateNodeData(id, { hasError: false });
  };


  /* ── Loaded state — video player ────────────────────────────────────────────── */
  if (baseVideoUrl) {
    return (
      <div
        ref={rootRef}
        className={`node-card group${hasError ? " node-error-blink" : ""}`}
        style={{ width: "100%", aspectRatio }}
        onAnimationEnd={handleAnimEnd}
      >
        <CornerResizer minWidth={160} minHeight={80} keepAspectRatio />
        <span className="node-above-label">{data.label as string}</span>
        <Handle type="source" position={Position.Right} className={`node-handle node-handle-video${sourceConnected ? " node-handle-connected" : ""}`} />

        <div
          className="relative w-full h-full overflow-hidden rounded-[7px] group/player"
          onMouseEnter={onHoverPlay}
          onMouseLeave={onHoverPause}
        >
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            src={baseVideoUrl}
            className="w-full h-full block"
            style={{
              objectFit: "fill",
              animation: isUploading ? "upload-pulse 1.6s ease-in-out infinite" : undefined,
            }}
            autoPlay
            muted={trimOpen ? false : (muted || !hovering)}
            playsInline
            preload="metadata"
            loop
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              const dur = v.duration || 0;
              updateNodeData(id, {
                ...(v.videoWidth && v.videoHeight ? { videoAspectRatio: `${v.videoWidth} / ${v.videoHeight}` } : {}),
                videoDuration: dur,
              });
              setVideoDuration(dur);
              videoDurationRef.current = dur;
              // Seek to trim start so autoPlay begins within the selection
              const tStart = committedTrimStartRef.current;
              if (tStart !== undefined && tStart > 0) v.currentTime = tStart;
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              setCurrentSec(v.currentTime);
              if (v.duration) {
                const pct = v.currentTime / v.duration;
                setProgress(pct);
                if (pickerOpen) setScrubPos(pct);
                // Loop within trim range (live refs in trim mode, committed refs otherwise)
                const tEnd   = trimOpenRef.current ? localTrimEndRef.current   : committedTrimEndRef.current;
                const tStart = trimOpenRef.current ? localTrimStartRef.current : committedTrimStartRef.current;
                if (tEnd !== undefined && v.currentTime >= tEnd) {
                  v.currentTime = tStart ?? 0;
                } else if (!trimOpenRef.current && tStart !== undefined && v.currentTime < tStart) {
                  // Jumped behind trim start (e.g. seek via progress bar) — snap forward
                  v.currentTime = tStart;
                }
              }
            }}
          />

          {/* Top video layer — new URL loads here at opacity 0, fades in, then promotes to base */}
          {topVideoUrl && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              ref={topVideoRef}
              src={topVideoUrl}
              autoPlay
              muted
              playsInline
              loop
              onCanPlay={() => {
                // Sync playback position, then trigger fade-in
                const base = videoRef.current;
                const top  = topVideoRef.current;
                if (base && top && base.duration) top.currentTime = base.currentTime;
                requestAnimationFrame(() => requestAnimationFrame(() => setTopVideoReady(true)));
              }}
              onTransitionEnd={() => {
                const oldBase = baseVideoUrlRef.current;
                setBaseVideoUrl(topVideoUrl);
                baseVideoUrlRef.current = topVideoUrl;
                setTopVideoUrl(undefined);
                setTopVideoReady(false);
                if (oldBase?.startsWith("blob:")) URL.revokeObjectURL(oldBase);
              }}
              style={{
                position: "absolute", inset: 0, zIndex: 2,
                width: "100%", height: "100%",
                objectFit: "fill", display: "block",
                opacity: topVideoReady ? 1 : 0,
                transition: "opacity 450ms ease",
                pointerEvents: "none",
              }}
            />
          )}

          {/* ── Normal player controls (hidden while picker is open) ── */}
          {!pickerOpen && !trimOpen && (
            <>
              {/* Timer badge */}
              <div className="absolute top-2 left-2 h-7 px-2 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/player:opacity-100 transition-opacity z-10 pointer-events-none">
                <span className="text-[11px] text-white font-mono tabular-nums">{fmtTime(currentSec)}</span>
              </div>

              {/* Mute button */}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/player:opacity-100 transition-opacity pointer-events-auto z-10"
                title={muted ? "Unmute" : "Mute"}
              >
                {muted ? (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                )}
              </button>

              {/* Progress bar */}
              {(() => {
                const tStart = data.trimStart as number | undefined;
                const tEnd   = data.trimEnd   as number | undefined;
                const dur    = videoDuration;
                const hasTrim = tStart !== undefined && tEnd !== undefined && dur > 0;
                const startPct = hasTrim ? (tStart! / dur) * 100 : 0;
                const endPct   = hasTrim ? (tEnd!   / dur) * 100 : 100;
                return (
                  <div
                    className="absolute bottom-0 left-0 right-0 h-[3px] opacity-0 group-hover/player:opacity-100 transition-opacity"
                    style={{ background: hasTrim ? "transparent" : "rgba(255,255,255,0.10)", cursor: "pointer" }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const v = videoRef.current;
                      if (v && v.duration) v.currentTime = ((e.clientX - rect.left) / rect.width) * v.duration;
                    }}
                  >
                    {hasTrim ? (
                      <>
                        {/* Pre-trim — invisible */}
                        {/* Played portion of selection — bright white */}
                        <div className="absolute inset-y-0" style={{ left: `${startPct}%`, width: `${Math.max(0, progress * 100 - startPct)}%`, background: "rgba(255,255,255,0.85)" }} />
                        {/* Unplayed portion of selection */}
                        <div className="absolute inset-y-0" style={{ left: `${Math.max(startPct, progress * 100)}%`, width: `${Math.max(0, endPct - Math.max(startPct, progress * 100))}%`, background: "rgba(255,255,255,0.40)" }} />
                        {/* Post-trim — invisible */}
                      </>
                    ) : (
                      <div className="absolute inset-y-0 left-0 bg-white/70" style={{ width: `${progress * 100}%` }} />
                    )}
                  </div>
                );
              })()}

              {/* Hover controls row */}
              {!capturedFrameUrl && (
                <div className="absolute bottom-2 left-0 right-0 flex justify-center items-center px-2.5 opacity-0 group-hover/player:opacity-100 transition-opacity z-10">
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => fileRef.current?.click()}
                    className="h-6 px-3 rounded-full bg-black/50 backdrop-blur-sm border border-white/10 text-[10px] text-[#CCCCCC] hover:text-white hover:bg-black/70 transition-colors pointer-events-auto"
                  >replace</button>
                </div>
              )}

              {/* Trim button — bottom-right icon pill, above frame preview if present */}
              {!isUploading && (
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); openTrim(); }}
                  className={`absolute right-2 w-7 h-7 rounded-full backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/player:opacity-100 transition-opacity pointer-events-auto z-10 ${data.trimStart !== undefined ? "bg-amber-400/80 hover:bg-amber-400" : "bg-black/40 hover:bg-black/60"}`}
                  style={{ bottom: capturedFrameUrl ? "calc(0.5rem + 1.75rem + 0.375rem)" : "0.5rem" }}
                  title="Trim video"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={data.trimStart !== undefined ? "black" : "white"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
                    <line x1="20" y1="4" x2="8.12" y2="15.88" />
                    <line x1="14.47" y1="14.48" x2="20" y2="20" />
                    <line x1="8.12" y1="8.12" x2="12" y2="12" />
                  </svg>
                </button>
              )}

              {/* "Pick a frame" CTA — shown on hover when connected but not locked */}
              {connectedToImageHandle && !capturedFrameUrl && (
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); openPicker(); }}
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/player:opacity-100 transition-opacity pointer-events-auto z-10"
                >
                  <span className="flex items-center gap-1.5 h-7 px-3 rounded-full bg-black/50 backdrop-blur-sm text-[11px] text-white font-medium">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                      <circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 3" />
                    </svg>
                    Pick a frame
                  </span>
                </button>
              )}

              {/* Captured frame preview icon — bottom-right, shown on hover */}
              {capturedFrameUrl && (
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); openFramePreview(); }}
                  className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/player:opacity-100 transition-opacity pointer-events-auto z-10"
                  title="View captured frame"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                  </svg>
                </button>
              )}
            </>
          )}

          {/* ── Trim overlay — bottom strip ───────────────────────────── */}
          {trimOpen && (
            <div
              className="nodrag absolute bottom-0 left-0 right-0 z-20 px-2.5 pb-2.5 pt-1.5 flex flex-col gap-1.5"
              style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.75) 30%)" }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Row: play button + trim bar */}
              <div className="flex items-center gap-2">
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    const v = videoRef.current;
                    if (!v) return;
                    if (v.paused) v.play().catch(() => {}); else v.pause();
                  }}
                  className="nodrag w-6 h-6 flex items-center justify-center shrink-0 text-white/80 hover:text-white"
                >
                  {isPlaying ? (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                    </svg>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  )}
                </button>

                <div
                  ref={trimBarRef}
                  className="relative flex-1 h-5 rounded-sm overflow-visible"
                  style={{ background: "rgba(255,255,255,0.12)" }}
                >
                  {videoDuration > 0 && (
                    <>
                      {/* Amber border — draggable middle */}
                      <div
                        className="absolute inset-y-0 rounded-sm cursor-grab active:cursor-grabbing touch-none select-none"
                        style={{
                          left:   `${(localTrimStart / videoDuration) * 100}%`,
                          right:  `${100 - (localTrimEnd / videoDuration) * 100}%`,
                          border: "1.5px solid #FBBF24",
                        }}
                        onPointerDown={startSelectionDrag}
                      />

                      {/* Left handle (invisible hit area) */}
                      <div
                        className="absolute top-0 bottom-0 cursor-ew-resize touch-none select-none z-10"
                        style={{ left: `${(localTrimStart / videoDuration) * 100}%`, transform: "translateX(-50%)", width: 14 }}
                        onPointerDown={(e) => startHandleDrag(e, "start")}
                      />

                      {/* Right handle (invisible hit area) */}
                      <div
                        className="absolute top-0 bottom-0 cursor-ew-resize touch-none select-none z-10"
                        style={{ left: `${(localTrimEnd / videoDuration) * 100}%`, transform: "translateX(-50%)", width: 14 }}
                        onPointerDown={(e) => startHandleDrag(e, "end")}
                      />

                      {/* Playhead */}
                      <div
                        className="absolute top-0 bottom-0 w-[1.5px] bg-white pointer-events-none"
                        style={{ left: `${(currentSec / videoDuration) * 100}%` }}
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Row: times + action buttons */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-amber-400 font-mono">{fmtTime(localTrimStart)} – {fmtTime(localTrimEnd)}</span>
                <div className="flex gap-1.5">
                  {data.trimStart !== undefined && (
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); resetTrim(); }}
                      className="nodrag h-5 px-2 rounded-full bg-white/10 text-white text-[10px] flex items-center cursor-pointer"
                    >Reset</button>
                  )}
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); cancelTrim(); }}
                    className="nodrag h-5 px-2 rounded-full bg-white/10 text-white text-[10px] flex items-center cursor-pointer"
                  >Cancel</button>
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); applyTrim(); }}
                    className="nodrag h-5 px-2 rounded-full text-black text-[10px] font-semibold flex items-center cursor-pointer"
                    style={{ background: "#FBBF24" }}
                  >Apply</button>
                </div>
              </div>
            </div>
          )}

          {/* ── Captured frame preview ───────────────────────────────── */}
          {capturedFrameUrl && showFramePreview && (
            <div
              className="absolute inset-0 z-20 bg-black"
              style={{
                opacity:    framePreviewVisible ? 1 : 0,
                transform:  framePreviewVisible ? "scale(1)" : "scale(1.03)",
                transition: "opacity 220ms ease, transform 220ms ease",
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Layer 1: optimized image (loads in background) */}
              {capturedFrameUrl.startsWith("https://") ? (
                <NextImage
                  src={capturedFrameUrl}
                  alt="Captured frame"
                  fill
                  quality={30}
                  sizes="400px"
                  onLoad={() => setFrameBlurVisible(false)}
                  style={{ objectFit: "fill" }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={capturedFrameUrl} alt="Captured frame" className="w-full h-full" style={{ objectFit: "fill" }} />
              )}

              {/* Layer 2: blur overlay — fades out once optimized image loads */}
              {(data.capturedFrameBlurUrl as string | undefined) && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage:    `url(${data.capturedFrameBlurUrl})`,
                    backgroundSize:     "100% 100%",
                    filter:             "blur(20px)",
                    opacity:            frameBlurVisible ? 1 : 0,
                    transition:         "opacity 300ms ease",
                  }}
                />
              )}

              {/* Close — top right */}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); closeFramePreview(); }}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center pointer-events-auto z-10"
                title="Back to video"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>

              {/* Retake — bottom center */}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowFramePreview(false);
                  const v = videoRef.current;
                  if (v) { v.pause(); setScrubPos(v.currentTime / (v.duration || 1)); }
                  setPickerOpen(true);
                }}
                className="absolute bottom-3 left-1/2 -translate-x-1/2 h-7 px-4 rounded-full bg-white/90 text-black text-[11px] font-semibold flex items-center gap-1.5 pointer-events-auto z-10"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" /><path d="M20 7h-3.2L15 5H9L7.2 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
                </svg>
                Retake
              </button>
            </div>
          )}

          {/* ── Frame picker overlay ─────────────────────────────────── */}
          {pickerOpen && (
            <div
              className="nodrag absolute inset-0 flex flex-col z-20 bg-black/50"
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
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
                      if (imageEdgeId) deleteElements({ edges: [{ id: imageEdgeId }] });
                    }}
                    className="nodrag h-7 px-3 rounded-full bg-white/10 text-white text-[11px] flex items-center justify-center cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Upload overlay */}
          {uploading && (
            <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2 pointer-events-none">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" style={{ animation: "spin 0.9s linear infinite" }}>
                <circle cx="11" cy="11" r="8" stroke="#333" strokeWidth="2.5" />
                <path d="M11 3A8 8 0 0 1 19 11" stroke="#22d3ee" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              <span className="text-[10px] text-[#22d3ee]">Uploading…</span>
            </div>
          )}

          {uploadErr && !uploading && (
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-2 py-1 text-[10px] text-red-400 text-center">
              {uploadErr}
            </div>
          )}
        </div>

        <input ref={fileRef} type="file" accept="video/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }} />
      </div>
    );
  }

  /* ── Empty state ──────────────────────────────────────────────────────────── */
  return (
    <div
      ref={rootRef}
      className={`node-card w-full${hasError ? " node-error-blink" : ""}`}
      style={{ minWidth: 200 }}
      onAnimationEnd={handleAnimEnd}
    >
      <CornerResizer minWidth={160} minHeight={100} />
      <span className="node-above-label">{data.label as string}</span>
      <Handle type="source" position={Position.Right} className={`node-handle node-handle-video${sourceConnected ? " node-handle-connected" : ""}`} />

      <div className="overflow-hidden rounded-[7px] p-2.5">
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className="border border-dashed border-[#22d3ee]/20 hover:border-[#22d3ee]/40 rounded-md cursor-pointer transition-colors py-8 text-center"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" className="mx-auto mb-2 opacity-40">
            <rect width="18" height="14" x="3" y="5" rx="2" />
            <path d="m16 10-4-2.5v5L16 10z" fill="#22d3ee" stroke="none" />
          </svg>
          <p className="text-[11px] text-[#8D8E89]">Drop video or{" "}<span className="underline underline-offset-2 text-white">browse</span></p>
          <p className="text-[10px] text-[#4A4A45] mt-1">Max 100 MB</p>
        </div>
        {uploadErr && <p className="text-[10px] text-red-400 mt-1.5 text-center">{uploadErr}</p>}
      </div>

      <input ref={fileRef} type="file" accept="video/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); e.target.value = ""; }} />
    </div>
  );
}
