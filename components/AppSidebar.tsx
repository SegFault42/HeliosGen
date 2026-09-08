"use client";
import { BrandMark, BRAND_NAME } from "@/components/BrandLogo";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useWorkflowStore } from "@/lib/store";
import { useChatSessionStore } from "@/lib/chatSessionStore";
import { useFolderStore } from "@/lib/folderStore";
import {
  Workflow,
  Image as ImageIcon,
  Video as VideoIcon,
  Package,
  MessageSquare,
  Settings,
  MoreHorizontal,
  Bot,
  Pencil,
  Trash2,
  Star,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  ChevronRight,
  ChevronDown,
  Plus,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";

// ── Deterministic pixel-art avatar ───────────────────────────────────────────
function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function PixelAvatar({ seed, size = 36 }: { seed: string; size?: number }) {
  const rand = lcg(fnv1a(seed || "guest"));
  const hue1 = Math.floor(rand() * 360);
  const hue2 = (hue1 + 100 + Math.floor(rand() * 120)) % 360;

  const palette = [
    `hsl(${hue1}, 22%, 10%)`,  // 0 = bg
    `hsl(${hue1}, 68%, 58%)`,  // 1 = primary
    `hsl(${hue2}, 62%, 48%)`,  // 2 = secondary
    `hsl(${hue1}, 18%, 5%)`,   // 3 = dark
  ];

  const ROWS = 8, COLS = 8, HALF = 4;
  const cells: number[][] = Array.from({ length: ROWS }, () => {
    const row = new Array(COLS).fill(0);
    for (let c = 0; c < HALF; c++) {
      const v = Math.floor(rand() * 4);
      row[c] = v;
      row[COLS - 1 - c] = v;
    }
    return row;
  });

  const px = size / COLS;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block", imageRendering: "pixelated" }}>
      <rect width={size} height={size} fill={palette[0]} />
      {cells.flatMap((row, r) =>
        row.map((v, c) =>
          v === 0 ? null : (
            <rect key={`${r}-${c}`} x={c * px} y={r * px} width={px} height={px} fill={palette[v]} />
          )
        )
      )}
    </svg>
  );
}

// ── GitHub buttons ────────────────────────────────────────────────────────────
function GitHubIcon() {
  return (
    <svg viewBox="0 0 438.549 438.549" className="size-4 shrink-0">
      <path fill="currentColor" d="M409.132 114.573c-19.608-33.596-46.205-60.194-79.798-79.8-33.598-19.607-70.277-29.408-110.063-29.408-39.781 0-76.472 9.804-110.063 29.408-33.596 19.605-60.192 46.204-79.8 79.8C9.803 148.168 0 184.854 0 224.63c0 47.78 13.94 90.745 41.827 128.906 27.884 38.164 63.906 64.572 108.063 79.227 5.14.954 8.945.283 11.419-1.996 2.475-2.282 3.711-5.14 3.711-8.562 0-.571-.049-5.708-.144-15.417a2549.81 2549.81 0 01-.144-25.406l-6.567 1.136c-4.187.767-9.469 1.092-15.846 1-6.374-.089-12.991-.757-19.842-1.999-6.854-1.231-13.229-4.086-19.13-8.559-5.898-4.473-10.085-10.328-12.56-17.556l-2.855-6.57c-1.903-4.374-4.899-9.233-8.992-14.559-4.093-5.331-8.232-8.945-12.419-10.848l-1.999-1.431c-1.332-.951-2.568-2.098-3.711-3.429-1.142-1.331-1.997-2.663-2.568-3.997-.572-1.335-.098-2.43 1.427-3.289 1.525-.859 4.281-1.276 8.28-1.276l5.708.853c3.807.763 8.516 3.042 14.133 6.851 5.614 3.806 10.229 8.754 13.846 14.842 4.38 7.806 9.657 13.754 15.846 17.847 6.184 4.093 12.419 6.136 18.699 6.136 6.28 0 11.704-.476 16.274-1.423 4.565-.952 8.848-2.383 12.847-4.285 1.713-12.758 6.377-22.559 13.988-29.41-10.848-1.14-20.601-2.857-29.264-5.14-8.658-2.286-17.605-5.996-26.835-11.14-9.235-5.137-16.896-11.516-22.985-19.126-6.09-7.614-11.088-17.61-14.987-29.979-3.901-12.374-5.852-26.648-5.852-42.826 0-23.035 7.52-42.637 22.557-58.817-7.044-17.318-6.379-36.732 1.997-58.24 5.52-1.715 13.706-.428 24.554 3.853 10.85 4.283 18.794 7.952 23.84 10.994 5.046 3.041 9.089 5.618 12.135 7.708 17.705-4.947 35.976-7.421 54.818-7.421s37.117 2.474 54.823 7.421l10.849-6.849c7.419-4.57 16.18-8.758 26.262-12.565 10.088-3.805 17.802-4.853 23.134-3.138 8.562 21.509 9.325 40.922 2.279 58.24 15.036 16.18 22.559 35.787 22.559 58.817 0 16.178-1.958 30.497-5.853 42.966-3.9 12.471-8.941 22.457-15.125 29.979-6.191 7.521-13.901 13.85-23.131 18.986-9.232 5.14-18.182 8.85-26.84 11.136-8.662 2.286-18.415 4.004-29.263 5.146 9.894 8.562 14.842 22.077 14.842 40.539v60.237c0 3.422 1.19 6.279 3.572 8.562 2.379 2.279 6.136 2.95 11.276 1.995 44.163-14.653 80.185-41.062 108.068-79.226 27.88-38.161 41.825-81.126 41.825-128.906-.01-39.771-9.818-76.454-29.414-110.049z" />
    </svg>
  );
}

function ForkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle cx="18" cy="6" r="3" />
      <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" /><line x1="12" y1="12" x2="12" y2="15" />
    </svg>
  );
}

function fmtCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function GitHubButtons() {
  const [stats, setStats] = React.useState<{ stars: number; forks: number } | null>(null);

  React.useEffect(() => {
    fetch("https://api.github.com/repos/segfault42/HeliosGen")
      .then(r => r.json())
      .then(d => setStats({ stars: d.stargazers_count, forks: d.forks_count }))
      .catch(() => {});
  }, []);

  const btnCls = "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 h-8 text-sm font-medium whitespace-nowrap transition-colors hover:bg-bg-2 hover:text-text-1 text-text-3";

  return (
    <div className="group-data-[collapsible=icon]:hidden flex gap-1 justify-center px-2 pb-3">
      <a href="https://github.com/segfault42/HeliosGen" target="_blank" rel="noreferrer" className={btnCls}>
        <Star size={14} strokeWidth={1.8} />
        {stats && <span className="label tabular text-text-3">{fmtCount(stats.stars)}</span>}
      </a>
      <a href="https://github.com/segfault42/HeliosGen/fork" target="_blank" rel="noreferrer" className={btnCls}>
        <ForkIcon />
        {stats && <span className="label tabular text-text-3">{fmtCount(stats.forks)}</span>}
      </a>
    </div>
  );
}

// ── Module-level drag tracker (avoids stale closures across re-renders) ──────
let _dragFolderId: string | null = null;

const FOLDER_COLORS: { color: string | null; label: string }[] = [
  { color: null, label: "Default" },
  { color: "hsl(217, 91%, 60%)", label: "Blue" },
  { color: "hsl(174, 70%, 51%)", label: "Cyan" },
  { color: "hsl(271, 81%, 66%)", label: "Purple" },
  { color: "hsl(330, 81%, 60%)", label: "Pink" },
  { color: "hsl(0, 84%, 60%)", label: "Red" },
  { color: "hsl(21, 90%, 55%)", label: "Orange" },
  { color: "hsl(45, 85%, 51%)", label: "Yellow" },
  { color: "hsl(142, 71%, 45%)", label: "Green" },
];

// ── Clean failed pending generations from localStorage + notify gallery page ──
function cleanFailedJobs(folderId: string | null) {
  try {
    const stored = localStorage.getItem("aiui-pending-gens");
    if (stored) {
      const parsed = JSON.parse(stored) as Array<{ error?: string; folderId?: string | null }>;
      const cleaned = parsed.filter(pg => {
        if (!pg.error) return true;
        if (folderId === null) return false;
        return pg.folderId !== folderId;
      });
      localStorage.setItem("aiui-pending-gens", JSON.stringify(cleaned));
    }
  } catch {}
  window.dispatchEvent(new CustomEvent("clean-failed-jobs", { detail: { folderId } }));
}

// ── FolderRow — defined at module level so React never remounts it on parent re-renders ──
interface FolderRowProps {
  folder: import("@/lib/folderStore").Folder;
  allFolders: import("@/lib/folderStore").Folder[];
  depth: number;
  expandedIds: Set<string>;
  selectedFolderId: string | null;
  onToggleExpand: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onColorChange: (id: string, color: string | null) => void;
  onMove: (id: string, newParentId: string | null, newOrderIndex: number) => void;
  creatingInFolderId: string | null;
  newFolderName: string;
  onNameChange: (v: string) => void;
  onNameKeyDown: (e: React.KeyboardEvent) => void;
  onNameBlur: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  getCount: (id: string) => number;
  generatingFolderIds: string[];
  unseenFolderIds: string[];
}

