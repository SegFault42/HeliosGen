"use client";
import {
  useRef, useState, useCallback, useEffect, useLayoutEffect, forwardRef,
  type ReactNode,
} from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { useWorkflowStore, NodeData } from "@/lib/store";
import CornerResizer from "./CornerResizer";

function cfImg(url: string, width: number): string {
  try {
    const u = new URL(url);
    return `${u.origin}/cdn-cgi/image/width=${width},quality=75,format=webp${u.pathname}`;
  } catch {
    return url;
  }
}

type PromptNodeType = Node<NodeData, "promptNode">;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the partial query after the last '@', or null when not in an active trigger. */
function getMentionQuery(text: string, cursor: number): string | null {
  const before = text.slice(0, cursor);
  const match  = before.match(/@(\S*)$/);
  return match ? match[1] : null;
}

/** Render text with exact @NodeLabel matches highlighted as chips. */
function renderWithMentions(text: string, knownLabels: string[]): ReactNode {
  if (!text) return null;
  const sorted = [...knownLabels].sort((a, b) => b.length - a.length);
  const parts: ReactNode[] = [];
  let rest = text;
  let key  = 0;
  while (rest.length > 0) {
    let earliest: { idx: number; label: string } | null = null;
    for (const label of sorted) {
      const idx = rest.indexOf(`@${label}`);
      if (idx !== -1 && (earliest === null || idx < earliest.idx)) {
        earliest = { idx, label };
      }
    }
    if (!earliest) { parts.push(<span key={key++}>{rest}</span>); break; }
    if (earliest.idx > 0) parts.push(<span key={key++}>{rest.slice(0, earliest.idx)}</span>);
    parts.push(<span key={key++} className="mention-chip">@{earliest.label}</span>);
    rest = rest.slice(earliest.idx + earliest.label.length + 1);
  }
  return <>{parts}</>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PromptNode({ id, data }: NodeProps<PromptNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const nodes          = useWorkflowStore((s) => s.nodes);
  const edges          = useWorkflowStore((s) => s.edges);

  const textareaRef      = useRef<HTMLTextAreaElement>(null);
  const cardRef          = useRef<HTMLDivElement>(null);
  // Cursor position to restore after the next React commit (programmatic edits)
  const pendingCursorRef = useRef<number | null>(null);

  // ── Restore cursor after programmatic prompt updates ──────────────────────
  useLayoutEffect(() => {
    const pos = pendingCursorRef.current;
    if (pos === null) return;
    pendingCursorRef.current = null;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
    ta.focus();
    ta.selectionStart = pos;
    ta.selectionEnd   = pos;
  });

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedIdx,  setSelectedIdx]  = useState(0);

  const prompt   = (data.prompt as string) ?? "";
  const hasError = !!data.hasError;

  // ── Resolve mentionable nodes ─────────────────────────────────────────────
  // Only show nodes that are connected to the same downstream generator(s) as
  // this text node — i.e. "siblings" of the text node at the generator.
  const downstreamTargetIds = edges
    .filter((e) => e.source === id)
    .map((e) => e.target);

  const mentionableNodes = nodes.filter((n) => {
    if (n.id === id || n.type === "promptNode") return false;
    // This node must share at least one downstream target with our text node
    return edges.some(
      (e) => e.source === n.id && downstreamTargetIds.includes(e.target)
    );
  });

  const knownLabels = mentionableNodes.map((n) => n.data.label as string).filter(Boolean);

  const filteredMentions =
    mentionQuery !== null
      ? mentionableNodes.filter((n) =>
          (n.data.label as string)
            ?.toLowerCase()
            .includes(mentionQuery.toLowerCase())
        )
      : mentionableNodes;

  // Reset selection when list changes
  useEffect(() => { setSelectedIdx(0); }, [filteredMentions.length]);

  // ── Elevate the RF node z-index while the menu is open ───────────────────
  // (the menu is inline so it needs its stacking context to be on top)
  useEffect(() => {
    const rfNode = cardRef.current?.closest<HTMLElement>(".react-flow__node");
    if (!rfNode) return;
    if (mentionQuery !== null && filteredMentions.length > 0) {
      rfNode.style.zIndex = "1000";
    } else {
      rfNode.style.zIndex = "";
    }
    return () => { rfNode.style.zIndex = ""; };
  }, [mentionQuery, filteredMentions.length]);

  // ── Auto-resize ───────────────────────────────────────────────────────────
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // ── onChange ──────────────────────────────────────────────────────────────
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text   = e.target.value;
      const cursor = e.target.selectionStart ?? text.length;
      updateNodeData(id, { prompt: text, hasError: false });
      autoResize();
      const query = getMentionQuery(text, cursor);
      setMentionQuery(query);
      if (query !== null) setSelectedIdx(0);
    },
    [id, updateNodeData, autoResize]
  );

  // ── Insert selected mention ───────────────────────────────────────────────
  const insertMention = useCallback(
    (label: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const cursor  = ta.selectionStart ?? prompt.length;
      const before  = prompt.slice(0, cursor);
      const after   = prompt.slice(cursor);
      const lastAt  = before.lastIndexOf("@");
      const newText = `${before.slice(0, lastAt)}@${label} ${after}`;

      const newPos = lastAt + label.length + 2;
      pendingCursorRef.current = newPos;
      updateNodeData(id, { prompt: newText });
      setMentionQuery(null);
    },
    [id, prompt, updateNodeData, autoResize]
  );

  const menuOpen = mentionQuery !== null && filteredMentions.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={cardRef}
      className={`node-card w-full h-full${hasError ? " node-error-blink" : ""}`}
      style={{ minWidth: 260 }}
      onAnimationEnd={() => updateNodeData(id, { hasError: false })}
    >
      <CornerResizer minWidth={200} minHeight={80} />
      <span className="node-above-label">{data.label as string}</span>

      {/* ── Text area ──────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-[7px] h-full">
        {/* Highlight overlay */}
        <div
          aria-hidden
          className="absolute inset-0 px-3 py-2.5 text-[12px] text-white leading-[1.6] pointer-events-none whitespace-pre-wrap break-words overflow-hidden select-none"
        >
          {renderWithMentions(prompt, knownLabels)}
          {"\u200b"}
        </div>

        {/* Placeholder */}
        {!prompt && (
          <div
            aria-hidden
            className="absolute inset-0 px-3 py-2.5 text-[12px] text-[#444444] leading-[1.6] pointer-events-none select-none"
          >
            Describe what you want to generate…
          </div>
        )}

        {/* Editable textarea — invisible text, white caret */}
        <textarea
          ref={textareaRef}
          className="relative w-full h-full px-3 py-2.5 bg-transparent text-[12px] leading-[1.6] resize-none outline-none overflow-auto z-10"
          style={{ minHeight: 80, color: "transparent", caretColor: "white" }}
          value={prompt}
          onChange={handleChange}
          onFocus={autoResize}
          onKeyDown={(e) => {
            const ta = textareaRef.current;

            // ── Atomic mention deletion ──────────────────────────────────
            if (
              (e.key === "Backspace" || e.key === "Delete") &&
              ta &&
              ta.selectionStart === ta.selectionEnd // no selection range
            ) {
              const cursor = ta.selectionStart ?? 0;
              for (const label of knownLabels) {
                const mention = `@${label}`;
                let pos = 0;
                while (pos < prompt.length) {
                  const idx = prompt.indexOf(mention, pos);
                  if (idx === -1) break;
                  const end = idx + mention.length;
                  // Backspace: cursor is inside or at the END of the mention
                  // Delete:    cursor is inside or at the START of the mention
                  const hit =
                    e.key === "Backspace"
                      ? cursor > idx && cursor <= end
                      : cursor >= idx && cursor < end;
                  if (hit) {
                    e.preventDefault();
                    const newText = prompt.slice(0, idx) + prompt.slice(end);
                    pendingCursorRef.current = idx;
                    updateNodeData(id, { prompt: newText });
                    return;
                  }
                  pos = idx + 1;
                }
              }
            }

            // ── Mention menu navigation ──────────────────────────────────
            if (!menuOpen) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelectedIdx((i) => (i + 1) % filteredMentions.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelectedIdx((i) => (i - 1 + filteredMentions.length) % filteredMentions.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              insertMention(filteredMentions[selectedIdx].data.label as string);
            } else if (e.key === "Escape") {
              setMentionQuery(null);
            }
          }}
        />
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="node-handle node-handle-source"
      />

      {/* ── Inline @mention menu (scales with canvas zoom) ─────────────── */}
      {menuOpen && (
        <div
          className="absolute left-0 right-0 bg-[#0F1214] border border-[#2A2A2A] rounded-lg overflow-hidden shadow-xl"
          style={{ top: "calc(100% + 6px)", zIndex: 50 }}
          onMouseDown={(e) => e.preventDefault()} // keep textarea focus
        >
          <div className="px-2.5 py-1.5 border-b border-[#1E1E1E]">
            <p className="text-[9px] text-[#4A4A45] uppercase tracking-widest">
              Connected nodes
            </p>
          </div>
          {filteredMentions.map((n, idx) => {
            const label    = n.data.label as string;
            const imageUrl =
              (n.data.inputImage as string | undefined) ??
              (n.data.imageUrl   as string | undefined);
            const videoUrl = n.data.videoUrl as string | undefined;
            const active   = idx === selectedIdx;

            return (
              <button
                key={n.id}
                onClick={() => insertMention(label)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors ${
                  active ? "bg-[#1A2010]" : "hover:bg-[#161A1E]"
                }`}
              >
                {/* Thumbnail */}
                <div className="w-6 h-6 rounded bg-[#1A1A1A] overflow-hidden shrink-0 flex items-center justify-center">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cfImg(imageUrl, 64)} alt="" className="w-full h-full object-cover" />
                  ) : videoUrl ? (
                    <VideoThumb />
                  ) : (
                    <EmptyThumb />
                  )}
                </div>

                {/* Label */}
                <span className={`text-[11px] font-medium truncate ${active ? "text-[#77E544]" : "text-[#CCCCCC]"}`}>
                  @{label}
                </span>

                {active && (
                  <span className="ml-auto text-[9px] text-[#4A4A45] shrink-0">↵</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Small icons ───────────────────────────────────────────────────────────────

function VideoThumb() {
  return (
    <svg width="12" height="10" viewBox="0 0 14 12" fill="#818cf8">
      <rect width="14" height="12" rx="1.5" opacity="0.2" />
      <path d="M9 6 5.5 4v4z" />
    </svg>
  );
}

function EmptyThumb() {
  return (
    <svg width="12" height="10" viewBox="0 0 14 12" fill="none" stroke="#333" strokeWidth="1.2">
      <rect x=".6" y=".6" width="12.8" height="10.8" rx="1.5" />
      <path d="m.6 8.5 3.5-3.5 2.5 2.5 2-2 5 4" />
    </svg>
  );
}
