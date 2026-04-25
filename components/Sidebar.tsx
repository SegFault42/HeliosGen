"use client";
import { useEffect, useRef, useState } from "react";
import { useWorkflowStore, Space } from "@/lib/store";
import { NODES, NodeCategory } from "@/lib/nodeTypes";
import { useSpaceSync, timeAgo, SyncStatus } from "@/lib/useSpaceSync";

/* ── Same accent colours & icons as AddNodeMenu ────────────────────────────── */
const NODE_META: Record<string, { accent: string; bg: string; bigIcon: React.ReactNode }> = {
  promptNode: {
    accent: "#4ade80",
    bg: "#052e16",
    bigIcon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  imageInputNode: {
    accent: "#fb923c",
    bg: "#431407",
    bigIcon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
    ),
  },
  videoInputNode: {
    accent: "#60a5fa",
    bg: "#0c1a3b",
    bigIcon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="14" x="3" y="5" rx="2" />
        <path d="m16 10-4-2.5v5L16 10z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  generateNode: {
    accent: "#77E544",
    bg: "#0d1f06",
    bigIcon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="m3 9 4-4 4 4 4-4 4 4" />
        <path d="M3 15h18" />
      </svg>
    ),
  },
  videoGeneratorNode: {
    accent: "#a78bfa",
    bg: "#1c0d3a",
    bigIcon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect width="18" height="14" x="3" y="5" rx="2" />
        <path d="m16 10-4-2.5v5L16 10z" fill="currentColor" stroke="none" />
        <path d="M7 12h4M9 10v4" />
      </svg>
    ),
  },
  assistantNode: {
    accent: "#FBBF24",
    bg: "#1c1000",
    bigIcon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
        <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
      </svg>
    ),
  },
};

// ── Spaces panel ──────────────────────────────────────────────────────────────

