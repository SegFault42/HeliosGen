"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FolderInput, Trash2, X, Maximize2, ChevronLeft, ChevronRight } from "lucide-react";
import { useFolderStore } from "@/lib/folderStore";
import { thumbSrc } from "@/lib/galleryUtils";

// ── Types ────────────────────────────────────────────────────────────────────
interface AssetItem {
  id: string;
  url: string;
  imageUrls?: string[];
  mediaType: "image" | "video";
  prompt?: string;
  model?: string;
  aspect_ratio?: string;
  source: "generation" | "upload";
  created_at: string;
}

interface DateGroup {
  key: string;
  label: string;
  items: AssetItem[];
}

// ── Date grouping ────────────────────────────────────────────────────────────
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function groupLabel(iso: string): { key: string; label: string } {
  const d = new Date(iso);
  const day = startOfDay(d);
  const today = startOfDay(new Date());
  const oneDay = 86_400_000;
  if (day === today) return { key: String(day), label: "Today" };
  if (day === today - oneDay) return { key: String(day), label: "Yesterday" };
  return {
    key: String(day),
    label: d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
  };
}

function groupByDate(items: AssetItem[]): DateGroup[] {
  const map = new Map<string, DateGroup>();
  for (const it of items) {
    const { key, label } = groupLabel(it.created_at);
    let g = map.get(key);
    if (!g) {
      g = { key, label, items: [] };
      map.set(key, g);
    }
    g.items.push(it);
  }
  return [...map.values()].sort((a, b) => Number(b.key) - Number(a.key));
}

// ── Aspect-ratio cache (shared across mounts) ────────────────────────────────
const ratioCache = new Map<string, number>();

function parseRatio(ar?: string): number | undefined {
  if (!ar) return undefined;
  const m = ar.match(/^(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)$/);
  if (!m) return undefined;
  const r = Number(m[1]) / Number(m[2]);
  return Number.isFinite(r) && r > 0 ? r : undefined;
}

function clampRatio(r: number): number {
  return Math.min(2.4, Math.max(0.42, r));
}

