"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GalleryItem, galleryCache, getToken } from "@/lib/galleryUtils";

type TabId = "uploads" | "image-gen" | "video-gen";

const SHIMMER_CSS = `
@keyframes picker-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
@keyframes picker-dropIn {
  0% { opacity: 0; transform: translateY(12px); }
  100% { opacity: 1; transform: translateY(0); }
}`;

function PickerImage({ src }: { src: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {status === "loading" && (
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(90deg, #1e2023 25%, #2a2d31 50%, #1e2023 75%)",
          backgroundSize: "200% 100%",
          animation: "picker-shimmer 1.4s ease-in-out infinite",
        }} />
      )}
      {status !== "error" && (
        <img
          alt=""
          src={src}
          loading="eager"
          decoding="async"
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
            opacity: status === "loaded" ? 1 : 0,
            transition: "opacity 180ms ease",
          }}
        />
      )}
    </div>
  );
}

function mergeByNewest(prev: GalleryItem[], incoming: GalleryItem[]): GalleryItem[] {
  const seen = new Set(prev.map(i => i.id));
  const brandNew = incoming.filter(i => !seen.has(i.id));
  if (brandNew.length === 0) return prev;
  return [...prev, ...brandNew].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function MediaPickerModal({
  open,
  mediaKind,
  onClose,
  onPickUrl,
  onDeselect,
  onUpload,
  anchorRef,
  x,
  y,
  selectedUrls,
  maxCount,
}: {
  open: boolean;
  mediaKind: "image" | "video" | "any";
  onClose: () => void;
  onPickUrl: (url: string, mediaType: "image" | "video") => void;
  onDeselect?: (url: string) => void;
  onUpload?: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
  x?: number;
  y?: number;
  selectedUrls?: string[];
  maxCount?: number;
}) {
  const defaultTab: TabId = mediaKind === "image" ? "image-gen" : mediaKind === "video" ? "video-gen" : "uploads";
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);
  const [sourceItems, setSourceItems] = useState<GalleryItem[]>([]);
  const [fetching, setFetching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const imagePageRef = useRef(0);
  const videoPageRef = useRef(0);
  const imageHasMoreRef = useRef(true);
  const videoHasMoreRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const activeTabRef = useRef<TabId>(defaultTab);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, bottom: 0, width: 0, isAnchored: false, isCustom: false });
  const [urlInput, setUrlInput] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<GalleryItem | null>(null);

  const submitUrl = async () => {
    const trimmed = urlInput.trim();
    if (!trimmed || urlLoading) return;
    setUrlError("");
    setUrlLoading(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/fetch-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json() as { cdnUrl?: string; mediaType?: "image" | "video"; error?: string };
      if (!res.ok || !data.cdnUrl) throw new Error(data.error ?? "Failed to fetch URL");
      setUrlInput("");
      onPickUrl(data.cdnUrl, data.mediaType ?? "image");
      onClose();
    } catch (e: unknown) {
      setUrlError(e instanceof Error ? e.message : "Failed to fetch URL");
    } finally {
      setUrlLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;

    let targetLeft = 0;
    let targetTop = 0;
    let targetBottom = 0;
    let targetWidth = 0;
    let anchored = false;
    let custom = false;

    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      targetLeft = rect.left;
      targetBottom = window.innerHeight - rect.top + 6;
      targetWidth = rect.width;
      // Clamp so the modal never overflows the top of the viewport
      const modalH = 88 + 0.25 * (targetWidth - 64);
      targetBottom = Math.min(targetBottom, window.innerHeight - modalH - 8);
      targetBottom = Math.max(targetBottom, 8);
      anchored = true;
    } else if (x !== undefined && y !== undefined) {
      // Position at cursor
      const modalW = 860;
      const modalH = 410;
      targetLeft = Math.max(12, Math.min(x, window.innerWidth - modalW - 12));
      targetTop = Math.max(12, Math.min(y, window.innerHeight - modalH - 12));
      targetWidth = modalW;
      custom = true;
    }

    setPos({
      left: targetLeft,
      top: targetTop,
      bottom: targetBottom,
      width: targetWidth,
      isAnchored: anchored,
      isCustom: custom,
    });
  }, [open, anchorRef, x, y]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    const needsImg = (mediaKind === "image" || mediaKind === "any") && imageHasMoreRef.current;
    const needsVid = (mediaKind === "video" || mediaKind === "any") && videoHasMoreRef.current;
    if (!needsImg && !needsVid) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const token = await getToken();
      if (!token) return;
      const fetches: Promise<void>[] = [];
      if (needsImg) {
        const nextPage = imagePageRef.current + 1;
        fetches.push(
          fetch(`/api/gallery?type=image&page=${nextPage}`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.ok ? r.json() as Promise<{ items: GalleryItem[]; hasMore: boolean }> : null)
            .then(data => {
              if (!data) return;
              imageHasMoreRef.current = data.hasMore;
              imagePageRef.current = nextPage;
              setSourceItems(prev => mergeByNewest(prev, data.items));
            })
        );
      }
      if (needsVid) {
        const nextPage = videoPageRef.current + 1;
        fetches.push(
          fetch(`/api/gallery?type=video&page=${nextPage}`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.ok ? r.json() as Promise<{ items: GalleryItem[]; hasMore: boolean }> : null)
            .then(data => {
              if (!data) return;
              videoHasMoreRef.current = data.hasMore;
              videoPageRef.current = nextPage;
              setSourceItems(prev => mergeByNewest(prev, data.items));
            })
        );
      }
      await Promise.all(fetches);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [mediaKind]);

  useEffect(() => {
    if (!open) { setUrlInput(""); setUrlError(""); return; }
    setActiveTab(defaultTab);
    activeTabRef.current = defaultTab;

    // Reset pagination
    imagePageRef.current = 0;
    videoPageRef.current = 0;
    imageHasMoreRef.current = true;
    videoHasMoreRef.current = true;
    loadingMoreRef.current = false;

    if (mediaKind === "any") {
      const cached = [
        ...(galleryCache.get("images")?.items ?? []),
        ...(galleryCache.get("videos")?.items ?? []),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setSourceItems(cached);
    } else {
      setSourceItems(galleryCache.get(mediaKind === "image" ? "images" : "videos")?.items ?? []);
    }

    setFetching(true);
    (async () => {
      const token = await getToken();
      if (!token) { setFetching(false); return; }

      if (mediaKind === "any") {
        const [imgRes, vidRes] = await Promise.all([
          fetch("/api/gallery?type=image&page=0", { headers: { Authorization: `Bearer ${token}` } }),
          fetch("/api/gallery?type=video&page=0", { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        const [imgData, vidData] = await Promise.all([
          imgRes.ok ? (imgRes.json() as Promise<{ items: GalleryItem[]; hasMore: boolean }>) : Promise.resolve({ items: [] as GalleryItem[], hasMore: false }),
          vidRes.ok ? (vidRes.json() as Promise<{ items: GalleryItem[]; hasMore: boolean }>) : Promise.resolve({ items: [] as GalleryItem[], hasMore: false }),
        ]);
        imageHasMoreRef.current = imgData.hasMore;
        videoHasMoreRef.current = vidData.hasMore;
        setSourceItems(prev => mergeByNewest(prev, [...imgData.items, ...vidData.items]));
      } else {
        const res = await fetch(`/api/gallery?type=${mediaKind}&page=0`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json() as { items: GalleryItem[]; hasMore: boolean };
          if (mediaKind === "image") imageHasMoreRef.current = data.hasMore;
          else videoHasMoreRef.current = data.hasMore;
          setSourceItems(prev => mergeByNewest(prev, data.items));
        }
      }
      setFetching(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mediaKind]);

  // Keep activeTabRef in sync
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Infinite scroll for the picker
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !open) return;

    const checkAndLoad = () => {
      if (loadingMoreRef.current) return;
      const needsImg = (mediaKind === "image" || mediaKind === "any") && imageHasMoreRef.current;
      const needsVid = (mediaKind === "video" || mediaKind === "any") && videoHasMoreRef.current;
      if (!needsImg && !needsVid) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
        loadMore();
      }
    };

    el.addEventListener("scroll", checkAndLoad, { passive: true });
    return () => el.removeEventListener("scroll", checkAndLoad);
  }, [open, mediaKind, loadMore, loadingMore]);

  const displayItems = useMemo(() => {
    if (activeTab === "uploads")   return sourceItems.filter((i) => i.source === "upload");
    if (activeTab === "image-gen") return sourceItems.filter((i) => i.source === "generation" && i.mediaType === "image");
    return sourceItems.filter((i) => i.source === "generation" && i.mediaType === "video");
  }, [activeTab, sourceItems]);

  if (!open) return null;

  // Build tab list based on mediaKind
  const tabs: { id: TabId; label: string }[] =
    mediaKind === "any"
      ? [
          { id: "uploads",   label: "Uploads" },
          { id: "image-gen", label: "Image Generations" },
          { id: "video-gen", label: "Video Generations" },
        ]
      : mediaKind === "image"
      ? [
          { id: "image-gen", label: "Image Generations" },
          { id: "uploads",   label: "Uploads" },
        ]
      : [
          { id: "video-gen", label: "Video Generations" },
          { id: "uploads",   label: "Uploads" },
        ];

  const modal = createPortal(
    <div data-prompt-overlay="" style={{ position: "fixed", inset: 0, zIndex: 100000, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <style>{SHIMMER_CSS}</style>
      <div
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}
      />
      <div style={{
        position: "fixed",
        left: (pos.isAnchored || pos.isCustom) ? pos.left : "50%",
        top: pos.isCustom ? pos.top : (pos.isAnchored ? "auto" : "50%"),
        bottom: pos.isAnchored ? pos.bottom : (pos.isCustom ? "auto" : "auto"),
        transform: (pos.isAnchored || pos.isCustom) ? "none" : "translate(-50%, -50%)",
        width: (pos.isAnchored || pos.isCustom) ? pos.width : "min(660px, calc(100vw - 32px))",
        height: (pos.isAnchored || pos.isCustom) ? `${88 + 0.25 * (pos.width - 64)}px` : "520px",
        background: "rgba(14,16,18,0.92)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: "18px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 32px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.04)",
        pointerEvents: "auto",
        animation: "picker-dropIn 160ms cubic-bezier(0.16,1,0.3,1)",
      }}>
        {/* Tab bar */}
        <div style={{ padding: "14px 18px 12px", display: "flex", alignItems: "center", gap: "4px", flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          {tabs.map((t) => {
            const active = activeTab === t.id;
            return (
              <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                padding: "6px 16px", borderRadius: "100px", border: "none", cursor: "pointer",
                fontSize: "13px", fontWeight: active ? 600 : 400,
                background: active ? "#ffffff" : "transparent",
                color: active ? "#0B0E14" : "rgba(255,255,255,0.5)",
                transition: "background 150ms, color 150ms",
              }}>
                {t.label}
              </button>
            );
          })}
          {maxCount !== undefined && (
            <span style={{
              marginLeft: "8px", fontSize: "11px", fontWeight: 500,
              padding: "3px 8px", borderRadius: "100px",
              background: (selectedUrls?.length ?? 0) >= maxCount ? "rgba(45,212,191,0.15)" : "rgba(255,255,255,0.07)",
              color: (selectedUrls?.length ?? 0) >= maxCount ? "#2DD4BF" : "rgba(255,255,255,0.4)",
              flexShrink: 0,
            }}>
              {selectedUrls?.length ?? 0}/{maxCount}
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              marginLeft: maxCount !== undefined ? "4px" : "auto", width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0,
              background: "rgba(255,255,255,0.07)", border: "none",
              color: "rgba(255,255,255,0.6)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", transition: "background 120ms",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.13)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* URL input bar */}
        <div style={{ padding: "10px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <div style={{ flex: 1, position: "relative" }}>
              <input
                type="url"
                placeholder="Paste an image URL…"
                value={urlInput}
                onChange={e => { setUrlInput(e.target.value); setUrlError(""); }}
                onKeyDown={e => { if (e.key === "Enter") submitUrl(); }}
                style={{
                  width: "100%", boxSizing: "border-box",
                  height: "32px", padding: "0 12px",
                  background: "rgba(255,255,255,0.06)",
                  border: urlError ? "1px solid rgba(248,113,113,0.5)" : "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  color: "rgba(255,255,255,0.85)", fontSize: "12px",
                  outline: "none", transition: "border-color 150ms",
                }}
                onFocus={e => { if (!urlError) e.currentTarget.style.borderColor = "rgba(45,212,191,0.4)"; }}
                onBlur={e => { if (!urlError) e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; }}
              />
            </div>
            <button
              onClick={submitUrl}
              disabled={!urlInput.trim() || urlLoading}
              style={{
                height: "32px", padding: "0 14px", borderRadius: "8px", border: "none",
                background: urlInput.trim() && !urlLoading ? "rgba(45,212,191,0.18)" : "rgba(255,255,255,0.05)",
                color: urlInput.trim() && !urlLoading ? "#2DD4BF" : "rgba(255,255,255,0.25)",
                fontSize: "12px", fontWeight: 500, cursor: urlInput.trim() && !urlLoading ? "pointer" : "default",
                transition: "background 150ms, color 150ms", flexShrink: 0,
                display: "flex", alignItems: "center", gap: "6px",
              }}
            >
              {urlLoading ? (
                <span style={{ width: "12px", height: "12px", borderRadius: "50%", border: "1.5px solid rgba(45,212,191,0.3)", borderTopColor: "#2DD4BF", display: "inline-block", animation: "spin 0.75s linear infinite" }} />
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
              Attach
            </button>
          </div>
          {urlError && (
            <p style={{ margin: "6px 0 0", fontSize: "11px", color: "#f87171" }}>{urlError}</p>
          )}
        </div>

        {/* Scrollable grid */}
        <div ref={scrollContainerRef} className="picker-scroll" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "14px 18px 18px" }}>
          {fetching && displayItems.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px" }}>
              <span style={{ width: "24px", height: "24px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "#2DD4BF", display: "inline-block", animation: "spin 0.75s linear infinite" }} />
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "4px" }}>
              {onUpload && (
                <button
                  onClick={onUpload}
                  style={{
                    aspectRatio: "1", borderRadius: "8px",
                    border: "1.5px dashed rgba(255,255,255,0.16)",
                    background: "rgba(255,255,255,0.025)", cursor: "pointer",
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: "8px",
                    color: "rgba(255,255,255,0.5)",
                    transition: "background 150ms, border-color 150ms, color 150ms",
                    padding: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.055)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
                >
                  <div style={{ width: "30px", height: "30px", borderRadius: "50%", background: "rgba(255,255,255,0.09)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </div>
                  <span style={{ fontSize: "10px", fontWeight: 500 }}>Upload</span>
                </button>
              )}

              {displayItems.map((item) => {
                const isSelected = selectedUrls?.includes(item.url) ?? false;
                const atLimit = maxCount !== undefined && (selectedUrls?.length ?? 0) >= maxCount;
                const isDisabled = !isSelected && atLimit;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (isSelected) { onDeselect?.(item.url); return; }
                      if (!isDisabled) onPickUrl(item.url, item.mediaType);
                    }}
                    style={{
                      position: "relative", aspectRatio: "1", borderRadius: "8px", overflow: "hidden",
                      background: "#1a1c1f",
                      border: isSelected ? "2px solid #2DD4BF" : "2px solid transparent",
                      cursor: isDisabled ? "not-allowed" : "pointer", padding: 0,
                      transition: "border-color 110ms, transform 110ms, opacity 110ms",
                      opacity: isDisabled ? 0.35 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (isDisabled) return;
                      setHoveredItemId(item.id);
                      if (!isSelected) e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)";
                      e.currentTarget.style.transform = "scale(1.04)";
                      const v = e.currentTarget.querySelector("video");
                      if (v) v.play().catch(() => {});
                      const overlay = e.currentTarget.querySelector<HTMLElement>(".picker-play-icon");
                      if (overlay) overlay.style.opacity = "0";
                    }}
                    onMouseLeave={(e) => {
                      setHoveredItemId(null);
                      if (!isSelected) e.currentTarget.style.borderColor = "transparent";
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
                        onLoadedMetadata={(e) => { (e.target as HTMLVideoElement).currentTime = 0.001; }}
                      />
                    ) : (
                      <PickerImage src={item.url} />
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
                    {hoveredItemId === item.id && (
                      <div
                        onClick={(e) => { e.stopPropagation(); setPreviewItem(item); }}
                        style={{ position: "absolute", top: "4px", right: "4px", width: "18px", height: "18px", borderRadius: "4px", background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 2 }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}

              {displayItems.length === 0 && !fetching && (
                <div style={{ gridColumn: "1 / -1", padding: "48px 0", textAlign: "center", color: "rgba(255,255,255,0.22)", fontSize: "13px" }}>
                  Nothing here yet
                </div>
              )}
            </div>
          )}
          {loadingMore && (
            <div style={{ padding: "16px", display: "flex", justifyContent: "center" }}>
              <span style={{ width: "18px", height: "18px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "#2DD4BF", display: "inline-block", animation: "spin 0.75s linear infinite" }} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );

  return (
    <>
      {modal}
      {previewItem && createPortal(
        <div
          onClick={(e) => { e.stopPropagation(); setPreviewItem(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 200000, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {previewItem.mediaType === "video" ? (
            <video
              src={previewItem.url}
              controls
              autoPlay
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: "10px", boxShadow: "0 24px 80px rgba(0,0,0,0.8)" }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewItem.url}
              alt=""
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: "10px", boxShadow: "0 24px 80px rgba(0,0,0,0.8)" }}
            />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setPreviewItem(null); }}
            style={{ position: "absolute", top: "20px", right: "20px", width: "32px", height: "32px", borderRadius: "50%", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.8)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
