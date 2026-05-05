"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import NextImage from "next/image";
import { useWorkflowStore, Space } from "@/lib/store";
import { timeAgo } from "@/lib/useSpaceSync";

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

// ── Single media cell ─────────────────────────────────────────────────────────

function MediaCell({ item, sizes }: { item: MediaItem; sizes: string }) {
  if (item.type === "video") {
    return (
      <video
        src={item.url}
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    );
  }
  return (
    <NextImage
      src={item.url}
      alt=""
      fill
      sizes={sizes}
      style={{ objectFit: "cover" }}
    />
  );
}

// ── Mosaic preview ────────────────────────────────────────────────────────────

function SpacePreview({ space }: { space: Space }) {
  const media = collectMedia(space).slice(0, 4);

  if (media.length === 0) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ background: "#0A0C0E" }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <path d="M6.5 10v4M10 6.5h4M17.5 14v-3.5H10" />
        </svg>
      </div>
    );
  }

  if (media.length === 1) {
    return (
      <div className="absolute inset-0 overflow-hidden">
        <MediaCell item={media[0]} sizes="(max-width: 768px) calc(100vw - 80px), 440px" />
      </div>
    );
  }

  if (media.length === 2) {
    return (
      <div className="absolute inset-0 overflow-hidden flex">
        <div style={{ flex: 1, borderRight: "1px solid rgba(0,0,0,0.5)", overflow: "hidden", position: "relative" }}>
          <MediaCell item={media[0]} sizes="(max-width: 768px) calc(50vw - 40px), 220px" />
        </div>
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          <MediaCell item={media[1]} sizes="(max-width: 768px) calc(50vw - 40px), 220px" />
        </div>
      </div>
    );
  }

  if (media.length === 3) {
    return (
      <div className="absolute inset-0 overflow-hidden flex">
        <div style={{ flex: "0 0 50%", borderRight: "1px solid rgba(0,0,0,0.5)", overflow: "hidden", position: "relative" }}>
          <MediaCell item={media[0]} sizes="(max-width: 768px) calc(50vw - 40px), 220px" />
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ flex: 1, borderBottom: "1px solid rgba(0,0,0,0.5)", overflow: "hidden", position: "relative" }}>
            <MediaCell item={media[1]} sizes="(max-width: 768px) calc(25vw - 20px), 110px" />
          </div>
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            <MediaCell item={media[2]} sizes="(max-width: 768px) calc(25vw - 20px), 110px" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: "1px",
        background: "rgba(0,0,0,0.5)",
      }}
    >
      {media.map((item, i) => (
        <div key={i} style={{ overflow: "hidden", position: "relative" }}>
          <MediaCell item={item} sizes="(max-width: 768px) calc(25vw - 20px), 160px" />
        </div>
      ))}
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
      className="flex items-center gap-3 w-full px-4 py-3 text-left transition-colors"
      style={{
        color: disabled ? "rgba(255,255,255,0.2)" : danger ? "#ff6b6b" : "#e8e8e6",
        fontSize: "15px",
        fontWeight: 450,
        background: "transparent",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <span style={{ color: disabled ? "rgba(255,255,255,0.2)" : danger ? "#ff6b6b" : "rgba(255,255,255,0.45)", flexShrink: 0 }}>
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
        bottom: "calc(100% + 6px)",
        right: 0,
        width: "200px",
        background: "#1A1D20",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        boxShadow: "0 16px 48px rgba(0,0,0,0.8), 0 2px 8px rgba(0,0,0,0.4)",
        overflow: "hidden",
        zIndex: 100,
      }}
    >
      {item("Open", <OpenIcon />, () => { onClose(); onOpen(); })}
      <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "0 12px" }} />
      {item("Rename", <RenameIcon />, () => { onClose(); onStartRename(); })}
      {item("Duplicate", <DuplicateIcon />, () => { duplicateSpace(spaceId); onClose(); })}
      <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "0 12px" }} />
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
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#141618",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "16px",
          padding: "24px",
          width: "320px",
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
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: "rgba(255,255,255,0.6)",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: "#ef4444",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
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
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(space.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const renameSpace = useWorkflowStore((s) => s.renameSpace);
  const deleteSpace = useWorkflowStore((s) => s.deleteSpace);

  const ts = space.updatedAt ?? space.createdAt;
  const generatorCount = space.nodes.filter(
    (n) => n.type === "generateNode" || n.type === "videoGeneratorNode"
  ).length;

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
    <div
      onClick={() => { if (!renaming && !menuOpen) onOpen(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "#0D1012",
        border: `1px solid ${hovered ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)"}`,
        borderRadius: "12px",
        overflow: "visible",
        boxShadow: hovered ? "0 8px 32px rgba(0,0,0,0.5)" : "none",
        transform: hovered ? "translateY(-1px)" : "none",
        transition: "all 150ms ease",
        cursor: renaming ? "default" : "pointer",
        position: "relative",
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16/9",
          background: "#0A0C0E",
          borderRadius: "11px 11px 0 0",
          overflow: "hidden",
        }}
      >
        <SpacePreview space={space} />
      </div>

      {/* Info row */}
      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          alignItems: "flex-start",
          gap: "8px",
          overflow: "visible",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
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
                width: "100%",
                background: "transparent",
                border: "none",
                color: "#fff",
                fontSize: "13px",
                fontWeight: 500,
                outline: "none",
                padding: "0 0 1px",
                fontFamily: "inherit",
              }}
            />
          ) : (
            <p style={{ fontSize: "13px", color: "#fff", fontWeight: 500, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {space.name}
            </p>
          )}
          <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", margin: "3px 0 0" }}>
            {timeAgo(new Date(ts))}
            {generatorCount > 0 && (
              <span style={{ marginLeft: "8px", color: "rgba(255,255,255,0.18)" }}>
                {generatorCount} generator{generatorCount > 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>

        {/* Three-dot button + menu */}
        <div
          style={{ position: "relative", flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "8px",
              background: menuOpen ? "rgba(255,255,255,0.1)" : "transparent",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: menuOpen ? "#fff" : "rgba(255,255,255,0.4)",
              transition: "background 120ms, color 120ms",
              opacity: hovered || menuOpen ? 1 : 0,
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = menuOpen ? "rgba(255,255,255,0.1)" : "transparent";
              (e.currentTarget as HTMLElement).style.color = menuOpen ? "#fff" : "rgba(255,255,255,0.4)";
            }}
          >
            <DotsIcon />
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

      {confirmDelete && (
        <DeleteConfirmModal
          spaceName={space.name}
          onConfirm={() => { deleteSpace(space.id); setConfirmDelete(false); }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

// ── Create new card ───────────────────────────────────────────────────────────

function CreateCard({ onCreate }: { onCreate: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onCreate}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "#0D1012" : "#090B0D",
        border: `1px dashed ${hovered ? "rgba(255,61,245,0.4)" : "rgba(255,255,255,0.08)"}`,
        borderRadius: "12px",
        overflow: "hidden",
        transform: hovered ? "translateY(-1px)" : "none",
        transition: "all 150ms ease",
        cursor: "pointer",
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16/9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "50%",
            background: hovered ? "rgba(255,61,245,0.12)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${hovered ? "rgba(255,61,245,0.3)" : "rgba(255,255,255,0.07)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 150ms ease",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={hovered ? "#ff3df5" : "rgba(255,255,255,0.3)"} strokeWidth="1.5" strokeLinecap="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </div>
      </div>

      {/* Label */}
      <div style={{ padding: "10px 12px" }}>
        <p style={{ fontSize: "13px", fontWeight: 500, margin: 0, color: hovered ? "#fff" : "rgba(255,255,255,0.45)" }}>
          New workflow
        </p>
        <p style={{ fontSize: "11px", margin: "3px 0 0", color: "rgba(255,255,255,0.2)" }}>
          Start from scratch
        </p>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function WorkflowDashboard() {
  const spaces = useWorkflowStore((s) => s.spaces);
  const createSpace = useWorkflowStore((s) => s.createSpace);
  const switchSpace = useWorkflowStore((s) => s.switchSpace);
  const setShowDashboard = useWorkflowStore((s) => s.setShowDashboard);

  const openSpace = (id: string) => {
    switchSpace(id);
    setShowDashboard(false);
  };

  const handleCreate = () => {
    createSpace(`Space ${spaces.length + 1}`);
    setShowDashboard(false);
  };

  const sorted = [...spaces].sort(
    (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)
  );

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "#1A1A1C" }}>
      <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "48px 40px" }}>
        <div style={{ marginBottom: "40px" }}>
          <h1 style={{ fontSize: "22px", fontWeight: 600, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>
            My Workflows
          </h1>
          <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)", margin: "6px 0 0" }}>
            {spaces.length} workspace{spaces.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "20px",
          }}
        >
          <CreateCard onCreate={handleCreate} />
          {sorted.map((sp) => (
            <SpaceCard key={sp.id} space={sp} onOpen={() => openSpace(sp.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function DotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function DuplicateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
