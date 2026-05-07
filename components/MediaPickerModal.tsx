"use client";
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { GalleryItem, galleryCache, getToken } from "@/lib/galleryUtils";

type TabId = "uploads" | "image-gen" | "video-gen";

const SHIMMER_CSS = `
@keyframes picker-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
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

export function MediaPickerModal({
  open,
  mediaKind,
  onClose,
  onPickUrl,
  onUpload,
}: {
  open: boolean;
  mediaKind: "image" | "video" | "any";
  onClose: () => void;
  onPickUrl: (url: string, mediaType: "image" | "video") => void;
  onUpload?: () => void;
}) {
  const defaultTab: TabId = mediaKind === "image" ? "image-gen" : mediaKind === "video" ? "video-gen" : "uploads";
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);
  const [sourceItems, setSourceItems] = useState<GalleryItem[]>([]);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setActiveTab(defaultTab);

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
          imgRes.ok ? (imgRes.json() as Promise<{ items: GalleryItem[] }>) : Promise.resolve({ items: [] as GalleryItem[] }),
          vidRes.ok ? (vidRes.json() as Promise<{ items: GalleryItem[] }>) : Promise.resolve({ items: [] as GalleryItem[] }),
        ]);
        setSourceItems(
          [...imgData.items, ...vidData.items].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          ),
        );
      } else {
        const res = await fetch(`/api/gallery?type=${mediaKind}&page=0`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setSourceItems((await res.json() as { items: GalleryItem[] }).items);
      }
      setFetching(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mediaKind]);

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

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <style>{SHIMMER_CSS}</style>
      <div
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        style={{ position: "absolute", inset: 0, pointerEvents: "auto" }}
      />
      <div style={{
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
                color: active ? "#000000" : "rgba(255,255,255,0.5)",
                transition: "background 150ms, color 150ms",
              }}>
                {t.label}
              </button>
            );
          })}
          <button
            onClick={onClose}
            style={{
              marginLeft: "auto", width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0,
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

        {/* Scrollable grid */}
        <div className="picker-scroll" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "14px 18px 18px" }}>
          {fetching && displayItems.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "200px" }}>
              <span style={{ width: "24px", height: "24px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "#ff3df5", display: "inline-block", animation: "spin 0.75s linear infinite" }} />
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "6px" }}>
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

              {displayItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onPickUrl(item.url, item.mediaType)}
                  style={{
                    position: "relative", aspectRatio: "1", borderRadius: "8px", overflow: "hidden",
                    background: "#1a1c1f", border: "2px solid transparent",
                    cursor: "pointer", padding: 0,
                    transition: "border-color 110ms, transform 110ms",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)";
                    e.currentTarget.style.transform = "scale(1.04)";
                    const v = e.currentTarget.querySelector("video");
                    if (v) v.play().catch(() => {});
                    const overlay = e.currentTarget.querySelector<HTMLElement>(".picker-play-icon");
                    if (overlay) overlay.style.opacity = "0";
                  }}
                  onMouseLeave={(e) => {
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
                      onLoadedMetadata={(e) => { (e.target as HTMLVideoElement).currentTime = 0.001; }}
                    />
                  ) : (
                    <PickerImage src={`/_next/image?url=${encodeURIComponent(item.url)}&w=128&q=75`} />
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
}
