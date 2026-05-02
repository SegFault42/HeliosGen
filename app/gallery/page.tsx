"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import NextImage from "next/image";
import { createClient } from "@/lib/supabase/client";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";
import { useWorkflowStore } from "@/lib/store";
import type { User } from "@supabase/supabase-js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GalleryItem {
  id: string;
  url: string;
  imageUrls?: string[];
  mediaType: "image" | "video";
  prompt?: string;
  model?: string;
  aspect_ratio?: string;
  quality?: string;
  source: "generation" | "upload";
  created_at: string;
  referenceImageUrls?: string[];
}

interface RefImage {
  id: string;
  objectUrl: string;
  cdnUrl: string | null;
  uploading: boolean;
  error: boolean;
}

interface PendingGen {
  id: string;
  aspectRatio: string;
  prompt: string;
  referenceImageUrls?: string[];
  error?: string;
}


interface DownloadTask {
  id: string;
  filename: string;
  status: "preparing" | "ready" | "error";
}

type Tab = "images" | "videos";

interface TaggedImage {
  label: string;
  refId: string;
  url: string;
}

interface KlingElement {
  id: string;
  name: string;
  description: string;
  imageUrls: string[];
}

function resolveGalleryMentions(
  text: string,
  tagged: TaggedImage[],
): { resolvedPrompt: string; extraUrls: string[] } {
  if (!tagged.length) return { resolvedPrompt: text, extraUrls: [] };
  type Span = { start: number; end: number; url: string };
  const spans: Span[] = [];
  const claimed = new Set<number>();
  for (const t of [...tagged].sort((a, b) => b.label.length - a.label.length)) {
    const escaped = t.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`@${escaped}(?!\\w)`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!claimed.has(m.index)) {
        spans.push({ start: m.index, end: m.index + m[0].length, url: t.url });
        claimed.add(m.index);
      }
    }
  }
  spans.sort((a, b) => a.start - b.start);
  if (!spans.length) return { resolvedPrompt: text, extraUrls: [] };
  const extraUrls: string[] = [];
  let resolvedPrompt = "";
  let lastEnd = 0;
  let n = 1;
  for (const span of spans) {
    resolvedPrompt += text.slice(lastEnd, span.start);
    resolvedPrompt += `<<<image ${n++}>>>`;
    extraUrls.push(span.url);
    lastEnd = span.end;
  }
  resolvedPrompt += text.slice(lastEnd);
  return { resolvedPrompt, extraUrls };
}

function renderGalleryMentions(
  text: string,
  tagged: TaggedImage[],
  onEnter: (tag: TaggedImage, rect: DOMRect) => void,
  onLeave: () => void,
  onMouseDown: (tag: TaggedImage) => void,
): React.ReactNode {
  if (!text) return null;
  if (!tagged.length) return <span style={{ color: "#e8e8e6" }}>{text}</span>;

  const sorted = [...tagged].sort((a, b) => b.label.length - a.label.length);
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;

  while (rest.length > 0) {
    let earliest: { idx: number; tag: TaggedImage } | null = null;
    for (const tag of sorted) {
      const idx = rest.indexOf(`@${tag.label}`);
      if (idx !== -1 && (earliest === null || idx < earliest.idx)) earliest = { idx, tag };
    }
    if (!earliest) { parts.push(<span key={key++} style={{ color: "#e8e8e6" }}>{rest}</span>); break; }
    if (earliest.idx > 0) parts.push(<span key={key++} style={{ color: "#e8e8e6" }}>{rest.slice(0, earliest.idx)}</span>);
    const tag = earliest.tag;
    parts.push(
      <span
        key={key++}
        style={{
          color: "#ff3df5",
          fontWeight: 500,
          cursor: "text",
          pointerEvents: "auto",
          userSelect: "none",
          background: "rgba(119,229,68,0.15)",
          boxShadow: "0 0 0 3px rgba(119,229,68,0.15)",
          borderRadius: "3px",
        }}
        onMouseEnter={e => onEnter(tag, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={onLeave}
        onMouseDown={e => { e.preventDefault(); onMouseDown(tag); }}
      >
        @{tag.label}
      </span>,
    );
    rest = rest.slice(earliest.idx + tag.label.length + 1);
  }
  return <>{parts}</>;
}

function resizeTextarea(el: HTMLTextAreaElement, maxH = 440) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, maxH) + "px";
}

async function getToken(): Promise<string | undefined> {
  const { data } = await createClient().auth.getSession();
  return data.session?.access_token;
}

// ── Module-level cache (memory + localStorage) ───────────────────────────────

const _galleryCacheMem = new Map<string, { items: GalleryItem[]; hasMore: boolean }>();

const galleryCache = {
  get(tab: string): { items: GalleryItem[]; hasMore: boolean } | undefined {
    const mem = _galleryCacheMem.get(tab);
    if (mem) return mem;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(`nf-gallery-cache-${tab}`) : null;
      if (!raw) return undefined;
      const data = JSON.parse(raw) as { items: GalleryItem[]; hasMore: boolean };
      _galleryCacheMem.set(tab, data);
      return data;
    } catch { return undefined; }
  },
  set(tab: string, data: { items: GalleryItem[]; hasMore: boolean }) {
    _galleryCacheMem.set(tab, data);
    try {
      if (typeof window !== "undefined") localStorage.setItem(`nf-gallery-cache-${tab}`, JSON.stringify(data));
    } catch { }
  },
};

const loadedImageUrls = new Set<string>();
const naturalRatioCache = new Map<string, string>(); // url → "w / h"

interface SavedSettings {
  prompt: string; modelId: string; aspectRatio: string;
  quality: string; count: number; duration: number; mode: string;
  sound?: boolean;
  refImageUrls?: string[];
}

function loadSettings(tab: Tab): Partial<SavedSettings> | null {
  if (typeof window === "undefined") return null;
  try { const r = localStorage.getItem(`nf-gallery-${tab}`); return r ? JSON.parse(r) : null; }
  catch { return null; }
}

function saveSettings(tab: Tab, s: SavedSettings) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(`nf-gallery-${tab}`, JSON.stringify(s)); } catch { }
}

function loadKlingElements(): KlingElement[] {
  if (typeof window === "undefined") return [];
  try { const r = localStorage.getItem("nf-kling-elements"); return r ? (JSON.parse(r) as KlingElement[]) : []; } catch { return []; }
}

function saveKlingElements(elements: KlingElement[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem("nf-kling-elements", JSON.stringify(elements)); } catch { }
}

// ── Inner page ────────────────────────────────────────────────────────────────

