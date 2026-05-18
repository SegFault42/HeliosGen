"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import NextImage from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore, Space } from "@/lib/store";
import { timeAgo } from "@/lib/useSpaceSync";
import { WorkflowHero } from "@/components/WorkflowHero";
import DotCanvasBackground from "@/components/ui/DotCanvasBackground";

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
  .wsd-card {
    position: relative;
    background: #0C0F16;
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 18px;
    overflow: hidden;
    cursor: pointer;
    transition: transform 240ms cubic-bezier(.22,1,.36,1),
                box-shadow  240ms cubic-bezier(.22,1,.36,1),
                border-color 240ms ease;
  }
  .wsd-card:hover {
    transform: translateY(-4px);
    border-color: rgba(255,255,255,0.13);
    box-shadow:
      0 0 0 1px rgba(45,212,191,0.12),
      0 16px 48px rgba(0,0,0,0.7),
      0 4px 12px rgba(0,0,0,0.4);
  }
  .wsd-card:hover .wsd-actions { opacity: 1; transform: translateY(0); }
  .wsd-card:hover .wsd-thumb-overlay { opacity: 1; }

  .wsd-actions {
    position: absolute; top: 12px; right: 12px;
    display: inline-flex; gap: 4px;
    opacity: 0; transform: translateY(-6px);
    transition: opacity 180ms ease, transform 180ms ease;
    z-index: 3;
  }
  .wsd-act {
    width: 30px; height: 30px; border-radius: 8px;
    display: grid; place-items: center;
    background: rgba(10,12,18,0.82);
    color: rgba(255,255,255,0.7);
    border: 1px solid rgba(255,255,255,0.1);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    cursor: pointer;
    transition: all 130ms ease;
  }
  .wsd-act:hover { color: white; border-color: rgba(255,255,255,0.22); background: rgba(30,34,44,0.95); }

  .wsd-thumbs {
    position: relative;
    aspect-ratio: 3/2;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 1px;
    background: #060709;
  }
  .wsd-thumb-cell {
    position: relative; overflow: hidden;
  }
  .wsd-thumb-cell-empty {
    background: linear-gradient(145deg, #111520 0%, #0a0d14 100%);
    display: grid; place-items: center;
  }
  .wsd-thumb-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(180deg,
      rgba(0,0,0,0) 40%,
      rgba(0,0,0,0.55) 100%);
    opacity: 0; transition: opacity 240ms ease;
    pointer-events: none; z-index: 1;
  }

  .wsd-foot {
    padding: 14px 16px 16px;
    display: flex; flex-direction: column; gap: 10px;
    border-top: 1px solid rgba(255,255,255,0.05);
    background: linear-gradient(180deg, rgba(12,14,20,0.5) 0%, rgba(8,10,16,0.9) 100%);
  }
  .wsd-foot-row {
    display: flex; align-items: center; gap: 8px;
  }

  .wsd-new {
    position: relative;
    background: #0C0F16;
    border: 1px dashed rgba(255,255,255,0.12);
    border-radius: 18px;
    overflow: hidden;
    cursor: pointer;
    display: flex; flex-direction: column;
    transition: transform 240ms cubic-bezier(.22,1,.36,1),
                box-shadow  240ms cubic-bezier(.22,1,.36,1),
                border-color 240ms ease,
                background 240ms ease;
  }
  .wsd-new:hover {
    border-color: rgba(45,212,191,0.35);
    background: #0e1219;
    box-shadow:
      0 0 0 1px rgba(45,212,191,0.12),
      0 16px 48px rgba(0,0,0,0.6);
    transform: translateY(-4px);
  }
  .wsd-new:hover .wsd-plus-orb {
    box-shadow: 0 0 32px rgba(45,212,191,0.4), 0 0 0 1px rgba(255,255,255,0.15) inset;
  }
  .wsd-new-art {
    flex: 1; aspect-ratio: 3/2;
    display: grid; place-items: center;
    position: relative; overflow: hidden;
  }
  .wsd-new-art::before {
    content:""; position:absolute; inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
    background-size: 20px 20px;
    mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 0%, transparent 100%);
    -webkit-mask-image: radial-gradient(ellipse 70% 70% at 50% 50%, black 0%, transparent 100%);
  }
  .wsd-plus-orb {
    position: relative; z-index: 1;
    width: 64px; height: 64px; border-radius: 50%;
    background: linear-gradient(135deg, #0D9488 0%, #2DD4BF 100%);
    display: grid; place-items: center;
    color: white;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.15) inset;
    transition: box-shadow 240ms ease;
  }

  .wsd-new-btn {
    appearance: none; border: 0; cursor: pointer;
    display: inline-flex; align-items: center; gap: 8px;
    padding: 9px 16px;
    background: linear-gradient(135deg, #0D9488 0%, #2DD4BF 100%);
    color: white; font-size: 12px; font-weight: 600; border-radius: 10px;
    transition: filter 140ms ease, transform 140ms ease;
    white-space: nowrap; font-family: inherit;
    letter-spacing: 0.01em;
  }
  .wsd-new-btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
`;

// ── Media collection ──────────────────────────────────────────────────────────

type MediaItem = { type: "image"; url: string } | { type: "video"; url: string };

function collectMedia(space: Space): MediaItem[] {
  const items: MediaItem[] = [];
  for (const node of space.nodes) {
    const { r2Url, imageUrl, videoUrl } = node.data;
    if (typeof videoUrl === "string" && videoUrl) {
      items.push({ type: "video", url: videoUrl });
    } else if (typeof r2Url === "string" && r2Url) {
      items.push({ type: "image", url: r2Url });
    } else if (typeof imageUrl === "string" && imageUrl) {
      items.push({ type: "image", url: imageUrl });
    }
  }
  return items;
}

// ── 4-cell thumbnail mosaic ───────────────────────────────────────────────────

function ThumbnailMosaic({ space }: { space: Space }) {
  const media = collectMedia(space).slice(0, 4);
  return (
    <div className="wsd-thumbs">
      {Array.from({ length: 4 }).map((_, i) => {
        const item = media[i];
        return (
          <div key={i} className={`wsd-thumb-cell${item ? "" : " wsd-thumb-cell-empty"}`}>
            {item ? (
              item.type === "video" ? (
                <video
                  src={item.url}
                  muted loop playsInline autoPlay preload="metadata"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <NextImage src={item.url} alt="" fill sizes="160px" style={{ objectFit: "cover" }} />
              )
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
                style={{ opacity: 0.12 }}>
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="M3 16l5-5 4 4 3-3 6 5" />
              </svg>
            )}
          </div>
        );
      })}
      <div className="wsd-thumb-overlay" />
    </div>
  );
}

// ── Card menu ─────────────────────────────────────────────────────────────────

interface CardMenuProps {
  spaceId: string;
  spaceName: string;
  onOpen: () => void;
  onStartRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function CardMenu({ spaceId, onOpen, onStartRename, onDelete, onClose }: CardMenuProps) {
  const duplicateSpace = useWorkflowStore((s) => s.duplicateSpace);
  const spaces = useWorkflowStore((s) => s.spaces);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const item = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    danger = false,
    disabled = false
  ) => (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) action(); }}
      disabled={disabled}
      style={{
        display: "flex", alignItems: "center", gap: "10px", width: "100%",
        padding: "8px 12px", background: "transparent", border: "none",
        color: disabled ? "rgba(255,255,255,0.2)" : danger ? "#f87171" : "rgba(255,255,255,0.85)",
        fontSize: "13px", fontWeight: 450, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1, fontFamily: "inherit", textAlign: "left",
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <span style={{ color: disabled ? "rgba(255,255,255,0.2)" : danger ? "#f87171" : "rgba(255,255,255,0.4)", flexShrink: 0 }}>
        {icon}
      </span>
      {label}
    </button>
  );

  return (
    <div
      ref={menuRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        right: 0,
        width: "186px",
        background: "#131720",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "12px",
        boxShadow: "0 16px 48px rgba(0,0,0,0.8), 0 2px 8px rgba(0,0,0,0.4)",
        overflow: "hidden",
        zIndex: 100,
      }}
    >
      {item("Open", <OpenIcon />, () => { onClose(); onOpen(); })}
      <div style={{ height: "1px", background: "rgba(255,255,255,0.07)", margin: "0 10px" }} />
      {item("Rename", <RenameIcon />, () => { onClose(); onStartRename(); })}
      {item("Duplicate", <DuplicateIcon />, () => { duplicateSpace(spaceId); onClose(); })}
      <div style={{ height: "1px", background: "rgba(255,255,255,0.07)", margin: "0 10px" }} />
      {item("Delete", <DeleteIcon />, () => { onClose(); onDelete(); }, true, spaces.length <= 1)}
    </div>
  );
}

// ── Delete confirmation modal ─────────────────────────────────────────────────

function DeleteConfirmModal({
  spaceName,
  onConfirm,
  onCancel,
}: {
  spaceName: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel, onConfirm]);

  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1000, backdropFilter: "blur(8px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#131720",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "16px", padding: "24px", width: "320px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
        }}
      >
        <p style={{ fontSize: "15px", fontWeight: 600, color: "#fff", margin: "0 0 8px" }}>
          Delete workflow?
        </p>
        <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.45)", margin: "0 0 24px", lineHeight: 1.5 }}>
          &ldquo;{spaceName}&rdquo; will be permanently deleted. This cannot be undone.
        </p>
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "8px 16px", borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
              color: "rgba(255,255,255,0.6)", fontSize: "13px", fontWeight: 500,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "8px 16px", borderRadius: "8px", border: "none",
              background: "#ef4444", color: "#fff", fontSize: "13px", fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Space card ────────────────────────────────────────────────────────────────


function SpaceCard({ space, onOpen }: { space: Space; onOpen: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(space.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const renameSpace = useWorkflowStore((s) => s.renameSpace);
  const deleteSpace = useWorkflowStore((s) => s.deleteSpace);

  const ts = space.updatedAt ?? space.createdAt;

  const startRename = () => {
    setDraft(space.name);
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = () => {
    if (draft.trim()) renameSpace(space.id, draft.trim());
    else setDraft(space.name);
    setRenaming(false);
  };

  return (
    <article
      className="wsd-card"
      onClick={() => { if (!renaming && !menuOpen) onOpen(); }}
    >
      {/* Hover action buttons */}
      <div className="wsd-actions" onClick={(e) => e.stopPropagation()}>
        <div style={{ position: "relative" }}>
          <button
            className="wsd-act"
            aria-label="More"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
          >
            <MoreHorizIcon />
          </button>
          {menuOpen && (
            <CardMenu
              spaceId={space.id}
              spaceName={space.name}
              onOpen={onOpen}
              onStartRename={startRename}
              onDelete={() => setConfirmDelete(true)}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>

      {/* Thumbnails */}
      <ThumbnailMosaic space={space} />

      {/* Footer */}
      <div className="wsd-foot">
        {/* Title row */}
        <div className="wsd-foot-row">
          {renaming ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") { setDraft(space.name); setRenaming(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              style={{
                flex: 1, background: "transparent", border: "none",
                color: "#fff", fontSize: "15px", fontWeight: 600,
                outline: "none", padding: 0, fontFamily: "inherit",
                letterSpacing: "-0.015em",
              }}
            />
          ) : (
            <div style={{
              flex: 1, minWidth: 0,
              fontSize: "15px", fontWeight: 600, color: "#fff",
              letterSpacing: "-0.015em",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {space.name}
            </div>
          )}
        </div>

        {/* Meta row: timestamp */}
        <div className="wsd-foot-row">
          <span style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: "10px", fontWeight: 500,
            color: "rgba(255,255,255,0.28)",
            letterSpacing: "0.05em", textTransform: "uppercase",
          }}>
            {timeAgo(new Date(ts))}
          </span>
        </div>
      </div>

      {confirmDelete && (
        <DeleteConfirmModal
          spaceName={space.name}
          onConfirm={() => { deleteSpace(space.id); setConfirmDelete(false); }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </article>
  );
}

// ── Create card ───────────────────────────────────────────────────────────────

function CreateCard({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="wsd-new"
      role="button"
      tabIndex={0}
      onClick={onCreate}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onCreate(); }}
    >
      <div className="wsd-new-art">
        <div className="wsd-plus-orb">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round"
            style={{ width: 26, height: 26, strokeWidth: 2 }}>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
      </div>
      <div style={{
        padding: "14px 16px 16px",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        display: "flex", flexDirection: "column", gap: "10px",
      }}>
        <div style={{ fontSize: "15px", fontWeight: 600, color: "#fff", letterSpacing: "-0.015em" }}>
          New workflow
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: "6px",
          fontSize: "10px", fontWeight: 500, letterSpacing: "0.04em",
          color: "rgba(255,255,255,0.25)", textTransform: "uppercase",
        }}>
          <span>Start from scratch</span>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function WorkflowDashboard() {
  const router = useRouter();
  const spaces = useWorkflowStore((s) => s.spaces);
  const createSpace = useWorkflowStore((s) => s.createSpace);
  const switchSpace = useWorkflowStore((s) => s.switchSpace);
  const setAuthModalOpen = useWorkflowStore((s) => s.setAuthModalOpen);
  const [user, setUser] = useState<boolean | null>(null);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_GUEST_MODE === "true") { setUser(true); return; }
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setUser(!!data.session?.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(!!session?.user);
    });
    return () => subscription.unsubscribe();
  }, []);

  const openSpace = (id: string) => {
    switchSpace(id);
    router.push(`/workflow/${id}`);
  };

  const handleCreate = () => {
    createSpace(`Space ${spaces.length + 1}`);
    const newId = useWorkflowStore.getState().activeSpaceId;
    router.push(`/workflow/${newId}`);
  };

  const sorted = user
    ? [...spaces]
        .filter((sp) => sp.nodes.length > 0)
        .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
    : [];

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        position: "relative",
        background: "#0B0E14",
      }}
    >
      <DotCanvasBackground />
      <style>{CSS}</style>

      <div style={{ paddingBottom: "80px" }}>

        <WorkflowHero />

        {/* ── Page header ── */}
        <section style={{
          padding: "28px 32px 20px",
          display: "flex", alignItems: "center", gap: "24px",
          flexWrap: "wrap", rowGap: "16px",
        }}>
          <div>
            <h1 style={{
              margin: 0,
              fontSize: "28px", fontWeight: 600, lineHeight: 1.1, letterSpacing: "-0.02em",
              color: "#ffffff",
            }}>
              My Workflows
            </h1>
            <div style={{
              marginTop: "10px",
              display: "inline-flex", alignItems: "center", gap: "8px",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: "11px", fontWeight: 500, color: "rgba(255,255,255,0.4)",
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              {user ? (
                <>
                  <b style={{ color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>{sorted.length}</b>
                  <span>workspace{sorted.length !== 1 ? "s" : ""}</span>
                </>
              ) : (
                <span style={{ color: "rgba(255,255,255,0.35)" }}>Sign in to save and sync your workflows</span>
              )}
            </div>
          </div>

          <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center" }}>
            {user ? (
              <button className="wsd-new-btn" onClick={handleCreate}>
                <PlusIcon />
                New workflow
              </button>
            ) : (
              <button className="wsd-new-btn" onClick={() => setAuthModalOpen(true)}>
                Sign in
              </button>
            )}
          </div>
        </section>

        {/* ── Grid ── */}
        <section style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "18px",
          padding: "0 32px",
        }}>
          <CreateCard onCreate={handleCreate} />
          {sorted.map((sp) => (
            <SpaceCard key={sp.id} space={sp} onOpen={() => openSpace(sp.id)} />
          ))}
        </section>

      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function MoreHorizIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function DuplicateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