const FolderRow = React.memo(function FolderRow({
  folder, allFolders, depth, expandedIds, selectedFolderId,
  onToggleExpand, onSelect, onDelete, onRename, onColorChange, onMove,
  creatingInFolderId, newFolderName, onNameChange, onNameKeyDown, onNameBlur, inputRef,
  getCount, generatingFolderIds, unseenFolderIds,
}: FolderRowProps) {
  const [drop, setDrop] = React.useState<"before" | "after" | "inside" | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuPos, setMenuPos] = React.useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState("");
  const menuRef = React.useRef<HTMLDivElement>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const renameInputRef = React.useRef<HTMLInputElement>(null);

  // Focus rename input once it mounts
  React.useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus();
  }, [isRenaming]);

  // Close menu on click outside
  React.useEffect(() => {
    if (!menuOpen) return;
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    const rect = btnRef.current!.getBoundingClientRect();
    setMenuPos({ x: rect.right, y: rect.bottom + 4 });
    setMenuOpen(true);
  }

  function startRename() {
    setMenuOpen(false);
    setRenameValue(folder.name);
    setIsRenaming(true);
  }

  function confirmRename() {
    const name = renameValue.trim();
    if (name && name !== folder.name) onRename(folder.id, name);
    setIsRenaming(false);
  }

  const children = allFolders
    .filter(f => f.parentId === folder.id)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const hasChildren = children.length > 0;
  const isCreatingHere = creatingInFolderId === folder.id;
  const isExpanded = expandedIds.has(folder.id);
  const isActive = selectedFolderId === folder.id;

  function getPos(e: React.DragEvent<HTMLDivElement>): "before" | "after" | "inside" {
    const { top, height } = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientY - top) / height;
    return pct < 0.3 ? "before" : pct > 0.7 ? "after" : "inside";
  }

  const isGenerating = generatingFolderIds.includes(folder.id);
  const hasUnseen = unseenFolderIds.includes(folder.id);

  const sharedChildProps = {
    allFolders, expandedIds, selectedFolderId,
    onToggleExpand, onSelect, onDelete, onRename, onColorChange, onMove,
    creatingInFolderId, newFolderName, onNameChange, onNameKeyDown, onNameBlur, inputRef,
    getCount, generatingFolderIds, unseenFolderIds,
  };

  return (
    <React.Fragment>
      {drop === "before" && (
        <div className="h-px mx-2 rounded-full bg-accent pointer-events-none" />
      )}
      <div
        draggable
        onDragStart={e => {
          _dragFolderId = folder.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", folder.id);
        }}
        onDragOver={e => {
          e.preventDefault();
          e.stopPropagation();
          if (_dragFolderId === folder.id) return;
          setDrop(getPos(e));
        }}
        onDragLeave={e => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null);
        }}
        onDrop={e => {
          e.preventDefault();
          e.stopPropagation();
          const dragged = _dragFolderId;
          setDrop(null);
          _dragFolderId = null;
          if (!dragged || dragged === folder.id) return;
          const pos = getPos(e);
          if (pos === "inside") {
            const sibs = allFolders.filter(f => f.parentId === folder.id).sort((a, b) => a.orderIndex - b.orderIndex);
            onMove(dragged, folder.id, sibs.length > 0 ? Math.max(...sibs.map(f => f.orderIndex)) + 1 : 0);
          } else {
            const sibs = allFolders.filter(f => f.parentId === folder.parentId && f.id !== dragged).sort((a, b) => a.orderIndex - b.orderIndex);
            const idx = sibs.findIndex(f => f.id === folder.id);
            onMove(dragged, folder.parentId, pos === "before" ? idx : idx + 1);
          }
        }}
        onDragEnd={() => { _dragFolderId = null; setDrop(null); }}
        onClick={() => !isRenaming && onSelect(folder.id)}
        className={cn(
          "group flex items-center gap-[10px] h-[34px] rounded-full cursor-pointer transition-colors select-none",
          isActive ? "bg-bg-2 font-semibold" : "hover:bg-bg-2",
          drop === "inside" && "outline outline-1 outline-accent -outline-offset-1",
        )}
        style={{
          paddingLeft: `${12 + depth * 14}px`,
          paddingRight: "8px",
        }}
      >
        {/* Expand toggle */}
        <button
          onClick={e => { e.stopPropagation(); onToggleExpand(folder.id); }}
          className={cn(
            "flex items-center justify-center shrink-0 bg-transparent border-0 p-0 cursor-pointer text-text-3",
            (hasChildren || isCreatingHere) ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
          )}
          style={{ width: 10, height: 10 }}
        >
          {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>

        {/* Colour dot */}
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: folder.color ?? "var(--text-3)" }}
        />

        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); confirmRename(); }
              if (e.key === "Escape") { e.stopPropagation(); setIsRenaming(false); }
            }}
            onBlur={confirmRename}
            onClick={e => e.stopPropagation()}
            className="flex-1 bg-transparent text-[13px] text-text-1 outline-none border-b border-border-2 pb-0.5 min-w-0"
          />
        ) : (
          <span className={cn(
            "flex-1 text-[13px] truncate leading-tight",
            isActive ? "text-text-1 font-semibold" : "text-text-2",
          )}>
            {folder.name}
          </span>
        )}

        {!isRenaming && (() => { const c = getCount(folder.id); return c > 0 ? (
          <span className="label tabular text-text-3 shrink-0">{c}</span>
        ) : null; })()}
        {!isRenaming && isGenerating && (
          <span
            className="shrink-0 rounded-full border-2 border-border-1 animate-spin"
            style={{ width: 10, height: 10, borderTopColor: "var(--accent)" }}
          />
        )}
        {!isRenaming && !isGenerating && hasUnseen && (
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-accent" />
        )}

        {/* ⋯ context menu button */}
        <button
          ref={btnRef}
          onClick={openMenu}
          className="w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 text-text-3 hover:text-text-1 hover:bg-bg-1 transition-all shrink-0"
        >
          <MoreHorizontal size={12} />
        </button>
      </div>

      {/* Context menu — fixed-position to escape overflow:auto clipping */}
      {menuOpen && menuPos && (
        <div
          ref={menuRef}
          onMouseDown={e => e.preventDefault()}
          className="fixed z-[9999] bg-surface border border-border-2 rounded-2 p-1"
          style={{
            left: menuPos.x,
            top: menuPos.y,
            transform: "translateX(-100%)",
            minWidth: 130,
          }}
        >
          {/* Color swatches */}
          <div className="px-2.5 pt-1.5 pb-1.5 flex gap-1 items-center flex-wrap">
            {FOLDER_COLORS.map(({ color, label }) => {
              const isSelected = color === null ? !folder.color : folder.color === color;
              return (
                <button
                  key={label}
                  title={label}
                  onClick={e => { e.stopPropagation(); setMenuOpen(false); onColorChange(folder.id, color); }}
                  className="relative shrink-0 rounded-full cursor-pointer p-0"
                  style={{
                    width: 14, height: 14,
                    background: color ?? "var(--border-2)",
                    border: isSelected ? "2px solid var(--text-1)" : "2px solid transparent",
                  }}
                >
                  {color === null && (
                    <X size={10} className="absolute inset-0 m-auto text-text-2" strokeWidth={1.5} />
                  )}
                </button>
              );
            })}
          </div>
          <div className="h-px bg-border-1 my-0.5" />
          <button
            onClick={e => { e.stopPropagation(); startRename(); }}
            className="block w-full text-left px-2.5 py-1.5 rounded-1 text-[13px] text-text-2 bg-transparent border-0 cursor-pointer hover:bg-bg-2 hover:text-text-1"
          >
            Rename
          </button>
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(false); cleanFailedJobs(folder.id); }}
            className="block w-full text-left px-2.5 py-1.5 rounded-1 text-[13px] text-text-2 bg-transparent border-0 cursor-pointer hover:bg-bg-2 hover:text-text-1"
          >
            Clean failed jobs
          </button>
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(folder.id); }}
            className="block w-full text-left px-2.5 py-1.5 rounded-1 text-[13px] text-error bg-transparent border-0 cursor-pointer hover:bg-bg-2"
          >
            Delete
          </button>
        </div>
      )}

      {drop === "after" && (
        <div className="h-px mx-2 rounded-full bg-accent pointer-events-none" />
      )}
      {isExpanded && (hasChildren || isCreatingHere) && (
        <>
          {children.map(child => (
            <FolderRow key={child.id} folder={child} depth={depth + 1} {...sharedChildProps} />
          ))}
          {isCreatingHere && (
            <div
              className="flex items-center gap-2 py-1"
              style={{ paddingLeft: `${8 + (depth + 1) * 14}px`, paddingRight: "8px" }}
            >
              <Folder size={13} className="shrink-0 text-text-3" />
              <input
                ref={inputRef}
                value={newFolderName}
                onChange={e => onNameChange(e.target.value)}
                onKeyDown={onNameKeyDown}
                onBlur={onNameBlur}
                placeholder="Folder name…"
                className="flex-1 bg-transparent text-[13px] text-text-1 placeholder:text-text-3 outline-none border-b border-border-2 pb-0.5 min-w-0"
              />
            </div>
          )}
        </>
      )}
    </React.Fragment>
  );
});