function GalleryInner() {
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab = (rawTab === "videos" ? "videos" : "images") as Tab;

  const [user, setUser] = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  const [items, setItems] = useState<GalleryItem[]>(() => galleryCache.get(tab)?.items ?? []);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(() => galleryCache.get(tab)?.hasMore ?? true);
  const [lightboxItem, setLightboxItem] = useState<GalleryItem | null>(null);

  const isVideo = tab === "videos";
  const models = isVideo ? VIDEO_MODELS : IMAGE_MODELS;

  const skipNextModelEffect = useRef(false);

  const [prompt, setPrompt] = useState<string>(() => loadSettings(tab)?.prompt ?? "");
  const [modelId, setModelId] = useState<string>(() => {
    const s = loadSettings(tab);
    return (s?.modelId && models.find(m => m.id === s.modelId)) ? s.modelId : models[0].id;
  });
  const [aspectRatio, setAspectRatio] = useState<string>(() => {
    const s = loadSettings(tab);
    const mId = (s?.modelId && models.find(m => m.id === s.modelId)) ? s.modelId : models[0].id;
    const mdl = models.find(m => m.id === mId) ?? models[0];
    if (s?.aspectRatio && mdl.ratios.includes(s.aspectRatio)) return s.aspectRatio;
    return ("defaultRatio" in mdl ? (mdl as { defaultRatio: string }).defaultRatio : null) ?? mdl.ratios[0] ?? "1:1";
  });
  const [quality, setQuality] = useState<string>(() => loadSettings(tab)?.quality ?? "2k");
  const [count, setCount] = useState<number>(() => loadSettings(tab)?.count ?? 1);
  const [duration, setDuration] = useState<number>(() => loadSettings(tab)?.duration ?? 5);
  const [mode, setMode] = useState<string>(() => loadSettings(tab)?.mode ?? "");
  const [resolution, setResolution] = useState<string>("");
  const [sound, setSound] = useState<boolean>(() => loadSettings(tab)?.sound ?? false);
  const [durPickerOpen, setDurPickerOpen] = useState(false);
  const [durPickerClosing, setDurPickerClosing] = useState(false);
  const [durPickerPos, setDurPickerPos] = useState<{ left: number; bottom: number } | null>(null);
  const durPillRef = useRef<HTMLButtonElement>(null);
  const durCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingGens, setPendingGens] = useState<PendingGen[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [genError, setGenError] = useState<string>("");
  const debugMode   = useWorkflowStore((s) => s.debugMode);
  const addToast    = useWorkflowStore((s) => s.addToast);
  const kieKeySet   = useWorkflowStore((s) => s.kieKeySet);
  const setKieKeySet = useWorkflowStore((s) => s.setKieKeySet);
  const [sourceFilter, setSourceFilter] = useState<"generated" | "uploaded">("generated");
  const [zoom, setZoom] = useState(6);
  const gridRef = useRef<HTMLDivElement>(null);
  const gridOuterRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [downloads, setDownloads] = useState<DownloadTask[]>([]);
  const [refError, setRefError] = useState("");

  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [videoMuted, setVideoMuted] = useState(true);

  // Media picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<"refImage" | "startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo" | null>(null);
  const [pickerUploadKind, setPickerUploadKind] = useState<"image" | "video">("image");

  // Reference images — restored from localStorage on mount
  const [refImages, setRefImages] = useState<RefImage[]>(() => {
    const s = loadSettings(tab);
    return (s?.refImageUrls ?? []).map(url => ({
      id: url, objectUrl: url, cdnUrl: url, uploading: false, error: false,
    }));
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Video reference state
  const [vidStartFrame, setVidStartFrame] = useState<RefImage | null>(null);
  const [vidEndFrame, setVidEndFrame]     = useState<RefImage | null>(null);
  const [vidResources, setVidResources]   = useState<RefImage[]>([]);
  const [vidVideoRef, setVidVideoRef]     = useState<RefImage | null>(null);
  const [vidRefVideos, setVidRefVideos]   = useState<RefImage[]>([]);
  const [vidRefAudios, setVidRefAudios]   = useState<RefImage[]>([]);
  const [vidElements, setVidElements]     = useState<KlingElement[]>([]);
  const [elementPickerOpen, setElementPickerOpen] = useState(false);
  const vidImgInputRef   = useRef<HTMLInputElement>(null);
  const vidVideoInputRef = useRef<HTMLInputElement>(null);
  const vidAudioInputRef = useRef<HTMLInputElement>(null);
  const vidPickTarget = useRef<"startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo" | "audioRef" | null>(null);

  // Prompt expansion

  // @ mention state — tagged images also restored from localStorage
  const [taggedImages, setTaggedImages] = useState<TaggedImage[]>(() => {
    const s = loadSettings(tab);
    const urls = s?.refImageUrls ?? [];
    const p = s?.prompt ?? "";
    return urls.flatMap((url, idx) => {
      const label = `img${idx + 1}`;
      return p.includes(`@${label}`) ? [{ label, refId: url, url }] : [];
    });
  });
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionSelIdx, setMentionSelIdx] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const promptBarRef = useRef<HTMLDivElement>(null);
  const overlayInnerRef = useRef<HTMLDivElement>(null);
  const [chipPreview, setChipPreview] = useState<{ tag: TaggedImage; rect: DOMRect } | null>(null);

  const pageRef = useRef(0);
  const tabRef = useRef<Tab>(tab);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [windowWidth, setWindowWidth] = useState(0);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => { refImages.forEach(r => URL.revokeObjectURL(r.objectUrl)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.access_token) {
        fetch("/api/settings/kie-key", { headers: { Authorization: `Bearer ${session.access_token}` } })
          .then(r => r.json())
          .then(d => setKieKeySet(!!d.hasToken))
          .catch(() => setKieKeySet(false))
          .finally(() => setAuthLoaded(true));
      } else {
        setKieKeySet(null);
        setAuthLoaded(true);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Load items ────────────────────────────────────────────────────────────

  const loadItems = useCallback(async (currentTab: Tab, page: number, replace = false) => {
    // Apply cache / loading state synchronously before any await so the UI
    // updates in the very next render rather than after the token promise.
    if (replace) {
      const cached = galleryCache.get(currentTab);
      if (cached) { setItems(cached.items); setHasMore(cached.hasMore); }
      else setLoading(true);
    } else {
      setLoadingMore(true);
    }
    const token = await getToken();
    if (!token) { setLoading(false); setLoadingMore(false); return; }
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

  // Fetches page 0 and returns only brand-new items (not already in the list).
  // Returns data without touching state so callers can batch it with other updates.
  const fetchNewItems = useCallback(async (currentTab: Tab): Promise<GalleryItem[]> => {
    const token = await getToken();
    if (!token) return [];
    try {
      const genType = currentTab === "videos" ? "video" : "image";
      const res = await fetch(`/api/gallery?type=${genType}&page=0`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const { items: fresh } = await res.json() as { items: GalleryItem[]; hasMore: boolean };
      return fresh;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!authLoaded || kieKeySet === null) return;
    if (user) loadItems(tab, 0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoaded, kieKeySet]);

  useEffect(() => {
    tabRef.current = tab;
    pageRef.current = 0;
    setHasMore(true);
    const cached = galleryCache.get(tab);
    if (cached) { setItems(cached.items); setHasMore(cached.hasMore); } else setItems([]);
    if (user) loadItems(tab, 0, true);
    const newModels = tab === "videos" ? VIDEO_MODELS : IMAGE_MODELS;
    const saved = loadSettings(tab);
    const model = (saved?.modelId ? newModels.find(m => m.id === saved.modelId) : null) ?? newModels[0];
    const savedAR = saved?.aspectRatio && model.ratios.includes(saved.aspectRatio) ? saved.aspectRatio : null;
    skipNextModelEffect.current = true;
    setModelId(model.id);
    setPrompt(saved?.prompt ?? "");
    setAspectRatio(savedAR ?? ("defaultRatio" in model ? (model as { defaultRatio: string }).defaultRatio : null) ?? model.ratios[0] ?? "16:9");
    setQuality(saved?.quality ?? "2k");
    setCount(saved?.count ?? 1);
    if ("defaultDuration" in model) setDuration(saved?.duration ?? (model as { defaultDuration: number }).defaultDuration ?? 5);
    if ("defaultMode" in model) setMode(saved?.mode ?? (model as { defaultMode: string }).defaultMode ?? "");
    if ("defaultResolution" in model) setResolution((model as { defaultResolution: string }).defaultResolution);
    setSound(saved?.sound ?? false);
    const savedUrls = saved?.refImageUrls ?? [];
    const savedPrompt = saved?.prompt ?? "";
    setRefImages(prev => {
      prev.forEach(r => URL.revokeObjectURL(r.objectUrl));
      return savedUrls.map(url => ({ id: url, objectUrl: url, cdnUrl: url, uploading: false, error: false }));
    });
    setTaggedImages(
      savedUrls.flatMap((url, idx) => {
        const label = `img${idx + 1}`;
        return savedPrompt.includes(`@${label}`) ? [{ label, refId: url, url }] : [];
      })
    );
    setVidStartFrame(null); setVidEndFrame(null); setVidResources([]);
    setVidVideoRef(null); setVidRefVideos([]); setVidRefAudios([]);
    setVidElements([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (skipNextModelEffect.current) { skipNextModelEffect.current = false; return; }
    const m = models.find(m => m.id === modelId);
    if (!m) return;
    setAspectRatio(("defaultRatio" in m ? m.defaultRatio : null) ?? m.ratios[0] ?? "1:1");
    if ("defaultDuration" in m) setDuration(m.defaultDuration ?? 5);
    if ("defaultMode" in m) setMode(m.defaultMode ?? "");
    if ("defaultResolution" in m) setResolution((m as { defaultResolution: string }).defaultResolution);
    if (!isVideo) {
      const im = m as { apiInput?: { qualityOptions?: string[] }; azureQualityOptions?: string[] };
      const provider = (() => { try { return JSON.parse(localStorage.getItem("aiui-model-providers") ?? "{}")[m.id] ?? "kie"; } catch { return "kie"; } })();
      const base     = (() => { try { return localStorage.getItem("aiui-azure-base-url") ?? ""; } catch { return ""; } })();
      const deploy   = (() => { try { return JSON.parse(localStorage.getItem("aiui-azure-endpoints") ?? "{}")[m.id] ?? ""; } catch { return ""; } })();
      const azure    = provider === "azure" && !!base && !!deploy && !!im.azureQualityOptions;
      const validQ   = azure ? im.azureQualityOptions! : (im.apiInput?.qualityOptions ?? []);
      if (validQ.length) {
        setQuality(prev => validQ.includes(prev) ? prev : validQ[0]);
      }
    }
    if (!("supportsImages" in m) || !m.supportsImages) {
      setRefImages(prev => { prev.forEach(r => URL.revokeObjectURL(r.objectUrl)); return []; });
      setTaggedImages([]);
    }
    if (isVideo) {
      setVidStartFrame(null); setVidEndFrame(null); setVidResources([]);
      setVidVideoRef(null); setVidRefVideos([]); setVidRefAudios([]);
      setVidElements([]);
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
    const refImageUrls = refImages
      .filter(r => r.cdnUrl && !r.uploading && !r.error)
      .map(r => r.cdnUrl!);
    saveSettings(tab, { prompt, modelId, aspectRatio, quality, count, duration, mode, sound, refImageUrls });
  }, [tab, prompt, modelId, aspectRatio, quality, count, duration, mode, sound, refImages]);

  // Track window width; set initial zoom from breakpoints
  useEffect(() => {
    const w = window.innerWidth;
    setWindowWidth(w);
    setZoom(w >= 1400 ? 6 : w >= 900 ? 5 : w >= 640 ? 5 : 4);
    const handler = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const el = gridOuterRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setContainerWidth(e.contentRect.width));
    ro.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  // Re-run once the full layout is mounted (after auth loads and user is present)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoaded, user]);

  // ── Image upload ──────────────────────────────────────────────────────────

  const imgModel = IMAGE_MODELS.find(m => m.id === modelId);
  const maxImgs = imgModel?.maxImages ?? 0;
  const canAddImgs = !isVideo && !!imgModel?.supportsImages && refImages.length < maxImgs;
  const promptMaxLength = (() => {
    if (isVideo) {
      const vm = VIDEO_MODELS.find(m => m.id === modelId);
      return vm?.apiInput.promptMaxLength ?? null;
    }
    if (!imgModel) return null;
    const hasRefImgs = refImages.length > 0;
    if (!hasRefImgs && imgModel.textOnlyPromptMaxLength) return imgModel.textOnlyPromptMaxLength;
    return imgModel.apiInput.promptMaxLength;
  })();
  const promptOverLimit = promptMaxLength !== null && prompt.length > promptMaxLength;

  const handleFilePick = async (files: FileList) => {
    if (!imgModel?.supportsImages) return;
    const remaining = maxImgs - refImages.length;
    const toAdd = Array.from(files).slice(0, remaining).filter(f => f.type.startsWith("image/"));
    if (toAdd.length === 0) return;

    const newEntries: RefImage[] = toAdd.map(f => ({
      id: crypto.randomUUID(),
      objectUrl: URL.createObjectURL(f),
      cdnUrl: null,
      uploading: true,
      error: false,
    }));
    setRefImages(prev => [...prev, ...newEntries]);

    const token = await getToken();
    await Promise.all(toAdd.map(async (file, i) => {
      const entry = newEntries[i];
      try {
        const res = await fetch("/api/upload-asset", {
          method: "POST",
          headers: {
            "Content-Type": file.type,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: file,
        });
        const data = await res.json() as { cdnUrl?: string; error?: string };
        if (!res.ok || !data.cdnUrl) throw new Error(data.error ?? "Upload failed");
        setRefImages(prev => prev.map(r => r.id === entry.id ? { ...r, cdnUrl: data.cdnUrl!, uploading: false } : r));
      } catch {
        setRefImages(prev => prev.map(r => r.id === entry.id ? { ...r, uploading: false, error: true } : r));
      }
    }));
  };

  const removeImage = (id: string) => {
    const el = document.querySelector(`[data-refimg-id="${id}"]`) as HTMLElement | null;
    if (el) {
      // Synchronous DOM write — zero frame delay, starts before React scheduler
      el.style.transition = "opacity 170ms cubic-bezier(0.4,0,1,1), transform 170ms cubic-bezier(0.4,0,1,1)";
      el.style.opacity = "0";
      el.style.transform = "translateY(-10px) scale(0.92)";
    }
    // React state as a backup so any re-render in the window doesn't reset the styles
    setRemovingIds(prev => new Set(prev).add(id));
    setTimeout(() => {
      setRemovingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      setRefImages(prev => {
        const img = prev.find(r => r.id === id);
        if (img) URL.revokeObjectURL(img.objectUrl);
        return prev.filter(r => r.id !== id);
      });
    }, 190);
  };

  // ── Video reference upload ────────────────────────────────────────────────

  const handleVidFilePick = async (
    files: FileList | null,
    target: "startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo" | "audioRef",
  ) => {
    if (!files || files.length === 0) return;
    const vm = VIDEO_MODELS.find(m => m.id === modelId);
    const isSingle = target === "startFrame" || target === "endFrame" || target === "videoRef";

    const maxCount = isSingle ? 1 : (
      target === "resource"        ? (vm?.maxResources      ?? 3) :
      target === "referenceVideo"  ? (vm?.maxReferenceVideos ?? 3) :
                                     (vm?.maxReferenceAudios ?? 3)
    );
    const currentCount = isSingle ? 0 : (
      target === "resource"        ? vidResources.length :
      target === "referenceVideo"  ? vidRefVideos.length :
                                     vidRefAudios.length
    );
    const toAdd = Array.from(files).slice(0, maxCount - currentCount);
    if (toAdd.length === 0) return;

    const newEntries: RefImage[] = toAdd.map(f => ({
      id: crypto.randomUUID(),
      objectUrl: URL.createObjectURL(f),
      cdnUrl: null,
      uploading: true,
      error: false,
    }));

    if (isSingle) {
      const [entry] = newEntries;
      if (target === "startFrame") setVidStartFrame(entry);
      else if (target === "endFrame") setVidEndFrame(entry);
      else setVidVideoRef(entry);
    } else {
      if (target === "resource")       setVidResources(prev => [...prev, ...newEntries]);
      else if (target === "referenceVideo") setVidRefVideos(prev => [...prev, ...newEntries]);
      else                             setVidRefAudios(prev => [...prev, ...newEntries]);
    }

    const token = await getToken();
    await Promise.all(toAdd.map(async (file, i) => {
      const entry = newEntries[i];
      try {
        const res = await fetch("/api/upload-asset", {
          method: "POST",
          headers: { "Content-Type": file.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: file,
        });
        const data = await res.json() as { cdnUrl?: string; error?: string };
        if (!res.ok || !data.cdnUrl) throw new Error(data.error ?? "Upload failed");
        const ok = (r: RefImage) => r.id === entry.id ? { ...r, cdnUrl: data.cdnUrl!, uploading: false } : r;
        if (isSingle) {
          if (target === "startFrame") setVidStartFrame(p => p?.id === entry.id ? { ...p, cdnUrl: data.cdnUrl!, uploading: false } : p);
          else if (target === "endFrame") setVidEndFrame(p => p?.id === entry.id ? { ...p, cdnUrl: data.cdnUrl!, uploading: false } : p);
          else setVidVideoRef(p => p?.id === entry.id ? { ...p, cdnUrl: data.cdnUrl!, uploading: false } : p);
        } else {
          if (target === "resource")       setVidResources(prev => prev.map(ok));
          else if (target === "referenceVideo") setVidRefVideos(prev => prev.map(ok));
          else                             setVidRefAudios(prev => prev.map(ok));
        }
      } catch {
        const err = (r: RefImage) => r.id === entry.id ? { ...r, uploading: false, error: true } : r;
        if (isSingle) {
          if (target === "startFrame") setVidStartFrame(p => p?.id === entry.id ? { ...p, uploading: false, error: true } : p);
          else if (target === "endFrame") setVidEndFrame(p => p?.id === entry.id ? { ...p, uploading: false, error: true } : p);
          else setVidVideoRef(p => p?.id === entry.id ? { ...p, uploading: false, error: true } : p);
        } else {
          if (target === "resource")       setVidResources(prev => prev.map(err));
          else if (target === "referenceVideo") setVidRefVideos(prev => prev.map(err));
          else                             setVidRefAudios(prev => prev.map(err));
        }
      }
    }));
  };

  const removeVidRef = (id: string, target: "startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo" | "audioRef") => {
    if (target === "startFrame")      setVidStartFrame(null);
    else if (target === "endFrame")   setVidEndFrame(null);
    else if (target === "videoRef")   setVidVideoRef(null);
    else if (target === "resource")   setVidResources(prev => prev.filter(r => r.id !== id));
    else if (target === "referenceVideo") setVidRefVideos(prev => prev.filter(r => r.id !== id));
    else                              setVidRefAudios(prev => prev.filter(r => r.id !== id));
  };

  // ── Media picker ──────────────────────────────────────────────────────────

  const openPicker = (target: NonNullable<typeof pickerTarget>, uploadKind: "image" | "video") => {
    setPickerTarget(target);
    setPickerUploadKind(uploadKind);
    setPickerOpen(true);
  };

  const handlePickerSelect = (url: string) => {
    setPickerOpen(false);
    if (!pickerTarget) return;
    if (pickerTarget === "refImage") {
      handleAddReference(url);
      return;
    }
    const isDup = (slots: RefImage[]) => slots.some(r => r.cdnUrl === url || r.objectUrl === url);
    const showDup = () => { setRefError("Already attached."); setTimeout(() => setRefError(""), 3000); };

    if (pickerTarget === "resource") {
      if (isDup(vidResources)) { showDup(); return; }
      setVidResources(prev => [...prev, { id: crypto.randomUUID(), objectUrl: url, cdnUrl: url, uploading: false, error: false }]);
      return;
    }
    if (pickerTarget === "referenceVideo") {
      if (isDup(vidRefVideos)) { showDup(); return; }
      setVidRefVideos(prev => [...prev, { id: crypto.randomUUID(), objectUrl: url, cdnUrl: url, uploading: false, error: false }]);
      return;
    }
    const entry: RefImage = { id: crypto.randomUUID(), objectUrl: url, cdnUrl: url, uploading: false, error: false };
    if (pickerTarget === "startFrame")    setVidStartFrame(entry);
    else if (pickerTarget === "endFrame") setVidEndFrame(entry);
    else if (pickerTarget === "videoRef") setVidVideoRef(entry);
  };

  const handlePickerUpload = () => {
    setPickerOpen(false);
    if (pickerTarget === "refImage") {
      fileInputRef.current?.click();
    } else if (pickerTarget) {
      vidPickTarget.current = pickerTarget as "startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo";
      if (pickerUploadKind === "image") vidImgInputRef.current?.click();
      else vidVideoInputRef.current?.click();
    }
  };

  // ── Generate ──────────────────────────────────────────────────────────────

  const generateOne = async (token: string): Promise<string> => {
    if (!isVideo) {
      const { resolvedPrompt, extraUrls } = resolveGalleryMentions(prompt, taggedImages);
      const refUrls = refImages.filter(r => r.cdnUrl && !r.error).map(r => r.cdnUrl!);
      const imageUrls = [...extraUrls, ...refUrls];

      // Read provider settings from localStorage (same keys as GenerateNode)
      const azureBaseUrl    = (() => { try { return localStorage.getItem("aiui-azure-base-url") ?? ""; } catch { return ""; } })();
      const azureDeployment = (() => { try { return JSON.parse(localStorage.getItem("aiui-azure-endpoints") ?? "{}")[modelId] ?? ""; } catch { return ""; } })();
      const providerForModel = (() => { try { return JSON.parse(localStorage.getItem("aiui-model-providers") ?? "{}")[modelId] ?? "kie"; } catch { return "kie"; } })();
      const isAzure = !!(azureBaseUrl && azureDeployment && providerForModel === "azure");

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          prompt: resolvedPrompt, model: modelId, aspectRatio, quality, imageUrls,
          ...(isAzure ? { azureBaseUrl, azureDeployment, azureQuality: quality } : {}),
        }),
      });
      const d = await res.json() as { taskId?: string; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Failed");
      return d.taskId!;
    } else {
      const vm = VIDEO_MODELS.find(m => m.id === modelId);
      const handles = vm?.handles ?? [];

      const startFrameUrl = handles.includes("startFrame") && vidStartFrame?.cdnUrl ? vidStartFrame.cdnUrl : undefined;
      const endFrameUrl   = handles.includes("endFrame")   && vidEndFrame?.cdnUrl   ? vidEndFrame.cdnUrl   : undefined;
      const videoRefUrl   = handles.includes("videoRef")   && vidVideoRef?.cdnUrl   ? vidVideoRef.cdnUrl   : undefined;

      const useElements = !!(vm?.apiInput.useKlingElements);

      // Non-kling resource models send referenceImageUrls
      const resourceUrls = handles.includes("resource") && !useElements
        ? vidResources.filter(r => r.cdnUrl && !r.error).map(r => r.cdnUrl!)
        : [];
      const referenceImageUrls = !useElements && resourceUrls.length ? resourceUrls : undefined;

      // Kling: send structured elements
      const klingElements = useElements && handles.includes("resource") && vidElements.length > 0
        ? vidElements.map(el => ({ name: el.name, description: el.description, imageUrls: el.imageUrls }))
        : undefined;

      const referenceVideoUrls = handles.includes("referenceVideo")
        ? vidRefVideos.filter(r => r.cdnUrl && !r.error).map(r => r.cdnUrl!)
        : undefined;
      const referenceAudioUrls = handles.includes("audioRef")
        ? vidRefAudios.filter(r => r.cdnUrl && !r.error).map(r => r.cdnUrl!)
        : undefined;

      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          videoModel: modelId,
          prompt,
          aspectRatio,
          duration,
          sound: vm?.sound ? sound : false,
          mode: mode || vm?.defaultMode || "pro",
          resolution: vm && "resolutions" in vm && vm.resolutions?.length ? resolution || vm.defaultResolution : undefined,
          ...(startFrameUrl               ? { startFrameUrl }               : {}),
          ...(endFrameUrl                 ? { endFrameUrl }                 : {}),
          ...(videoRefUrl                 ? { videoRefUrl }                 : {}),
          ...(klingElements?.length       ? { klingElements }               : {}),
          ...(referenceImageUrls?.length  ? { referenceImageUrls }          : {}),
          ...(referenceVideoUrls?.length  ? { referenceVideoUrls }          : {}),
          ...(referenceAudioUrls?.length  ? { referenceAudioUrls }          : {}),
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
      const poll = await fetch(`/api/job-status?taskId=${taskId}`);
      const result = await poll.json() as { status: string; error?: string };
      if (result.status === "done") return;
      if (result.status === "error") throw new Error(result.error ?? "Generation failed");
    }
    throw new Error("Timed out");
  };

  const generate = async () => {
    if (!prompt.trim() && !isVideo) return;
    if (refImages.some(r => r.uploading)) { setGenError("Images still uploading…"); setTimeout(() => setGenError(""), 3_000); return; }
    if (isVideo && [vidStartFrame, vidEndFrame, vidVideoRef, ...vidResources, ...vidRefVideos, ...vidRefAudios].some(r => r?.uploading)) {
      setGenError("References still uploading…"); setTimeout(() => setGenError(""), 3_000); return;
    }
    setGenError("");

    const n = isVideo ? 1 : count;
    const snapshotRefUrls = refImages.filter(r => r.cdnUrl && !r.error).map(r => r.cdnUrl!);
    const newPendings: PendingGen[] = Array.from({ length: n }, () => ({
      id: crypto.randomUUID(), aspectRatio, prompt, referenceImageUrls: snapshotRefUrls,
    }));
    setPendingGens(prev => [...prev, ...newPendings]);

    // ── Debug mode: log + simulate, no real API call ────────────────────────
    if (debugMode) {
      const { resolvedPrompt: dbgPrompt, extraUrls: dbgExtra } = resolveGalleryMentions(prompt, taggedImages);
      const dbgRefUrls = refImages.filter(r => r.cdnUrl && !r.error).map(r => r.cdnUrl!);
      const dbgAzureBaseUrl    = (() => { try { return localStorage.getItem("aiui-azure-base-url") ?? ""; } catch { return ""; } })();
      const dbgAzureDeployment = (() => { try { return JSON.parse(localStorage.getItem("aiui-azure-endpoints") ?? "{}")[modelId] ?? ""; } catch { return ""; } })();
      const dbgProvider        = (() => { try { return JSON.parse(localStorage.getItem("aiui-model-providers") ?? "{}")[modelId] ?? "kie"; } catch { return "kie"; } })();
      const dbgIsAzure = !!(dbgAzureBaseUrl && dbgAzureDeployment && dbgProvider === "azure");
      console.log("[Gallery Debug] Generate request:", {
        type: isVideo ? "video" : "image",
        prompt: dbgPrompt, model: modelId, aspectRatio, quality,
        provider: dbgIsAzure ? "azure" : "kie",
        ...(dbgIsAzure ? { azureBaseUrl: dbgAzureBaseUrl, azureDeployment: dbgAzureDeployment, azureQuality: "auto" } : {}),
        ...(isVideo
          ? { duration, mode }
          : { imageUrls: [...dbgExtra, ...dbgRefUrls], count: n }),
      });
      setTimeout(() => {
        setPendingGens(prev => prev.filter(p => !newPendings.some(np => np.id === p.id)));
      }, 3_000);
      return;
    }

    // ── Submit ────────────────────────────────────────────────────────────
    const token = await getToken();
    if (!token) {
      setPendingGens(prev => prev.map(p =>
        newPendings.some(np => np.id === p.id) ? { ...p, error: "Please sign in to generate." } : p
      ));
      return;
    }

    setSubmitting(true);
    let taskIds: string[];
    try {
      taskIds = await Promise.all(newPendings.map(() => generateOne(token)));
    } catch (e: unknown) {
      setSubmitting(false);
      const msg = e instanceof Error ? e.message : String(e);
      setPendingGens(prev => prev.map(p =>
        newPendings.some(np => np.id === p.id) ? { ...p, error: msg } : p
      ));
      return;
    }
    setSubmitting(false); // re-enable button — polling happens in background

    // ── Poll each task independently ───────────────────────────────────────
    taskIds.forEach(async (taskId, i) => {
      const pending = newPendings[i];
      try {
        await pollTask(taskId);
        // Fetch fresh items before touching state so both updates land in one render.
        const fresh = await fetchNewItems(tabRef.current);
        setPendingGens(prev => prev.filter(p => p.id !== pending.id));
        if (fresh.length > 0) {
          setItems(prev => {
            const existingIds = new Set(prev.map(i => i.id));
            const brandNew = fresh.filter(i => !existingIds.has(i.id));
            if (brandNew.length === 0) return prev;
            const merged = [...brandNew, ...prev];
            galleryCache.set(tabRef.current, { items: merged, hasMore: true });
            return merged;
          });
        }
        window.dispatchEvent(new Event("credits-refresh"));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setPendingGens(prev => prev.map(p => p.id === pending.id ? { ...p, error: msg } : p));
      }
    });
  };

  // ── @ mention derived + helpers ───────────────────────────────────────────

  const mentionableImages = useMemo(() =>
    refImages.filter(r => !r.uploading && !r.error && r.cdnUrl),
    [refImages]);

  const filteredMentions = useMemo(() => {
    if (mentionQuery === null) return [];
    return mentionableImages.slice(0, 8);
  }, [mentionableImages, mentionQuery]);

  const atMenuOpen = !isVideo && mentionQuery !== null && filteredMentions.length > 0;

  useEffect(() => { setMentionSelIdx(0); }, [filteredMentions.length]);

  // Sync: remove chips whose @label was deleted from the prompt
  useEffect(() => {
    setTaggedImages(prev => prev.filter(t => prompt.includes(`@${t.label}`)));
    if (inputRef.current) {
      resizeTextarea(inputRef.current);
      inputRef.current.scrollTop = 0;
    }
    if (overlayInnerRef.current) overlayInnerRef.current.style.transform = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  const openDurPicker = useCallback(() => {
    const r = durPillRef.current?.getBoundingClientRect();
    if (!r) return;
    setDurPickerPos({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    setDurPickerOpen(true);
  }, []);

  const closeDurPicker = useCallback(() => {
    if (durCloseTimer.current) clearTimeout(durCloseTimer.current);
    setDurPickerOpen(false);
    setDurPickerClosing(true);
    durCloseTimer.current = setTimeout(() => setDurPickerClosing(false), 180);
  }, []);

  // Close duration picker on outside click
  useEffect(() => {
    if (!durPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (!durPillRef.current?.contains(e.target as Node)) closeDurPicker();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [durPickerOpen, closeDurPicker]);

  // Close @ menu on outside click
  useEffect(() => {
    if (!atMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-at-menu]") &&
        !(e.target as HTMLElement).closest("[data-prompt-input]")) {
        setMentionQuery(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [atMenuOpen]);

  const insertMention = (ref: RefImage) => {
    const pos = refImages.findIndex(r => r.id === ref.id);
    const label = `img${pos + 1}`;
    if (!taggedImages.some(t => t.refId === ref.id))
      setTaggedImages(prev => [...prev, { label, refId: ref.id, url: ref.cdnUrl! }]);

    const input = inputRef.current;
    const cursor = input?.selectionStart ?? prompt.length;
    const before = prompt.slice(0, cursor);
    const after = prompt.slice(cursor);
    const lastAt = before.lastIndexOf("@");
    const newText = lastAt >= 0
      ? `${before.slice(0, lastAt)}@${label} ${after}`
      : `${before}@${label} ${after}`;
    const newPos = (lastAt >= 0 ? lastAt : cursor) + label.length + 2;

    setPrompt(newText);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      if (!input) return;
      input.focus();
      input.setSelectionRange(newPos, newPos);
    });
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const vidModel = VIDEO_MODELS.find(m => m.id === modelId);
  const ratios = (isVideo ? vidModel?.ratios : imgModel?.ratios) ?? [];
  const supportsQ = !isVideo && !!imgModel?.supportsQuality;

  // Read provider from localStorage to pick the right quality option set
  const isAzureProvider = !isVideo && !!imgModel && (() => {
    try {
      const provider = JSON.parse(localStorage.getItem("aiui-model-providers") ?? "{}")[modelId] ?? "kie";
      const base      = localStorage.getItem("aiui-azure-base-url") ?? "";
      const deploy    = JSON.parse(localStorage.getItem("aiui-azure-endpoints") ?? "{}")[modelId] ?? "";
      return provider === "azure" && !!base && !!deploy && !!imgModel.azureQualityOptions;
    } catch { return false; }
  })();
  const qualityOpts: string[] = isAzureProvider
    ? (imgModel!.azureQualityOptions ?? [])
    : (imgModel?.apiInput.qualityOptions ?? ["2k", "4k"]);
  const durations = vidModel?.durations ?? [];
  const vidModes = vidModel?.modes ?? [];
  const activeModel = models.find(m => m.id === modelId);
  const hasRefImgs = refImages.length > 0;
  const allUploaded = refImages.every(r => !r.uploading);
  const vidRefHandles = (vidModel?.handles ?? []).filter(h => h !== "prompt");
  const hasVidRefs = isVideo && (!!vidStartFrame || !!vidEndFrame || !!vidVideoRef || vidResources.length > 0 || vidElements.length > 0 || vidRefVideos.length > 0 || vidRefAudios.length > 0);

  const vidRequiresPrompt = isVideo && !!(vidModel?.apiInput.promptMaxLength);
  const canGenerate = kieKeySet === false ? false : submitting ? false : promptOverLimit ? false : (vidRequiresPrompt || !isVideo) ? prompt.trim().length > 0 : true;

  const handleAddReference = useCallback((url: string) => {
    if (refImages.some(r => r.cdnUrl === url || r.objectUrl === url)) {
      setRefError("Already added as a reference.");
      setTimeout(() => setRefError(""), 3000);
      return;
    }
    if (refImages.length >= maxImgs) return;
    setRefImages(prev => [...prev, { id: crypto.randomUUID(), objectUrl: url, cdnUrl: url, uploading: false, error: false }]);
  }, [refImages, maxImgs]);

  const handleCopyPrompt = useCallback((text: string, refUrls?: string[]) => {
    setRefImages(prev => {
      prev.forEach(r => URL.revokeObjectURL(r.objectUrl));
      return (refUrls ?? []).map(url => ({
        id: crypto.randomUUID(), objectUrl: url, cdnUrl: url, uploading: false, error: false,
      }));
    });
    setTaggedImages([]);
    setPrompt(text);
    requestAnimationFrame(() => {
      if (inputRef.current) resizeTextarea(inputRef.current);
    });
  }, []);

  const handleDelete = useCallback(async (id: string, source: "generation" | "upload") => {
    const token = await getToken();
    if (!token) return;
    await fetch("/api/gallery", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, source }),
    });
    setItems(prev => {
      const updated = prev.filter(i => i.id !== id);
      galleryCache.set(tabRef.current, { items: updated, hasMore });
      return updated;
    });
  }, [hasMore]);

  const handleDownload = useCallback(async (url: string, itemIsVideo: boolean): Promise<void> => {
    const ext = itemIsVideo ? "mp4" : "jpg";
    const filename = `${Date.now()}.${ext}`;
    const taskId = crypto.randomUUID();
    setDownloads(prev => [...prev, { id: taskId, filename, status: "preparing" }]);
    try {
      const res = await fetch(`/api/download?url=${encodeURIComponent(url)}&filename=${filename}`);
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
      setDownloads(prev => prev.map(t => t.id === taskId ? { ...t, status: "ready" } : t));
    } catch {
      setDownloads(prev => prev.map(t => t.id === taskId ? { ...t, status: "error" } : t));
    }
  }, []);

  // Auto-dismiss download toast when all tasks complete
  useEffect(() => {
    if (downloads.length > 0 && downloads.every(d => d.status !== "preparing")) {
      const timer = setTimeout(() => setDownloads([]), 4000);
      return () => clearTimeout(timer);
    }
  }, [downloads]);

  const GALLERY_GAP = 3;

  const filteredItems = useMemo(() =>
    sourceFilter === "generated"
      ? items.filter(item => item.source === "generation")
      : items.filter(item => item.source === "upload"),
    [items, sourceFilter]);

  const justifiedRows = useMemo(() => {
    if (containerWidth <= 0) return [];
    const targetH = Math.max(80, Math.min(400, Math.round(containerWidth / Math.max(1, zoom))));

    type LayoutEntry =
      | { kind: "pending"; pg: PendingGen; ratio: number; width: number }
      | { kind: "gallery"; item: GalleryItem; ratio: number; width: number };

    const allItems: LayoutEntry[] = [
      ...pendingGens.map(pg => {
        const [ws, hs] = pg.aspectRatio.split(":");
        const w = parseFloat(ws), h = parseFloat(hs);
        return { kind: "pending" as const, pg, ratio: (w && h) ? w / h : 1, width: 0 };
      }),
      ...filteredItems.map(item => {
        const ar = item.aspect_ratio;
        let ratio = 1;
        if (ar && ar !== "auto") {
          const [w, h] = ar.split(":");
          const wn = parseFloat(w), hn = parseFloat(h);
          if (wn && hn) ratio = wn / hn;
        }
        return { kind: "gallery" as const, item, ratio, width: 0 };
      }),
    ];

    const rows: Array<{ items: LayoutEntry[]; height: number }> = [];
    let cur: LayoutEntry[] = [];
    let ratioSum = 0;

    const sealRow = (items: LayoutEntry[], rSum: number, rowH: number) => {
      const totalGaps = (items.length - 1) * GALLERY_GAP;
      const availW = containerWidth - totalGaps;
      rows.push({
        items: items.map(it => ({ ...it, width: availW * it.ratio / rSum })),
        height: rowH,
      });
    };

    for (const item of allItems) {
      cur.push(item);
      ratioSum += item.ratio;
      const gaps = (cur.length - 1) * GALLERY_GAP;
      const h = (containerWidth - gaps) / ratioSum;
      if (h <= targetH) {
        sealRow(cur, ratioSum, h);
        cur = [];
        ratioSum = 0;
      }
    }

    if (cur.length > 0) sealRow(cur, ratioSum, targetH);

    return rows;
  }, [containerWidth, zoom, pendingGens, filteredItems, GALLERY_GAP]);


  // ── Render ────────────────────────────────────────────────────────────────

  if (!authLoaded) return <div style={{ flex: 1, background: "#1A1A1C" }} />;

  if (!user) {
    return (
      <div style={{ flex: 1, background: "#1A1A1C", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px" }}>
        <p style={{ color: "#4A4A45", fontSize: "14px" }}>Sign in to view your gallery</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, background: "#1A1A1C", display: "flex", flexDirection: "column", overflow: "hidden", color: "#fff" }}>

      {/* ── Sub-navbar ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14px",
        height: "44px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        flexShrink: 0,
      }}>
        {/* Left: source tabs */}
        <div style={{ display: "flex", gap: "2px" }}>
          {(["generated", "uploaded"] as const).map(src => (
            <button
              key={src}
              onClick={() => setSourceFilter(src)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "5px 12px",
                borderRadius: "8px",
                border: "none",
                background: sourceFilter === src ? "rgba(255,255,255,0.08)" : "transparent",
                color: sourceFilter === src ? "#ffffff" : "rgba(255,255,255,0.38)",
                fontSize: "13px",
                fontWeight: sourceFilter === src ? 500 : 400,
                cursor: "pointer",
                transition: "background 140ms, color 140ms",
                fontFamily: "inherit",
                letterSpacing: "-0.01em",
              }}
              onMouseEnter={e => { if (sourceFilter !== src) e.currentTarget.style.color = "rgba(255,255,255,0.65)"; }}
              onMouseLeave={e => { if (sourceFilter !== src) e.currentTarget.style.color = "rgba(255,255,255,0.38)"; }}
            >
              {src === "generated" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              )}
              {src === "generated" ? "Generated" : "Uploaded"}
            </button>
          ))}
        </div>

        {/* Right: zoom slider */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35M8 11h6" />
          </svg>
          <input
            type="range"
            min={4} max={8} step={1}
            value={12 - zoom}
            onChange={e => setZoom(12 - Number(e.target.value))}
            className="gallery-zoom-slider"
          />
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35M11 8v6M8 11h6" />
          </svg>
        </div>
      </div>

      {/* ── Grid ── */}
      <div ref={gridOuterRef} style={{ flex: 1, overflowY: "auto", paddingBottom: "260px" }}>
        {loading || containerWidth === 0 ? (
          /* Skeleton — shown while loading or before container size is measured */
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${zoom}, 1fr)`, gap: "3px", padding: "3px", alignItems: "start" }}>
            {Array.from({ length: zoom * 3 }).map((_, i) => (
              <div key={i} className="gallery-skeleton" style={{ aspectRatio: i % 3 === 1 ? "4 / 5" : i % 5 === 0 ? "16 / 9" : "1 / 1" }} />
            ))}
          </div>
        ) : filteredItems.length === 0 && pendingGens.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div ref={gridRef} style={{ padding: "3px" }}>
            {justifiedRows.map((row, rowIdx) => (
              <div
                key={rowIdx}
                style={{
                  display: "flex",
                  height: row.height,
                  gap: `${GALLERY_GAP}px`,
                  marginBottom: rowIdx < justifiedRows.length - 1 ? `${GALLERY_GAP}px` : 0,
                }}
              >
                {row.items.map(layoutItem => {
                  if (layoutItem.kind === "pending") {
                    const pg = layoutItem.pg;
                    return (
                      <div key={pg.id} style={{
                        width: layoutItem.width,
                        flex: "0 0 auto",
                        height: "100%",
                        position: "relative",
                        overflow: "hidden",
                        background: pg.error ? "rgba(20,8,8,0.95)" : "#0D1012",
                      }}>
                        {pg.error ? (
                          <>
                            <div style={{
                              position: "absolute", inset: 0,
                              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                              gap: "10px", padding: "16px 48px 16px 16px",
                            }}>
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.8" strokeLinecap="round">
                                <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                              </svg>
                              <p style={{
                                fontSize: "11px", color: "#f87171", textAlign: "center",
                                lineHeight: 1.45, wordBreak: "break-word",
                                display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden",
                              }}>
                                {pg.error}
                              </p>
                            </div>
                            <div style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 5, zIndex: 5 }}>
                              <button className="gallery-action-btn" title="Paste prompt & images" onClick={() => handleCopyPrompt(pg.prompt, pg.referenceImageUrls)}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                              </button>
                              <button className="gallery-action-btn" title="Retry" onClick={async () => {
                                const newId = crypto.randomUUID();
                                const newPending: PendingGen = { id: newId, aspectRatio: pg.aspectRatio, prompt: pg.prompt, referenceImageUrls: pg.referenceImageUrls };
                                setPendingGens(prev => [...prev.filter(p => p.id !== pg.id), newPending]);
                                const token = await getToken();
                                if (!token) { setPendingGens(prev => prev.map(p => p.id === newId ? { ...p, error: "Please sign in." } : p)); return; }
                                const storedRefs = pg.referenceImageUrls ?? [];
                                const syntheticTagged: TaggedImage[] = storedRefs.map((url, i) => ({ label: `img${i + 1}`, refId: url, url }));
                                const { resolvedPrompt, extraUrls } = resolveGalleryMentions(pg.prompt, syntheticTagged);
                                const dedupedExtra = new Set(extraUrls);
                                const imageUrls = [...extraUrls, ...storedRefs.filter(u => !dedupedExtra.has(u))];
                                const azureBaseUrl    = (() => { try { return localStorage.getItem("aiui-azure-base-url") ?? ""; } catch { return ""; } })();
                                const azureDeployment = (() => { try { return JSON.parse(localStorage.getItem("aiui-azure-endpoints") ?? "{}")[modelId] ?? ""; } catch { return ""; } })();
                                const providerForModel = (() => { try { return JSON.parse(localStorage.getItem("aiui-model-providers") ?? "{}")[modelId] ?? "kie"; } catch { return "kie"; } })();
                                const isAzure = !!(azureBaseUrl && azureDeployment && providerForModel === "azure");
                                let taskId: string;
                                try {
                                  const res = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ prompt: resolvedPrompt, model: modelId, aspectRatio: pg.aspectRatio, quality, imageUrls, ...(isAzure ? { azureBaseUrl, azureDeployment, azureQuality: quality } : {}) }) });
                                  const d = await res.json() as { taskId?: string; error?: string };
                                  if (!res.ok) throw new Error(d.error ?? "Failed");
                                  taskId = d.taskId!;
                                } catch (e: unknown) {
                                  setPendingGens(prev => prev.map(p => p.id === newId ? { ...p, error: e instanceof Error ? e.message : String(e) } : p));
                                  return;
                                }
                                try {
                                  await pollTask(taskId);
                                  const fresh = await fetchNewItems(tabRef.current);
                                  setPendingGens(prev => prev.filter(p => p.id !== newId));
                                  if (fresh.length > 0) {
                                    setItems(prev => {
                                      const existingIds = new Set(prev.map(i => i.id));
                                      const brandNew = fresh.filter(i => !existingIds.has(i.id));
                                      if (brandNew.length === 0) return prev;
                                      const merged = [...brandNew, ...prev];
                                      galleryCache.set(tabRef.current, { items: merged, hasMore: true });
                                      return merged;
                                    });
                                  }
                                  window.dispatchEvent(new Event("credits-refresh"));
                                } catch (e: unknown) {
                                  setPendingGens(prev => prev.map(p => p.id === newId ? { ...p, error: e instanceof Error ? e.message : String(e) } : p));
                                }
                              }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
                                </svg>
                              </button>
                              <button className="gallery-action-btn gallery-delete-btn" title="Dismiss" onClick={() => setPendingGens(prev => prev.filter(p => p.id !== pg.id))}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                </svg>
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                              <div style={{ width: "20px", height: "20px", borderRadius: "50%", border: "2px solid rgba(119,229,68,0.15)", borderTopColor: "#ff3df5", animation: "spin 0.9s linear infinite" }} />
                              <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.22)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Generating</span>
                            </div>
                            {pg.prompt && (
                              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "24px 10px 10px", background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)" }}>
                                <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{pg.prompt}</p>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={layoutItem.item.id} style={{ width: layoutItem.width, flex: "0 0 auto", height: "100%", overflow: "hidden" }}>
                      <GalleryCard
                        item={layoutItem.item}
                        onOpen={() => setLightboxItem(layoutItem.item)}
                        onAddReference={layoutItem.item.mediaType === "image" && canAddImgs ? handleAddReference : undefined}
                        onCopyPrompt={handleCopyPrompt}
                        onDownload={handleDownload}
                        onDelete={handleDelete}
                        videoMuted={videoMuted}
                        onToggleMute={() => setVideoMuted(m => !m)}
                      />
                    </div>
                  );
                })}
              </div>
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
      <input ref={vidImgInputRef}   type="file" accept="image/*" multiple style={{ display: "none" }}
        onChange={e => { if (e.target.files && vidPickTarget.current) { handleVidFilePick(e.target.files, vidPickTarget.current); e.target.value = ""; } }} />
      <input ref={vidVideoInputRef} type="file" accept="video/*" multiple style={{ display: "none" }}
        onChange={e => { if (e.target.files && vidPickTarget.current) { handleVidFilePick(e.target.files, vidPickTarget.current); e.target.value = ""; } }} />
      <input ref={vidAudioInputRef} type="file" accept="audio/*" multiple style={{ display: "none" }}
        onChange={e => { if (e.target.files && vidPickTarget.current) { handleVidFilePick(e.target.files, vidPickTarget.current); e.target.value = ""; } }} />

      {/* ── Prompt bar ── */}
      <div
        ref={promptBarRef}
        style={{
          position: "fixed",
          bottom: "20px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(860px, calc(100vw - 32px))",
          zIndex: 200,
        }}
      >

        {/* Toast */}
        {genError && (
          <div style={{
            marginBottom: "8px",
            padding: "8px 14px",
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: "10px",
            fontSize: "12px",
            color: "#f87171",
          }}>
            {genError}
          </div>
        )}

        <div style={{
          background: "rgba(14,16,18,0.55)",
          backdropFilter: "blur(48px)",
          WebkitBackdropFilter: "blur(48px)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "18px",
          boxShadow: "0 28px 80px rgba(0,0,0,0.9), 0 4px 20px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}>

          {/* ── Reference image thumbnails ── */}
          {!isVideo && (hasRefImgs || canAddImgs) && (
            <div style={{
              padding: "14px 16px 0",
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
              alignItems: "flex-start",
            }}>
              {refImages.map(img => {
                const isRemoving = removingIds.has(img.id);
                return (
                  <div key={img.id} data-refimg-id={img.id} style={{
                    position: "relative",
                    width: "88px",
                    height: "80px",
                    borderRadius: "10px",
                    overflow: "hidden",
                    background: "#1A1C1F",
                    flexShrink: 0,
                    border: img.error ? "1px solid rgba(248,113,113,0.4)" : "1px solid rgba(255,255,255,0.08)",
                    // Entry: spring animation on mount
                    animation: isRemoving ? "none" : "refImgIn 260ms cubic-bezier(0.16,1,0.3,1)",
                    // Exit: CSS transition driven by React state (same values as DOM manipulation — no conflict)
                    ...(isRemoving ? {
                      transition: "opacity 170ms cubic-bezier(0.4,0,1,1), transform 170ms cubic-bezier(0.4,0,1,1)",
                      opacity: 0,
                      transform: "translateY(-10px) scale(0.92)",
                    } : {}),
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
                        position: "absolute",
                        inset: 0,
                        background: "rgba(0,0,0,0.55)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}>
                        <span style={{
                          width: "18px",
                          height: "18px",
                          borderRadius: "50%",
                          border: "2px solid rgba(255,255,255,0.2)",
                          borderTopColor: "#ff3df5",
                          display: "inline-block",
                          animation: "spin 0.75s linear infinite",
                        }} />
                      </div>
                    )}
                    {/* Error overlay */}
                    {img.error && (
                      <div style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(0,0,0,0.55)",
                        display: "flex",
                        alignItems: "center",
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
                        position: "absolute",
                        top: "5px",
                        right: "5px",
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        background: "rgba(0,0,0,0.7)",
                        border: "1px solid rgba(255,255,255,0.15)",
                        color: "rgba(255,255,255,0.85)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        lineHeight: 1,
                        padding: 0,
                        fontSize: "12px",
                        transition: "background 120ms",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.9)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,0,0,0.7)"; }}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}

              {/* Add-more button */}
              {canAddImgs && (
                <button
                  onClick={() => openPicker("refImage", "image")}
                  disabled={submitting}
                  style={{
                    width: "88px",
                    height: "80px",
                    borderRadius: "10px",
                    border: "1.5px dashed rgba(255,255,255,0.4)",
                    background: "rgba(255,255,255,0.025)",
                    cursor: submitting ? "not-allowed" : "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    color: "rgba(255,255,255,0.75)",
                    flexShrink: 0,
                    transition: "border-color 140ms, background 140ms, color 140ms",
                  }}
                  onMouseEnter={e => {
                    if (!submitting) {
                      e.currentTarget.style.borderColor = "rgba(255,255,255,0.6)";
                      e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                      e.currentTarget.style.color = "#ffffff";
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.4)";
                    e.currentTarget.style.background = "rgba(255,255,255,0.025)";
                    e.currentTarget.style.color = "rgba(255,255,255,0.75)";
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

          {/* ── Video reference slots ── */}
          {isVideo && vidRefHandles.length > 0 && (() => {
            type VidSlot =
              | { kind: "filled"; target: "startFrame"|"endFrame"|"resource"|"videoRef"|"referenceVideo"|"audioRef"; mediaKind: "image"|"video"|"audio"; label: string; ref: RefImage }
              | { kind: "add";    target: "startFrame"|"endFrame"|"resource"|"videoRef"|"referenceVideo"|"audioRef"; mediaKind: "image"|"video"|"audio"; label: string; countLeft: number }
              | { kind: "element-filled"; element: KlingElement }
              | { kind: "element-add"; countLeft: number };
            const slots: VidSlot[] = [];
            const useElems = !!(vidModel?.apiInput.useKlingElements);
            for (const h of vidRefHandles) {
              if (h === "startFrame") {
                if (vidStartFrame) slots.push({ kind: "filled", target: h, mediaKind: "image", label: "Start Frame", ref: vidStartFrame });
                else               slots.push({ kind: "add",    target: h, mediaKind: "image", label: "Start Frame", countLeft: 1 });
              } else if (h === "endFrame") {
                if (vidEndFrame)   slots.push({ kind: "filled", target: h, mediaKind: "image", label: "End Frame", ref: vidEndFrame });
                else               slots.push({ kind: "add",    target: h, mediaKind: "image", label: "End Frame", countLeft: 1 });
              } else if (h === "videoRef") {
                if (vidVideoRef)   slots.push({ kind: "filled", target: h, mediaKind: "video", label: "Ref Video", ref: vidVideoRef });
                else               slots.push({ kind: "add",    target: h, mediaKind: "video", label: "Ref Video", countLeft: 1 });
              } else if (h === "resource") {
                if (useElems) {
                  vidElements.forEach(el => slots.push({ kind: "element-filled", element: el }));
                  if (vidElements.length < 3) slots.push({ kind: "element-add", countLeft: 3 - vidElements.length });
                } else {
                  const maxRes = vidModel?.maxResources ?? 3;
                  vidResources.forEach(r => slots.push({ kind: "filled", target: h, mediaKind: "image", label: "Image", ref: r }));
                  if (vidResources.length < maxRes)
                    slots.push({ kind: "add", target: h, mediaKind: "image", label: "Image", countLeft: maxRes - vidResources.length });
                }
              } else if (h === "referenceVideo") {
                const maxRefVid = vidModel?.maxReferenceVideos ?? 3;
                vidRefVideos.forEach(r => slots.push({ kind: "filled", target: h, mediaKind: "video", label: "Ref Video", ref: r }));
                if (vidRefVideos.length < maxRefVid)
                  slots.push({ kind: "add", target: h, mediaKind: "video", label: "Ref Video", countLeft: maxRefVid - vidRefVideos.length });
              } else if (h === "audioRef") {
                const maxRefAud = vidModel?.maxReferenceAudios ?? 3;
                vidRefAudios.forEach(r => slots.push({ kind: "filled", target: h, mediaKind: "audio", label: "Audio", ref: r }));
                if (vidRefAudios.length < maxRefAud)
                  slots.push({ kind: "add", target: h, mediaKind: "audio", label: "Audio", countLeft: maxRefAud - vidRefAudios.length });
              }
            }
            return (
              <div style={{ padding: "14px 16px 0", display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-start" }}>
                {slots.map((slot, idx) => {
                  // ── Element-filled slot ──────────────────────────────────────
                  if (slot.kind === "element-filled") {
                    const el = slot.element;
                    const thumb = el.imageUrls[0];
                    return (
                      <div key={el.id} style={{
                        position: "relative", width: "88px", height: "80px",
                        borderRadius: "10px", overflow: "hidden", flexShrink: 0,
                        background: "#1a1c1f", border: "1px solid rgba(255,255,255,0.12)",
                      }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        {el.imageUrls.length > 1 && (
                          <div style={{ position: "absolute", top: "5px", left: "5px", background: "rgba(0,0,0,0.65)", borderRadius: "4px", padding: "1px 5px", fontSize: "9px", fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: "0.04em" }}>
                            {el.imageUrls.length}
                          </div>
                        )}
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "12px 5px 4px", background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)", textAlign: "center" }}>
                          <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.04em", color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", padding: "0 4px" }}>{el.name}</span>
                        </div>
                        <button onClick={() => setVidElements(prev => prev.filter(e => e.id !== el.id))} style={{
                          position: "absolute", top: "5px", right: "5px", width: "20px", height: "20px",
                          borderRadius: "50%", background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.15)",
                          color: "rgba(255,255,255,0.85)", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "background 120ms",
                        }}
                          onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.9)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,0,0,0.7)"; }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                        </button>
                      </div>
                    );
                  }

                  // ── Element-add slot ─────────────────────────────────────────
                  if (slot.kind === "element-add") {
                    return (
                      <button key={`element-add-${idx}`}
                        onClick={() => setElementPickerOpen(true)}
                        disabled={submitting}
                        style={{
                          width: "88px", height: "80px", borderRadius: "10px", flexShrink: 0,
                          border: "1.5px dashed rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.03)",
                          cursor: submitting ? "not-allowed" : "pointer",
                          display: "flex", flexDirection: "column", alignItems: "center",
                          justifyContent: "center", gap: "5px", color: "rgba(255,255,255,0.4)",
                          transition: "border-color 140ms, background 140ms, color 140ms",
                        }}
                        onMouseEnter={e => { if (!submitting) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.4)"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.8)"; } }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
                          <path d="M20 3v4M22 5h-4"/>
                        </svg>
                        <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>Element</span>
                        <span style={{ fontSize: "9px", fontWeight: 500, color: "rgba(255,255,255,0.3)", letterSpacing: "0.03em" }}>{slot.countLeft} left</span>
                      </button>
                    );
                  }

                  // ── Regular filled / add slots ───────────────────────────────
                  const { target, mediaKind, label } = slot;
                  const MediaIcon = () => mediaKind === "image" ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
                    </svg>
                  ) : mediaKind === "audio" ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="5" width="15" height="14" rx="2"/>
                      <path d="m17 8 5-3v14l-5-3V8Z"/>
                    </svg>
                  );

                  if (slot.kind === "filled") {
                    const r = slot.ref;
                    return (
                      <div key={r.id} style={{
                          position: "relative", width: "88px", height: "80px",
                          borderRadius: "10px", overflow: "hidden", flexShrink: 0,
                          background: "#1a1c1f",
                          border: r.error ? "1px solid rgba(248,113,113,0.4)" : "1px solid rgba(255,255,255,0.12)",
                        }}>
                        {mediaKind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.objectUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        ) : mediaKind === "video" ? (
                          <video
                            src={r.objectUrl}
                            autoPlay
                            muted
                            loop
                            playsInline
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)" }}>
                            <MediaIcon />
                          </div>
                        )}
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "12px 5px 4px", background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)", textAlign: "center" }}>
                          <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.7)" }}>{label}</span>
                        </div>
                        {r.uploading && (
                          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ width: "16px", height: "16px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.8)", display: "inline-block", animation: "spin 0.75s linear infinite" }} />
                          </div>
                        )}
                        {r.error && (
                          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                          </div>
                        )}
                        <button onClick={() => removeVidRef(r.id, target)} style={{
                          position: "absolute", top: "5px", right: "5px", width: "20px", height: "20px",
                          borderRadius: "50%", background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.15)",
                          color: "rgba(255,255,255,0.85)", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "background 120ms",
                        }}
                          onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.9)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,0,0,0.7)"; }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                        </button>
                      </div>
                    );
                  }

                  return (
                    <button key={`${target}-add-${idx}`}
                      onClick={() => {
                        if (mediaKind === "audio") {
                          vidPickTarget.current = target;
                          vidAudioInputRef.current?.click();
                        } else {
                          openPicker(target as "startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo", mediaKind);
                        }
                      }}
                      disabled={submitting}
                      style={{
                        width: "88px", height: "80px", borderRadius: "10px", flexShrink: 0,
                        border: "1.5px dashed rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.03)",
                        cursor: submitting ? "not-allowed" : "pointer",
                        display: "flex", flexDirection: "column", alignItems: "center",
                        justifyContent: "center", gap: "5px", color: "rgba(255,255,255,0.4)",
                        transition: "border-color 140ms, background 140ms, color 140ms",
                      }}
                      onMouseEnter={e => { if (!submitting) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.4)"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.8)"; } }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
                    >
                      <MediaIcon />
                      <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>{label}</span>
                      <span style={{ fontSize: "9px", fontWeight: 500, color: "rgba(255,255,255,0.3)", letterSpacing: "0.03em" }}>{slot.countLeft} left</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* ── Input + Controls + Generate ── */}
          <div style={{
            padding: (hasRefImgs || (isVideo && vidRefHandles.length > 0)) ? "12px 14px 14px 16px" : "16px 14px 14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}>
            {/* Prompt input with inline mention chips */}
            <div style={{ position: "relative", flex: "none" }}>
              {/* Transparent textarea — editing layer */}
              <textarea
                ref={inputRef}
                data-prompt-input=""
                value={prompt}
                rows={3}
                onChange={e => {
                  const text = e.target.value;
                  const cursor = e.target.selectionStart ?? text.length;
                  setPrompt(text);
                  resizeTextarea(e.target);
                  if (!isVideo) {
                    const match = text.slice(0, cursor).match(/@(\w*)$/);
                    setMentionQuery(match ? match[1] : null);
                  }
                }}
                onSelect={e => {
                  if (isVideo) return;
                  const ta = e.currentTarget;
                  const cursor = ta.selectionStart ?? ta.value.length;
                  const match = ta.value.slice(0, cursor).match(/@(\w*)$/);
                  setMentionQuery(match ? match[1] : null);
                }}
                onScroll={e => {
                  if (overlayInnerRef.current)
                    overlayInnerRef.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
                }}
                onKeyDown={e => {
                  if (atMenuOpen) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setMentionSelIdx(i => (i + 1) % filteredMentions.length); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setMentionSelIdx(i => (i - 1 + filteredMentions.length) % filteredMentions.length); return; }
                    if (e.key === "Enter") { e.preventDefault(); insertMention(filteredMentions[mentionSelIdx]); return; }
                    if (e.key === "Escape") { setMentionQuery(null); return; }
                  }
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !submitting) { e.preventDefault(); generate(); }
                }}
                disabled={submitting}
                style={{
                  position: "relative",
                  display: "block",
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "transparent",
                  caretColor: "#ff3df5",
                  fontSize: "14.5px",
                  fontFamily: "inherit",
                  lineHeight: "22px",
                  letterSpacing: "-0.01em",
                  padding: 0,
                  resize: "none",
                  maxHeight: "440px",
                  overflowY: "auto",
                  scrollbarWidth: "none",
                } as React.CSSProperties}
              />
              {/* Chip overlay — visually replaces the transparent text */}
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  overflow: "hidden",
                  pointerEvents: "none",
                }}
              >
                <div
                  ref={overlayInnerRef}
                  style={{
                    display: "block",
                    fontSize: "14.5px",
                    fontFamily: "inherit",
                    lineHeight: "22px",
                    letterSpacing: "-0.01em",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    willChange: "transform",
                  }}
                >
                  {promptMaxLength !== null && prompt.length > promptMaxLength ? (
                    <>
                      {renderGalleryMentions(
                        prompt.slice(0, promptMaxLength), taggedImages,
                        (tag, rect) => setChipPreview({ tag, rect }),
                        () => setChipPreview(null),
                        tag => {
                          const idx = prompt.indexOf(`@${tag.label}`);
                          const pos = idx >= 0 ? idx + tag.label.length + 1 : prompt.length;
                          inputRef.current?.focus();
                          inputRef.current?.setSelectionRange(pos, pos);
                        },
                      )}
                      <span style={{ background: "rgba(239,68,68,0.22)", color: "#f87171", borderRadius: 2 }}>
                        {prompt.slice(promptMaxLength)}
                      </span>
                    </>
                  ) : renderGalleryMentions(
                    prompt, taggedImages,
                    (tag, rect) => setChipPreview({ tag, rect }),
                    () => setChipPreview(null),
                    tag => {
                      const idx = prompt.indexOf(`@${tag.label}`);
                      const pos = idx >= 0 ? idx + tag.label.length + 1 : prompt.length;
                      inputRef.current?.focus();
                      inputRef.current?.setSelectionRange(pos, pos);
                    },
                  )}
                </div>
              </div>
              {/* Placeholder */}
              {!prompt && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "block",
                    lineHeight: "22px",
                    fontSize: "14.5px",
                    fontFamily: "inherit",
                    letterSpacing: "-0.01em",
                    color: "rgba(255,255,255,0.3)",
                    pointerEvents: "none",
                  }}
                >
                  {isVideo ? "Describe the video you imagine…" : "Describe the scene you imagine…"}
                </div>
              )}
            </div>
            {/* Bottom row: controls + generate button — always stays at the bottom, never moves on expand */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: "12px" }}>
              {/* Controls group */}
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" }}>
                {/* Model picker */}
                <CustomDropdown
                  value={modelId}
                  onChange={setModelId}
                  disabled={submitting}
                  options={models.map(m => ({
                    value: m.id,
                    label: m.name,
                    group: ("provider" in m ? (m as { provider: string }).provider : undefined),
                    providerIcon: "provider" in m ? <ProviderIcon provider={(m as { provider: string }).provider} /> : undefined,
                  }))}
                  showChevron
                />

                {/* Quality */}
                {supportsQ && (
                  <CustomDropdown
                    value={quality}
                    onChange={setQuality}
                    disabled={submitting}
                    options={qualityOpts.map(q => ({ value: q, label: q.toUpperCase() }))}
                    icon={<DiamondIcon />}
                  />
                )}

                {/* Aspect ratio */}
                {ratios.length > 0 && (
                  <CustomDropdown
                    value={aspectRatio}
                    onChange={setAspectRatio}
                    disabled={submitting}
                    options={ratios.map(r => ({ value: r, label: r, preview: <RatioPreview ratio={r} /> }))}
                    icon={<RatioTriggerPreview ratio={aspectRatio} />}
                  />
                )}

                {/* Duration (video) — slider pill */}
                {isVideo && durations.length > 0 && (
                  <button
                    ref={durPillRef}
                    onClick={() => durPickerOpen ? closeDurPicker() : openDurPicker()}
                    disabled={submitting}
                    style={{
                      display: "flex", alignItems: "center", gap: "5px",
                      height: "36px", padding: "0 11px",
                      borderRadius: "8px",
                      border: durPickerOpen ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(255,255,255,0.1)",
                      background: durPickerOpen ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
                      color: "#fff", fontSize: "13px", fontFamily: "inherit",
                      cursor: submitting ? "not-allowed" : "pointer",
                      transition: "border-color 140ms, background 140ms",
                      flexShrink: 0,
                    }}>
                    <span style={{ fontVariantNumeric: "tabular-nums", display: "inline-block", width: "2ch", textAlign: "right" }}>{duration}</span><span>s</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2.5" strokeLinecap="round" style={{ transition: "transform 180ms cubic-bezier(0.16,1,0.3,1)", transform: durPickerOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                )}

                {/* Mode (video) */}
                {isVideo && vidModes.length > 0 && (
                  <CustomDropdown
                    value={mode}
                    onChange={setMode}
                    disabled={submitting}
                    options={vidModes.map(m => ({ value: m.value, label: m.label }))}
                  />
                )}

                {/* Resolution (video) */}
                {isVideo && (vidModel?.resolutions?.length ?? 0) > 0 && (
                  <CustomDropdown
                    value={resolution || vidModel!.defaultResolution!}
                    onChange={setResolution}
                    disabled={submitting}
                    options={vidModel!.resolutions!.map(r => ({ value: r, label: r }))}
                  />
                )}

                {/* Sound toggle (video) */}
                {isVideo && vidModel?.sound && (
                  <button
                    onClick={() => setSound(s => !s)}
                    disabled={submitting}
                    style={{
                      display: "flex", alignItems: "center", gap: "7px",
                      height: "36px", padding: "0 12px",
                      borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: sound ? "rgba(167,139,250,0.12)" : "rgba(255,255,255,0.05)",
                      color: sound ? "#a78bfa" : "rgba(255,255,255,0.55)",
                      fontSize: "13px", fontFamily: "inherit",
                      cursor: submitting ? "not-allowed" : "pointer",
                      transition: "background 150ms, color 150ms, border-color 150ms",
                      flexShrink: 0,
                    }}>
                    {/* Toggle pill */}
                    <span style={{
                      width: "28px", height: "16px", borderRadius: "8px",
                      background: sound ? "#a78bfa" : "rgba(255,255,255,0.18)",
                      position: "relative", flexShrink: 0,
                      transition: "background 150ms",
                    }}>
                      <span style={{
                        position: "absolute", top: "2px",
                        left: sound ? "14px" : "2px",
                        width: "12px", height: "12px", borderRadius: "50%",
                        background: sound ? "#1e1040" : "#ffffff",
                        transition: "left 150ms",
                      }} />
                    </span>
                    Sound
                  </button>
                )}

                {/* Count stepper (image only) — last control */}
                {!isVideo && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    height: "36px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.05)",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}>
                    <button
                      onClick={() => setCount(c => Math.max(1, c - 1))}
                      disabled={submitting || count <= 1}
                      style={{
                        width: "34px", height: "100%", border: "none", background: "transparent",
                        color: count <= 1 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.55)",
                        cursor: submitting || count <= 1 ? "not-allowed" : "pointer",
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
                      disabled={submitting || count >= 4}
                      style={{
                        width: "34px", height: "100%", border: "none", background: "transparent",
                        color: count >= 4 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.55)",
                        cursor: submitting || count >= 4 ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "16px", fontFamily: "inherit", transition: "color 140ms",
                      }}
                    >+</button>
                  </div>
                )}
              </div>{/* end controls group */}

              {/* Character count — same level as controls, left of generate button */}
              {promptMaxLength !== null && (
                <div
                  aria-hidden
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: "36px",
                    padding: "0 8px",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    lineHeight: 1,
                    pointerEvents: "none",
                    userSelect: "none",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    color: promptOverLimit ? "#f87171" : "#ffffff",
                    background: promptOverLimit ? "#3a1010" : "#2a2a2a",
                  }}
                >
                  {prompt.length.toLocaleString()}/{promptMaxLength.toLocaleString()}
                </div>
              )}

              {/* Generate button — last item in the controls row */}
              <button
                onClick={generate}
                disabled={!canGenerate}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "7px",
                  padding: "0 20px",
                  height: "72px",
                  borderRadius: "10px",
                  border: "none",
                  background: "#ff3df5",
                  color: "#060A06",
                  fontSize: "14px",
                  fontWeight: 700,
                  cursor: !canGenerate ? "not-allowed" : "pointer",
                  opacity: !canGenerate ? 0.45 : 1,
                  transition: "opacity 150ms, background 150ms",
                  fontFamily: "inherit",
                  flexShrink: 0,
                  letterSpacing: "-0.02em",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={e => { if (canGenerate) e.currentTarget.style.background = "#cc00c4"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "#ff3df5"; }}
              >
                {submitting ? (
                  <>
                    <span style={{
                      width: "12px", height: "12px", borderRadius: "50%",
                      border: "2px solid rgba(6,10,6,0.25)", borderTopColor: "#060A06",
                      display: "inline-block", animation: "spin 0.75s linear infinite",
                    }} />
                    Sending…
                  </>
                ) : (
                  <>Generate <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" stroke="none" style={{ display: "inline", verticalAlign: "middle" }}><path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z" /><path d="M4.6519 14.7568L4.82063 14.2084C4.84491 14.1295 4.91781 14.0757 5.00037 14.0757C5.08292 14.0757 5.15582 14.1295 5.1801 14.2084L5.34883 14.7568C5.56525 15.4602 6.11587 16.0108 6.81925 16.2272L7.36762 16.3959C7.44652 16.4202 7.50037 16.4931 7.50037 16.5757C7.50037 16.6582 7.44652 16.7311 7.36762 16.7554L6.81926 16.9241C6.11587 17.1406 5.56525 17.6912 5.34883 18.3946L5.1801 18.9429C5.15582 19.0218 5.08292 19.0757 5.00037 19.0757C4.91781 19.0757 4.84491 19.0218 4.82063 18.9429L4.65191 18.3946C4.43548 17.6912 3.88486 17.1406 3.18147 16.9241L2.63311 16.7554C2.55421 16.7311 2.50037 16.6582 2.50037 16.5757C2.50037 16.4931 2.55421 16.4202 2.63311 16.3959L3.18148 16.2272C3.88486 16.0108 4.43548 15.4602 4.6519 14.7568Z" /></svg></>
                )}
              </button>
            </div>{/* end bottom row */}
          </div>
        </div>
      </div>

      <style>{GALLERY_CSS}</style>

      {/* ── @ image picker menu ── */}
      {atMenuOpen && promptBarRef.current && createPortal(
        <div
          data-at-menu=""
          style={{
            position: "fixed",
            left: promptBarRef.current.getBoundingClientRect().left,
            bottom: window.innerHeight - promptBarRef.current.getBoundingClientRect().top + 6,
            width: promptBarRef.current.getBoundingClientRect().width,
            background: "#0E1012",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "14px",
            boxShadow: "0 8px 48px rgba(0,0,0,0.75), 0 2px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            overflow: "hidden",
            zIndex: 9999,
            animation: "dropIn 130ms cubic-bezier(0.16,1,0.3,1)",
          }}
          onMouseDown={e => e.preventDefault()}
        >
          <div style={{ padding: "6px 12px 4px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
              Gallery images
            </span>
          </div>
          <div style={{ maxHeight: "280px", overflowY: "auto", padding: "4px" }}>
            {filteredMentions.map((ref, idx) => (
              <button
                key={ref.id}
                onClick={() => insertMention(ref)}
                onMouseEnter={() => setMentionSelIdx(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: "9px",
                  border: "none",
                  background: idx === mentionSelIdx ? "rgba(119,229,68,0.07)" : "transparent",
                  color: idx === mentionSelIdx ? "#ff3df5" : "rgba(255,255,255,0.65)",
                  fontSize: "13px",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 80ms",
                  letterSpacing: "-0.01em",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ref.objectUrl}
                  alt=""
                  style={{ width: "30px", height: "30px", borderRadius: "6px", objectFit: "cover", flexShrink: 0, background: "#1a1c1f" }}
                />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Image {idx + 1}
                </span>
                {idx === mentionSelIdx && (
                  <span style={{ marginLeft: "auto", fontSize: "10px", color: "rgba(255,255,255,0.2)", flexShrink: 0 }}>↵</span>
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}

      {/* ── Chip hover preview ── */}
      {chipPreview && createPortal(
        /* Outer: positioning only — no animation so transform stays stable */
        <div
          style={{
            position: "fixed",
            left: chipPreview.rect.left + chipPreview.rect.width / 2,
            bottom: window.innerHeight - chipPreview.rect.top + 8,
            transform: "translateX(-50%)",
            zIndex: 99999,
            pointerEvents: "none",
          }}
        >
          {/* Inner: animation only — no positioning transform */}
          <div
            style={{
              borderRadius: "10px",
              overflow: "hidden",
              boxShadow: "0 8px 32px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.08)",
              animation: "dropIn 140ms cubic-bezier(0.16,1,0.3,1)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={chipPreview.tag.url}
              alt=""
              style={{ display: "block", maxWidth: "200px", maxHeight: "160px", width: "auto", height: "auto", objectFit: "contain" }}
            />
          </div>
        </div>,
        document.body,
      )}

      {lightboxItem && (
        <Lightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
      )}

      {/* Duration picker popover — portal so it escapes overflow/transform ancestors */}
      {(durPickerOpen || durPickerClosing) && durPickerPos && createPortal(
        <div
          onMouseDown={e => e.stopPropagation()}
          className={durPickerClosing ? "dur-picker-out" : "dur-picker-in"}
          style={{
            position: "fixed",
            left: durPickerPos.left,
            bottom: durPickerPos.bottom,
            zIndex: 9200,
            background: "rgba(18,20,22,0.98)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "12px",
            padding: "12px 14px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
            minWidth: "220px",
            transformOrigin: "bottom left",
          }}>
          <p style={{ margin: "0 0 10px", fontSize: "12px", fontWeight: 600, color: "#fff" }}>Duration</p>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "8px", background: "#161A1E" }}>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", fontVariantNumeric: "tabular-nums", minWidth: "24px" }}>{duration}s</span>
            <div style={{ width: "1px", height: "14px", background: "#2A2A2A", flexShrink: 0 }} />
            <input
              type="range"
              min={0}
              max={durations.length - 1}
              step={1}
              value={Math.max(0, durations.indexOf(duration))}
              onChange={e => setDuration(durations[parseInt(e.target.value)])}
              className="dur-slider"
              style={{ flex: 1 }}
            />
          </div>
        </div>,
        document.body,
      )}

      <MediaPickerModal
        open={pickerOpen}
        mediaKind={pickerUploadKind}
        onClose={() => setPickerOpen(false)}
        onPickUrl={handlePickerSelect}
        onUpload={handlePickerUpload}
      />

      <ElementPickerModal
        open={elementPickerOpen}
        attached={vidElements}
        onClose={() => setElementPickerOpen(false)}
        onAttach={el => {
          setVidElements(prev => prev.some(e => e.id === el.id) ? prev : [...prev, el]);
          setElementPickerOpen(false);
        }}
      />

      <DownloadToast downloads={downloads} onClear={() => setDownloads([])} />

      {refError && (
        <div style={{
          position: "fixed",
          top: "64px",
          right: "16px",
          zIndex: 9600,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 14px",
          borderRadius: "12px",
          background: "rgba(16,18,20,0.97)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(248,113,113,0.25)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
          fontSize: "13px",
          color: "#f87171",
          fontFamily: "inherit",
          letterSpacing: "-0.01em",
          animation: "dropIn 160ms cubic-bezier(0.16,1,0.3,1)",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
          {refError}
        </div>
      )}
    </div>
  );
}

export default function GalleryPage() {
  return (
    <Suspense fallback={<div style={{ flex: 1, background: "#1A1A1C" }} />}>
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
  providerIcon?: React.ReactNode;
}

// ── Media picker modal ───────────────────────────────────────────────────────

function MediaPickerModal({
  open, mediaKind, onClose, onPickUrl, onUpload,
}: {
  open: boolean;
  mediaKind: "image" | "video";
  onClose: () => void;
  onPickUrl: (url: string) => void;
  onUpload: () => void;
}) {
  const genTab = mediaKind === "image" ? "image-gen" : "video-gen";
  const [activeTab, setActiveTab] = useState<"gen" | "uploads">("gen");
  const [sourceItems, setSourceItems] = useState<GalleryItem[]>(
    () => galleryCache.get(mediaKind === "image" ? "images" : "videos")?.items ?? [],
  );
  const [fetching, setFetching] = useState(false);

  // Reset tab and load fresh data each time the picker opens
  useEffect(() => {
    if (!open) return;
    setActiveTab("gen");
    const cacheKey = mediaKind === "image" ? "images" : "videos";
    setSourceItems(galleryCache.get(cacheKey)?.items ?? []);
    setFetching(true);
    (async () => {
      const token = await getToken();
      if (!token) { setFetching(false); return; }
      const res = await fetch(`/api/gallery?type=${mediaKind === "image" ? "image" : "video"}&page=0`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setSourceItems((await res.json() as { items: GalleryItem[] }).items);
      setFetching(false);
    })();
  }, [open, mediaKind]);

  const displayItems = useMemo(() =>
    activeTab === "uploads"
      ? sourceItems.filter(i => i.source === "upload")
      : sourceItems.filter(i => i.source === "generation"),
  [activeTab, sourceItems]);

  if (!open) return null;

  const tabs = [
    { id: "gen" as const,     label: mediaKind === "image" ? "Image Generations" : "Video Generations" },
    { id: "uploads" as const, label: "Uploads" },
  ];

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}
    >
      <div
        onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
        style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}
      />
      <div
        style={{
          position: "relative",
          width: "min(660px, calc(100vw - 32px))",
          height: "520px",
          background: "rgba(14,16,18,0.98)",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: "18px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 32px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.04)",
          pointerEvents: "auto",
        }}
      >
        {/* Tab bar */}
        <div style={{
          padding: "14px 18px 0", display: "flex", alignItems: "center", gap: "4px",
          flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "12px",
        }}>
          {tabs.map(t => {
            const active = activeTab === t.id;
            return (
              <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                padding: "6px 16px", borderRadius: "100px", border: "none", cursor: "pointer",
                fontSize: "13px", fontWeight: active ? 600 : 400,
                background: active ? "#ffffff" : "transparent",
                color: active ? "#000000" : "rgba(255,255,255,0.5)",
                transition: "background 150ms, color 150ms",
              }}>
                {t.label}
              </button>
            );
          })}
          <button onClick={onClose} style={{
            marginLeft: "auto", width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0,
            background: "rgba(255,255,255,0.07)", border: "none",
            color: "rgba(255,255,255,0.6)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", transition: "background 120ms",
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.13)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable grid */}
        <div className="picker-scroll" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "14px 18px 18px" }}>
          {fetching && displayItems.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px" }}>
              <span style={{ width: "24px", height: "24px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "#ff3df5", display: "inline-block", animation: "spin 0.75s linear infinite" }} />
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px" }}>
              {/* Upload card — same size as gallery items */}
              <button
                onClick={onUpload}
                style={{
                  aspectRatio: "1",
                  borderRadius: "8px",
                  border: "1.5px dashed rgba(255,255,255,0.16)",
                  background: "rgba(255,255,255,0.025)",
                  cursor: "pointer",
                  display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: "8px",
                  color: "rgba(255,255,255,0.5)",
                  transition: "background 150ms, border-color 150ms, color 150ms",
                  padding: 0,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.055)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
              >
                <div style={{ width: "30px", height: "30px", borderRadius: "50%", background: "rgba(255,255,255,0.09)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </div>
                <span style={{ fontSize: "10px", fontWeight: 500 }}>Upload</span>
              </button>

              {/* Gallery items */}
              {displayItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => onPickUrl(item.url)}
                  style={{
                    position: "relative", aspectRatio: "1", borderRadius: "8px", overflow: "hidden",
                    background: "#1a1c1f", border: "2px solid transparent",
                    cursor: "pointer", padding: 0,
                    transition: "border-color 110ms, transform 110ms",
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)";
                    e.currentTarget.style.transform = "scale(1.04)";
                    const v = e.currentTarget.querySelector("video");
                    if (v) v.play().catch(() => {});
                    const overlay = e.currentTarget.querySelector<HTMLElement>(".picker-play-icon");
                    if (overlay) overlay.style.opacity = "0";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = "transparent";
                    e.currentTarget.style.transform = "scale(1)";
                    const v = e.currentTarget.querySelector("video");
                    if (v) { v.pause(); v.currentTime = 0; }
                    const overlay = e.currentTarget.querySelector<HTMLElement>(".picker-play-icon");
                    if (overlay) overlay.style.opacity = "1";
                  }}
                >
                  {item.mediaType === "video" ? (
                    <video
                      src={item.url}
                      muted
                      playsInline
                      preload="metadata"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      onLoadedMetadata={e => { (e.target as HTMLVideoElement).currentTime = 0.001; }}
                    />
                  ) : (
                    <NextImage
                      src={item.url}
                      alt=""
                      fill
                      sizes="120px"
                      style={{ objectFit: "cover" }}
                    />
                  )}
                  {item.mediaType === "video" && (
                    <div className="picker-play-icon" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", transition: "opacity 120ms" }}>
                      <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="white">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      </div>
                    </div>
                  )}
                </button>
              ))}

              {displayItems.length === 0 && !fetching && (
                <div style={{ gridColumn: "1 / -1", padding: "48px 0", textAlign: "center", color: "rgba(255,255,255,0.22)", fontSize: "13px" }}>
                  Nothing here yet
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
  void genTab; // suppress unused var
}

// ── Element picker modal ─────────────────────────────────────────────────────

function ElementPickerModal({
  open,
  attached,
  onClose,
  onAttach,
}: {
  open: boolean;
  attached: KlingElement[];
  onClose: () => void;
  onAttach: (el: KlingElement) => void;
}) {
  const [view, setView] = useState<"browse" | "create">("browse");
  const [elements, setElements] = useState<KlingElement[]>([]);

  // Create form state
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createImages, setCreateImages] = useState<{ id: string; objectUrl: string; cdnUrl: string | null; uploading: boolean; error: boolean }[]>([]);
  const [creating, setCreating] = useState(false);
  const createFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setView("browse");
    setElements(loadKlingElements());
    setCreateName("");
    setCreateDesc("");
    setCreateImages([]);
    setCreating(false);
  }, [open]);

  if (!open) return null;

  const handleDeleteElement = (id: string) => {
    const updated = elements.filter(e => e.id !== id);
    setElements(updated);
    saveKlingElements(updated);
  };

  const handleCreateImages = async (files: FileList) => {
    const remaining = 4 - createImages.length;
    const toAdd = Array.from(files).slice(0, remaining).filter(
      f => (f.type === "image/jpeg" || f.type === "image/png") && f.size <= 10 * 1024 * 1024
    );
    if (!toAdd.length) return;
    const newEntries = toAdd.map(f => ({
      id: crypto.randomUUID(),
      objectUrl: URL.createObjectURL(f),
      cdnUrl: null as string | null,
      uploading: true,
      error: false,
    }));
    setCreateImages(prev => [...prev, ...newEntries]);
    const token = await getToken();
    await Promise.all(toAdd.map(async (file, i) => {
      const entry = newEntries[i];
      try {
        const res = await fetch("/api/upload-asset", {
          method: "POST",
          headers: { "Content-Type": file.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: file,
        });
        const data = await res.json() as { cdnUrl?: string; error?: string };
        if (!res.ok || !data.cdnUrl) throw new Error(data.error ?? "Upload failed");
        setCreateImages(prev => prev.map(e => e.id === entry.id ? { ...e, cdnUrl: data.cdnUrl!, uploading: false } : e));
      } catch {
        setCreateImages(prev => prev.map(e => e.id === entry.id ? { ...e, uploading: false, error: true } : e));
      }
    }));
  };

  const readyImages = createImages.filter(e => e.cdnUrl && !e.error);
  const canCreate = createName.trim().length > 0
    && readyImages.length >= 2
    && !createImages.some(e => e.uploading)
    && !creating;

  const handleCreate = () => {
    if (!canCreate) return;
    setCreating(true);
    const newEl: KlingElement = {
      id: crypto.randomUUID(),
      name: createName.trim(),
      description: createDesc.trim(),
      imageUrls: readyImages.map(e => e.cdnUrl!),
    };
    const updated = [...loadKlingElements(), newEl];
    saveKlingElements(updated);
    createImages.forEach(e => URL.revokeObjectURL(e.objectUrl));
    onAttach(newEl);
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 9100, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "absolute", inset: 0, pointerEvents: "auto" }} />
      <div style={{
        position: "relative",
        width: "min(520px, calc(100vw - 32px))",
        maxHeight: "80vh",
        background: "rgba(14,16,18,0.98)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: "18px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 32px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.04)",
        pointerEvents: "auto",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 18px 14px", display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          {view === "create" && (
            <button onClick={() => setView("browse")} style={{ width: "28px", height: "28px", borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 120ms" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.13)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          )}
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#fff", letterSpacing: "-0.01em" }}>
            {view === "browse" ? "Elements" : "New Element"}
          </span>
          <button onClick={onClose} style={{ marginLeft: "auto", width: "28px", height: "28px", borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 120ms" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.13)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {view === "browse" ? (
          /* ── Browse view ── */
          <div className="picker-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 18px 18px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
              {/* Create new card */}
              <button onClick={() => setView("create")} style={{
                aspectRatio: "1", borderRadius: "10px", border: "1.5px dashed rgba(255,255,255,0.16)",
                background: "rgba(255,255,255,0.025)", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px",
                color: "rgba(255,255,255,0.5)", transition: "background 150ms, border-color 150ms, color 150ms", padding: 0,
              }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.055)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "rgba(255,255,255,0.09)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                </div>
                <span style={{ fontSize: "11px", fontWeight: 500 }}>New element</span>
              </button>

              {/* Element cards */}
              {elements.map(el => {
                const isAttached = attached.some(a => a.id === el.id);
                const atMax = attached.length >= 3 && !isAttached;
                return (
                  <div key={el.id} style={{ position: "relative", aspectRatio: "1" }}>
                    <button
                      onClick={() => { if (!isAttached && !atMax) onAttach(el); }}
                      disabled={isAttached || atMax}
                      style={{
                        width: "100%", height: "100%", borderRadius: "10px", overflow: "hidden",
                        border: isAttached ? "2px solid #77e544" : "2px solid transparent",
                        background: "#1a1c1f", cursor: isAttached || atMax ? "default" : "pointer",
                        padding: 0, display: "block", position: "relative",
                        transition: "border-color 110ms, opacity 110ms",
                        opacity: atMax ? 0.4 : 1,
                      }}
                      onMouseEnter={e => { if (!isAttached && !atMax) e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)"; }}
                      onMouseLeave={e => { if (!isAttached) e.currentTarget.style.borderColor = "transparent"; }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={el.imageUrls[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      {el.imageUrls.length > 1 && (
                        <div style={{ position: "absolute", top: "5px", left: "5px", background: "rgba(0,0,0,0.65)", borderRadius: "4px", padding: "1px 5px", fontSize: "9px", fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>
                          {el.imageUrls.length}
                        </div>
                      )}
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "14px 6px 5px", background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)" }}>
                        <span style={{ fontSize: "10px", fontWeight: 600, color: "rgba(255,255,255,0.9)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{el.name}</span>
                      </div>
                      {isAttached && (
                        <div style={{ position: "absolute", top: "5px", right: "5px", width: "18px", height: "18px", borderRadius: "50%", background: "#77e544", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        </div>
                      )}
                    </button>
                    {/* Delete button */}
                    <button onClick={e => { e.stopPropagation(); handleDeleteElement(el.id); }} style={{
                      position: "absolute", bottom: "5px", right: "5px", width: "20px", height: "20px",
                      borderRadius: "50%", background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.15)",
                      color: "rgba(255,255,255,0.7)", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "background 120ms, color 120ms",
                      zIndex: 2,
                    }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(220,40,40,0.85)"; e.currentTarget.style.color = "#fff"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,0,0,0.7)"; e.currentTarget.style.color = "rgba(255,255,255,0.7)"; }}>
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                );
              })}

              {elements.length === 0 && (
                <div style={{ gridColumn: "1 / -1", padding: "32px 0", textAlign: "center", color: "rgba(255,255,255,0.22)", fontSize: "13px" }}>
                  No elements yet — create your first one
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Create view ── */
          <div className="picker-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Images */}
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.4)", marginBottom: "8px" }}>Images (2–4 · JPG/PNG · max 10 MB each)</div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" as const }}>
                {createImages.map((img, i) => (
                  <div key={img.id} style={{ position: "relative", width: "72px", height: "72px", borderRadius: "8px", overflow: "hidden", border: img.error ? "1px solid rgba(248,113,113,0.4)" : "1px solid rgba(255,255,255,0.12)", background: "#1a1c1f", flexShrink: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.objectUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    {img.uploading && (
                      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ width: "14px", height: "14px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.8)", display: "inline-block", animation: "spin 0.75s linear infinite" }} />
                      </div>
                    )}
                    {img.error && (
                      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                      </div>
                    )}
                    <button onClick={() => setCreateImages(prev => { URL.revokeObjectURL(img.objectUrl); return prev.filter((_, j) => j !== i); })} style={{
                      position: "absolute", top: "3px", right: "3px", width: "16px", height: "16px",
                      borderRadius: "50%", background: "rgba(0,0,0,0.7)", border: "none",
                      color: "rgba(255,255,255,0.85)", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                    }}>
                      <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                ))}
                {createImages.length < 4 && (
                  <button onClick={() => createFileRef.current?.click()} style={{
                    width: "72px", height: "72px", borderRadius: "8px", flexShrink: 0,
                    border: "1.5px dashed rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.025)",
                    cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px",
                    color: "rgba(255,255,255,0.4)", transition: "background 140ms, border-color 140ms, color 140ms",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.055)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; e.currentTarget.style.color = "rgba(255,255,255,0.8)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                    <span style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.04em" }}>ADD</span>
                  </button>
                )}
              </div>
              <input ref={createFileRef} type="file" accept="image/jpeg,image/png" multiple style={{ display: "none" }}
                onChange={e => { if (e.target.files) { handleCreateImages(e.target.files); e.target.value = ""; } }} />
            </div>

            {/* Name */}
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.4)", marginBottom: "8px" }}>Name</div>
              <input
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                placeholder="Element name"
                maxLength={50}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: "8px",
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff", fontSize: "13.5px", fontFamily: "inherit", outline: "none",
                  boxSizing: "border-box" as const,
                }}
              />
            </div>

            {/* Description */}
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.4)", marginBottom: "8px" }}>Description</div>
              <textarea
                value={createDesc}
                onChange={e => setCreateDesc(e.target.value)}
                placeholder="Describe this element…"
                rows={3}
                maxLength={500}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: "8px",
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff", fontSize: "13.5px", fontFamily: "inherit", outline: "none",
                  resize: "none", boxSizing: "border-box" as const,
                }}
              />
            </div>

            {/* Create button */}
            <button
              onClick={handleCreate}
              disabled={!canCreate}
              style={{
                padding: "10px 24px", borderRadius: "10px", border: "none",
                background: canCreate ? "#77e544" : "rgba(255,255,255,0.08)",
                color: canCreate ? "#000" : "rgba(255,255,255,0.3)",
                fontSize: "13.5px", fontWeight: 600, fontFamily: "inherit",
                cursor: canCreate ? "pointer" : "not-allowed", transition: "background 150ms, color 150ms",
                alignSelf: "flex-start" as const,
              }}>
              {creating ? "Creating…" : "Create element"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
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
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, bottom: 0, minW: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const selectedOpt = options.find(o => o.value === value);
  const label = selectedOpt?.label ?? value;
  const triggerIcon = selectedOpt?.providerIcon ?? icon;

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
  const groupKeys = Object.keys(groups);
  const hasGroups = groupKeys.some(k => k !== "");

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => open ? setOpen(false) : openDrop()}
        disabled={disabled}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          height: "36px",
          padding: "0 12px",
          borderRadius: "8px",
          border: open
            ? "1px solid rgba(255,255,255,0.18)"
            : "1px solid rgba(255,255,255,0.1)",
          background: open
            ? "rgba(255,255,255,0.08)"
            : "rgba(255,255,255,0.05)",
          flexShrink: 0,
          cursor: disabled ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          transition: "border-color 140ms, background 140ms",
          userSelect: "none",
        }}
        onMouseEnter={e => {
          if (!disabled && !open) {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)";
            e.currentTarget.style.background = "rgba(255,255,255,0.07)";
          }
        }}
        onMouseLeave={e => {
          if (!open) {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
          }
        }}
      >
        {triggerIcon && (
          <span style={{ display: "flex", alignItems: "center", color: selectedOpt?.providerIcon ? "#a855f7" : "white", flexShrink: 0 }}>
            {triggerIcon}
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
            position: "fixed",
            left: pos.left,
            bottom: pos.bottom,
            minWidth: Math.max(pos.minW, 160),
            background: "#0E1012",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "14px",
            boxShadow: "0 8px 48px rgba(0,0,0,0.75), 0 2px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            overflow: "hidden",
            zIndex: 9999,
            animation: "dropIn 130ms cubic-bezier(0.16,1,0.3,1)",
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
                      padding: "5px 10px 3px",
                      fontSize: "10px",
                      color: "rgba(255,255,255,0.22)",
                      textTransform: "uppercase",
                      letterSpacing: "0.09em",
                      fontWeight: 500,
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
                      providerIcon={opt.providerIcon}
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
                  providerIcon={opt.providerIcon}
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

function DropItem({ label, active, onClick, preview, providerIcon }: { label: string; active: boolean; onClick: () => void; preview?: React.ReactNode; providerIcon?: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        width: "100%",
        padding: "7px 10px",
        borderRadius: "9px",
        border: "none",
        background: active
          ? "rgba(255,255,255,0.09)"
          : hovered ? "rgba(255,255,255,0.06)" : "transparent",
        color: active ? "#ffffff" : hovered ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.55)",
        fontSize: "13px",
        fontWeight: active ? 500 : 400,
        cursor: "pointer",
        textAlign: "left",
        transition: "background 100ms, color 100ms",
        fontFamily: "inherit",
        letterSpacing: "-0.01em",
        whiteSpace: "nowrap",
      }}
    >
      {providerIcon && (
        <span style={{ display: "flex", alignItems: "center", color: "#a855f7", flexShrink: 0, opacity: active ? 1 : 0.7 }}>
          {providerIcon}
        </span>
      )}
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
        display: "inline-block",
        width: `${Math.round(rw)}px`,
        height: `${Math.round(rh)}px`,
        border: "1.5px solid rgba(255,255,255,0.75)",
        borderRadius: "5px",
        flexShrink: 0,
      }} />
    </span>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ProviderIcon({ provider }: { provider: string }) {
  switch (provider) {
    case "OpenAI":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path fillRule="evenodd" clipRule="evenodd" d="M22.408 9.80741C22.9487 8.17778 22.7685 6.37037 21.8974 4.88889C20.5758 2.60741 17.9024 1.45185 15.2891 1.98519C14.1477 0.711111 12.4656 0 10.7234 0C8.0501 0 5.70717 1.68889 4.86612 4.17778C3.15398 4.53333 1.68214 5.57037 0.811051 7.08148C-0.510601 9.36296 -0.210226 12.2074 1.56199 14.163C1.02131 15.8222 1.23158 17.6 2.10267 19.0815C3.42432 21.363 6.09766 22.5481 8.71093 21.9852C9.88239 23.2593 11.5345 24 13.2766 24C15.95 24 18.2929 22.3111 19.134 19.8222C20.8461 19.4667 22.3179 18.4296 23.189 16.9185C24.5107 14.637 24.2103 11.763 22.408 9.80741ZM13.2766 22.4296C12.1953 22.4296 11.174 22.0741 10.363 21.3926C10.393 21.363 10.4831 21.3333 10.5132 21.3037L15.3492 18.5481C15.5895 18.4 15.7397 18.163 15.7397 17.8667V11.1407L17.7823 12.2963C17.8123 12.2963 17.8123 12.3259 17.8123 12.3556V17.9259C17.8423 20.4148 15.7998 22.4296 13.2766 22.4296ZM3.48439 18.3111C2.94372 17.3926 2.76349 16.3259 2.94372 15.2889C2.97375 15.3185 3.03383 15.3481 3.0939 15.3778L7.92995 18.1333C8.17025 18.2815 8.47063 18.2815 8.71093 18.1333L14.6283 14.7556V17.0963C14.6283 17.1259 14.6283 17.1556 14.5983 17.1556L9.70216 19.9407C7.53946 21.1852 4.74597 20.4444 3.48439 18.3111ZM2.22282 7.88148C2.76349 6.96296 3.60454 6.28148 4.59578 5.8963V11.5852C4.59578 11.8519 4.74597 12.1185 4.98627 12.2667L10.9037 15.6444L8.86111 16.8C8.83108 16.8 8.80104 16.8296 8.80104 16.8L3.90492 14.0148C1.68214 12.7704 0.961239 10.0148 2.22282 7.88148ZM19.0438 11.7333L13.1264 8.35556L15.169 7.2C15.199 7.2 15.2291 7.17037 15.2291 7.2L20.1252 9.98519C22.3179 11.2296 23.0388 13.9852 21.7773 16.1185C21.2366 17.037 20.3955 17.7185 19.4043 18.0741V12.4148C19.4343 12.1481 19.2841 11.8815 19.0438 11.7333ZM21.0564 8.71111C21.0263 8.68148 20.9662 8.65185 20.9062 8.62222L16.0701 5.86667C15.8298 5.71852 15.5294 5.71852 15.2891 5.86667L9.37175 9.24444V6.9037C9.37175 6.87407 9.37175 6.84444 9.40179 6.84444L14.2979 4.05926C16.4906 2.81481 19.2541 3.55556 20.5157 5.71852C21.0564 6.60741 21.2366 7.67407 21.0564 8.71111ZM8.26036 12.8593L6.21781 11.7037C6.18777 11.7037 6.18777 11.6741 6.18777 11.6444V6.07407C6.18777 3.58519 8.23032 1.57037 10.7535 1.57037C11.8348 1.57037 12.8561 1.92593 13.6671 2.60741C13.6371 2.63704 13.577 2.66667 13.5169 2.6963L8.68089 5.45185C8.44059 5.6 8.2904 5.83704 8.2904 6.13333V12.8593H8.26036ZM9.37175 10.4889L12.0151 8.97778L14.6584 10.4889V13.4815L12.0151 14.9926L9.37175 13.4815V10.4889Z" />
        </svg>
      );
    case "Google":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path d="M2.55464 6.25768C3.24798 4.87705 4.31161 3.71644 5.62666 2.90557C6.94171 2.0947 8.45636 1.66553 10.0013 1.66602C12.2471 1.66602 14.1338 2.49102 15.5763 3.83685L13.1871 6.22685C12.323 5.40102 11.2246 4.98018 10.0013 4.98018C7.83047 4.98018 5.99297 6.44685 5.3388 8.41602C5.17214 8.91602 5.07714 9.44935 5.07714 9.99935C5.07714 10.5493 5.17214 11.0827 5.3388 11.5827C5.9938 13.5527 7.83047 15.0185 10.0013 15.0185C11.1221 15.0185 12.0763 14.7227 12.823 14.2227C13.2558 13.9377 13.6264 13.5679 13.9123 13.1356C14.1982 12.7033 14.3935 12.2176 14.4863 11.7077H10.0013V8.48435H17.8496C17.948 9.02935 18.0013 9.59768 18.0013 10.1885C18.0013 12.7268 17.093 14.8635 15.5163 16.3135C14.138 17.5868 12.2513 18.3327 10.0013 18.3327C8.90683 18.3331 7.823 18.1179 6.81176 17.6992C5.80051 17.2806 4.88168 16.6668 4.10777 15.8929C3.33386 15.119 2.72005 14.2001 2.30141 13.1889C1.88278 12.1777 1.66753 11.0938 1.66797 9.99935C1.66797 8.65435 1.98964 7.38268 2.55464 6.25768Z" />
        </svg>
      );
    case "Seedream":
      return (
        <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor">
          <path d="M2.7601 10.635L0.466553 11.2084V1.04883L2.7601 1.62222V10.635Z" />
          <path d="M13.8448 11.2295L11.5469 11.8029V0.454102L13.8448 1.02324V11.2295Z" />
          <path d="M6.39853 10.9452L4.10498 11.5186V5.53418L6.39853 6.10752V10.9452Z" />
          <path d="M7.89722 4.64663L10.1952 4.07324V10.0577L7.89722 9.48433V4.64663Z" />
        </svg>
      );
    case "Z-AI":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path d="M19.9361 12.1411L17.6243 8.09523L17.3525 7.61735L18.5771 5.47657C18.6187 5.4023 18.6411 5.32158 18.6411 5.23763C18.6411 5.15367 18.6187 5.07295 18.5771 4.99868L17.215 2.61896C17.1735 2.5447 17.1127 2.48658 17.0424 2.4446C16.972 2.40262 16.8921 2.38002 16.8058 2.38002H11.6323L10.4077 0.236011C10.3245 0.0874804 10.1679 -0.00292969 9.9984 -0.00292969H7.27738C7.19425 -0.00292969 7.11111 0.0196728 7.04077 0.0616489C6.97042 0.103625 6.90967 0.161746 6.86811 0.236011L4.55316 4.28509L4.28138 4.75974H1.83213C1.749 4.75974 1.66587 4.78235 1.59552 4.82432C1.52518 4.8663 1.46443 4.92442 1.42286 4.99868L0.0639488 7.38164C0.0223821 7.4559 0 7.53663 0 7.62058C0 7.70453 0.0223821 7.78525 0.0639488 7.85952L2.65068 12.3833L1.42606 14.5273C1.38449 14.6015 1.36211 14.6823 1.36211 14.7662C1.36211 14.8502 1.38449 14.9309 1.42606 15.0051L2.78817 17.3849C2.82974 17.4591 2.89049 17.5173 2.96083 17.5592C3.03118 17.6012 3.11111 17.6238 3.19744 17.6238H8.36771L9.59233 19.7678C9.67546 19.9163 9.83214 20.0068 10.0016 20.0068H12.7226C12.8058 20.0068 12.8889 19.9842 12.9592 19.9422C13.0296 19.9002 13.0903 19.8421 13.1319 19.7678L15.7186 15.2441H18.1679C18.251 15.2441 18.3341 15.2215 18.4045 15.1795C18.4748 15.1375 18.5356 15.0794 18.5771 15.0051L19.9393 12.6254C19.9808 12.5512 20.0032 12.4704 20.0032 12.3865C20.0032 12.3025 19.9808 12.2218 19.9393 12.1475L19.9361 12.1411ZM7.27738 0.474952L8.63949 2.8579L7.27738 5.23763H18.1679L16.8058 7.61735H6.45883L4.82494 4.75974L7.27738 0.474952ZM8.09273 17.1395H3.19424L4.55636 14.7565H7.27738L1.83213 5.23763H4.55316L5.91527 7.61735L9.72662 14.2851L8.09273 17.1427V17.1395ZM16.8058 12.3768L15.4468 9.99707L10.0016 19.5224L8.63949 17.1427L10.0016 14.763L13.813 8.09523H17.0807L19.53 12.38H16.8058V12.3768Z" />
        </svg>
      );
    case "X":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9.23842 15.4055L17.3051 9.26292C17.7006 8.9618 18.2658 9.07925 18.4543 9.54702C19.446 12.0138 19.0029 14.9784 17.0297 17.0138C15.0566 19.0492 12.3111 19.4955 9.80163 18.4789L7.06027 19.7882C10.9922 22.5604 15.7667 21.8748 18.7504 18.795C21.117 16.3538 21.8499 13.0262 21.1646 10.0254L21.1708 10.0318C20.1769 5.62354 21.4151 3.86151 23.9515 0.258408C23.9702 0.231693 23.9351 0.202703 23.9123 0.226139L20.7939 3.44289V3.43221L9.23842 15.4055Z" />
          <path d="M7.65167 7.33217C5.24368 9.81392 4.75711 14.1176 7.57924 16.8984L7.57713 16.9005L0.0792788 23.8097C0.0528384 23.834 0.0162235 23.8015 0.0377551 23.7728C0.487937 23.1707 1.01883 22.595 1.54932 22.0198L1.57777 21.9889C3.28214 20.1411 4.97141 18.3097 3.93926 15.7216C2.55615 12.2552 3.36158 8.19287 5.9228 5.55089C8.58547 2.80639 12.507 2.1144 15.7826 3.5048C16.5072 3.78245 17.1388 4.17758 17.6315 4.54493L14.8964 5.84777C12.3497 4.7457 9.43229 5.49537 7.65167 7.33217Z" />
        </svg>
      );
    case "Kling":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" clipRule="evenodd" d="M16.7522 2.86984L16.818 2.93745L16.8199 2.93552C18.087 4.25441 17.7236 6.90443 15.8863 9.90864L19.5 13.6567L19.3447 13.9703C18.7372 15.1986 17.9147 16.2992 16.9193 17.216C15.608 18.43 14.0251 19.2853 12.3143 19.7044L12.2522 19.7198L12.1634 19.7417L12.0994 19.7565L11.9584 19.7887L11.8416 19.8126L11.754 19.8299C11.6609 19.8493 11.5634 19.8673 11.4683 19.884L11.3888 19.8963L11.3286 19.904C11.2429 19.916 11.1576 19.9272 11.0727 19.9375C9.64831 20.1036 8.20616 19.9376 6.8516 19.4517C5.49703 18.9658 4.2643 18.1723 3.24348 17.1291L3.18385 17.0692C1.91429 15.7503 2.27391 13.0983 4.11366 10.0922L0.5 6.34416L0.65528 6.03054C1.26118 4.80131 2.0846 3.70115 3.08261 2.78741C4.10242 1.8473 5.28649 1.11848 6.57081 0.640344C6.86894 0.528933 7.18075 0.431691 7.48696 0.34926C7.73931 0.279139 7.9944 0.220054 8.25155 0.172163C8.33851 0.154131 8.43665 0.135456 8.53168 0.118712C10.0139 -0.12084 11.5297 0.00325476 12.9574 0.481036C14.385 0.958817 15.6847 1.77698 16.7522 2.86984ZM15.5304 3.03083H15.5267L15.5304 3.03276C14.3025 2.63864 12.354 3.27555 10.2944 4.68267C11.8615 4.22994 13.377 4.46435 14.3565 5.48057C15.2845 6.44462 15.5385 7.90777 15.187 9.44497C15.1704 9.52697 15.1497 9.61005 15.1248 9.69419C16.8062 7.05706 17.3441 4.58993 16.2795 3.48807C16.262 3.4682 16.2433 3.44949 16.2236 3.43204L16.2155 3.42431L16.2037 3.41336L16.1683 3.38503C16.153 3.37215 16.1371 3.3597 16.1205 3.34768L16.0944 3.32836C15.9242 3.19657 15.7334 3.09594 15.5304 3.03083ZM14.6876 8.95876C14.4708 10.2995 13.7559 11.6545 12.672 12.777C11.5913 13.9001 10.282 14.642 8.98696 14.8687C7.77516 15.0812 6.72981 14.8043 6.04472 14.0959C5.36149 13.3868 5.09441 12.3069 5.29938 11.044C5.51615 9.7045 6.22919 8.3489 7.30807 7.22771C7.30807 7.22771 7.30994 7.22771 7.31429 7.22127L7.31801 7.21483C8.40062 6.09944 9.70497 5.3595 10.9969 5.13539C12.2087 4.92287 13.2516 5.1985 13.9391 5.90818C14.6224 6.61657 14.8894 7.69847 14.6845 8.9594H14.6882L14.6876 8.95876ZM3.70621 3.51061C2.88113 4.26712 2.1865 5.16395 1.65217 6.16255L1.64596 6.16449L4.78137 9.40762C5.04127 9.02837 5.31475 8.65932 5.60124 8.30124C5.70311 8.17567 5.80807 8.04558 5.91553 7.91614L5.95652 7.86784L6.10559 7.69525C6.10994 7.69139 6.11429 7.68301 6.11429 7.68301L6.14161 7.65082L6.1559 7.63343L6.23292 7.54456C6.27226 7.49819 6.31284 7.45247 6.35466 7.40739C6.35466 7.40288 6.36087 7.39644 6.36087 7.39644L6.42795 7.32045L6.47578 7.26893C6.47785 7.26592 6.4795 7.26507 6.4795 7.26507C6.48385 7.26249 6.48385 7.25863 6.48385 7.25863C6.48675 7.25562 6.48965 7.25176 6.49255 7.24703L6.50124 7.23609C6.50882 7.23006 6.51569 7.22314 6.52174 7.21548L6.53354 7.2026C6.55901 7.17619 6.58944 7.14528 6.61677 7.11437C6.63126 7.09591 6.64783 7.07745 6.66646 7.05899L6.69193 7.03194C6.69627 7.0255 6.70807 7.01326 6.70807 7.01326L6.7559 6.96432L6.84907 6.86901L6.88012 6.83488L6.91491 6.79688C7.5863 6.09838 8.30377 5.44917 9.06211 4.85397L9.16149 4.77862H9.16211V4.77798L9.16335 4.77733L9.26273 4.70134C9.37371 4.61505 9.48551 4.53068 9.59814 4.44825C9.71822 4.36325 9.8383 4.27953 9.95838 4.1971C11.587 3.0714 13.182 2.39586 14.4839 2.26191C12.7422 1.17239 10.6864 0.752921 8.6764 1.07697C8.58944 1.09114 8.50621 1.10595 8.41677 1.12462C8.36025 1.13493 8.31118 1.14523 8.26149 1.15554L8.23168 1.16198C7.77515 1.25942 7.3258 1.39004 6.88696 1.55288C5.71551 1.9877 4.63519 2.65238 3.70621 3.51061ZM3.87888 16.6531C4.05279 16.7905 4.25093 16.8949 4.47329 16.9661H4.46894C5.70497 17.3577 7.64596 16.7188 9.69814 15.3156C8.13292 15.7664 6.6205 15.532 5.64099 14.5157C4.71739 13.5562 4.46335 12.0885 4.81304 10.5513C4.83043 10.4693 4.85093 10.3863 4.87453 10.3021C3.19379 12.9399 2.65714 15.4064 3.7205 16.5089C3.77062 16.56 3.8235 16.6082 3.87888 16.6531ZM18.346 13.8389V13.8402C17.8108 14.8373 17.1168 15.7333 16.2932 16.4902C15.0606 17.625 13.5707 18.4173 11.9627 18.7931L11.9429 18.7983L11.8894 18.8112C11.8291 18.8281 11.7679 18.8418 11.7062 18.8524C11.666 18.8614 11.6251 18.8693 11.5832 18.8762C11.4967 18.8936 11.4097 18.9087 11.3224 18.9213L11.2497 18.9342L11.1671 18.9451C11.1008 18.9545 11.0329 18.9631 10.9634 18.9709C9.06697 19.1922 7.15308 18.7592 5.51801 17.7389C6.77143 17.6108 8.29752 16.9764 9.86273 15.9274L9.95217 15.8668L10.0416 15.8057L10.1634 15.7206H10.164L10.3994 15.5545C10.5128 15.4721 10.6246 15.3877 10.7348 15.3014C10.8035 15.2503 10.871 15.1994 10.9373 15.1488C11.6946 14.5518 12.4122 13.9025 13.0851 13.2052C13.1012 13.1881 13.1164 13.1713 13.1304 13.155L13.1491 13.1331C13.1822 13.1009 13.2133 13.0693 13.2422 13.0384L13.2894 12.9895C13.2894 12.9895 13.3019 12.9766 13.3037 12.9702L13.3217 12.9521L13.3292 12.9438L13.3832 12.8884L13.4248 12.8433C13.4389 12.8296 13.4528 12.815 13.4665 12.7995L13.4776 12.7866C13.4837 12.7792 13.4906 12.7725 13.4981 12.7667L13.5075 12.7551L13.5161 12.7441C13.5161 12.7441 13.5224 12.7377 13.5261 12.7358L13.5429 12.7171L13.5596 12.6984L13.5758 12.6823C13.5584 12.7012 13.5418 12.7209 13.5261 12.7416L13.5646 12.6997L13.5652 12.6984C13.5921 12.6684 13.6188 12.6396 13.6453 12.6121C13.6453 12.6121 13.6453 12.6057 13.6516 12.6057C13.688 12.5653 13.7234 12.5245 13.7578 12.4833L13.828 12.4022C13.8372 12.396 13.8447 12.3873 13.8497 12.3771L13.8894 12.3275L13.8994 12.3152C13.9478 12.2616 13.9952 12.2073 14.0416 12.1523L14.0901 12.0943C14.1679 12.0003 14.2453 11.9057 14.3224 11.8103L14.4155 11.6951L14.4447 11.6577C14.482 11.6092 14.5188 11.562 14.5553 11.516C14.5863 11.4774 14.6168 11.4379 14.6466 11.3975C14.8451 11.1367 15.0377 10.8711 15.2242 10.6009L18.346 13.8389ZM18.346 13.8389C18.346 13.8368 18.3472 13.835 18.3497 13.8338V13.8441L18.346 13.8402H18.3472L18.346 13.8389Z" />
        </svg>
      );
    case "Bytedance":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <g clipPath="url(#seedance-clip)">
            <path d="M3.1544 12.1539L0.533203 12.8092V1.19824L3.1544 1.85354V12.1539Z" />
            <path d="M15.8225 12.8333L13.1963 13.4886V0.518555L15.8225 1.169V12.8333Z" />
            <path d="M7.31261 12.5083L4.69141 13.1636V6.32422L7.31261 6.97947V12.5083Z" />
            <path d="M9.02539 5.3096L11.6516 4.6543V11.4937L9.02539 10.8384V5.3096Z" />
          </g>
          <defs>
            <clipPath id="seedance-clip">
              <rect width="16" height="14" fill="white" />
            </clipPath>
          </defs>
        </svg>
      );
    default:
      return null;
  }
}

function RatioTriggerPreview({ ratio }: { ratio: string }) {
  const [ws, hs] = ratio.split(":");
  const w = parseFloat(ws), h = parseFloat(hs);
  if (!w || !h) return null;
  const maxW = 16, maxH = 12;
  let rw = maxW, rh = (h / w) * maxW;
  if (rh > maxH) { rh = maxH; rw = (w / h) * maxH; }
  return (
    <span style={{
      display: "inline-block",
      width: `${Math.round(rw)}px`,
      height: `${Math.round(rh)}px`,
      border: "1.5px solid currentColor",
      borderRadius: "2px",
      flexShrink: 0,
    }} />
  );
}

function DiamondIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M9.7832 0.499878C10.3232 0.499878 10.6767 0.496482 11.0146 0.578979C11.1617 0.61491 11.3057 0.662985 11.4443 0.722534C11.7645 0.860077 12.0366 1.07387 12.4492 1.39148C13.1566 1.93605 13.7165 2.36662 14.127 2.75183C14.5421 3.14152 14.8482 3.52421 15.0088 3.99109C15.1407 4.37448 15.1904 4.77934 15.1543 5.18152C15.11 5.67308 14.9012 6.11252 14.5889 6.57898C14.2806 7.0392 13.8372 7.57315 13.2793 8.24695L10.6172 11.4628C10.115 12.0692 9.7038 12.5675 9.32715 12.9071C8.93826 13.2577 8.52095 13.4998 7.99902 13.4999C7.47706 13.4998 7.05981 13.2577 6.6709 12.9071C6.29425 12.5675 5.88301 12.0692 5.38086 11.4628L2.71875 8.24695C2.16068 7.573 1.71649 7.03928 1.4082 6.57898C1.09583 6.11253 0.88806 5.67308 0.84375 5.18152C0.807575 4.77927 0.857447 4.37442 0.989258 3.99109C1.14984 3.52425 1.45592 3.14152 1.87109 2.75183C2.28153 2.36662 2.84142 1.93606 3.54883 1.39148C3.96144 1.07384 4.23354 0.860066 4.55371 0.722534C4.69233 0.663015 4.83627 0.614905 4.9834 0.578979C5.32129 0.496532 5.67406 0.499877 6.21387 0.499878H9.7832ZM6.21387 1.49988C5.62618 1.49988 5.41459 1.50338 5.2207 1.55066C5.12692 1.57356 5.03539 1.60407 4.94824 1.64148C4.77007 1.71805 4.60994 1.83744 4.15918 2.18445C3.43571 2.74139 2.92207 3.13743 2.55566 3.48132C2.19409 3.82071 2.01931 4.06993 1.93457 4.31628C1.84817 4.56755 1.81638 4.83083 1.83984 5.09167C1.86269 5.34527 1.97017 5.62051 2.23926 6.02234C2.51258 6.43044 2.91688 6.91921 3.48828 7.60925L6.15039 10.8251C6.67274 11.4559 7.03123 11.8858 7.34082 12.1649C7.63783 12.4326 7.8253 12.4998 7.99902 12.4999C8.17274 12.4998 8.36021 12.4326 8.65723 12.1649C8.96678 11.8858 9.32443 11.4558 9.84668 10.8251L12.5098 7.60925C13.0811 6.91925 13.4855 6.43042 13.7588 6.02234C14.0278 5.62058 14.1353 5.34525 14.1582 5.09167C14.1816 4.83081 14.1498 4.56744 14.0635 4.31628C13.9788 4.06995 13.8039 3.82068 13.4424 3.48132C13.076 3.13744 12.5623 2.74138 11.8389 2.18445C11.3881 1.83744 11.228 1.71805 11.0498 1.64148C10.9627 1.60406 10.8712 1.57359 10.7773 1.55066C10.5834 1.50333 10.3713 1.49988 9.7832 1.49988H6.21387ZM9.33203 4.16687C9.6081 4.16695 9.83203 4.39078 9.83203 4.66687C9.83188 4.94283 9.60801 5.16679 9.33203 5.16687H6.66504C6.38915 5.16669 6.16519 4.94277 6.16504 4.66687C6.16504 4.39084 6.38905 4.16705 6.66504 4.16687H9.33203Z" />
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

function GalleryCard({
  item,
  onOpen,
  onAddReference,
  onCopyPrompt,
  onDownload,
  onDelete,
  videoMuted,
  onToggleMute,
}: {
  item: GalleryItem;
  onOpen?: () => void;
  onAddReference?: (url: string) => void;
  onCopyPrompt?: (prompt: string, refUrls?: string[]) => void;
  onDownload?: (url: string, isVideo: boolean) => Promise<void>;
  onDelete?: (id: string, source: "generation" | "upload") => Promise<void>;
  videoMuted?: boolean;
  onToggleMute?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const preloaded = loadedImageUrls.has(item.url);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(preloaded);
  const [shouldLoad, setShouldLoad] = useState(preloaded);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cardImgIdx, setCardImgIdx] = useState(0);
  const [naturalRatio, setNaturalRatio] = useState<string | null>(() => naturalRatioCache.get(item.url) ?? null);
  const isVideo = item.mediaType === "video";
  const allUrls = item.imageUrls ?? [item.url];
  const displayUrl = allUrls[cardImgIdx] ?? item.url;

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

  const storedRatio = (() => {
    const ar = item.aspect_ratio;
    if (!ar || ar === "auto") return null;
    const [w, h] = ar.split(":");
    return w && h ? `${w} / ${h}` : null;
  })();

  // Uploads have no stored aspect_ratio — use natural dims once known, 1/1 only while actively loading
  const cssRatio = storedRatio ?? (() => {
    if (item.source !== "upload") return null;
    if (naturalRatio) return naturalRatio;
    if (shouldLoad && !imgLoaded) return "1 / 1"; // placeholder so shimmer has height
    return null;
  })();

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try { await onDownload?.(item.url, isVideo); } finally { setDownloading(false); }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.prompt) return;
    onCopyPrompt?.(item.prompt, item.referenceImageUrls);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleAddRef = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddReference?.(item.url);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    try { await onDelete?.(item.id, item.source); } finally { setDeleting(false); }
  };

  if (failed) {
    return (
      <div className="gallery-item" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className="gallery-item"
      onMouseEnter={() => { if (isVideo) videoRef.current?.play().then(() => setPlaying(true)).catch(() => { }); }}
      onMouseLeave={() => { if (isVideo && videoRef.current) { videoRef.current.pause(); setPlaying(false); } }}
      onClick={onOpen}
    >
      {isVideo ? (
        <>
          <video
            ref={videoRef}
            src={item.url}
            muted={videoMuted}
            loop
            playsInline
            preload="metadata"
            onError={() => setFailed(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
          {!playing && (
            <div className="gallery-play-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            </div>
          )}
          {/* Mute toggle — top-left, visible on hover, global state */}
          <button
            className="gallery-mute-btn gallery-action-btn"
            onClick={e => { e.stopPropagation(); onToggleMute?.(); }}
            title={videoMuted ? "Unmute" : "Mute"}
          >
            {videoMuted ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
            )}
          </button>
        </>
      ) : (
        <>
          {(!shouldLoad || !imgLoaded) && <div className="gallery-shimmer" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={displayUrl}
            src={shouldLoad ? `/_next/image?url=${encodeURIComponent(displayUrl)}&w=828&q=75` : undefined}
            alt={item.prompt ?? ""}
            decoding="async"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (!storedRatio && item.source === "upload" && img.naturalWidth && img.naturalHeight) {
                const r = `${img.naturalWidth} / ${img.naturalHeight}`;
                naturalRatioCache.set(item.url, r);
                setNaturalRatio(r);
              }
              setImgLoaded(true);
              loadedImageUrls.add(item.url);
            }}
            onError={() => setFailed(true)}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", opacity: imgLoaded ? 1 : 0, transition: "opacity 280ms ease" }}
          />
          {/* Inner carousel nav — only when multiple images */}
          {allUrls.length > 1 && (
            <>
              <button
                onClick={e => { e.stopPropagation(); setImgLoaded(false); setCardImgIdx(i => Math.max(0, i - 1)); }}
                disabled={cardImgIdx === 0}
                style={{
                  position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)",
                  width: 26, height: 26, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", zIndex: 3, opacity: cardImgIdx === 0 ? 0.25 : 1,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <button
                onClick={e => { e.stopPropagation(); setImgLoaded(false); setCardImgIdx(i => Math.min(allUrls.length - 1, i + 1)); }}
                disabled={cardImgIdx === allUrls.length - 1}
                style={{
                  position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                  width: 26, height: 26, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", zIndex: 3, opacity: cardImgIdx === allUrls.length - 1 ? 0.25 : 1,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
              <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 4, zIndex: 3 }}>
                {allUrls.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={e => { e.stopPropagation(); setImgLoaded(false); setCardImgIdx(idx); }}
                    style={{
                      width: idx === cardImgIdx ? 12 : 6, height: 6, borderRadius: 3,
                      background: idx === cardImgIdx ? "#fff" : "rgba(255,255,255,0.4)",
                      border: "none", cursor: "pointer", padding: 0, transition: "all 150ms",
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Gradient overlay + prompt ── */}
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

      {/* ── Top-right icon buttons ── */}
      <div className="gallery-actions-top">
        {item.prompt && onCopyPrompt && (
          <button className="gallery-action-btn" title={copied ? "Copied!" : "Copy prompt"} onClick={handleCopy}>
            {copied ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ff3df5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        )}
        <button
          className="gallery-action-btn"
          title={downloading ? "Downloading…" : "Download"}
          onClick={handleDownload}
          disabled={downloading}
          style={{ opacity: downloading ? 0.65 : undefined }}
        >
          {downloading ? (
            <div style={{ width: "11px", height: "11px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#fff", animation: "spin 0.75s linear infinite", flexShrink: 0 }} />
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          )}
        </button>
        {onDelete && (
          <button
            className="gallery-action-btn gallery-delete-btn"
            title="Delete"
            onClick={handleDelete}
            disabled={deleting}
            style={{ opacity: deleting ? 0.65 : undefined }}
          >
            {deleting ? (
              <div style={{ width: "11px", height: "11px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#fff", animation: "spin 0.75s linear infinite", flexShrink: 0 }} />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* ── Bottom-left Reference button (images only) ── */}
      {!isVideo && onAddReference && (
        <div className="gallery-actions-bottom">
          <button className="gallery-ref-btn" onClick={handleAddRef}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
            </svg>
            Reference
          </button>
        </div>
      )}
    </div>
  );
}

// ── DownloadToast ─────────────────────────────────────────────────────────────

function DownloadToast({ downloads, onClear }: { downloads: DownloadTask[]; onClear: () => void }) {
  const [collapsed, setCollapsed] = useState(false);

  if (downloads.length === 0) return null;

  const allDone = downloads.every(d => d.status !== "preparing");
  const title = allDone ? "Download complete" : "Preparing download";

  return (
    <div style={{
      position: "fixed",
      top: "64px",
      right: "16px",
      width: "300px",
      background: "rgba(16,18,20,0.97)",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      borderRadius: "18px",
      border: "1px solid rgba(255,255,255,0.07)",
      boxShadow: "0 12px 48px rgba(0,0,0,0.7), 0 2px 12px rgba(0,0,0,0.4)",
      zIndex: 9500,
      overflow: "hidden",
      fontFamily: "inherit",
    }}>
      {/* Header */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 14px 14px 14px", cursor: "pointer", userSelect: "none" }}
      >
        {/* Animated icon */}
        <div style={{ position: "relative", width: "28px", height: "28px", flexShrink: 0 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ position: "absolute", inset: 0 }}>
            <circle cx="14" cy="14" r="12" stroke="rgba(119,229,68,0.2)" strokeWidth="2" />
            <circle
              cx="14" cy="14" r="12"
              stroke="#ff3df5" strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 12}`}
              strokeDashoffset={allDone ? 0 : `${2 * Math.PI * 12 * 0.25}`}
              style={{ transformOrigin: "center", transform: "rotate(-90deg)", transition: "stroke-dashoffset 0.4s ease" }}
              className={allDone ? undefined : "dl-ring-spin"}
            />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ff3df5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
        </div>
        <span style={{ flex: 1, fontSize: "14px", fontWeight: 600, color: "#ffffff", letterSpacing: "-0.01em" }}>{title}</span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round"
          style={{ flexShrink: 0, transition: "transform 200ms", transform: collapsed ? "rotate(180deg)" : "none" }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>

      {/* Items */}
      {!collapsed && (
        <div style={{ padding: "0 8px 8px" }}>
          {downloads.map(task => (
            <div key={task.id} style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "9px 10px",
              background: "rgba(255,255,255,0.035)",
              borderRadius: "10px",
              marginBottom: "4px",
            }}>
              {/* File icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={task.status === "preparing" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.45)"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M3 6h18M3 12h18M3 18h18" />
                <rect x="2" y="4" width="20" height="16" rx="2" />
              </svg>
              {/* Label */}
              <span style={{ flex: 1, fontSize: "13px", color: task.status === "preparing" ? "rgba(255,255,255,0.35)" : "#ffffff", letterSpacing: "-0.01em" }}>
                {task.status === "preparing" ? "Preparing…" : task.status === "error" ? "Failed" : "Ready"}
              </span>
              {/* Status indicator */}
              {task.status === "preparing" ? (
                <div style={{ width: "16px", height: "16px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.12)", borderTopColor: "rgba(255,255,255,0.45)", animation: "spin 0.9s linear infinite", flexShrink: 0 }} />
              ) : task.status === "error" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                </svg>
              ) : (
                <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: "#ff3df5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#060A06" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Lightbox helpers ──────────────────────────────────────────────────────────

function renderLightboxPrompt(
  text: string,
  refUrls: string[] | undefined,
): React.ReactNode {
  if (!refUrls?.length) {
    return <span style={{ color: "rgba(255,255,255,0.72)" }}>{text}</span>;
  }
  const parts: React.ReactNode[] = [];
  let lastEnd = 0;
  let key = 0;
  const re = /<<<image (\d+)>>>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastEnd) {
      parts.push(<span key={key++} style={{ color: "rgba(255,255,255,0.72)" }}>{text.slice(lastEnd, m.index)}</span>);
    }
    const n = parseInt(m[1]);
    const imgUrl = refUrls[n - 1];
    parts.push(
      <span key={key++} style={{
        display: "inline-flex", alignItems: "center", gap: "4px",
        background: "rgba(255,255,255,0.1)", borderRadius: "6px",
        padding: "1px 7px 1px 2px", verticalAlign: "middle",
        margin: "0 1px", fontSize: "12px", fontWeight: 600,
        color: "#ffffff", lineHeight: "20px",
      }}>
        {imgUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgUrl} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: "cover", flexShrink: 0 }} />
        )}
        Image {n}
      </span>
    );
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < text.length) {
    parts.push(<span key={key++} style={{ color: "rgba(255,255,255,0.72)" }}>{text.slice(lastEnd)}</span>);
  }
  return <>{parts}</>;
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({ item, onClose }: { item: GalleryItem; onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const allUrls = item.imageUrls ?? [item.url];
  const lightboxUrl = allUrls[imgIdx] ?? item.url;

  useEffect(() => { const id = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(id); }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { handleClose(); return; }
      if (e.key === "ArrowLeft") { setFullLoaded(false); setImgIdx(i => Math.max(0, i - 1)); }
      if (e.key === "ArrowRight") { setFullLoaded(false); setImgIdx(i => Math.min(allUrls.length - 1, i + 1)); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUrls.length]);

  const handleClose = () => { setVisible(false); setTimeout(onClose, 200); };

  const copyPrompt = () => {
    if (!item.prompt) return;
    navigator.clipboard.writeText(item.prompt).catch(() => { });
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const isVideo = item.mediaType === "video";

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const ext = isVideo ? "mp4" : "jpg";
      const filename = `${isVideo ? "video" : "image"}-${item.id.slice(0, 8)}.${ext}`;
      const res = await fetch(`/api/download?url=${encodeURIComponent(lightboxUrl)}&filename=${filename}`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setDownloading(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const infoRows = [
    item.model && { label: "Model", value: item.model },
    item.quality && { label: "Quality", value: item.quality.charAt(0).toUpperCase() + item.quality.slice(1) },
    item.aspect_ratio && { label: "Aspect ratio", value: item.aspect_ratio },
    item.source && { label: "Source", value: item.source === "generation" ? "Generated" : "Uploaded" },
    { label: "Created", value: formatDate(item.created_at) },
  ].filter(Boolean) as { label: string; value: string }[];

  const panelStyle: React.CSSProperties = {
    background: "#0D1012",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: "16px",
    overflow: "hidden",
  };

  const sectionHeaderStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: "8px",
    padding: "14px 16px 12px",
  };

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em",
    color: "rgba(255,255,255,0.4)", textTransform: "uppercase",
  };

  return createPortal(
    <div onClick={handleClose} style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      background: `rgba(0,0,0,${visible ? 0.55 : 0})`,
      backdropFilter: visible ? "blur(16px)" : "none",
      WebkitBackdropFilter: visible ? "blur(16px)" : "none",
      transition: "background 200ms ease, backdrop-filter 200ms ease",
      padding: "24px", gap: "20px",
      overflowY: "auto",
    }}>

      {/* ── Media (vertically centered column) ── */}
      <div style={{ flex: 1, minHeight: "calc(100vh - 48px)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>

        {/* Prev button — images only */}
        {!isVideo && allUrls.length > 1 && (
          <button
            onClick={e => { e.stopPropagation(); setFullLoaded(false); setImgIdx(i => Math.max(0, i - 1)); }}
            disabled={imgIdx === 0}
            style={{
              position: "absolute", left: 0, zIndex: 10,
              width: 40, height: 40, borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", opacity: imgIdx === 0 ? 0.2 : 1, transition: "opacity 150ms",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        )}

        <div onClick={e => e.stopPropagation()} style={{
          position: "relative", flexShrink: 0,
          maxWidth: "100%",
          transform: visible ? "scale(1)" : "scale(0.96)", transition: "transform 200ms ease",
          borderRadius: "12px", overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
        }}>
          {isVideo ? (
            <video
              key={lightboxUrl}
              src={lightboxUrl}
              autoPlay
              loop
              playsInline
              controls
              style={{
                display: "block",
                maxHeight: "calc(100vh - 48px)",
                maxWidth: "100%",
                borderRadius: "12px",
              }}
            />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={`blur-${lightboxUrl}`} src={`/_next/image?url=${encodeURIComponent(lightboxUrl)}&w=828&q=75`} alt="" aria-hidden style={{
                display: "block",
                maxHeight: "calc(100vh - 48px)",
                width: "100%", height: "auto", objectFit: "contain",
                filter: fullLoaded ? "none" : "blur(12px)",
                transform: fullLoaded ? "scale(1)" : "scale(1.04)",
                transition: "filter 320ms ease, transform 320ms ease",
              }} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={`full-${lightboxUrl}`} src={lightboxUrl} alt={item.prompt ?? ""} onLoad={() => setFullLoaded(true)} style={{
                position: "absolute", inset: 0, display: "block", width: "100%", height: "100%", objectFit: "contain",
                opacity: fullLoaded ? 1 : 0, transition: "opacity 320ms ease",
              }} />
              {/* Dot indicators */}
              {allUrls.length > 1 && (
                <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 5, zIndex: 5 }}>
                  {allUrls.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={e => { e.stopPropagation(); setFullLoaded(false); setImgIdx(idx); }}
                      style={{
                        width: idx === imgIdx ? 16 : 8, height: 8, borderRadius: 4,
                        background: idx === imgIdx ? "#fff" : "rgba(255,255,255,0.4)",
                        border: "none", cursor: "pointer", padding: 0, transition: "all 150ms",
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Next button — images only */}
        {!isVideo && allUrls.length > 1 && (
          <button
            onClick={e => { e.stopPropagation(); setFullLoaded(false); setImgIdx(i => Math.min(allUrls.length - 1, i + 1)); }}
            disabled={imgIdx === allUrls.length - 1}
            style={{
              position: "absolute", right: 0, zIndex: 10,
              width: 40, height: 40, borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", opacity: imgIdx === allUrls.length - 1 ? 0.2 : 1, transition: "opacity 150ms",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        )}
      </div>

      {/* ── Right panel ── */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "300px", flexShrink: 0,
          display: "flex", flexDirection: "column", gap: "12px",
          opacity: visible ? 1 : 0,
          transform: visible ? "translateX(0)" : "translateX(14px)",
          transition: "opacity 220ms ease 80ms, transform 220ms ease 80ms",
          background: "rgba(10,12,14,0.85)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderRadius: "20px",
          border: "1px solid rgba(255,255,255,0.07)",
          padding: "12px",
          overflowY: "auto",
          maxHeight: "calc(100vh - 48px)",
        }}
      >
        {/* Prompt section */}
        {item.prompt && (
          <div style={panelStyle}>
            {/* Reference image thumbnails */}
            {item.referenceImageUrls && item.referenceImageUrls.length > 0 && (
              <div style={{ padding: "14px 16px 0", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {item.referenceImageUrls.map((url, i) => (
                  <div key={i} style={{ position: "relative", width: 76, height: 68, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    <div style={{
                      position: "absolute", bottom: 4, right: 4,
                      background: "rgba(0,0,0,0.65)", borderRadius: 4,
                      padding: "2px 5px", fontSize: 9, fontWeight: 700,
                      color: "rgba(255,255,255,0.8)", lineHeight: 1,
                    }}>
                      {i + 1}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ ...sectionHeaderStyle, justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3h6l-1 5H3z" /><path d="M3 8h6M7 3v5" /><path d="M14 3h7" /><path d="M14 8h7" /><path d="M14 13h4" /><path d="M3 13h8" /><path d="M3 18h18" />
                </svg>
                <span style={sectionLabelStyle}>Prompt</span>
              </div>
              <button
                onClick={copyPrompt}
                style={{
                  padding: "4px 12px", borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.05)",
                  color: copied ? "#ff3df5" : "rgba(255,255,255,0.65)",
                  fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  transition: "background 140ms, color 140ms",
                  borderColor: copied ? "rgba(119,229,68,0.3)" : "rgba(255,255,255,0.1)",
                }}
                onMouseEnter={e => { if (!copied) { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#fff"; } }}
                onMouseLeave={e => { if (!copied) { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "rgba(255,255,255,0.65)"; } }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <div style={{
              padding: "0 16px",
              fontSize: "13px", lineHeight: 1.65,
              ...(promptExpanded ? {} : {
                display: "-webkit-box" as "block",
                WebkitBoxOrient: "vertical" as const,
                WebkitLineClamp: 5,
                overflow: "hidden",
              }),
            }}>
              {renderLightboxPrompt(item.prompt, item.referenceImageUrls)}
            </div>
            <button
              onClick={() => setPromptExpanded(p => !p)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                width: "100%", padding: "10px 16px 14px",
                background: "transparent", border: "none",
                color: "rgba(255,255,255,0.3)",
                fontSize: "13px", cursor: "pointer", fontFamily: "inherit",
                transition: "color 140ms",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.3)"; }}
            >
              {promptExpanded ? "Show less" : "See all"}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
                style={{ transform: promptExpanded ? "rotate(180deg)" : "none", transition: "transform 200ms" }}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
        )}

        {/* Information section */}
        <div style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
            </svg>
            <span style={sectionLabelStyle}>Information</span>
          </div>
          {infoRows.map((row) => (
            <div key={row.label} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "13px 16px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
            }}>
              <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)" }}>{row.label}</span>
              <span style={{ fontSize: "13px", color: "#ffffff", fontWeight: 600 }}>{row.value}</span>
            </div>
          ))}
        </div>

        {/* Download button */}
        <button
          onClick={download}
          disabled={downloading}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            width: "100%", padding: "13px 16px",
            borderRadius: "14px", border: "1px solid rgba(255,255,255,0.07)",
            background: "#0D1012",
            color: downloading ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.75)",
            fontSize: "13px", fontWeight: 600, cursor: downloading ? "default" : "pointer",
            fontFamily: "inherit", transition: "background 140ms, color 140ms",
          }}
          onMouseEnter={e => { if (!downloading) { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#fff"; } }}
          onMouseLeave={e => { if (!downloading) { e.currentTarget.style.background = "#0D1012"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; } }}
        >
          {downloading ? (
            <span style={{ width: 13, height: 13, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.5)", display: "inline-block", animation: "spin 0.75s linear infinite" }} />
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v13M7 13l5 5 5-5" /><path d="M5 21h14" />
            </svg>
          )}
          {downloading ? "Downloading…" : "Download"}
        </button>
      </div>

      {/* ── Close button ── */}
      <button onClick={handleClose} style={{
        position: "fixed", top: "16px", right: "16px",
        width: "34px", height: "34px", borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.5)",
        color: "rgba(255,255,255,0.6)", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
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
  .picker-scroll { scrollbar-width: none; }
  .picker-scroll::-webkit-scrollbar { display: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes dlRingSpin {
    from { stroke-dashoffset: 75.4; transform: rotate(-90deg); }
    to   { stroke-dashoffset: 0;    transform: rotate(270deg); }
  }
  .dl-ring-spin { animation: dlRingSpin 1.4s linear infinite; transform-origin: center; }
  @keyframes dropIn {
    from { opacity: 0; transform: translateY(6px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)   scale(1);    }
  }
  @keyframes shimmer {
    0%   { background-position: -800px 0; }
    100% { background-position:  800px 0; }
  }
  .gallery-skeleton {
    width: 100%;
    background: linear-gradient(
      90deg,
      #222226 0px,
      #2e2e33 200px,
      #3a3a40 350px,
      #2e2e33 500px,
      #222226 700px
    );
    background-size: 800px 100%;
    animation: shimmer 1.6s ease-in-out infinite;
    border-radius: 2px;
  }
  @keyframes refImgIn {
    from { opacity: 0; transform: translateY(14px) scale(0.91); }
    to   { opacity: 1; transform: translateY(0)    scale(1);    }
  }
  .gallery-zoom-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 90px;
    height: 3px;
    border-radius: 2px;
    background: rgba(255,255,255,0.14);
    outline: none;
    cursor: pointer;
  }
  .gallery-zoom-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #ffffff;
    cursor: pointer;
    transition: transform 120ms;
  }
  .gallery-zoom-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
  .gallery-zoom-slider::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #ffffff;
    cursor: pointer;
    border: none;
  }
  @keyframes durPickerIn {
    from { opacity: 0; transform: translateY(6px) scale(0.95); }
    to   { opacity: 1; transform: translateY(0)   scale(1);    }
  }
  @keyframes durPickerOut {
    from { opacity: 1; transform: translateY(0)   scale(1);    }
    to   { opacity: 0; transform: translateY(6px) scale(0.95); }
  }
  .dur-picker-in  { animation: durPickerIn  170ms cubic-bezier(0.16,1,0.3,1) both; }
  .dur-picker-out { animation: durPickerOut 160ms cubic-bezier(0.4,0,1,1)    both; }
  .dur-slider {
    -webkit-appearance: none;
    appearance: none;
    height: 3px;
    border-radius: 2px;
    background: rgba(255,255,255,0.18);
    outline: none;
    cursor: pointer;
  }
  .dur-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #ffffff;
    cursor: pointer;
    transition: transform 100ms;
  }
  .dur-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
  .dur-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #ffffff;
    cursor: pointer;
    border: none;
  }
  .gallery-item {
    position: relative;
    overflow: hidden;
    cursor: pointer;
    background: #222226;
    width: 100%;
    height: 100%;
  }
  .gallery-actions-top {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    opacity: 0;
    transition: opacity 180ms ease;
    z-index: 5;
    pointer-events: none;
  }
  .gallery-item:hover .gallery-actions-top {
    opacity: 1;
    pointer-events: auto;
  }
  .gallery-action-btn {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(0,0,0,0.62);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    color: rgba(255,255,255,0.8);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 120ms, color 120ms;
    flex-shrink: 0;
    padding: 0;
  }
  .gallery-action-btn:hover {
    background: rgba(255,255,255,0.16);
    color: #ffffff;
  }
  .gallery-delete-btn:hover {
    background: rgba(255,255,255,0.16);
    color: #ef4444 !important;
  }
  .gallery-actions-bottom {
    position: absolute;
    bottom: 10px;
    right: 10px;
    opacity: 0;
    transition: opacity 180ms ease;
    z-index: 5;
    pointer-events: none;
  }
  .gallery-item:hover .gallery-actions-bottom {
    opacity: 1;
    pointer-events: auto;
  }
  .gallery-ref-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 11px 5px 9px;
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(0,0,0,0.62);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    color: #ffffff;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 120ms;
    font-family: inherit;
    letter-spacing: -0.01em;
    white-space: nowrap;
    padding: 5px 11px 5px 9px;
  }
  .gallery-ref-btn:hover {
    background: rgba(255,255,255,0.16);
  }
  .gallery-shimmer {
    position: absolute; inset: 0;
    background: linear-gradient(90deg, #222226 25%, #2a2a2e 50%, #222226 75%);
    background-size: 800px 100%;
    animation: shimmer 1.6s infinite linear;
  }
  .gallery-item img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .gallery-item video { display: block; width: 100%; height: 100%; object-fit: cover; }
  [data-at-menu] { font-family: inherit; }
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
  .gallery-mute-btn {
    position: absolute; top: 8px; left: 8px;
    opacity: 0; transition: opacity 180ms ease;
    pointer-events: none; z-index: 5;
  }
  .gallery-item:hover .gallery-mute-btn {
    opacity: 1;
    pointer-events: auto;
  }
`;