// ── Tile ─────────────────────────────────────────────────────────────────────
function AssetTile({
  item,
  height,
  selected,
  anySelected,
  onToggleSelect,
  onOpen,
}: {
  item: AssetItem;
  height: number;
  selected: boolean;
  anySelected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const isVideo = item.mediaType === "video";
  const displayUrl = item.imageUrls?.[0] ?? item.url;
  const [ratio, setRatio] = useState<number | undefined>(
    () => ratioCache.get(item.url) ?? parseRatio(item.aspect_ratio),
  );
  const [loaded, setLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const width = Math.round(height * (ratio ?? 1));

  const setNaturalRatio = (w: number, h: number) => {
    if (!w || !h) return;
    const r = clampRatio(w / h);
    ratioCache.set(item.url, r);
    setRatio(r);
  };

  return (
    <button
      type="button"
      className={`asset-tile${selected ? " asset-tile--selected" : ""}${anySelected ? " asset-tile--anyselected" : ""}`}
      style={{ height, width }}
      onClick={() => (anySelected ? onToggleSelect() : onOpen())}
      onMouseEnter={() => { if (isVideo) videoRef.current?.play().catch(() => {}); }}
      onMouseLeave={() => { if (isVideo) { const v = videoRef.current; if (v) { v.pause(); v.currentTime = 0; } } }}
    >
      {!loaded && <div className="asset-shimmer" />}
      {isVideo ? (
        <video
          ref={videoRef}
          // #t=0.1 makes the browser seek to and paint the first frame as a poster
          src={`${item.url}#t=0.1`}
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedData={() => setLoaded(true)}
          onLoadedMetadata={(e) => setNaturalRatio(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
        />
      ) : (
        <img
          src={thumbSrc(displayUrl, Math.max(96, width))}
          alt={item.prompt ?? ""}
          loading="lazy"
          draggable={false}
          onLoad={(e) => { setLoaded(true); setNaturalRatio(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight); }}
          onError={() => setLoaded(true)}
        />
      )}

      {isVideo && (
        <span className="asset-play" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><polygon points="6 4 20 12 6 20 6 4" /></svg>
        </span>
      )}

      <span
        className="asset-check"
        onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
        role="checkbox"
        aria-checked={selected}
      >
        {selected && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0B0E14" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
    </button>
  );
}

// ── Lightbox ─────────────────────────────────────────────────────────────────
function Lightbox({
  item,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: {
  item: AssetItem;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onPrev();
      if (e.key === "ArrowRight" && hasNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  const download = async () => {
    const ext = item.url.split("?")[0].split(".").pop()?.toLowerCase();
    const safeExt = item.mediaType === "video" ? "mp4" : (ext && ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) ? ext : "png");
    const filename = `${item.mediaType}-${item.id.slice(0, 8)}.${safeExt}`;
    try {
      const res = await fetch(`/api/download?url=${encodeURIComponent(item.url)}&filename=${filename}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(item.url, "_blank");
    }
  };

  return createPortal(
    <div className="asset-lightbox" onClick={onClose}>
      <button className="asset-lb-btn asset-lb-close" onClick={onClose} title="Close (Esc)"><X size={18} /></button>
      <button className="asset-lb-btn asset-lb-dl" onClick={(e) => { e.stopPropagation(); download(); }} title="Download"><Download size={18} /></button>

      {hasPrev && (
        <button className="asset-lb-btn asset-lb-nav asset-lb-prev" onClick={(e) => { e.stopPropagation(); onPrev(); }} title="Previous (←)"><ChevronLeft size={22} /></button>
      )}
      {hasNext && (
        <button className="asset-lb-btn asset-lb-nav asset-lb-next" onClick={(e) => { e.stopPropagation(); onNext(); }} title="Next (→)"><ChevronRight size={22} /></button>
      )}

      <div className="asset-lb-stage" onClick={(e) => e.stopPropagation()}>
        {item.mediaType === "video" ? (
          <video key={item.url} src={item.url} controls autoPlay loop playsInline />
        ) : (
          <img key={item.url} src={item.imageUrls?.[0] ?? item.url} alt={item.prompt ?? ""} />
        )}
        {item.prompt && <p className="asset-lb-prompt">{item.prompt}</p>}
      </div>
    </div>,
    document.body,
  );
}

// ── Folder picker popover ────────────────────────────────────────────────────
function FolderPicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const folders = useFolderStore((s) => s.folders);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  const depth = (id: string | null): number => {
    let d = 0;
    let cur = id;
    while (cur) {
      const f = folders.find((x) => x.id === cur);
      if (!f) break;
      cur = f.parentId;
      d++;
    }
    return d;
  };

  const ordered = useMemo(() => {
    const out: typeof folders = [];
    const walk = (parentId: string | null) => {
      folders
        .filter((f) => f.parentId === parentId)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .forEach((f) => { out.push(f); walk(f.id); });
    };
    walk(null);
    return out;
  }, [folders]);

  return (
    <div ref={ref} className="asset-folderpop">
      {ordered.length === 0 ? (
        <p className="asset-folderpop-empty">No folders yet</p>
      ) : (
        ordered.map((f) => (
          <button
            key={f.id}
            className="asset-folderpop-item"
            style={{ paddingLeft: 10 + depth(f.parentId) * 12 }}
            onClick={() => onPick(f.id)}
          >
            <span className="asset-folderpop-dot" style={{ background: f.color ?? "rgba(255,255,255,0.3)" }} />
            <span className="asset-folderpop-name">{f.name}</span>
          </button>
        ))
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
const MIN_H = 96;
const MAX_H = 260;

export default function AssetsPage() {
  const [items, setItems] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [tileH, setTileH] = useState<number>(() => {
    if (typeof window === "undefined") return 150;
    try {
      const raw = localStorage.getItem("hg-assets-tile-h");
      if (raw) return Math.min(MAX_H, Math.max(MIN_H, Number(raw)));
    } catch { /* ignore */ }
    return 150;
  });

  const assignItemsToFolder = useFolderStore((s) => s.assignItemsToFolder);

  const updateTileH = (v: number) => {
    setTileH(v);
    try { localStorage.setItem("hg-assets-tile-h", String(v)); } catch { /* ignore */ }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/assets");
        const data = (await res.json()) as { items: AssetItem[] };
        if (!cancelled) setItems(data.items ?? []);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const groups = useMemo(() => groupByDate(items), [items]);
  const anySelected = selected.size > 0;

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((group: DateGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = group.items.every((it) => next.has(it.id));
      group.items.forEach((it) => (allIn ? next.delete(it.id) : next.add(it.id)));
      return next;
    });
  }, []);

  const clearSelection = () => { setSelected(new Set()); setFolderPickerOpen(false); };

  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);

  const handleDownloadSelected = async () => {
    const targets = [...selectedItems];
    clearSelection();
    for (const item of targets) {
      const ext = item.url.split("?")[0].split(".").pop()?.toLowerCase();
      const safeExt = item.mediaType === "video" ? "mp4" : (ext && ["png", "jpg", "jpeg", "webp", "gif"].includes(ext) ? ext : "png");
      const filename = `${Date.now()}-${item.id.slice(0, 6)}.${safeExt}`;
      try {
        const res = await fetch(`/api/download?url=${encodeURIComponent(item.url)}&filename=${filename}`);
        if (!res.ok) continue;
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      } catch { /* skip */ }
    }
  };

  const handleDeleteSelected = async () => {
    if (!confirm(`Delete ${selected.size} asset${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    const targets = selectedItems.map((i) => ({ id: i.id, source: i.source }));
    const ids = new Set(selectedItems.map((i) => i.id));
    setItems((prev) => prev.filter((i) => !ids.has(i.id)));
    clearSelection();
    try {
      await fetch("/api/assets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: targets }),
      });
    } catch { /* optimistic */ }
  };

  const handleAssignFolder = async (folderId: string) => {
    const ids = selectedItems.map((i) => i.id);
    setFolderPickerOpen(false);
    clearSelection();
    await assignItemsToFolder(ids, folderId);
  };

  // Lightbox navigation over the flat, date-sorted list
  const flatIndex = lightboxId ? items.findIndex((i) => i.id === lightboxId) : -1;
  const lightboxItem = flatIndex >= 0 ? items[flatIndex] : null;

  return (
    <div className="asset-page">
      <style>{CSS}</style>

      <header className="asset-header">
        <h1>All assets</h1>
        <div className="asset-zoom">
          <Maximize2 size={13} />
          <input
            type="range"
            min={MIN_H}
            max={MAX_H}
            step={2}
            value={tileH}
            onChange={(e) => updateTileH(Number(e.target.value))}
            aria-label="Thumbnail size"
          />
        </div>
      </header>

      <div className="asset-scroll">
        {loading ? (
          <p className="asset-empty">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="asset-empty">No assets yet. Generate an image or video to see it here.</p>
        ) : (
          groups.map((group) => {
            const allIn = group.items.every((it) => selected.has(it.id));
            const someIn = !allIn && group.items.some((it) => selected.has(it.id));
            return (
              <section key={group.key} className="asset-group">
                <button
                  className="asset-group-head"
                  onClick={() => toggleGroup(group)}
                >
                  <span className={`asset-group-check${allIn ? " is-all" : ""}${someIn ? " is-some" : ""}`}>
                    {allIn && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0B0E14" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    )}
                    {someIn && <span className="asset-group-dash" />}
                  </span>
                  <span className="asset-group-label">{group.label}</span>
                </button>

                <div className="asset-grid">
                  {group.items.map((item) => (
                    <AssetTile
                      key={item.id}
                      item={item}
                      height={tileH}
                      selected={selected.has(item.id)}
                      anySelected={anySelected}
                      onToggleSelect={() => toggleSelect(item.id)}
                      onOpen={() => setLightboxId(item.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>

      {anySelected && (
        <div className="asset-actionbar">
          <span className="asset-actionbar-count">{selected.size} selected</span>
          <div className="asset-actionbar-sep" />
          <button onClick={handleDownloadSelected}><Download size={15} /> Download</button>
          <div className="asset-actionbar-folderwrap">
            <button onClick={() => setFolderPickerOpen((v) => !v)}><FolderInput size={15} /> Add to folder</button>
            {folderPickerOpen && (
              <FolderPicker onPick={handleAssignFolder} onClose={() => setFolderPickerOpen(false)} />
            )}
          </div>
          <button className="asset-actionbar-danger" onClick={handleDeleteSelected}><Trash2 size={15} /> Delete</button>
          <button className="asset-actionbar-clear" onClick={clearSelection} title="Clear selection"><X size={15} /></button>
        </div>
      )}

      {lightboxItem && (
        <Lightbox
          item={lightboxItem}
          onClose={() => setLightboxId(null)}
          onPrev={() => setLightboxId(items[flatIndex - 1]?.id ?? null)}
          onNext={() => setLightboxId(items[flatIndex + 1]?.id ?? null)}
          hasPrev={flatIndex > 0}
          hasNext={flatIndex < items.length - 1}
        />
      )}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const CSS = `
  .asset-page {
    display: flex; flex-direction: column;
    flex: 1; min-height: 0; min-width: 0;
    background: #0B0E14; color: #fff;
    position: relative;
  }
  .asset-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 28px 14px;
    flex-shrink: 0;
  }
  .asset-header h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; margin: 0; }
  .asset-zoom {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 12px; border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
    color: rgba(255,255,255,0.55);
  }
  .asset-zoom input[type="range"] {
    -webkit-appearance: none; appearance: none;
    width: 96px; height: 3px; border-radius: 3px;
    background: rgba(255,255,255,0.18);
    outline: none; cursor: pointer;
  }
  .asset-zoom input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 13px; height: 13px; border-radius: 50%;
    background: #fff; cursor: pointer;
  }
  .asset-zoom input[type="range"]::-moz-range-thumb {
    width: 13px; height: 13px; border: none; border-radius: 50%;
    background: #fff; cursor: pointer;
  }

  .asset-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 28px 120px; }
  .asset-empty { color: rgba(255,255,255,0.4); font-size: 13px; padding: 40px 0; }

  .asset-group { margin-bottom: 30px; }
  .asset-group-head {
    display: flex; align-items: center; gap: 10px;
    background: none; border: none; padding: 6px 2px; margin-bottom: 10px;
    cursor: pointer; color: #fff;
  }
  .asset-group-check {
    width: 18px; height: 18px; border-radius: 6px; flex-shrink: 0;
    border: 2px solid rgba(255,255,255,0.35);
    display: flex; align-items: center; justify-content: center;
    transition: background 120ms, border-color 120ms;
  }
  .asset-group-head:hover .asset-group-check { border-color: rgba(255,255,255,0.6); }
  .asset-group-check.is-all { background: #fff; border-color: #fff; }
  .asset-group-check.is-some { border-color: #fff; }
  .asset-group-dash { width: 9px; height: 2px; border-radius: 1px; background: #fff; }
  .asset-group-label { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }

  .asset-grid { display: flex; flex-wrap: wrap; gap: 10px; }

  .asset-tile {
    position: relative; padding: 0; border: none; margin: 0;
    border-radius: 16px; overflow: hidden;
    background: #16181f; cursor: pointer;
    flex-shrink: 0; display: block;
    outline: 2px solid transparent; outline-offset: 2px;
    transition: outline-color 120ms;
  }
  .asset-tile img, .asset-tile video {
    width: 100%; height: 100%; object-fit: cover; display: block;
  }
  .asset-tile--selected { outline-color: #2DD4BF; }
  .asset-shimmer {
    position: absolute; inset: 0;
    background: linear-gradient(90deg, #1b1d25 25%, #23252e 50%, #1b1d25 75%);
    background-size: 800px 100%;
    animation: asset-shimmer 1.6s infinite linear;
  }
  @keyframes asset-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }

  .asset-play {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 34px; height: 34px; border-radius: 50%;
    background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    pointer-events: none;
  }
  .asset-play svg { margin-left: 2px; }

  .asset-check {
    position: absolute; top: 8px; left: 8px;
    width: 20px; height: 20px; border-radius: 6px;
    border: 2px solid rgba(255,255,255,0.6);
    background: rgba(0,0,0,0.25);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 140ms;
    z-index: 3;
  }
  .asset-tile:hover .asset-check { opacity: 1; }
  .asset-tile--selected .asset-check { opacity: 1; background: #fff; border-color: #fff; }
  .asset-tile--anyselected .asset-play { opacity: 0; }

  /* Action bar */
  .asset-actionbar {
    position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 6px;
    padding: 8px 10px; border-radius: 14px;
    background: rgba(20,22,28,0.95);
    border: 1px solid rgba(255,255,255,0.1);
    box-shadow: 0 10px 40px rgba(0,0,0,0.6);
    z-index: 40;
  }
  .asset-actionbar-count { font-size: 12px; color: rgba(255,255,255,0.65); padding: 0 8px; white-space: nowrap; }
  .asset-actionbar-sep { width: 1px; height: 20px; background: rgba(255,255,255,0.12); }
  .asset-actionbar button {
    display: flex; align-items: center; gap: 6px;
    padding: 7px 12px; border-radius: 9px;
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,0.8); font-size: 12px; font-weight: 500;
    white-space: nowrap; transition: background 120ms, color 120ms;
  }
  .asset-actionbar button:hover { background: rgba(255,255,255,0.08); color: #fff; }
  .asset-actionbar-danger:hover { background: rgba(248,113,113,0.12) !important; color: #f87171 !important; }
  .asset-actionbar-clear { padding: 7px !important; }
  .asset-actionbar-folderwrap { position: relative; }

  .asset-folderpop {
    position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
    min-width: 180px; max-height: 260px; overflow-y: auto;
    background: #16181f; border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px; padding: 4px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.6);
  }
  .asset-folderpop-empty { font-size: 12px; color: rgba(255,255,255,0.4); padding: 10px; text-align: center; margin: 0; }
  .asset-folderpop-item {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 7px 10px; border-radius: 6px;
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,0.8); font-size: 12px; text-align: left;
  }
  .asset-folderpop-item:hover { background: rgba(255,255,255,0.06); }
  .asset-folderpop-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .asset-folderpop-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Lightbox */
  .asset-lightbox {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.88); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    padding: 48px;
  }
  .asset-lb-stage {
    display: flex; flex-direction: column; align-items: center; gap: 14px;
    max-width: 100%; max-height: 100%;
  }
  .asset-lb-stage img, .asset-lb-stage video {
    max-width: 100%; max-height: calc(100vh - 140px);
    border-radius: 12px; object-fit: contain;
  }
  .asset-lb-prompt {
    max-width: 720px; text-align: center; margin: 0;
    font-size: 12px; line-height: 1.5; color: rgba(255,255,255,0.6);
  }
  .asset-lb-btn {
    position: fixed; display: flex; align-items: center; justify-content: center;
    width: 38px; height: 38px; border-radius: 10px;
    background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
    color: #fff; cursor: pointer; transition: background 120ms;
  }
  .asset-lb-btn:hover { background: rgba(255,255,255,0.18); }
  .asset-lb-close { top: 20px; right: 20px; }
  .asset-lb-dl { top: 20px; right: 66px; }
  .asset-lb-nav { top: 50%; transform: translateY(-50%); width: 42px; height: 42px; }
  .asset-lb-prev { left: 20px; }
  .asset-lb-next { right: 20px; }
`;