// ── AllAssetsRow — "All assets" item with its own "..." menu ─────────────────
interface AllAssetsRowProps {
  isActive: boolean;
  count: number;
  onSelect: () => void;
  isGenerating?: boolean;
  hasUnseen?: boolean;
}

const AllAssetsRow = React.memo(function AllAssetsRow({ isActive, count, onSelect, isGenerating, hasUnseen }: AllAssetsRowProps) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuPos, setMenuPos] = React.useState<{ x: number; y: number } | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

  function openMenu(e: React.MouseEvent) {
    e.stopPropagation();
    const rect = btnRef.current!.getBoundingClientRect();
    setMenuPos({ x: rect.right, y: rect.bottom + 4 });
    setMenuOpen(true);
  }

  return (
    <React.Fragment>
      <div
        onClick={onSelect}
        className={cn(
          "group flex items-center gap-[10px] h-[34px] px-3 rounded-full cursor-pointer transition-colors",
          isActive ? "bg-bg-2 font-semibold" : "hover:bg-bg-2"
        )}
      >
        <LayoutGrid size={13} className={cn("shrink-0", isActive ? "text-text-1" : "text-text-3")} />
        <span className={cn(
          "flex-1 text-[13px] truncate leading-tight",
          isActive ? "text-text-1 font-semibold" : "text-text-2"
        )}>
          All assets
        </span>
        {count > 0 && (
          <span className="label tabular text-text-3 shrink-0">{count}</span>
        )}
        {isGenerating && (
          <span
            className="shrink-0 rounded-full border-2 border-border-1 animate-spin"
            style={{ width: 10, height: 10, borderTopColor: "var(--accent)" }}
          />
        )}
        {!isGenerating && hasUnseen && (
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-accent" />
        )}
        <button
          ref={btnRef}
          onClick={openMenu}
          className="w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 text-text-3 hover:text-text-1 hover:bg-bg-1 transition-all shrink-0"
        >
          <MoreHorizontal size={12} />
        </button>
      </div>

      {menuOpen && menuPos && (
        <div
          ref={menuRef}
          onMouseDown={e => e.preventDefault()}
          className="fixed z-[9999] bg-surface border border-border-2 rounded-2 p-1"
          style={{
            left: menuPos.x,
            top: menuPos.y,
            transform: "translateX(-100%)",
            minWidth: 130,
          }}
        >
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(false); cleanFailedJobs(null); }}
            className="block w-full text-left px-2.5 py-1.5 rounded-1 text-[13px] text-text-2 bg-transparent border-0 cursor-pointer hover:bg-bg-2 hover:text-text-1"
          >
            Clean failed jobs
          </button>
        </div>
      )}
    </React.Fragment>
  );
});

