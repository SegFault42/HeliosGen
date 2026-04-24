"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";
import type { User } from "@supabase/supabase-js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GalleryItem {
  id: string;
  url: string;
  mediaType: "image" | "video";
  prompt?: string;
  model?: string;
  aspect_ratio?: string;
  quality?: string;
  source: "generation" | "upload";
  created_at: string;
}

type Tab = "images" | "videos";

// ── Auth helper ───────────────────────────────────────────────────────────────

async function getToken(): Promise<string | undefined> {
  const { data } = await createClient().auth.getSession();
  return data.session?.access_token;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GalleryPage() {
  const [tab, setTab]       = useState<Tab>("images");
  const [user, setUser]     = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  const [items, setItems]         = useState<GalleryItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]     = useState(true);
  const [lightboxItem, setLightboxItem] = useState<GalleryItem | null>(null);

  // Generate bar state
  const isVideo = tab === "videos";
  const models  = isVideo ? VIDEO_MODELS : IMAGE_MODELS;

  const [prompt, setPrompt]           = useState("");
  const [modelId, setModelId]         = useState<string>(IMAGE_MODELS[0].id);
  const [aspectRatio, setAspectRatio] = useState<string>(IMAGE_MODELS[0].ratios[0]);
  const [quality, setQuality]         = useState<string>("2k");
  const [duration, setDuration]       = useState<number>(5);
  const [mode, setMode]               = useState<string>("");
  const [generating, setGenerating]   = useState(false);
  const [genMsg, setGenMsg]           = useState<string>("");
  const [genError, setGenError]       = useState<string>("");

  const pageRef    = useRef(0);
  const tabRef     = useRef<Tab>("images");
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthLoaded(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Load items ────────────────────────────────────────────────────────────

  const loadItems = useCallback(async (currentTab: Tab, page: number, replace = false) => {
    const token = await getToken();
    if (!token) return;

    if (replace) setLoading(true); else setLoadingMore(true);

    try {
      const genType = currentTab === "videos" ? "video" : "image";
      const res = await fetch(`/api/gallery?type=${genType}&page=${page}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const { items: newItems, hasMore: more } = await res.json() as { items: GalleryItem[]; hasMore: boolean };
      setItems(prev => replace ? newItems : [...prev, ...newItems]);
      setHasMore(more);
      pageRef.current = page;
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  // Load after auth resolves
  useEffect(() => {
    if (authLoaded && user) loadItems(tab, 0, true);
    if (authLoaded && !user) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoaded]);

  // Reload on tab change
  useEffect(() => {
    tabRef.current = tab;
    pageRef.current = 0;
    setItems([]);
    setHasMore(true);
    if (user) loadItems(tab, 0, true);

    // Reset model + defaults for new tab
    const newModels = tab === "videos" ? VIDEO_MODELS : IMAGE_MODELS;
    const first = newModels[0];
    setModelId(first.id);
    setAspectRatio(("defaultRatio" in first ? first.defaultRatio : null) ?? first.ratios[0] ?? "16:9");
    if ("defaultDuration" in first) setDuration(first.defaultDuration ?? 5);
    if ("defaultMode" in first) setMode(first.defaultMode ?? "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Sync model defaults when model changes
  useEffect(() => {
    const m = models.find(m => m.id === modelId);
    if (!m) return;
    setAspectRatio(("defaultRatio" in m ? m.defaultRatio : null) ?? m.ratios[0] ?? "1:1");
    if ("defaultDuration" in m) setDuration(m.defaultDuration ?? 5);
    if ("defaultMode" in m) setMode(m.defaultMode ?? "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
        loadItems(tabRef.current, pageRef.current + 1);
      }
    }, { rootMargin: "400px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, loadItems]);

  // ── Generate ──────────────────────────────────────────────────────────────

  const generate = async () => {
    if (!prompt.trim() && !isVideo) return;
    const token = await getToken();
    if (!token) { setGenError("Please sign in to generate."); return; }

    setGenerating(true);
    setGenMsg("Submitting…");
    setGenError("");

    try {
      let taskId: string;

      if (!isVideo) {
        const res = await fetch("/api/generate", {
          method:  "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body:    JSON.stringify({ prompt, model: modelId, aspectRatio, quality }),
        });
        const d = await res.json() as { taskId?: string; error?: string };
        if (!res.ok) throw new Error(d.error ?? "Failed");
        taskId = d.taskId!;
      } else {
        const vm = VIDEO_MODELS.find(m => m.id === modelId);
        const res = await fetch("/api/generate-video", {
          method:  "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body:    JSON.stringify({
            videoModel:  modelId,
            prompt,
            aspectRatio,
            duration,
            mode:        mode || vm?.defaultMode || "pro",
            resolution:  vm && "defaultResolution" in vm ? vm.defaultResolution : undefined,
          }),
        });
        const d = await res.json() as { taskId?: string; error?: string };
        if (!res.ok) throw new Error(d.error ?? "Failed");
        taskId = d.taskId!;
      }

      // Poll until done
      setGenMsg("Generating…");
      for (let i = 0; i < 150; i++) {
        await new Promise(r => setTimeout(r, 3_000));
        const poll   = await fetch(`/api/job-status?taskId=${taskId}`);
        const result = await poll.json() as { status: string; error?: string };

        if (result.status === "done") {
          setGenMsg("");
          await loadItems(tabRef.current, 0, true);
          break;
        }
        if (result.status === "error") throw new Error(result.error ?? "Generation failed");
        if (i > 0 && i % 5 === 0) setGenMsg(`Generating… (${Math.round(i * 3)}s)`);
      }
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : String(e));
      setTimeout(() => setGenError(""), 6_000);
    } finally {
      setGenerating(false);
      setGenMsg("");
    }
  };

  // ── Derived model config ──────────────────────────────────────────────────

  const imgModel   = IMAGE_MODELS.find(m => m.id === modelId);
  const vidModel   = VIDEO_MODELS.find(m => m.id === modelId);
  const ratios     = (isVideo ? vidModel?.ratios : imgModel?.ratios) ?? [];
  const supportsQ  = !isVideo && !!imgModel?.supportsQuality;
  const qualityOpts = imgModel?.apiInput.qualityOptions ?? ["2k", "4k"];
  const durations  = vidModel?.durations ?? [];
  const vidModes   = vidModel?.modes ?? [];

  // ── Render ────────────────────────────────────────────────────────────────

  if (!authLoaded) return <div style={{ height: "100vh", background: "#080A0C" }} />;

  if (!user) {
    return (
      <div style={{ height: "100vh", background: "#080A0C", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px" }}>
        <p style={{ color: "#4A4A45", fontSize: "14px" }}>Sign in to view your gallery</p>
        <Link href="/" style={{ color: "#8D8E89", fontSize: "13px", textDecoration: "none", padding: "6px 14px", border: "1px solid #222", borderRadius: "7px" }}>
          Back to canvas
        </Link>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", background: "#080A0C", display: "flex", flexDirection: "column", overflow: "hidden", color: "#fff" }}>

      {/* ── Top nav ─────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        flexShrink: 0,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}>
        {/* Tab switcher */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "2px",
          background: "rgba(255,255,255,0.04)",
          borderRadius: "8px",
          padding: "3px",
        }}>
          {(["images", "videos"] as Tab[]).map((t) => (
            <TabBtn key={t} active={tab === t} onClick={() => setTab(t)}>
              {t === "images" ? "Images" : "Videos"}
            </TabBtn>
          ))}
        </div>

        {/* Canvas link */}
        <Link href="/" style={{
          color: "#3A3A38",
          fontSize: "12px",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: "5px",
          transition: "color 150ms",
          padding: "4px 0",
        }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#8D8E89"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#3A3A38"; }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M9 21V9" />
          </svg>
          Canvas
        </Link>
      </div>

      {/* ── Grid ────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: "132px" }}>
        {loading ? null : items.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div className="gallery-masonry">
            {generating && (
              <div className="gallery-item gallery-item-pending">
                <div className="gallery-shimmer" />
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "12px" }}>
                  <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginBottom: "4px" }}>{genMsg || "Generating…"}</p>
                  {prompt && <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{prompt}</p>}
                </div>
              </div>
            )}
            {items.map((item) => (
              <GalleryItem key={item.id} item={item} onOpen={item.mediaType === "image" ? () => setLightboxItem(item) : undefined} />
            ))}
          </div>
        )}

        <div ref={sentinelRef} style={{ height: "1px" }} />
      </div>

      {/* ── Prompt bar ──────────────────────────────────────────────────── */}
      <div style={{
        position: "fixed",
        bottom: "18px",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(820px, calc(100vw - 32px))",
        zIndex: 200,
      }}>
        {/* Error / status toast */}
        {(genError || (genMsg && !generating)) && (
          <div style={{
            marginBottom: "8px",
            padding: "8px 14px",
            background: genError ? "rgba(248,113,113,0.1)" : "rgba(119,229,68,0.08)",
            border: `1px solid ${genError ? "rgba(248,113,113,0.2)" : "rgba(119,229,68,0.15)"}`,
            borderRadius: "10px",
            fontSize: "12px",
            color: genError ? "#f87171" : "#77E544",
          }}>
            {genError || genMsg}
          </div>
        )}

        <div style={{
          background: "rgba(10,12,14,0.96)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "16px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.85), 0 4px 16px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}>
          {/* Input row */}
          <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: "10px" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !generating) { e.preventDefault(); generate(); } }}
              placeholder={isVideo ? "Describe the video you imagine…" : "Describe the scene you imagine…"}
              disabled={generating}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#e0e0e0",
                fontSize: "14px",
                fontFamily: "inherit",
                caretColor: "#77E544",
              }}
            />
          </div>

          {/* Controls row */}
          <div style={{
            padding: "6px 14px 12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}>
            {/* Model */}
            <BarSelect
              value={modelId}
              onChange={setModelId}
              disabled={generating}
              icon={
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8M12 17v4" />
                </svg>
              }
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </BarSelect>

            {/* Quality (image only) */}
            {supportsQ && (
              <BarSelect value={quality} onChange={setQuality} disabled={generating}>
                {qualityOpts.map((q) => (
                  <option key={q} value={q}>{q.toUpperCase()}</option>
                ))}
              </BarSelect>
            )}

            {/* Aspect ratio */}
            {ratios.length > 0 && (
              <BarSelect value={aspectRatio} onChange={setAspectRatio} disabled={generating}>
                {ratios.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </BarSelect>
            )}

            {/* Duration (video only) */}
            {isVideo && durations.length > 0 && (
              <BarSelect value={String(duration)} onChange={(v) => setDuration(Number(v))} disabled={generating}>
                {durations.map((d) => (
                  <option key={d} value={d}>{d}s</option>
                ))}
              </BarSelect>
            )}

            {/* Mode (video only, if model has modes) */}
            {isVideo && vidModes.length > 0 && (
              <BarSelect value={mode} onChange={setMode} disabled={generating}>
                {vidModes.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </BarSelect>
            )}

            <div style={{ flex: 1 }} />

            {/* Generate button */}
            <button
              onClick={generate}
              disabled={generating || (!prompt.trim() && !isVideo)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "7px",
                padding: "8px 18px",
                borderRadius: "10px",
                border: "none",
                background: "#77E544",
                color: "#060A06",
                fontSize: "13px",
                fontWeight: 600,
                cursor: generating || (!prompt.trim() && !isVideo) ? "not-allowed" : "pointer",
                opacity: generating || (!prompt.trim() && !isVideo) ? 0.5 : 1,
                transition: "opacity 150ms, background 150ms",
                fontFamily: "inherit",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { if (!generating) e.currentTarget.style.background = "#8FEE60"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#77E544"; }}
            >
              {generating ? (
                <>
                  <span style={{
                    width: "11px", height: "11px",
                    borderRadius: "50%",
                    border: "2px solid rgba(6,10,6,0.25)",
                    borderTopColor: "#060A06",
                    display: "inline-block",
                    animation: "spin 0.75s linear infinite",
                  }} />
                  {genMsg || "Generating"}
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  Generate
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Spinner keyframe */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer {
          0%   { background-position: -400px 0; }
          100% { background-position:  400px 0; }
        }
        .gallery-masonry {
          columns: 2;
          column-gap: 3px;
          padding: 3px;
        }
        @media (min-width: 640px)  { .gallery-masonry { columns: 3; } }
        @media (min-width: 900px)  { .gallery-masonry { columns: 4; } }
        @media (min-width: 1400px) { .gallery-masonry { columns: 5; } }
        .gallery-item {
          break-inside: avoid;
          margin-bottom: 3px;
          position: relative;
          overflow: hidden;
          cursor: pointer;
          background: #111416;
          display: block;
        }
        .gallery-item-pending {
          aspect-ratio: 16 / 9;
        }
        .gallery-shimmer {
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, #111416 25%, #1a1d20 50%, #111416 75%);
          background-size: 800px 100%;
          animation: shimmer 1.6s infinite linear;
        }
        .gallery-item img,
        .gallery-item video {
          display: block;
          width: 100%;
          height: auto;
        }
        .gallery-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 55%);
          opacity: 0;
          transition: opacity 180ms ease;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          padding: 10px;
        }
        .gallery-item:hover .gallery-overlay { opacity: 1; }
        .gallery-play-icon {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: rgba(0,0,0,0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transition: opacity 180ms ease;
          pointer-events: none;
        }
        .gallery-item:hover .gallery-play-icon { opacity: 1; }
      `}</style>

      {/* Lightbox */}
      {lightboxItem && (
        <Lightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      )}
    </div>
  );
}

// ── Gallery item ──────────────────────────────────────────────────────────────

function GalleryItem({ item, onOpen }: { item: GalleryItem; onOpen?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying]     = useState(false);
  const [failed, setFailed]       = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const isVideo = item.mediaType === "video";

  // Convert "16:9" → "16 / 9" for CSS aspect-ratio
  const cssRatio = (() => {
    const ar = item.aspect_ratio;
    if (!ar || ar === "auto") return null;
    const [w, h] = ar.split(":");
    return w && h ? `${w} / ${h}` : null;
  })();

  const handleMouseEnter = () => {
    if (!isVideo || !videoRef.current) return;
    videoRef.current.play().then(() => setPlaying(true)).catch(() => {});
  };
  const handleMouseLeave = () => {
    if (!isVideo || !videoRef.current) return;
    videoRef.current.pause();
    videoRef.current.currentTime = 0;
    setPlaying(false);
  };

  if (failed) {
    return (
      <div className="gallery-item" style={{ aspectRatio: cssRatio ?? "1 / 1", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5" strokeLinecap="round"><path d="M3 3l18 18M10.5 10.677A4.992 4.992 0 0 0 12 17a5 5 0 0 0 5-5 4.992 4.992 0 0 0-.677-2.5" /><path d="M12 7a5 5 0 0 1 5 5" /></svg>
      </div>
    );
  }

  return (
    <div
      className="gallery-item"
      style={cssRatio ? { aspectRatio: cssRatio } : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onOpen}
    >
      {isVideo ? (
        <>
          <video
            ref={videoRef}
            src={item.url}
            muted
            loop
            playsInline
            preload="metadata"
            onError={() => setFailed(true)}
          />
          {!playing && (
            <div className="gallery-play-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" stroke="none">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Shimmer placeholder — fills the aspect-ratio box while image loads */}
          {!imgLoaded && <div className="gallery-shimmer" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/_next/image?url=${encodeURIComponent(item.url)}&w=828&q=75`}
            alt={item.prompt ?? ""}
            loading="lazy"
            decoding="async"
            onLoad={() => setImgLoaded(true)}
            onError={() => setFailed(true)}
            style={{
              display: "block",
              width: "100%",
              height: "auto",
              opacity: imgLoaded ? 1 : 0,
              transition: "opacity 280ms ease",
            }}
          />
        </>
      )}

      {/* Hover overlay */}
      <div className="gallery-overlay">
        {item.prompt && (
          <p style={{
            fontSize: "11px",
            color: "rgba(255,255,255,0.85)",
            lineHeight: 1.45,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            marginBottom: "4px",
          }}>
            {item.prompt}
          </p>
        )}
        <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)" }}>
          {[item.model, item.aspect_ratio].filter(Boolean).join(" · ") || (item.source === "upload" ? "Uploaded" : "")}
        </p>
      </div>
    </div>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({ item, onClose }: { item: GalleryItem; onClose: () => void }) {
  const [visible, setVisible]       = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false);

  // Fade in on mount
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const meta = [item.model, item.aspect_ratio, item.quality?.toUpperCase()]
    .filter(Boolean).join(" · ");

  return createPortal(
    <div
      onClick={handleClose}
      style={{
        position:        "fixed",
        inset:           0,
        zIndex:          9999,
        display:         "flex",
        flexDirection:   "column",
        alignItems:      "center",
        justifyContent:  "center",
        background:      `rgba(0,0,0,${visible ? 0.88 : 0})`,
        backdropFilter:  visible ? "blur(12px)" : "none",
        WebkitBackdropFilter: visible ? "blur(12px)" : "none",
        transition:      "background 200ms ease, backdrop-filter 200ms ease",
        padding:         "24px",
      }}
    >
      {/* Image container */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position:   "relative",
          maxWidth:   "min(1200px, calc(100vw - 48px))",
          maxHeight:  "calc(100vh - 120px)",
          transform:  visible ? "scale(1)" : "scale(0.96)",
          transition: "transform 200ms ease",
          borderRadius: "10px",
          overflow:   "hidden",
          boxShadow:  "0 32px 80px rgba(0,0,0,0.8)",
        }}
      >
        {/* Blurred low-res placeholder while full-res loads */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/_next/image?url=${encodeURIComponent(item.url)}&w=828&q=75`}
          alt=""
          aria-hidden
          style={{
            display:    "block",
            maxWidth:   "min(1200px, calc(100vw - 48px))",
            maxHeight:  "calc(100vh - 120px)",
            width:      "100%",
            height:     "auto",
            objectFit:  "contain",
            filter:     fullLoaded ? "none" : "blur(12px)",
            transform:  fullLoaded ? "scale(1)" : "scale(1.04)",
            transition: "filter 320ms ease, transform 320ms ease",
          }}
        />
        {/* Full-res image on top */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.url}
          alt={item.prompt ?? ""}
          onLoad={() => setFullLoaded(true)}
          style={{
            position:  "absolute",
            inset:     0,
            display:   "block",
            width:     "100%",
            height:    "100%",
            objectFit: "contain",
            opacity:   fullLoaded ? 1 : 0,
            transition: "opacity 320ms ease",
          }}
        />
      </div>

      {/* Meta row below image */}
      {(item.prompt || meta) && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            marginTop:  "14px",
            maxWidth:   "min(1200px, calc(100vw - 48px))",
            width:      "100%",
            opacity:    visible ? 1 : 0,
            transition: "opacity 250ms ease 100ms",
          }}
        >
          {item.prompt && (
            <p style={{
              fontSize:   "13px",
              color:      "rgba(255,255,255,0.6)",
              lineHeight: 1.5,
              marginBottom: meta ? "5px" : 0,
              overflow:   "hidden",
              display:    "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}>
              {item.prompt}
            </p>
          )}
          {meta && (
            <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>
              {meta}
            </p>
          )}
        </div>
      )}

      {/* Close button */}
      <button
        onClick={handleClose}
        style={{
          position:    "fixed",
          top:         "16px",
          right:       "16px",
          width:       "34px",
          height:      "34px",
          borderRadius: "50%",
          border:      "1px solid rgba(255,255,255,0.1)",
          background:  "rgba(0,0,0,0.5)",
          color:       "rgba(255,255,255,0.6)",
          cursor:      "pointer",
          display:     "flex",
          alignItems:  "center",
          justifyContent: "center",
          opacity:     visible ? 1 : 0,
          transition:  "opacity 200ms ease, background 150ms",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,0,0,0.5)"; }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>,
    document.body,
  );
}

// ── Small components ──────────────────────────────────────────────────────────

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 14px",
        borderRadius: "6px",
        border: "none",
        background: active ? "rgba(255,255,255,0.09)" : "transparent",
        color: active ? "#e0e0e0" : "#4A4A45",
        fontSize: "13px",
        fontWeight: 500,
        cursor: "pointer",
        transition: "background 150ms, color 150ms",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function BarSelect({
  value,
  onChange,
  disabled,
  children,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "5px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "7px", padding: "0 8px", height: "30px" }}>
      {icon && <span style={{ color: "#4A4A45", flexShrink: 0, display: "flex" }}>{icon}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          background: "transparent",
          border: "none",
          outline: "none",
          color: "#8D8E89",
          fontSize: "12px",
          fontFamily: "inherit",
          cursor: disabled ? "not-allowed" : "pointer",
          padding: 0,
          appearance: "none",
          WebkitAppearance: "none",
          minWidth: "60px",
          maxWidth: "160px",
        }}
      >
        {children}
      </select>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, pointerEvents: "none" }}>
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "320px", gap: "10px" }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#252523" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        {tab === "images" ? (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </>
        ) : (
          <>
            <rect x="2" y="5" width="15" height="14" rx="2" />
            <path d="m17 8 5-3v14l-5-3V8Z" />
          </>
        )}
      </svg>
      <p style={{ color: "#3A3A38", fontSize: "13px" }}>No {tab === "images" ? "images" : "videos"} yet</p>
      <p style={{ color: "#252523", fontSize: "11px" }}>Use the prompt below to generate your first {tab === "images" ? "image" : "video"}</p>
    </div>
  );
}
