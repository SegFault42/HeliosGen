"use client";
import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
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

interface RefImage {
  id: string;
  objectUrl: string;
  cdnUrl: string | null;
  uploading: boolean;
  error: boolean;
}

type Tab = "images" | "videos";

async function getToken(): Promise<string | undefined> {
  const { data } = await createClient().auth.getSession();
  return data.session?.access_token;
}

// ── Module-level cache ────────────────────────────────────────────────────────

const galleryCache    = new Map<string, { items: GalleryItem[]; hasMore: boolean }>();
const loadedImageUrls = new Set<string>();

interface SavedSettings {
  prompt: string; modelId: string; aspectRatio: string;
  quality: string; count: number; duration: number; mode: string;
}

function loadSettings(tab: Tab): Partial<SavedSettings> | null {
  if (typeof window === "undefined") return null;
  try { const r = localStorage.getItem(`nf-gallery-${tab}`); return r ? JSON.parse(r) : null; }
  catch { return null; }
}

function saveSettings(tab: Tab, s: SavedSettings) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(`nf-gallery-${tab}`, JSON.stringify(s)); } catch {}
}

// ── Inner page ────────────────────────────────────────────────────────────────

function GalleryInner() {
  const searchParams = useSearchParams();
  const rawTab       = searchParams.get("tab");
  const tab          = (rawTab === "videos" ? "videos" : "images") as Tab;

  const [user, setUser]             = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  const [items, setItems]               = useState<GalleryItem[]>([]);
  const [loading, setLoading]           = useState(true);
  const [loadingMore, setLoadingMore]   = useState(false);
  const [hasMore, setHasMore]           = useState(true);
  const [lightboxItem, setLightboxItem] = useState<GalleryItem | null>(null);

  const isVideo = tab === "videos";
  const models  = isVideo ? VIDEO_MODELS : IMAGE_MODELS;

  const skipNextModelEffect = useRef(false);

  const [prompt, setPrompt]           = useState<string>(() => loadSettings(tab)?.prompt ?? "");
  const [modelId, setModelId]         = useState<string>(() => {
    const s = loadSettings(tab);
    return (s?.modelId && models.find(m => m.id === s.modelId)) ? s.modelId : models[0].id;
  });
  const [aspectRatio, setAspectRatio] = useState<string>(() => {
    const s   = loadSettings(tab);
    const mId = (s?.modelId && models.find(m => m.id === s.modelId)) ? s.modelId : models[0].id;
    const mdl = models.find(m => m.id === mId) ?? models[0];
    if (s?.aspectRatio && mdl.ratios.includes(s.aspectRatio)) return s.aspectRatio;
    return ("defaultRatio" in mdl ? (mdl as { defaultRatio: string }).defaultRatio : null) ?? mdl.ratios[0] ?? "1:1";
  });
  const [quality, setQuality]         = useState<string>(() => loadSettings(tab)?.quality ?? "2k");
  const [count, setCount]             = useState<number>(() => loadSettings(tab)?.count ?? 1);
  const [duration, setDuration]       = useState<number>(() => loadSettings(tab)?.duration ?? 5);
  const [mode, setMode]               = useState<string>(() => loadSettings(tab)?.mode ?? "");
  const [generating, setGenerating]   = useState(false);
  const [genMsg, setGenMsg]           = useState<string>("");
  const [genError, setGenError]       = useState<string>("");

  // Reference images
  const [refImages, setRefImages]     = useState<RefImage[]>([]);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  const pageRef     = useRef(0);
  const tabRef      = useRef<Tab>(tab);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => { refImages.forEach(r => URL.revokeObjectURL(r.objectUrl)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (replace) {
      const cached = galleryCache.get(currentTab);
      if (cached) { setItems(cached.items); setHasMore(cached.hasMore); }
      else setLoading(true);
    } else {
      setLoadingMore(true);
    }
    try {
      const genType = currentTab === "videos" ? "video" : "image";
      const res = await fetch(`/api/gallery?type=${genType}&page=${page}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const { items: newItems, hasMore: more } = await res.json() as { items: GalleryItem[]; hasMore: boolean };
      if (replace) {
        setItems(newItems);
        galleryCache.set(currentTab, { items: newItems, hasMore: more });
      } else {
        setItems(prev => {
          const merged = [...prev, ...newItems];
          galleryCache.set(currentTab, { items: merged, hasMore: more });
          return merged;
        });
      }
      setHasMore(more);
      pageRef.current = page;
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (authLoaded && user) loadItems(tab, 0, true);
    if (authLoaded && !user) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoaded]);

  useEffect(() => {
    tabRef.current = tab;
    pageRef.current = 0;
    setHasMore(true);
    const cached = galleryCache.get(tab);
    if (cached) { setItems(cached.items); setHasMore(cached.hasMore); } else setItems([]);
    if (user) loadItems(tab, 0, true);
    const newModels = tab === "videos" ? VIDEO_MODELS : IMAGE_MODELS;
    const saved  = loadSettings(tab);
    const model  = (saved?.modelId ? newModels.find(m => m.id === saved.modelId) : null) ?? newModels[0];
    const savedAR = saved?.aspectRatio && model.ratios.includes(saved.aspectRatio) ? saved.aspectRatio : null;
    skipNextModelEffect.current = true;
    setModelId(model.id);
    setPrompt(saved?.prompt ?? "");
    setAspectRatio(savedAR ?? ("defaultRatio" in model ? (model as { defaultRatio: string }).defaultRatio : null) ?? model.ratios[0] ?? "16:9");
    setQuality(saved?.quality ?? "2k");
    setCount(saved?.count ?? 1);
    if ("defaultDuration" in model) setDuration(saved?.duration ?? (model as { defaultDuration: number }).defaultDuration ?? 5);
    if ("defaultMode" in model) setMode(saved?.mode ?? (model as { defaultMode: string }).defaultMode ?? "");
    setRefImages(prev => { prev.forEach(r => URL.revokeObjectURL(r.objectUrl)); return []; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (skipNextModelEffect.current) { skipNextModelEffect.current = false; return; }
    const m = models.find(m => m.id === modelId);
    if (!m) return;
    setAspectRatio(("defaultRatio" in m ? m.defaultRatio : null) ?? m.ratios[0] ?? "1:1");
    if ("defaultDuration" in m) setDuration(m.defaultDuration ?? 5);
    if ("defaultMode" in m) setMode(m.defaultMode ?? "");
    if (!("supportsImages" in m) || !m.supportsImages) {
      setRefImages(prev => { prev.forEach(r => URL.revokeObjectURL(r.objectUrl)); return []; });
    }
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

  // Persist settings
  useEffect(() => {
    saveSettings(tab, { prompt, modelId, aspectRatio, quality, count, duration, mode });
  }, [tab, prompt, modelId, aspectRatio, quality, count, duration, mode]);

  // ── Image upload ──────────────────────────────────────────────────────────

  const imgModel   = IMAGE_MODELS.find(m => m.id === modelId);
  const maxImgs    = imgModel?.maxImages ?? 0;
  const canAddImgs = !isVideo && !!imgModel?.supportsImages && refImages.length < maxImgs;

  const handleFilePick = async (files: FileList) => {
    if (!imgModel?.supportsImages) return;
    const remaining = maxImgs - refImages.length;
    const toAdd     = Array.from(files).slice(0, remaining).filter(f => f.type.startsWith("image/"));
    if (toAdd.length === 0) return;

    const newEntries: RefImage[] = toAdd.map(f => ({
      id:        crypto.randomUUID(),
      objectUrl: URL.createObjectURL(f),
      cdnUrl:    null,
      uploading: true,
      error:     false,
    }));
    setRefImages(prev => [...prev, ...newEntries]);

    const token = await getToken();
    await Promise.all(toAdd.map(async (file, i) => {
      const entry = newEntries[i];
      try {
        const res  = await fetch("/api/upload-asset", {
          method:  "POST",
          headers: {
            "Content-Type": file.type,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: file,
        });
        const data = await res.json() as { url?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error ?? "Upload failed");
        setRefImages(prev => prev.map(r => r.id === entry.id ? { ...r, cdnUrl: data.url!, uploading: false } : r));
      } catch {
        setRefImages(prev => prev.map(r => r.id === entry.id ? { ...r, uploading: false, error: true } : r));
      }
    }));
  };

  const removeImage = (id: string) => {
    setRefImages(prev => {
      const img = prev.find(r => r.id === id);
      if (img) URL.revokeObjectURL(img.objectUrl);
      return prev.filter(r => r.id !== id);
    });
  };

  // ── Generate ──────────────────────────────────────────────────────────────

  const generateOne = async (token: string): Promise<string> => {
    if (!isVideo) {
      const imageUrls = refImages.filter(r => r.cdnUrl && !r.error).map(r => r.cdnUrl!);
      const res = await fetch("/api/generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ prompt, model: modelId, aspectRatio, quality, imageUrls }),
      });
      const d = await res.json() as { taskId?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Failed");
      return d.taskId!;
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
      return d.taskId!;
    }
  };

  const pollTask = async (taskId: string): Promise<void> => {
    for (let i = 0; i < 150; i++) {
      await new Promise(r => setTimeout(r, 3_000));
      const poll   = await fetch(`/api/job-status?taskId=${taskId}`);
      const result = await poll.json() as { status: string; error?: string };
      if (result.status === "done") return;
      if (result.status === "error") throw new Error(result.error ?? "Generation failed");
    }
    throw new Error("Timed out");
  };

  const generate = async () => {
    if (!prompt.trim() && !isVideo) return;
    if (refImages.some(r => r.uploading)) { setGenError("Images still uploading…"); setTimeout(() => setGenError(""), 3_000); return; }
    const token = await getToken();
    if (!token) { setGenError("Please sign in to generate."); return; }
    setGenerating(true);
    setGenMsg("Submitting…");
    setGenError("");
    try {
      const taskIds = await Promise.all(Array.from({ length: count }, () => generateOne(token)));
      setGenMsg("Generating…");
      await Promise.all(taskIds.map(pollTask));
      setGenMsg("");
      await loadItems(tabRef.current, 0, true);
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : String(e));
      setTimeout(() => setGenError(""), 6_000);
    } finally {
      setGenerating(false);
      setGenMsg("");
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const vidModel    = VIDEO_MODELS.find(m => m.id === modelId);
  const ratios      = (isVideo ? vidModel?.ratios : imgModel?.ratios) ?? [];
  const supportsQ   = !isVideo && !!imgModel?.supportsQuality;
  const qualityOpts = imgModel?.apiInput.qualityOptions ?? ["2k", "4k"];
  const durations   = vidModel?.durations ?? [];
  const vidModes    = vidModel?.modes ?? [];
  const activeModel = models.find(m => m.id === modelId);
  const hasRefImgs  = refImages.length > 0;
  const allUploaded = refImages.every(r => !r.uploading);

  const canGenerate = generating
    ? false
    : isVideo
    ? true
    : prompt.trim().length > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  if (!authLoaded) return <div style={{ flex: 1, background: "#080A0C" }} />;

  if (!user) {
    return (
      <div style={{ flex: 1, background: "#080A0C", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px" }}>
        <p style={{ color: "#4A4A45", fontSize: "14px" }}>Sign in to view your gallery</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, background: "#080A0C", display: "flex", flexDirection: "column", overflow: "hidden", color: "#fff" }}>

      {/* ── Grid ── */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: "160px" }}>
        {!loading && items.length === 0 ? (
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
            {items.map(item => (
              <GalleryCard key={item.id} item={item} onOpen={item.mediaType === "image" ? () => setLightboxItem(item) : undefined} />
            ))}
          </div>
        )}
        <div ref={sentinelRef} style={{ height: "1px" }} />
      </div>

      {/* ── Hidden file input ── */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={e => { if (e.target.files) { handleFilePick(e.target.files); e.target.value = ""; } }}
      />

      {/* ── Prompt bar ── */}
      <div style={{
        position:  "fixed",
        bottom:    "20px",
        left:      "50%",
        transform: "translateX(-50%)",
        width:     "min(860px, calc(100vw - 32px))",
        zIndex:    200,
      }}>

        {/* Toast */}
        {(genError || (genMsg && !generating)) && (
          <div style={{
            marginBottom: "8px",
            padding:      "8px 14px",
            background:   genError ? "rgba(248,113,113,0.1)" : "rgba(119,229,68,0.08)",
            border:       `1px solid ${genError ? "rgba(248,113,113,0.2)" : "rgba(119,229,68,0.15)"}`,
            borderRadius: "10px",
            fontSize:     "12px",
            color:        genError ? "#f87171" : "#77E544",
          }}>
            {genError || genMsg}
          </div>
        )}

        <div style={{
          background:           "rgba(14,16,18,0.97)",
          backdropFilter:       "blur(32px)",
          WebkitBackdropFilter: "blur(32px)",
          border:               "1px solid rgba(255,255,255,0.08)",
          borderRadius:         "18px",
          boxShadow:            "0 28px 80px rgba(0,0,0,0.9), 0 4px 20px rgba(0,0,0,0.5)",
          overflow:             "hidden",
        }}>

          {/* ── Reference image thumbnails ── */}
          {!isVideo && (hasRefImgs || canAddImgs) && (
            <div style={{
              padding:    "14px 16px 0",
              display:    "flex",
              gap:        "10px",
              flexWrap:   "wrap",
              alignItems: "flex-start",
            }}>
              {refImages.map(img => (
                <div key={img.id} style={{
                  position:     "relative",
                  width:        "88px",
                  height:       "80px",
                  borderRadius: "10px",
                  overflow:     "hidden",
                  background:   "#1A1C1F",
                  flexShrink:   0,
                  border:       img.error ? "1px solid rgba(248,113,113,0.4)" : "1px solid rgba(255,255,255,0.08)",
                }}>
                  {/* Thumbnail */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.objectUrl}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                  {/* Upload overlay */}
                  {img.uploading && (
                    <div style={{
                      position:        "absolute",
                      inset:           0,
                      background:      "rgba(0,0,0,0.55)",
                      display:         "flex",
                      alignItems:      "center",
                      justifyContent:  "center",
                    }}>
                      <span style={{
                        width:        "18px",
                        height:       "18px",
                        borderRadius: "50%",
                        border:       "2px solid rgba(255,255,255,0.2)",
                        borderTopColor: "#77E544",
                        display:      "inline-block",
                        animation:    "spin 0.75s linear infinite",
                      }} />
                    </div>
                  )}
                  {/* Error overlay */}
                  {img.error && (
                    <div style={{
                      position:       "absolute",
                      inset:          0,
                      background:     "rgba(0,0,0,0.55)",
                      display:        "flex",
                      alignItems:     "center",
                      justifyContent: "center",
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                      </svg>
                    </div>
                  )}
                  {/* X button */}
                  <button
                    onClick={() => removeImage(img.id)}
                    style={{
                      position:       "absolute",
                      top:            "5px",
                      right:          "5px",
                      width:          "20px",
                      height:         "20px",
                      borderRadius:   "50%",
                      background:     "rgba(0,0,0,0.7)",
                      border:         "1px solid rgba(255,255,255,0.15)",
                      color:          "rgba(255,255,255,0.85)",
                      cursor:         "pointer",
                      display:        "flex",
                      alignItems:     "center",
                      justifyContent: "center",
                      lineHeight:     1,
                      padding:        0,
                      fontSize:       "12px",
                      transition:     "background 120ms",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.9)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,0,0,0.7)"; }}
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}

              {/* Add-more button */}
              {canAddImgs && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={generating}
                  style={{
                    width:          "88px",
                    height:         "80px",
                    borderRadius:   "10px",
                    border:         "1.5px dashed rgba(255,255,255,0.4)",
                    background:     "rgba(255,255,255,0.025)",
                    cursor:         generating ? "not-allowed" : "pointer",
                    display:        "flex",
                    flexDirection:  "column",
                    alignItems:     "center",
                    justifyContent: "center",
                    gap:            "6px",
                    color:          "rgba(255,255,255,0.75)",
                    flexShrink:     0,
                    transition:     "border-color 140ms, background 140ms, color 140ms",
                  }}
                  onMouseEnter={e => {
                    if (!generating) {
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.6)";
                      e.currentTarget.style.background  = "rgba(255,255,255,0.05)";
                      e.currentTarget.style.color       = "#ffffff";
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.4)";
                    e.currentTarget.style.background  = "rgba(255,255,255,0.025)";
                    e.currentTarget.style.color       = "rgba(255,255,255,0.75)";
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="m21 15-5-5L5 21" />
                    <path d="M19 3v6M22 6h-6" />
                  </svg>
                  <span style={{ fontSize: "10px", letterSpacing: "0.02em" }}>
                    {maxImgs - refImages.length} left
                  </span>
                </button>
              )}
            </div>
          )}

          {/* ── Input + Controls + Generate ── */}
          <div style={{
            padding:    hasRefImgs ? "12px 14px 14px 16px" : "16px 14px 14px 16px",
            display:    "flex",
            alignItems: "stretch",
            gap:        "12px",
          }}>
            {/* Left column: input + controls */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
            <input
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !generating) { e.preventDefault(); generate(); } }}
              placeholder={isVideo ? "Describe the video you imagine…" : "Describe the scene you imagine…"}
              disabled={generating}
              style={{
                flex:        "none",
                background:  "transparent",
                border:      "none",
                outline:     "none",
                color:       "#e8e8e6",
                fontSize:    "14.5px",
                fontFamily:  "inherit",
                caretColor:  "#77E544",
                letterSpacing: "-0.01em",
              }}
            />
            {/* Controls group */}
            <div style={{ display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" }}>
            {/* Count stepper (image only) — leftmost */}
            {!isVideo && (
              <div style={{
                display:      "flex",
                alignItems:   "center",
                height:       "36px",
                borderRadius: "8px",
                border:       "1px solid rgba(255,255,255,0.1)",
                background:   "rgba(255,255,255,0.05)",
                overflow:     "hidden",
                flexShrink:   0,
              }}>
                <button
                  onClick={() => setCount(c => Math.max(1, c - 1))}
                  disabled={generating || count <= 1}
                  style={{
                    width: "34px", height: "100%", border: "none", background: "transparent",
                    color: count <= 1 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.55)",
                    cursor: generating || count <= 1 ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "16px", fontFamily: "inherit", transition: "color 140ms",
                  }}
                >−</button>
                <span style={{
                  fontSize: "12.5px", color: "#ffffff",
                  minWidth: "30px", textAlign: "center",
                  fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em",
                }}>
                  {count}/4
                </span>
                <button
                  onClick={() => setCount(c => Math.min(4, c + 1))}
                  disabled={generating || count >= 4}
                  style={{
                    width: "34px", height: "100%", border: "none", background: "transparent",
                    color: count >= 4 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.55)",
                    cursor: generating || count >= 4 ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "16px", fontFamily: "inherit", transition: "color 140ms",
                  }}
                >+</button>
              </div>
            )}

            {/* Model picker */}
            <CustomDropdown
              value={modelId}
              onChange={setModelId}
              disabled={generating}
              options={models.map(m => ({
                value: m.id,
                label: m.name,
                group: ("provider" in m ? (m as { provider: string }).provider : undefined),
              }))}
              showChevron
            />

            {/* Quality */}
            {supportsQ && (
              <CustomDropdown
                value={quality}
                onChange={setQuality}
                disabled={generating}
                options={qualityOpts.map(q => ({ value: q, label: q.toUpperCase() }))}
                icon={<DiamondIcon />}
              />
            )}

            {/* Aspect ratio */}
            {ratios.length > 0 && (
              <CustomDropdown
                value={aspectRatio}
                onChange={setAspectRatio}
                disabled={generating}
                options={ratios.map(r => ({ value: r, label: r, preview: <RatioPreview ratio={r} /> }))}
                icon={<AspectIcon />}
              />
            )}

            {/* Duration (video) */}
            {isVideo && durations.length > 0 && (
              <CustomDropdown
                value={String(duration)}
                onChange={v => setDuration(Number(v))}
                disabled={generating}
                options={durations.map(d => ({ value: String(d), label: `${d}s` }))}
              />
            )}

            {/* Mode (video) */}
            {isVideo && vidModes.length > 0 && (
              <CustomDropdown
                value={mode}
                onChange={setMode}
                disabled={generating}
                options={vidModes.map(m => ({ value: m.value, label: m.label }))}
              />
            )}
            </div>{/* end controls group */}
            </div>{/* end left column */}

            {/* Generate button — stretches full height of the box */}
            <button
              onClick={generate}
              disabled={!canGenerate}
              style={{
                display:        "flex",
                flexDirection:  "row",
                alignItems:     "center",
                justifyContent: "center",
                gap:            "7px",
                padding:        "0 26px",
                borderRadius:   "14px",
                border:         "none",
                background:     "#77E544",
                color:          "#060A06",
                fontSize:       "15px",
                fontWeight:     700,
                cursor:         !canGenerate ? "not-allowed" : "pointer",
                opacity:        !canGenerate ? 0.45 : 1,
                transition:     "opacity 150ms, background 150ms",
                fontFamily:     "inherit",
                flexShrink:     0,
                letterSpacing:  "-0.02em",
                whiteSpace:     "nowrap",
                alignSelf:      "stretch",
              }}
              onMouseEnter={e => { if (canGenerate) e.currentTarget.style.background = "#8FEE60"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#77E544"; }}
            >
              {generating ? (
                <>
                  <span style={{
                    width: "12px", height: "12px", borderRadius: "50%",
                    border: "2px solid rgba(6,10,6,0.25)", borderTopColor: "#060A06",
                    display: "inline-block", animation: "spin 0.75s linear infinite",
                  }} />
                  {genMsg || "Generating"}
                </>
              ) : (
                <>Generate <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" stroke="none" style={{ display: "inline", verticalAlign: "middle" }}><path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z"/><path d="M4.6519 14.7568L4.82063 14.2084C4.84491 14.1295 4.91781 14.0757 5.00037 14.0757C5.08292 14.0757 5.15582 14.1295 5.1801 14.2084L5.34883 14.7568C5.56525 15.4602 6.11587 16.0108 6.81925 16.2272L7.36762 16.3959C7.44652 16.4202 7.50037 16.4931 7.50037 16.5757C7.50037 16.6582 7.44652 16.7311 7.36762 16.7554L6.81926 16.9241C6.11587 17.1406 5.56525 17.6912 5.34883 18.3946L5.1801 18.9429C5.15582 19.0218 5.08292 19.0757 5.00037 19.0757C4.91781 19.0757 4.84491 19.0218 4.82063 18.9429L4.65191 18.3946C4.43548 17.6912 3.88486 17.1406 3.18147 16.9241L2.63311 16.7554C2.55421 16.7311 2.50037 16.6582 2.50037 16.5757C2.50037 16.4931 2.55421 16.4202 2.63311 16.3959L3.18148 16.2272C3.88486 16.0108 4.43548 15.4602 4.6519 14.7568Z"/></svg></>
              )}
            </button>
          </div>
        </div>
      </div>

      <style>{GALLERY_CSS}</style>

      {lightboxItem && (
        <Lightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      )}
    </div>
  );
}

export default function GalleryPage() {
  return (
    <Suspense fallback={<div style={{ flex: 1, background: "#080A0C" }} />}>
      <GalleryInner />
    </Suspense>
  );
}

// ── CustomDropdown ────────────────────────────────────────────────────────────

interface DropOption {
  value: string;
  label: string;
  group?: string;
  preview?: React.ReactNode;
}

function CustomDropdown({
  value,
  onChange,
  disabled,
  options,
  icon,
  showChevron = true,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  options: DropOption[];
  icon?: React.ReactNode;
  showChevron?: boolean;
}) {
  const [open, setOpen]     = useState(false);
  const [pos, setPos]       = useState({ left: 0, bottom: 0, minW: 0 });
  const triggerRef          = useRef<HTMLButtonElement>(null);
  const dropRef             = useRef<HTMLDivElement>(null);

  const label = options.find(o => o.value === value)?.label ?? value;

  const openDrop = () => {
    if (disabled || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ left: r.left, bottom: window.innerHeight - r.top + 6, minW: r.width });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !dropRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Group options by group field
  const groups = options.reduce<Record<string, DropOption[]>>((acc, o) => {
    const g = o.group ?? "";
    (acc[g] ??= []).push(o);
    return acc;
  }, {});
  const groupKeys    = Object.keys(groups);
  const hasGroups    = groupKeys.some(k => k !== "");

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => open ? setOpen(false) : openDrop()}
        disabled={disabled}
        style={{
          display:      "flex",
          alignItems:   "center",
          gap:          "6px",
          height:       "36px",
          padding:      "0 12px",
          borderRadius: "8px",
          border:       open
            ? "1px solid rgba(255,255,255,0.18)"
            : "1px solid rgba(255,255,255,0.1)",
          background:   open
            ? "rgba(255,255,255,0.08)"
            : "rgba(255,255,255,0.05)",
          flexShrink:   0,
          cursor:       disabled ? "not-allowed" : "pointer",
          fontFamily:   "inherit",
          transition:   "border-color 140ms, background 140ms",
          userSelect:   "none",
        }}
        onMouseEnter={e => {
          if (!disabled && !open) {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)";
            e.currentTarget.style.background  = "rgba(255,255,255,0.07)";
          }
        }}
        onMouseLeave={e => {
          if (!open) {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
            e.currentTarget.style.background  = "rgba(255,255,255,0.05)";
          }
        }}
      >
        {icon && (
          <span style={{ display: "flex", alignItems: "center", color: "rgba(255,255,255,0.4)", flexShrink: 0 }}>
            {icon}
          </span>
        )}
        <span style={{ fontSize: "13px", color: "#ffffff", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
          {label}
        </span>
        {showChevron && (
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round"
            style={{ flexShrink: 0, transition: "transform 140ms", transform: open ? "rotate(180deg)" : "none" }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {open && createPortal(
        <div
          ref={dropRef}
          style={{
            position:     "fixed",
            left:         pos.left,
            bottom:       pos.bottom,
            minWidth:     Math.max(pos.minW, 160),
            background:   "#0E1012",
            border:       "1px solid rgba(255,255,255,0.1)",
            borderRadius: "14px",
            boxShadow:    "0 8px 48px rgba(0,0,0,0.75), 0 2px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            overflow:     "hidden",
            zIndex:       9999,
            animation:    "dropIn 130ms cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          <div style={{ padding: "5px", maxHeight: "300px", overflowY: "auto" }}>
            {hasGroups ? (
              groupKeys.map((gk, gi) => (
                <div key={gk}>
                  {gi > 0 && (
                    <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "4px 8px" }} />
                  )}
                  {gk && (
                    <div style={{
                      padding:       "5px 10px 3px",
                      fontSize:      "10px",
                      color:         "rgba(255,255,255,0.22)",
                      textTransform: "uppercase",
                      letterSpacing: "0.09em",
                      fontWeight:    500,
                    }}>
                      {gk}
                    </div>
                  )}
                  {groups[gk].map(opt => (
                    <DropItem
                      key={opt.value}
                      label={opt.label}
                      active={opt.value === value}
                      onClick={() => { onChange(opt.value); setOpen(false); }}
                      preview={opt.preview}
                    />
                  ))}
                </div>
              ))
            ) : (
              options.map(opt => (
                <DropItem
                  key={opt.value}
                  label={opt.label}
                  active={opt.value === value}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  preview={opt.preview}
                />
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function DropItem({ label, active, onClick, preview }: { label: string; active: boolean; onClick: () => void; preview?: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display:      "flex",
        alignItems:   "center",
        gap:          "8px",
        width:        "100%",
        padding:      "7px 10px",
        borderRadius: "9px",
        border:       "none",
        background:   active
          ? "rgba(255,255,255,0.09)"
          : hovered ? "rgba(255,255,255,0.06)" : "transparent",
        color:        active ? "#ffffff" : hovered ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.55)",
        fontSize:     "13px",
        fontWeight:   active ? 500 : 400,
        cursor:       "pointer",
        textAlign:    "left",
        transition:   "background 100ms, color 100ms",
        fontFamily:   "inherit",
        letterSpacing: "-0.01em",
        whiteSpace:   "nowrap",
      }}
    >
      {preview}
      {label}
    </button>
  );
}

function RatioPreview({ ratio }: { ratio: string }) {
  const [ws, hs] = ratio.split(":");
  const w = parseFloat(ws), h = parseFloat(hs);
  if (!w || !h) return null;
  const maxW = 36, maxH = 22;
  let rw = maxW, rh = (h / w) * maxW;
  if (rh > maxH) { rh = maxH; rw = (w / h) * maxH; }
  return (
    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "44px", flexShrink: 0 }}>
      <span style={{
        display:     "inline-block",
        width:       `${Math.round(rw)}px`,
        height:      `${Math.round(rh)}px`,
        border:      "1.5px solid rgba(255,255,255,0.75)",
        borderRadius: "5px",
        flexShrink:  0,
      }} />
    </span>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function DiamondIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41L13.7 2.71a2.41 2.41 0 0 0-3.41 0Z" />
    </svg>
  );
}

function AspectIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
    </svg>
  );
}

// ── Gallery card ──────────────────────────────────────────────────────────────

function GalleryCard({ item, onOpen }: { item: GalleryItem; onOpen?: () => void }) {
  const videoRef                        = useRef<HTMLVideoElement>(null);
  const cardRef                         = useRef<HTMLDivElement>(null);
  const preloaded                       = loadedImageUrls.has(item.url);
  const [playing, setPlaying]           = useState(false);
  const [failed, setFailed]             = useState(false);
  const [imgLoaded, setImgLoaded]       = useState(preloaded);
  const [shouldLoad, setShouldLoad]     = useState(preloaded);
  const isVideo                         = item.mediaType === "video";

  useEffect(() => {
    if (preloaded) return;
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setShouldLoad(true); observer.disconnect(); } },
      { rootMargin: "80px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cssRatio = (() => {
    const ar = item.aspect_ratio;
    if (!ar || ar === "auto") return null;
    const [w, h] = ar.split(":");
    return w && h ? `${w} / ${h}` : null;
  })();

  if (failed) {
    return (
      <div className="gallery-item" style={{ aspectRatio: cssRatio ?? "1 / 1", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className="gallery-item"
      style={cssRatio ? { aspectRatio: cssRatio } : undefined}
      onMouseEnter={() => { if (isVideo) videoRef.current?.play().then(() => setPlaying(true)).catch(() => {}); }}
      onMouseLeave={() => { if (isVideo && videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; setPlaying(false); } }}
      onClick={onOpen}
    >
      {isVideo ? (
        <>
          <video ref={videoRef} src={item.url} muted loop playsInline preload="metadata" onError={() => setFailed(true)} />
          {!playing && (
            <div className="gallery-play-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            </div>
          )}
        </>
      ) : (
        <>
          {(!shouldLoad || !imgLoaded) && <div className="gallery-shimmer" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shouldLoad ? `/_next/image?url=${encodeURIComponent(item.url)}&w=828&q=75` : undefined}
            alt={item.prompt ?? ""}
            decoding="async"
            onLoad={() => { setImgLoaded(true); loadedImageUrls.add(item.url); }}
            onError={() => setFailed(true)}
            style={{ display: "block", width: "100%", height: "auto", opacity: imgLoaded ? 1 : 0, transition: "opacity 280ms ease" }}
          />
        </>
      )}
      <div className="gallery-overlay">
        {item.prompt && (
          <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.85)", lineHeight: 1.45, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", marginBottom: "4px" }}>
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

  useEffect(() => { const id = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(id); }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => { setVisible(false); setTimeout(onClose, 200); };
  const meta = [item.model, item.aspect_ratio, item.quality?.toUpperCase()].filter(Boolean).join(" · ");

  return createPortal(
    <div onClick={handleClose} style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: `rgba(0,0,0,${visible ? 0.88 : 0})`,
      backdropFilter: visible ? "blur(12px)" : "none",
      WebkitBackdropFilter: visible ? "blur(12px)" : "none",
      transition: "background 200ms ease, backdrop-filter 200ms ease",
      padding: "24px",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        position: "relative",
        maxWidth: "min(1200px, calc(100vw - 48px))", maxHeight: "calc(100vh - 120px)",
        transform: visible ? "scale(1)" : "scale(0.96)", transition: "transform 200ms ease",
        borderRadius: "10px", overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,0.8)",
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/_next/image?url=${encodeURIComponent(item.url)}&w=828&q=75`} alt="" aria-hidden style={{
          display: "block", maxWidth: "min(1200px, calc(100vw - 48px))", maxHeight: "calc(100vh - 120px)",
          width: "100%", height: "auto", objectFit: "contain",
          filter: fullLoaded ? "none" : "blur(12px)", transform: fullLoaded ? "scale(1)" : "scale(1.04)",
          transition: "filter 320ms ease, transform 320ms ease",
        }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.url} alt={item.prompt ?? ""} onLoad={() => setFullLoaded(true)} style={{
          position: "absolute", inset: 0, display: "block", width: "100%", height: "100%", objectFit: "contain",
          opacity: fullLoaded ? 1 : 0, transition: "opacity 320ms ease",
        }} />
      </div>
      {(item.prompt || meta) && (
        <div onClick={e => e.stopPropagation()} style={{
          marginTop: "14px", maxWidth: "min(1200px, calc(100vw - 48px))", width: "100%",
          opacity: visible ? 1 : 0, transition: "opacity 250ms ease 100ms",
        }}>
          {item.prompt && <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)", lineHeight: 1.5, marginBottom: meta ? "5px" : 0, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{item.prompt}</p>}
          {meta && <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>{meta}</p>}
        </div>
      )}
      <button onClick={handleClose} style={{
        position: "fixed", top: "16px", right: "16px", width: "34px", height: "34px", borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.5)", color: "rgba(255,255,255,0.6)",
        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        opacity: visible ? 1 : 0, transition: "opacity 200ms ease, background 150ms",
      }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,0,0,0.5)"; }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>,
    document.body,
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "320px", gap: "10px" }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#252523" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        {tab === "images" ? (
          <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>
        ) : (
          <><rect x="2" y="5" width="15" height="14" rx="2" /><path d="m17 8 5-3v14l-5-3V8Z" /></>
        )}
      </svg>
      <p style={{ color: "#3A3A38", fontSize: "13px" }}>No {tab === "images" ? "images" : "videos"} yet</p>
      <p style={{ color: "#252523", fontSize: "11px" }}>Use the prompt below to generate your first {tab === "images" ? "image" : "video"}</p>
    </div>
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const GALLERY_CSS = `
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes dropIn {
    from { opacity: 0; transform: translateY(6px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)   scale(1);    }
  }
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
  .gallery-item-pending { aspect-ratio: 16 / 9; }
  .gallery-shimmer {
    position: absolute; inset: 0;
    background: linear-gradient(90deg, #111416 25%, #1a1d20 50%, #111416 75%);
    background-size: 800px 100%;
    animation: shimmer 1.6s infinite linear;
  }
  .gallery-item img, .gallery-item video { display: block; width: 100%; height: auto; }
  .gallery-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 55%);
    opacity: 0; transition: opacity 180ms ease;
    display: flex; flex-direction: column; justify-content: flex-end; padding: 10px;
  }
  .gallery-item:hover .gallery-overlay { opacity: 1; }
  .gallery-play-icon {
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 36px; height: 36px; border-radius: 50%;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 180ms ease; pointer-events: none;
  }
  .gallery-item:hover .gallery-play-icon { opacity: 1; }
`;
