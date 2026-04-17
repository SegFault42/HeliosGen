"use client";
import {
  useRef, useState, useCallback, useEffect, useLayoutEffect,
  type ReactNode,
} from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { useWorkflowStore, NodeData } from "@/lib/store";
import CornerResizer from "./CornerResizer";


type PromptNodeType = Node<NodeData, "promptNode">;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the partial query after the last '@', or null when not in an active trigger. */
function getMentionQuery(text: string, cursor: number): string | null {
  const before = text.slice(0, cursor);
  const match  = before.match(/@(\S*)$/);
  return match ? match[1] : null;
}

type MentionPreview = { imageUrl?: string; videoUrl?: string };

/** Render text with exact @NodeLabel matches highlighted as chips + inline preview thumbnails. */
function renderWithMentions(
  text: string,
  knownLabels: string[],
  previews: Map<string, MentionPreview> = new Map(),
): ReactNode {
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

    const preview = previews.get(earliest.label);
    parts.push(
      <span key={key++} className="mention-chip" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        {preview?.videoUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={preview.videoUrl}
            autoPlay loop muted playsInline
            style={{ width: 14, height: 14, objectFit: "cover", borderRadius: 2, flexShrink: 0 }}
          />
        ) : preview?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview.imageUrl}
            alt=""
            style={{ width: 14, height: 14, objectFit: "cover", borderRadius: 2, flexShrink: 0 }}
          />
        ) : null}
        @{earliest.label}
      </span>
    );
    rest = rest.slice(earliest.idx + earliest.label.length + 1);
  }
  return <>{parts}</>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PromptNode({ id, data, selected }: NodeProps<PromptNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const nodes          = useWorkflowStore((s) => s.nodes);
  const edges          = useWorkflowStore((s) => s.edges);

  const textareaRef      = useRef<HTMLTextAreaElement>(null);
  const highlightRef     = useRef<HTMLDivElement>(null);
  const cardRef          = useRef<HTMLDivElement>(null);
  const textZoneRef      = useRef<HTMLDivElement>(null);
  // Desired cursor position after a programmatic text change (insertion / deletion)
  const pendingCursorRef = useRef<number | null>(null);
  const selectedRef      = useRef(selected);

  const [mentionQuery,    setMentionQuery]    = useState<string | null>(null);
  const [selectedIdx,    setSelectedIdx]    = useState(0);
  const [hasScrollTop,   setHasScrollTop]   = useState(false);
  const [hasScrollBottom, setHasScrollBottom] = useState(false);

  selectedRef.current = selected;

  const storePrompt = (data.prompt as string) ?? "";
  const hasError    = !!data.hasError;

  // localText drives the overlay and placeholder — always in sync with what's
  // actually in the textarea (updated on every keystroke via handleChange).
  const [localText, setLocalText] = useState(storePrompt);

  // ── Keep uncontrolled textarea in sync with external store changes ────────
  // (e.g. when the whole canvas is loaded from saved state, or programmatic
  //  edits like insertMention / atomic deletion call updateNodeData directly)
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta || ta.value === storePrompt) return;
    ta.value = storePrompt;
    setLocalText(storePrompt);
  }, [storePrompt]);

  // ── Restore cursor after programmatic edits ───────────────────────────────
  // Runs synchronously after every commit. When pendingCursorRef is set (by
  // insertMention / atomic deletion), places the cursor before the browser
  // paints — no rAF race possible.
  useLayoutEffect(() => {
    const pos = pendingCursorRef.current;
    if (pos === null) return;
    pendingCursorRef.current = null;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.selectionStart = pos;
    ta.selectionEnd   = pos;
  });

  // ── Resolve mentionable nodes ─────────────────────────────────────────────
  const downstreamTargetIds = edges
    .filter((e) => e.source === id)
    .map((e) => e.target);

  const mentionableNodes = nodes.filter((n) => {
    if (n.id === id || n.type === "promptNode") return false;
    return edges.some(
      (e) => e.source === n.id && downstreamTargetIds.includes(e.target)
    );
  });

  const knownLabels = mentionableNodes.map((n) => n.data.label as string).filter(Boolean);

  const mentionPreviews = new Map<string, MentionPreview>(
    mentionableNodes.map((n) => [
      n.data.label as string,
      {
        imageUrl: (n.data.r2Url ?? n.data.inputImage ?? n.data.imageUrl) as string | undefined,
        videoUrl: n.data.videoUrl as string | undefined,
      },
    ])
  );

  const filteredMentions =
    mentionQuery !== null
      ? mentionableNodes.filter((n) =>
          (n.data.label as string)
            ?.toLowerCase()
            .includes(mentionQuery.toLowerCase())
        )
      : mentionableNodes;

  useEffect(() => { setSelectedIdx(0); }, [filteredMentions.length]);

  // ── Elevate the RF node z-index while the menu is open ───────────────────
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

  // ── Sync highlight overlay scroll with textarea scroll ───────────────────
  const syncScroll = useCallback(() => {
    if (highlightRef.current && textareaRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  // ── Track overflow for gradient fades ────────────────────────────────────
  const checkScrollState = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    setHasScrollTop(ta.scrollTop > 2);
    setHasScrollBottom(ta.scrollTop + ta.clientHeight < ta.scrollHeight - 2);
  }, []);

  useEffect(() => { checkScrollState(); }, [localText, checkScrollState]);

  // Native listeners on the text zone — must be native (not React synthetic) so they
  // fire during DOM bubble before ReactFlow's listener on the node wrapper sees the event.
  useEffect(() => {
    const el = textZoneRef.current;
    if (!el) return;
    const onMouseDown = (e: MouseEvent) => {
      if (selectedRef.current) {
        // Selected: block node drag so the user can place cursor / select text
        e.stopPropagation();
      } else {
        // Unselected: let ReactFlow drag the node, but prevent the browser from
        // starting a text-selection gesture on the textarea at the same time
        e.preventDefault();
      }
    };
    // Block wheel only when the node is selected (otherwise canvas zooms normally).
    // No passive:true so stopPropagation is fully honoured; stopImmediatePropagation
    // also blocks any other listeners registered on this same element.
    const onWheel = (e: WheelEvent) => {
      if (selectedRef.current) {
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    };
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("wheel", onWheel);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  // ── onChange — textarea is uncontrolled; React never writes .value ────────
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text   = e.target.value;
      const cursor = e.target.selectionStart ?? text.length;
      // Sync overlay immediately (no re-render lag)
      setLocalText(text);
      // Persist to store (triggers a re-render, but textarea.value is never
      // overwritten by React since there is no value= prop → cursor safe)
      updateNodeData(id, { prompt: text, hasError: false });
      const query = getMentionQuery(text, cursor);
      setMentionQuery(query);
      if (query !== null) setSelectedIdx(0);
    },
    [id, updateNodeData]
  );

  // ── Insert selected mention ───────────────────────────────────────────────
  const insertMention = useCallback(
    (label: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      // Use ta.value (source of truth for uncontrolled textarea)
      const text    = ta.value;
      const cursor  = ta.selectionStart ?? text.length;
      const before  = text.slice(0, cursor);
      const after   = text.slice(cursor);
      const lastAt  = before.lastIndexOf("@");
      const newText = `${before.slice(0, lastAt)}@${label} ${after}`;
      const newPos  = lastAt + label.length + 2;

      // Update textarea value directly (uncontrolled)
      ta.value = newText;
      setLocalText(newText);
      pendingCursorRef.current = newPos;
      updateNodeData(id, { prompt: newText });
      setMentionQuery(null);
    },
    [id, updateNodeData]
  );

  const menuOpen = mentionQuery !== null && filteredMentions.length > 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={cardRef}
      className={`node-card w-full h-full flex flex-col${hasError ? " node-error-blink" : ""}`}
      style={{ minWidth: 260 }}
      onAnimationEnd={() => updateNodeData(id, { hasError: false })}
    >
      <CornerResizer minWidth={200} minHeight={80} />
      <span className="node-above-label">{data.label as string}</span>

      {/* Padding zone — fills remaining height; clicking here drags the node */}
      <div className="flex-1 p-2.5 min-h-0">
        {/* Text zone — stops propagation so clicking edits text, not drags node */}
        <div
          ref={textZoneRef}
          className="relative h-full rounded-[7px] overflow-hidden"
        >
        {/* Highlight overlay — driven by localText so it updates on every keystroke */}
        <div
          ref={highlightRef}
          aria-hidden
          className="absolute inset-0 px-3 py-2.5 text-[12px] text-white leading-[1.6] pointer-events-none whitespace-pre-wrap break-words overflow-hidden select-none"
        >
          {renderWithMentions(localText, knownLabels, mentionPreviews)}
          {"\u200b"}
        </div>

        {/* Placeholder */}
        {!localText && (
          <div
            aria-hidden
            className="absolute inset-0 px-3 py-2.5 text-[12px] text-[#444444] leading-[1.6] pointer-events-none select-none"
          >
            Describe what you want to generate…
          </div>
        )}

        {/* Editable textarea — UNCONTROLLED (no value= prop).
            React never writes .value, so cursor position is never reset. */}
        <textarea
          ref={textareaRef}
          className="relative w-full h-full px-3 py-2.5 bg-transparent text-[12px] leading-[1.6] resize-none outline-none overflow-y-auto z-10"
          style={{ color: "transparent", caretColor: "white", overscrollBehavior: "contain" }}
          defaultValue={storePrompt}
          onChange={handleChange}
          onScroll={() => { syncScroll(); checkScrollState(); }}
          onKeyDown={(e) => {
            const ta = textareaRef.current;

            // ── Atomic mention deletion ──────────────────────────────────
            if (
              (e.key === "Backspace" || e.key === "Delete") &&
              ta &&
              ta.selectionStart === ta.selectionEnd
            ) {
              const cursor = ta.selectionStart ?? 0;
              const text   = ta.value; // source of truth
              for (const label of knownLabels) {
                const mention = `@${label}`;
                let pos = 0;
                while (pos < text.length) {
                  const idx = text.indexOf(mention, pos);
                  if (idx === -1) break;
                  const end = idx + mention.length;
                  const hit =
                    e.key === "Backspace"
                      ? cursor > idx && cursor <= end
                      : cursor >= idx && cursor < end;
                  if (hit) {
                    e.preventDefault();
                    const newText = text.slice(0, idx) + text.slice(end);
                    ta.value = newText;
                    setLocalText(newText);
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

        {/* Top gradient — visible when scrolled down */}
        {hasScrollTop && (
          <div
            aria-hidden
            className="absolute top-0 left-0 right-0 h-8 pointer-events-none z-20"
            style={{ background: "linear-gradient(to bottom, #0D1012 0%, transparent 100%)" }}
          />
        )}

        {/* Bottom gradient — visible when more text is below */}
        {hasScrollBottom && (
          <div
            aria-hidden
            className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none z-20"
            style={{ background: "linear-gradient(to top, #0D1012 0%, transparent 100%)" }}
          />
        )}
        </div>
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
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="px-2.5 py-1.5 border-b border-[#1E1E1E]">
            <p className="text-[9px] text-[#4A4A45] uppercase tracking-widest">
              Connected nodes
            </p>
          </div>
          {filteredMentions.map((n, idx) => {
            const label    = n.data.label as string;
            const imageUrl =
              (n.data.r2Url      as string | undefined) ??
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
                <div className="w-6 h-6 rounded bg-[#1A1A1A] overflow-hidden shrink-0 flex items-center justify-center">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                  ) : videoUrl ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video
                      src={videoUrl}
                      autoPlay
                      loop
                      muted
                      playsInline
                      className="w-full h-full"
                      style={{ objectFit: "cover" }}
                    />
                  ) : (
                    <EmptyThumb />
                  )}
                </div>
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


function EmptyThumb() {
  return (
    <svg width="12" height="10" viewBox="0 0 14 12" fill="none" stroke="#333" strokeWidth="1.2">
      <rect x=".6" y=".6" width="12.8" height="10.8" rx="1.5" />
      <path d="m.6 8.5 3.5-3.5 2.5 2.5 2-2 5 4" />
    </svg>
  );
}