function SpacesPanel({ syncNow }: { syncNow: () => void }) {
  const spaces        = useWorkflowStore((s) => s.spaces);
  const activeSpaceId = useWorkflowStore((s) => s.activeSpaceId);
  const createSpace   = useWorkflowStore((s) => s.createSpace);
  const switchSpace   = useWorkflowStore((s) => s.switchSpace);
  const renameSpace   = useWorkflowStore((s) => s.renameSpace);
  const deleteSpace   = useWorkflowStore((s) => s.deleteSpace);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft]         = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = (sp: Space) => {
    setEditingId(sp.id);
    setDraft(sp.name);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = () => {
    if (editingId && draft.trim()) renameSpace(editingId, draft.trim());
    setEditingId(null);
  };

  const addSpace = () => {
    const n = spaces.length + 1;
    createSpace(`Space ${n}`);
    syncNow();
  };

  return (
    <div className="border-b border-[#1A100C]">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[10px] uppercase tracking-widest text-[#8D8E89]">Spaces</span>
        <button
          onClick={addSpace}
          className="w-4 h-4 flex items-center justify-center rounded text-[#8D8E89] hover:text-white hover:bg-[#1A100C] transition-colors"
          title="New space"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 1v6M1 4h6" />
          </svg>
        </button>
      </div>

      <div className="pb-2 space-y-px px-2">
        {spaces.map((sp) => {
          const active = sp.id === activeSpaceId;
          const nodeCount = sp.nodes.filter(
            (n) => n.type === "generateNode" || n.type === "videoGeneratorNode"
          ).length;

          return (
            <div
              key={sp.id}
              onClick={() => { if (!active) switchSpace(sp.id); }}
              className={`group flex items-center gap-2 px-2 py-2 rounded cursor-pointer transition-colors ${
                active ? "bg-[#0D1012]" : "hover:bg-[#0A0C0E]"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? "bg-[#77E544]" : "bg-[#2A1A14]"}`} />

              {editingId === sp.id ? (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 bg-transparent text-[12px] text-white outline-none border-b border-[#77E544]"
                />
              ) : (
                <span
                  onDoubleClick={(e) => { e.stopPropagation(); startRename(sp); }}
                  className={`flex-1 min-w-0 text-[12px] truncate ${active ? "text-white" : "text-[#8D8E89]"}`}
                >
                  {sp.name}
                </span>
              )}

              {nodeCount > 0 && (
                <span className="text-[10px] text-[#4A4A45] tabular-nums shrink-0">{nodeCount}</span>
              )}

              {spaces.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSpace(sp.id); syncNow(); }}
                  className="opacity-0 group-hover:opacity-100 shrink-0 w-3.5 h-3.5 flex items-center justify-center text-[#8D8E89] hover:text-red-400 transition-colors"
                  title="Delete space"
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M1 1l6 6M7 1L1 7" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const { status, lastSyncedAt, syncNow } = useSpaceSync();

  const onDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData("application/reactflow-node", type);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <aside className="w-48 bg-[#0A0C0E] border-r border-[#1A100C] flex flex-col shrink-0 select-none">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-[#1A100C]">
        <span className="text-white text-sm font-medium tracking-tight">
          AI Workflow
        </span>
      </div>

      {/* Spaces */}
      <SpacesPanel syncNow={syncNow} />

      {/* Node list */}
      <div className="flex-1 overflow-y-auto">
        {(["generators", "resources"] as NodeCategory[]).map((cat) => {
          const group = NODES.filter((n) => n.category === cat);
          return (
            <div key={cat} className="border-b border-[#1A100C] last:border-b-0">
              <p className="text-[#8D8E89] text-[10px] uppercase tracking-widest px-4 pt-3 pb-1.5">
                {cat}
              </p>
              <div className="px-2 pb-2 space-y-px">
                {group.map((n) => {
                  const meta = NODE_META[n.type];
                  return (
                    <div
                      key={n.type}
                      draggable
                      onDragStart={(e) => onDragStart(e, n.type)}
                      className="w-full text-left px-2 py-2 rounded hover:bg-[#0D1012] transition-colors group cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex items-center gap-2.5">
                        {/* Colored icon badge — matches AddNodeMenu style */}
                        <span
                          style={{
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "30px",
                            height: "30px",
                            borderRadius: "8px",
                            background: meta?.bg ?? "rgba(255,255,255,0.06)",
                            color: meta?.accent ?? "#aaa",
                            border: `1px solid ${meta?.accent ?? "#333"}28`,
                            transition: "box-shadow 150ms ease",
                          }}
                          className="group-hover:shadow-[0_0_0_1px_var(--accent)]"
                        >
                          {meta?.bigIcon ?? n.icon}
                        </span>
                        <div className="min-w-0">
                          <span className="text-[12px] text-white font-medium leading-tight block">
                            {n.label}
                          </span>
                          <p className="text-[10px] text-[#8D8E89] mt-0.5 leading-tight truncate">
                            {n.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-[#1A100C] flex flex-col gap-2">
        <p className="text-[10px] text-[#4A4A45] leading-4">
          Drag nodes onto the canvas to add them
        </p>
        <SyncIndicator status={status} lastSyncedAt={lastSyncedAt} />
      </div>
    </aside>
  );
}

// ── Sync indicator ────────────────────────────────────────────────────────────

function SyncIndicator({ status, lastSyncedAt }: { status: SyncStatus; lastSyncedAt: Date | null }) {
  const [, forceUpdate] = useState(0);

  // Re-render every 30s so the "X ago" text stays fresh
  useEffect(() => {
    const id = setInterval(() => forceUpdate((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (status === "idle") return null;

  const dot: Record<SyncStatus, string> = {
    idle:    "",
    syncing: "bg-amber-400 animate-pulse",
    synced:  "bg-[#77E544]",
    error:   "bg-red-500",
  };

  const label: Record<SyncStatus, string> = {
    idle:    "",
    syncing: "Syncing…",
    synced:  lastSyncedAt ? `Synced ${timeAgo(lastSyncedAt)}` : "Synced",
    error:   "Sync failed",
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot[status]}`} />
      <span className="text-[10px] text-[#4A4A45]">{label[status]}</span>
    </div>
  );
}
