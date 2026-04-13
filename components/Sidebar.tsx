"use client";
import { useEffect, useRef, useState } from "react";
import { useWorkflowStore, Space } from "@/lib/store";
import { NODES } from "@/lib/nodeTypes";
import { useSpaceSync, timeAgo, SyncStatus } from "@/lib/useSpaceSync";

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
      <div className="flex-1 p-3 space-y-1 overflow-y-auto">
        <p className="text-[#8D8E89] text-[10px] uppercase tracking-widest px-1 py-2">
          Nodes
        </p>
        {NODES.map((n) => (
          <div
            key={n.type + n.label}
            draggable
            onDragStart={(e) => onDragStart(e, n.type)}
            className="w-full text-left px-3 py-2.5 rounded hover:bg-[#0D1012] transition-colors group cursor-grab active:cursor-grabbing"
          >
            <div className="flex items-center gap-2.5 text-[#8D8E89] group-hover:text-[#77E544] transition-colors">
              {n.icon}
              <span className="text-[13px] text-white group-hover:text-white font-medium transition-colors">
                {n.label}
              </span>
            </div>
            <p className="text-[10px] text-[#8D8E89] mt-0.5 pl-[22px]">
              {n.description}
            </p>
          </div>
        ))}
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