// ── Static icons ──────────────────────────────────────────────────────────────
function LogoIcon() {
  return <BrandMark size={32} />;
}

function CreditIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

// ── Sidebar component ─────────────────────────────────────────────────────────
export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "images";
  const activeChatId = searchParams.get("id");

  const [balance, setBalance] = React.useState<number | null>(null);

  const setSettingsOpen   = useWorkflowStore((s) => s.setSettingsOpen);
  const setKieKeySet      = useWorkflowStore((s) => s.setKieKeySet);
  const setAzureKeySet    = useWorkflowStore((s) => s.setAzureKeySet);

  React.useEffect(() => {
    fetch("/api/settings/kie-key")
      .then((r) => r.json())
      .then((d) => setKieKeySet(!!d.hasToken))
      .catch(() => setKieKeySet(null));
    fetch("/api/settings/azure-key")
      .then((r) => r.json())
      .then((d) => setAzureKeySet(!!d.hasToken))
      .catch(() => setAzureKeySet(null));
  }, [setKieKeySet, setAzureKeySet]);

  React.useEffect(() => {
    const fetchBalance = async () => {
      try {
        const res = await fetch("/api/credit");
        if (!res.ok) return;
        const data = await res.json();
        const val = typeof data?.data === "number"
          ? data.data
          : (data?.data?.balance ?? data?.balance ?? null);
        setBalance(val);
      } catch { /* ignore */ }
    };
    fetchBalance();
    const id = setInterval(fetchBalance, 60_000);
    window.addEventListener("credits-refresh", fetchBalance);
    return () => { clearInterval(id); window.removeEventListener("credits-refresh", fetchBalance); };
  }, []);

  const { sessions, deleteSession } = useChatSessionStore();

  const {
    folders, selectedFolderId, itemFolderMap,
    createFolder, deleteFolder, selectFolder,
    updateFolder, moveFolder, folderItemCount,
    galleryImageCount, galleryVideoCount,
    loadFromServer, generatingFolderIds, unseenFolderIds,
    generatingAllAssets, unseenAllAssets,
  } = useFolderStore();
  const [creatingFolder, setCreatingFolder] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const newFolderInputRef = React.useRef<HTMLInputElement>(null);
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    loadFromServer();
  }, [loadFromServer]);

  function startNewChat() {
    router.push("/chat");
  }

  function handleDeleteChat(id: string, isActive: boolean) {
    deleteSession(id);
    if (isActive) {
      const next = sessions.find(s => s.id !== id);
      router.push(next ? `/chat?id=${next.id}` : "/chat");
    }
  }

  function handleCreateFolder() {
    setCreatingFolder(true);
    setNewFolderName("");
    // Auto-expand parent folder so the inline input is visible
    if (selectedFolderId) {
      setExpandedIds(prev => new Set([...prev, selectedFolderId]));
    }
    setTimeout(() => newFolderInputRef.current?.focus(), 50);
  }

  function confirmCreateFolder() {
    const name = newFolderName.trim();
    if (name) {
      // If a folder is currently selected, create subfolder under it
      const parentId = selectedFolderId ?? null;
      createFolder(name, parentId);
    }
    setCreatingFolder(false);
    setNewFolderName("");
  }

  function handleFolderKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") confirmCreateFolder();
    if (e.key === "Escape") { setCreatingFolder(false); setNewFolderName(""); }
  }

  // ── Folder tree helpers ──────────────────────────────────────────────────────
  function buildTree(parentId: string | null): typeof folders {
    return folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }

  function handleToggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const displayName = "";
  const avatarSeed = "guest";

  const folderParam = selectedFolderId ? `&folder=${selectedFolderId}` : "";
  const navItems = [
    { label: "Image", href: `/gallery?tab=images${folderParam}`, icon: ImageIcon, active: pathname === "/gallery" && tab === "images" },
    { label: "Video", href: `/gallery?tab=videos${folderParam}`, icon: VideoIcon, active: pathname === "/gallery" && tab === "videos" },
    { label: "Workflow", href: "/workflow", icon: Workflow, active: pathname === "/workflow" || (pathname.startsWith("/workflow/") && pathname !== "/workflow") },
    { label: "Assets", href: "#", icon: Package, active: false, disabled: true },
    { label: "Chat", href: "/chat", icon: MessageSquare, active: pathname === "/chat" },
    { label: "Settings", href: "#", icon: Settings, active: false, onClick: (e: React.MouseEvent) => { e.preventDefault(); setSettingsOpen(true); } },
  ];

  const itemCls = (active: boolean, disabled?: boolean) => cn(
    "flex items-center gap-[10px] px-3 h-[38px] w-full rounded-full transition-colors duration-150 text-left",
    "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:w-10 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:mx-auto",
    active ? "bg-surface border border-border-2 font-semibold text-text-1" : "text-text-2 font-medium hover:bg-bg-2",
    disabled && "opacity-40 cursor-not-allowed pointer-events-none",
  );

  return (
    <Sidebar collapsible="icon" className="border-r-0 bg-bg-0">

      {/* ── Header ── */}
      <SidebarHeader className="flex-row items-center justify-between px-4 pt-5 pb-2 gap-0">
        <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:hidden">
          <LogoIcon />
          <span className="display text-text-1 text-[18px] leading-none select-none">
            {BRAND_NAME}
          </span>
        </div>
        {/* Collapsed: logo fades to trigger on hover */}
        <div className="hidden group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:py-1">
          <div className="relative group/logo-area w-10 h-10 flex items-center justify-center">
            <div className="pointer-events-none transition-opacity duration-200 group-hover/logo-area:opacity-0">
              <LogoIcon />
            </div>
            <SidebarTrigger className="absolute inset-0 opacity-0 group-hover/logo-area:opacity-100 transition-opacity duration-200 text-text-2 hover:text-text-1 hover:bg-bg-2 w-full h-full rounded-full p-0 [&_svg]:size-4" />
          </div>
        </div>
        <SidebarTrigger className="group-data-[collapsible=icon]:hidden text-text-3 hover:text-text-1 hover:bg-bg-2 transition-colors p-1.5 rounded-full -mr-1 [&_svg]:size-4" />
      </SidebarHeader>

      {/* ── Nav + Chat history ── */}
      <SidebarContent className="overflow-y-auto flex flex-col">
        {/* Nav items */}
        <div className="px-2 py-3 flex flex-col gap-0.5 shrink-0">
          {navItems.map((item) => {
            const content = (
              <>
                {React.createElement(item.icon, { size: 18, strokeWidth: 1.5, className: "shrink-0" })}
                <span className="text-[14px] group-data-[collapsible=icon]:hidden leading-none flex-1">
                  {item.label}
                </span>
                {item.label === "Workflow" && (
                  <span className="label font-bold bg-accent text-on-accent rounded-full px-2 py-0.5 group-data-[collapsible=icon]:hidden">
                    NEW
                  </span>
                )}
              </>
            );
            if (item.disabled) return (
              <div key={item.label} className={itemCls(item.active, true)} title={item.label}>{content}</div>
            );
            if (!item.href || item.href === "#") return (
              <button key={item.label} className={itemCls(item.active)} onClick={item.onClick} title={item.label}>{content}</button>
            );
            return (
              <Link key={item.label} href={item.href} onClick={item.onClick} className={itemCls(item.active)} title={item.label}>{content}</Link>
            );
          })}
        </div>

        {/* Folders section — hidden in icon mode */}
        <div className="group-data-[collapsible=icon]:hidden flex flex-col shrink-0 px-2">
          <div className="border-t border-border-1 mb-1" />

          {/* Section header */}
          <div className="flex items-center justify-between px-1 py-2 shrink-0">
            <span className="label text-text-3">Folders</span>
            <button
              onClick={handleCreateFolder}
              title="New folder"
              className="w-[22px] h-[22px] rounded-full border border-border-2 flex items-center justify-center text-text-2 hover:bg-bg-2 hover:text-text-1 transition-colors"
            >
              <Plus size={12} />
            </button>
          </div>

          {/* Folder list — max 7 rows, scrollable */}
          <div className="flex flex-col gap-0.5" style={{ maxHeight: "calc(7 * 36px)", overflowY: "auto" }}>
            {/* All assets row */}
            <AllAssetsRow
              isActive={selectedFolderId === null}
              count={pathname === "/gallery" ? (tab === "videos" ? galleryVideoCount : galleryImageCount) : 0}
              onSelect={() => selectFolder(null)}
              isGenerating={generatingAllAssets}
              hasUnseen={unseenAllAssets}
            />

            {/* Recursive folder tree — root folders only, children rendered inside FolderRow */}
            {buildTree(null).map((folder) => (
              <FolderRow
                key={folder.id}
                folder={folder}
                allFolders={folders}
                depth={0}
                expandedIds={expandedIds}
                selectedFolderId={selectedFolderId}
                onToggleExpand={handleToggleExpand}
                onSelect={selectFolder}
                onDelete={deleteFolder}
                onRename={(id, name) => updateFolder(id, { name })}
                onColorChange={(id, color) => updateFolder(id, { color })}
                onMove={moveFolder}
                creatingInFolderId={creatingFolder ? selectedFolderId : null}
                newFolderName={newFolderName}
                onNameChange={setNewFolderName}
                onNameKeyDown={handleFolderKeyDown}
                onNameBlur={confirmCreateFolder}
                inputRef={newFolderInputRef}
                getCount={folderItemCount}
                generatingFolderIds={generatingFolderIds}
                unseenFolderIds={unseenFolderIds}
              />
            ))}

            {/* Root-level new folder input — shown at bottom when no folder is selected */}
            {creatingFolder && selectedFolderId === null && (
              <div className="flex items-center gap-[10px] px-3 py-1">
                <Folder size={13} className="shrink-0 text-text-3" />
                <input
                  ref={newFolderInputRef}
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={handleFolderKeyDown}
                  onBlur={confirmCreateFolder}
                  placeholder="Folder name…"
                  className="flex-1 bg-transparent text-[13px] text-text-1 placeholder:text-text-3 outline-none border-b border-border-2 pb-0.5 min-w-0"
                />
              </div>
            )}
          </div>
        </div>

        {/* Chat history — hidden in icon mode */}
        <div className="group-data-[collapsible=icon]:hidden flex flex-col flex-1 min-h-0 px-2 pb-2">
          <div className="border-t border-border-1 mb-1" />

          {/* Section header */}
          <div className="flex items-center justify-between px-1 py-2 shrink-0">
            <span className="label text-text-3">Chats</span>
            <button
              onClick={startNewChat}
              title="New chat"
              className="w-[22px] h-[22px] rounded-full border border-border-2 flex items-center justify-center text-text-2 hover:bg-bg-2 hover:text-text-1 transition-colors"
            >
              <Pencil size={12} />
            </button>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 min-h-0">
            {sessions.length === 0 ? (
              <p className="text-center text-[12px] text-text-3 px-2 py-4">No chats yet</p>
            ) : sessions.map(sess => {
              const isActive = pathname === "/chat" && sess.id === activeChatId;
              return (
                <div
                  key={sess.id}
                  onClick={() => router.push(`/chat?id=${sess.id}`)}
                  className={cn(
                    "group flex items-center gap-[10px] h-[34px] px-3 rounded-full cursor-pointer transition-colors",
                    isActive ? "bg-bg-2 font-semibold" : "hover:bg-bg-2"
                  )}
                >
                  <div className="w-6 h-6 rounded-full border border-border-1 flex items-center justify-center shrink-0">
                    <Bot size={11} className="text-text-3" />
                  </div>
                  <span className={cn(
                    "flex-1 text-[13px] truncate leading-tight",
                    isActive ? "text-text-1 font-semibold" : "text-text-2"
                  )}>
                    {sess.title}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteChat(sess.id, isActive); }}
                    className="w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 text-text-3 hover:text-error hover:bg-bg-1 transition-all shrink-0"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </SidebarContent>

      {/* ── Footer ── */}
      <SidebarFooter className="px-2 pb-4">
        <GitHubButtons />
        <DropdownMenu>

          {/* Trigger: pixel avatar + name + credits */}
          <DropdownMenuTrigger
            render={
              <button
                title={displayName}
                className={cn(
                  "flex items-center gap-3 w-full px-2.5 py-2 rounded-2 hover:bg-bg-2 transition-colors cursor-pointer",
                  "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:w-10 group-data-[collapsible=icon]:h-10 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:mx-auto",
                )}
              >
                <Avatar className="size-9 rounded-2 shrink-0 after:rounded-2 after:border-border-2">
                  <AvatarFallback className="rounded-2 bg-transparent p-0 overflow-hidden">
                    <PixelAvatar seed={avatarSeed} size={36} />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left group-data-[collapsible=icon]:hidden min-w-0">
                  {displayName && <div className="text-[13px] font-semibold text-text-1 truncate leading-tight">{displayName}</div>}
                  <div className="flex items-center gap-1 mt-0.5 label tabular text-text-3">
                    <CreditIcon />
                    <span>{balance !== null ? `${balance.toLocaleString()} Credits` : "0 Credits"}</span>
                  </div>
                </div>
                <MoreHorizontal size={15} className="text-text-3 shrink-0 group-data-[collapsible=icon]:hidden" />
              </button>
            }
          />

          {/* Menu popup */}
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={8}
            className="!p-0 !rounded-2 !bg-surface !border-border-2 !ring-0 !shadow-none overflow-hidden !w-auto !min-w-[280px]"
          >
            {/* User header — non-interactive */}
            <div className="flex items-center gap-3.5 px-4 pt-4 pb-3.5">
              <Avatar className="size-14 rounded-2 shrink-0 after:rounded-2 after:border-border-2">
                <AvatarFallback className="rounded-2 bg-transparent p-0 overflow-hidden">
                  <PixelAvatar seed={avatarSeed} size={56} />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                {displayName && <div className="text-[15px] font-semibold text-text-1 truncate">{displayName}</div>}
                <div className="flex items-center gap-1.5 mt-0.5 label tabular text-text-3">
                  <CreditIcon size={13} />
                  <span>{balance !== null ? `${balance.toLocaleString()} Credits` : "0 Credits"}</span>
                </div>
              </div>
            </div>

            <DropdownMenuSeparator className="!bg-border-1 !my-0 !mx-0" />

            {/* Purchase Kie Credits */}
            <DropdownMenuItem
              className="flex items-center justify-between rounded-none px-4 py-3 text-[14px] text-text-2 hover:text-text-1 focus:text-text-1 focus:bg-bg-2 cursor-pointer"
              onClick={() => window.open("https://kie.ai?ref=25abb3f2236cbff9780ab9c2f84479ec", "_blank")}
            >
              <span>Purchase Kie Credits</span>
              <CreditIcon size={15} />
            </DropdownMenuItem>

            <DropdownMenuSeparator className="!bg-border-1 !my-0 !mx-0" />

            {/* Settings */}
            <DropdownMenuItem
              className="rounded-none px-4 pb-4 pt-3 text-[14px] text-text-2 hover:text-text-1 focus:text-text-1 focus:bg-bg-2 cursor-pointer"
              onClick={() => setSettingsOpen(true)}
            >
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>

        </DropdownMenu>
      </SidebarFooter>

    </Sidebar>
  );
}
