"use client";
import {
  useRef, useState, useCallback, useEffect, useLayoutEffect,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Handle, Position, NodeProps, Node, useViewport } from "@xyflow/react";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";
import CornerResizer from "./CornerResizer";


type PromptNodeType = Node<NodeData, "promptNode">;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the partial query after the last '@', or null when not in an active trigger. */
function getMentionQuery(text: string, cursor: number): string | null {
  const before = text.slice(0, cursor);
  const match = before.match(/@(\S*)$/);
  return match ? match[1] : null;
}

type MentionPreview = { imageUrl?: string; videoUrl?: string };

/** Render text with exact @NodeLabel matches highlighted as chips. */
function renderWithMentions(
  text: string,
  knownLabels: string[],
): ReactNode {
  if (!text) return null;
  const sorted = [...knownLabels].sort((a, b) => b.length - a.length);
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
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

    parts.push(
      <span key={key++} className="mention-chip">@{earliest.label}</span>
    );
    rest = rest.slice(earliest.idx + earliest.label.length + 1);
  }
  return <>{parts}</>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PromptNode({ id, data, selected }: NodeProps<PromptNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const addNode = useWorkflowStore((s) => s.addNode);
  const insertEdge = useWorkflowStore((s) => s.insertEdge);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const textZoneRef = useRef<HTMLDivElement>(null);
  // Desired cursor position after a programmatic text change (insertion / deletion)
  const pendingCursorRef = useRef<number | null>(null);
  const selectedRef = useRef(selected);
  const prevSelectedRef = useRef(selected);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hasScrollTop, setHasScrollTop] = useState(false);
  const [hasScrollBottom, setHasScrollBottom] = useState(false);

  const [chipPopover, setChipPopover] = useState<{
    label: string; preview: MentionPreview;
  } | null>(null);
  const [popoverIn, setPopoverIn] = useState(false);
  const popoverHideTimer = useRef<ReturnType<typeof setTimeout>>();
  const popoverRaf = useRef<number>();
  const chipElementRef = useRef<HTMLElement | null>(null);  // the live chip DOM node
  const popoverPosRef = useRef<HTMLDivElement | null>(null); // outer positioning div
  const scaleWrapperRef = useRef<HTMLDivElement | null>(null);

  // ── Expand modal ──────────────────────────────────────────────────────────
  const [expandOpen, setExpandOpen] = useState(false);
  const [expandMentionQuery, setExpandMentionQuery] = useState<string | null>(null);
  const [expandSelectedIdx, setExpandSelectedIdx] = useState(0);
  const modalTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const modalHighlightRef = useRef<HTMLDivElement | null>(null);
  const modalPendingCursor = useRef<number | null>(null);

  selectedRef.current = selected;

  // Instant handle hide on deselect
  useEffect(() => {
    const was = prevSelectedRef.current;
    prevSelectedRef.current = selected;
    if (was && !selected && cardRef.current) {
      const el = cardRef.current;
      el.classList.add("handles-no-delay");
      const t = setTimeout(() => el.classList.remove("handles-no-delay"), 200);
      return () => { clearTimeout(t); el.classList.remove("handles-no-delay"); };
    }
  }, [selected]);

  const { zoom } = useViewport();
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  const sourceConnected = edges.some((e) => e.source === id);

  // Derive prompt character limit from the connected downstream node's model
  const promptMaxLength: number | null = (() => {
    const target = edges
      .filter((e) => e.source === id)
      .map((e) => nodes.find((n) => n.id === e.target))
      .find((n) => n?.type === "generateNode" || n?.type === "videoGeneratorNode");
    if (!target) return null;
    if (target.type === "generateNode") {
      const m = IMAGE_MODELS.find((m) => m.id === ((target.data?.model as string) ?? "nano-banana-2"));
      if (!m) return null;
      const hasImages = edges.some((e) => e.target === target.id && e.targetHandle === "image");
      if (!hasImages && m.textOnlyPromptMaxLength) return m.textOnlyPromptMaxLength;
      return m.apiInput.promptMaxLength;
    }
    const m = VIDEO_MODELS.find((m) => m.id === ((target.data?.videoModel as string) ?? "kling-3.0"));
    return m?.apiInput.promptMaxLength ?? null;
  })();

  const storePrompt = (data.prompt as string) ?? "";
  const hasError = !!data.hasError;
  const overLimit = promptMaxLength !== null && storePrompt.length > promptMaxLength;

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
    ta.selectionEnd = pos;
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
    mentionableNodes.map((n) => {
      const captured = n.data.capturedFrameUrl as string | undefined;
      return [
        n.data.label as string,
        n.type === "videoInputNode"
          ? { imageUrl: captured, videoUrl: captured ? undefined : n.data.videoUrl as string | undefined }
          : { imageUrl: (n.data.r2Url ?? n.data.inputImage ?? n.data.imageUrl) as string | undefined, videoUrl: n.data.videoUrl as string | undefined },
      ];
    })
  );
  const mentionPreviewsRef = useRef(mentionPreviews);
  mentionPreviewsRef.current = mentionPreviews;

  const filteredMentions =
    mentionQuery !== null
      ? mentionableNodes.filter((n) =>
        (n.data.label as string)?.toLowerCase().includes(mentionQuery.toLowerCase())
      )
      : mentionableNodes;

  const expandFilteredMentions =
    expandMentionQuery !== null
      ? mentionableNodes.filter((n) =>
        (n.data.label as string)?.toLowerCase().includes(expandMentionQuery.toLowerCase())
      )
      : mentionableNodes;

  useEffect(() => { setSelectedIdx(0); }, [filteredMentions.length]);
  useEffect(() => { setExpandSelectedIdx(0); }, [expandFilteredMentions.length]);

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

  // ── Chip hover popover ────────────────────────────────────────────────────
  const currentChipLabel = useRef<string | null>(null);

  const openChipPopover = useCallback((el: HTMLElement) => {
    const label = (el.textContent ?? "").replace(/^@/, "");
    // Already showing this chip — just cancel any pending close
    if (currentChipLabel.current === label) {
      clearTimeout(popoverHideTimer.current);
      chipElementRef.current = el; // keep ref fresh
      return;
    }
    const preview = mentionPreviewsRef.current.get(label);
    if (!preview?.imageUrl && !preview?.videoUrl) return;
    clearTimeout(popoverHideTimer.current);
    cancelAnimationFrame(popoverRaf.current ?? 0);
    currentChipLabel.current = label;
    chipElementRef.current = el;
    setChipPopover({ label, preview });
    popoverRaf.current = requestAnimationFrame(() => setPopoverIn(true));
  }, []);

  const closeChipPopover = useCallback(() => {
    cancelAnimationFrame(popoverRaf.current ?? 0);
    currentChipLabel.current = null;
    setPopoverIn(false);
    popoverHideTimer.current = setTimeout(() => setChipPopover(null), 180);
  }, []);

  useEffect(() => () => {
    clearTimeout(popoverHideTimer.current);
    cancelAnimationFrame(popoverRaf.current ?? 0);
  }, []);

  // Continuously lock the popover to the chip's live viewport position.
  // Direct DOM writes avoid React re-renders; runs only while a chip is shown.
  useEffect(() => {
    if (!chipPopover) return;
    let rafId: number;
    const tick = () => {
      const el = chipElementRef.current;
      const div = popoverPosRef.current;
      if (el && div) {
        const r = el.getBoundingClientRect();
        const z = zoomRef.current;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const GAP = 10;
        const MARGIN = 8;

        // Visual size: layout dimensions × zoom (scale() doesn't affect offsetWidth/Height)
        const popW = div.offsetWidth * z;
        const popH = div.offsetHeight * z;

        // Prefer above the chip; fall back to below if it would clip the top
        const showBelow = r.top - GAP - popH < MARGIN;
        let top = showBelow ? r.bottom + GAP : r.top - GAP;

        // Clamp to bottom of viewport when showing below
        if (showBelow && top + popH > vh - MARGIN) top = vh - MARGIN - popH;

        // Center on chip horizontally, then clamp to viewport edges
        let left = r.left + r.width / 2;
        const halfW = popW / 2;
        if (left - halfW < MARGIN) left = MARGIN + halfW;
        else if (left + halfW > vw - MARGIN) left = vw - MARGIN - halfW;

        div.style.left = `${left}px`;
        div.style.top = `${top}px`;
        div.style.transform = `translateX(-50%) translateY(${showBelow ? "0%" : "-100%"})`;
        const origin = showBelow ? "top center" : "bottom center";
        if (scaleWrapperRef.current) scaleWrapperRef.current.style.transformOrigin = origin;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [chipPopover?.label]);

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
    const onMouseMove = (e: MouseEvent) => {
      const chips = highlightRef.current?.querySelectorAll<HTMLElement>(".mention-chip");
      if (chips?.length) {
        for (const chip of Array.from(chips)) {
          const r = chip.getBoundingClientRect();
          if (e.clientX >= r.left && e.clientX <= r.right &&
            e.clientY >= r.top && e.clientY <= r.bottom) {
            openChipPopover(chip);
            return;
          }
        }
      }
      if (currentChipLabel.current) closeChipPopover();
    };
    const onMouseLeave = () => closeChipPopover();

    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("wheel", onWheel);
    el.addEventListener("mousemove", onMouseMove);
    el.addEventListener("mouseleave", onMouseLeave);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousemove", onMouseMove);
      el.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [openChipPopover, closeChipPopover]);

  // ── onChange — textarea is uncontrolled; React never writes .value ────────
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
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
      const text = ta.value;
      const cursor = ta.selectionStart ?? text.length;
      const before = text.slice(0, cursor);
      const after = text.slice(cursor);
      const lastAt = before.lastIndexOf("@");
      const newText = `${before.slice(0, lastAt)}@${label} ${after}`;
      const newPos = lastAt + label.length + 2;

      // Update textarea value directly (uncontrolled); set cursor immediately before paint
      ta.value = newText;
      ta.focus();
      ta.selectionStart = newPos;
      ta.selectionEnd = newPos;
      setLocalText(newText);
      pendingCursorRef.current = newPos;
      updateNodeData(id, { prompt: newText });
      setMentionQuery(null);
    },
    [id, updateNodeData]
  );

  const menuOpen = mentionQuery !== null && filteredMentions.length > 0;
  const expandMenuOpen = expandMentionQuery !== null && expandFilteredMentions.length > 0;

  // Sync modal textarea value + cursor after programmatic edits inside the modal
  useLayoutEffect(() => {
    const pos = modalPendingCursor.current;
    if (pos === null) return;
    modalPendingCursor.current = null;
    const ta = modalTextareaRef.current;
    if (!ta) return;
    ta.selectionStart = pos;
    ta.selectionEnd = pos;
  });

  // When modal opens, seed & focus its textarea
  useEffect(() => {
    if (!expandOpen) return;
    requestAnimationFrame(() => {
      const ta = modalTextareaRef.current;
      if (!ta) return;
      ta.value = (data.prompt as string) ?? "";
      ta.focus();
      ta.selectionStart = ta.value.length;
      ta.selectionEnd = ta.value.length;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandOpen]);

  // Sync modal highlight scroll
  const syncModalScroll = useCallback(() => {
    if (modalHighlightRef.current && modalTextareaRef.current)
      modalHighlightRef.current.scrollTop = modalTextareaRef.current.scrollTop;
  }, []);

  const handleModalChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    const cursor = e.target.selectionStart ?? text.length;
    setLocalText(text);
    updateNodeData(id, { prompt: text, hasError: false });
    const query = getMentionQuery(text, cursor);
    setExpandMentionQuery(query);
    if (query !== null) setExpandSelectedIdx(0);
  }, [id, updateNodeData]);

  const insertMentionModal = useCallback((label: string) => {
    const ta = modalTextareaRef.current;
    if (!ta) return;
    const text = ta.value;
    const cursor = ta.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const lastAt = before.lastIndexOf("@");
    const newText = `${before.slice(0, lastAt)}@${label} ${after}`;
    const newPos = lastAt + label.length + 2;
    ta.value = newText;
    ta.focus();
    setLocalText(newText);
    modalPendingCursor.current = newPos;
    updateNodeData(id, { prompt: newText });
    setExpandMentionQuery(null);
  }, [id, updateNodeData]);

  const handleDelete = useCallback(() => {
    onNodesChange([{ type: "remove", id }]);
  }, [id, onNodesChange]);

  // Delete node with Del key when selected but textarea is not focused
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = document.activeElement;
      if (active === textareaRef.current || active === modalTextareaRef.current) return;
      if ((active as HTMLElement)?.isContentEditable) return;
      handleDelete();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, handleDelete]);

  const handleDuplicate = useCallback(() => {
    const state = useWorkflowStore.getState();
    const src = state.nodes.find((n) => n.id === id);
    if (!src) return;
    const newId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    onNodesChange([{ type: "select", id, selected: false }]);
    addNode({
      ...src,
      id: newId,
      position: { x: src.position.x + 20, y: src.position.y + 20 },
      selected: true,
      data: { ...src.data },
    });
    state.edges
      .filter((e) => e.source === id || e.target === id)
      .forEach((e) => insertEdge({
        ...e,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        source: e.source === id ? newId : e.source,
        target: e.target === id ? newId : e.target,
      }));
  }, [id, addNode, insertEdge, onNodesChange]);

  const handleCopyToClipboard = useCallback(() => {
    const text = (data.prompt as string) ?? "";
    navigator.clipboard.writeText(text).catch(() => { });
  }, [data.prompt]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div
        ref={cardRef}
        className={`node-card w-full h-full flex flex-col${hasError ? " node-error-blink" : ""}${overLimit ? " node-over-limit" : ""}`}
        style={{ minWidth: 260 }}
        onAnimationEnd={() => updateNodeData(id, { hasError: false })}
      >
        <CornerResizer minWidth={200} minHeight={80} />
        <span className="node-above-label">{data.label as string}</span>

        {/* ── Action bar — shown when selected ─────────────────────────────── */}
        <div
          className="absolute z-50 flex items-center gap-0.5 px-1.5 py-1"
          style={{
            bottom: "calc(100% + 28px)", left: "50%",
            borderRadius: 999,
            background: "rgba(16,16,16,0.96)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.07)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.65), 0 1px 4px rgba(0,0,0,0.4)",
            transform: `translateX(-50%) translateY(${selected ? "0px" : "6px"})`,
            opacity: selected ? 1 : 0,
            transition: "opacity 180ms ease, transform 180ms ease",
            pointerEvents: selected ? "auto" : "none",
            whiteSpace: "nowrap",
          }}
        >
          {/* Copy to clipboard */}
          <button onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleCopyToClipboard(); }} title="Copy prompt text"
            className="w-7 h-7 flex items-center justify-center rounded-full text-[#777] hover:text-white hover:bg-white/10 transition-colors duration-150">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
          </button>
          <span className="w-px h-4 bg-white/[0.08] mx-0.5 shrink-0" />
          {/* Duplicate */}
          <button onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleDuplicate(); }} title="Duplicate node"
            className="w-7 h-7 flex items-center justify-center rounded-full text-[#777] hover:text-white hover:bg-white/10 transition-colors duration-150">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          {/* Expand */}
          <button onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setExpandOpen(true); }} title="Expand editor"
            className="w-7 h-7 flex items-center justify-center rounded-full text-[#777] hover:text-white hover:bg-white/10 transition-colors duration-150">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
          <span className="w-px h-4 bg-white/[0.08] mx-0.5 shrink-0" />
          {/* Delete */}
          <button onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleDelete(); }} title="Delete node"
            className="w-7 h-7 flex items-center justify-center rounded-full text-[#777] hover:text-red-400 hover:bg-red-400/10 transition-colors duration-150">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
            </svg>
          </button>
        </div>

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
              className="absolute inset-0 px-3 pt-2.5 pb-8 text-[13px] text-white leading-[1.6] pointer-events-none whitespace-pre-wrap break-words overflow-hidden select-none"
            >
              {promptMaxLength !== null && localText.length > promptMaxLength ? (
                <>
                  {renderWithMentions(localText.slice(0, promptMaxLength), knownLabels)}
                  <span style={{ background: "rgba(239,68,68,0.22)", color: "#f87171", borderRadius: 2 }}>
                    {localText.slice(promptMaxLength)}
                  </span>
                </>
              ) : renderWithMentions(localText, knownLabels)}
              {"\u200b"}
            </div>

            {/* Placeholder */}
            {!localText && (
              <div
                aria-hidden
                className="absolute inset-0 px-3 pt-2.5 pb-8 text-[13px] text-[#444444] leading-[1.6] pointer-events-none select-none"
              >
                Describe what you want to generate…
              </div>
            )}

            {/* Editable textarea — UNCONTROLLED (no value= prop).
            React never writes .value, so cursor position is never reset. */}
            <textarea
              ref={textareaRef}
              className="relative w-full h-full px-3 pt-2.5 pb-8 bg-transparent text-[13px] leading-[1.6] resize-none outline-none overflow-y-auto z-10"
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
                  const text = ta.value; // source of truth
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

            {/* Character count */}
            {promptMaxLength !== null && (
              <div
                aria-hidden
                className="absolute bottom-1.5 right-2 pointer-events-none select-none z-30 tabular-nums px-1.5 py-0.5 rounded-full"
                style={{
                  fontSize: 9,
                  lineHeight: 1,
                  color: localText.length > promptMaxLength ? "#f87171" : "#fff",
                  background: localText.length > promptMaxLength ? "#2a1010" : "#1a1a1a",
                }}
              >
                {localText.length.toLocaleString()}/{promptMaxLength.toLocaleString()}
              </div>
            )}
          </div>
        </div>

        <Handle
          type="source"
          position={Position.Right}
          style={{ top: 20 }}
          className={`node-handle-icon node-handle-icon-out-text${sourceConnected ? " node-handle-connected" : ""}`}
          title="Text output"
        >
          <TextOutIcon />
        </Handle>

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
              const label = n.data.label as string;
              const captured = n.data.capturedFrameUrl as string | undefined;
              const imageUrl = n.type === "videoInputNode"
                ? captured
                : (n.data.r2Url ?? n.data.inputImage ?? n.data.imageUrl) as string | undefined;
              const videoUrl = n.type === "videoInputNode"
                ? (captured ? undefined : n.data.videoUrl as string | undefined)
                : n.data.videoUrl as string | undefined;
              const active = idx === selectedIdx;

              return (
                <button
                  key={n.id}
                  onClick={() => insertMention(label)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors ${active ? "bg-[#1A2010]" : "hover:bg-[#161A1E]"
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
                  <span className={`text-[11px] font-medium truncate ${active ? "text-[#ff3df5]" : "text-[#CCCCCC]"}`}>
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

      {/* ── Expand modal ─────────────────────────────────────────────────── */}
      {expandOpen && createPortal(
        <div className="fixed inset-0 z-[9998] flex items-center justify-center p-6">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            style={{ backdropFilter: "blur(4px)" }}
            onClick={() => { setExpandOpen(false); setExpandMentionQuery(null); }}
          />
          {/* Panel */}
          <div
            className="relative z-10 flex flex-col rounded-xl border border-white/[0.08]"
            style={{ width: "min(760px, 100%)", height: "min(520px, 100%)", background: "#0D1012", boxShadow: "0 24px 80px rgba(0,0,0,0.8)" }}
            onKeyDown={(e) => { if (e.key === "Escape") { setExpandOpen(false); setExpandMentionQuery(null); } }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
              <span className="text-[11px] text-[#555] uppercase tracking-widest font-medium">{data.label as string}</span>
              <button
                onClick={() => { setExpandOpen(false); setExpandMentionQuery(null); }}
                className="w-6 h-6 flex items-center justify-center rounded text-[#555] hover:text-white hover:bg-white/10 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            {/* Text editor zone */}
            <div className="relative flex-1 min-h-0">
              {/* Highlight overlay */}
              <div
                ref={modalHighlightRef}
                aria-hidden
                className="absolute inset-0 px-4 pt-3 pb-4 text-[14px] text-white leading-[1.7] pointer-events-none whitespace-pre-wrap break-words overflow-hidden select-none"
              >
                {renderWithMentions(localText, knownLabels)}
                {"\u200b"}
              </div>
              {/* Placeholder */}
              {!localText && (
                <div aria-hidden className="absolute inset-0 px-4 pt-3 pb-4 text-[14px] text-[#444] leading-[1.7] pointer-events-none select-none">
                  Describe what you want to generate…
                </div>
              )}
              {/* Textarea */}
              <textarea
                ref={modalTextareaRef}
                className="relative w-full h-full px-4 pt-3 pb-4 bg-transparent text-[14px] leading-[1.7] resize-none outline-none overflow-y-auto"
                style={{ color: "transparent", caretColor: "white", overscrollBehavior: "contain" }}
                onChange={handleModalChange}
                onScroll={syncModalScroll}
                onKeyDown={(e) => {
                  const ta = modalTextareaRef.current;
                  // Atomic mention deletion
                  if ((e.key === "Backspace" || e.key === "Delete") && ta && ta.selectionStart === ta.selectionEnd) {
                    const cursor = ta.selectionStart ?? 0;
                    const text = ta.value;
                    for (const label of knownLabels) {
                      const mention = `@${label}`;
                      let pos = 0;
                      while (pos < text.length) {
                        const idx = text.indexOf(mention, pos);
                        if (idx === -1) break;
                        const end = idx + mention.length;
                        const hit = e.key === "Backspace" ? cursor > idx && cursor <= end : cursor >= idx && cursor < end;
                        if (hit) {
                          e.preventDefault();
                          const newText = text.slice(0, idx) + text.slice(end);
                          ta.value = newText;
                          setLocalText(newText);
                          modalPendingCursor.current = idx;
                          updateNodeData(id, { prompt: newText });
                          return;
                        }
                        pos = idx + 1;
                      }
                    }
                  }
                  if (e.key === "Escape") { setExpandOpen(false); setExpandMentionQuery(null); return; }
                  if (!expandMenuOpen) return;
                  if (e.key === "ArrowDown") { e.preventDefault(); setExpandSelectedIdx((i) => (i + 1) % filteredMentions.length); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setExpandSelectedIdx((i) => (i - 1 + filteredMentions.length) % filteredMentions.length); }
                  else if (e.key === "Enter") { e.preventDefault(); insertMentionModal(expandFilteredMentions[expandSelectedIdx].data.label as string); }
                }}
              />
            </div>

            {/* @mention menu */}
            {expandMenuOpen && (
              <div
                className="shrink-0 border-t border-[#1E1E1E] bg-[#0F1214] overflow-y-auto"
                style={{ maxHeight: 160 }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <div className="px-3 py-1.5 border-b border-[#1A1A1A]">
                  <p className="text-[9px] text-[#4A4A45] uppercase tracking-widest">Connected nodes</p>
                </div>
                {expandFilteredMentions.map((n, idx) => {
                  const label = n.data.label as string;
                  const captured = n.data.capturedFrameUrl as string | undefined;
                  const imageUrl = n.type === "videoInputNode"
                    ? captured
                    : (n.data.r2Url ?? n.data.inputImage ?? n.data.imageUrl) as string | undefined;
                  const videoUrl = n.type === "videoInputNode"
                    ? (captured ? undefined : n.data.videoUrl as string | undefined)
                    : n.data.videoUrl as string | undefined;
                  const active = idx === expandSelectedIdx;
                  return (
                    <button key={n.id} onClick={() => insertMentionModal(label)}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${active ? "bg-[#1A2010]" : "hover:bg-[#161A1E]"}`}>
                      <div className="w-5 h-5 rounded bg-[#1A1A1A] overflow-hidden shrink-0 flex items-center justify-center">
                        {imageUrl ? <img src={imageUrl} alt="" className="w-full h-full object-cover" /> :
                          videoUrl ? <video src={videoUrl} autoPlay loop muted playsInline className="w-full h-full" style={{ objectFit: "cover" }} /> :
                            <EmptyThumb />}
                      </div>
                      <span className={`text-[11px] font-medium truncate ${active ? "text-[#ff3df5]" : "text-[#CCC]"}`}>@{label}</span>
                      {active && <span className="ml-auto text-[9px] text-[#4A4A45] shrink-0">↵</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* ── Chip hover popover — portal outside ReactFlow transforms ─────── */}
      {chipPopover && createPortal(
        <div
          ref={popoverPosRef}
          aria-hidden
          style={{
            position: "fixed",
            left: 0, top: 0,          // set each frame by the rAF loop
            transform: "translateX(-50%) translateY(-100%)",
            zIndex: 9999,
            pointerEvents: "none",
          }}
        >
          {/* Scale with canvas zoom — no transition so it tracks zoom instantly */}
          <div ref={scaleWrapperRef} style={{ transform: `scale(${zoom})`, transformOrigin: "bottom center" }}>
            <div
              style={{
                opacity: popoverIn ? 1 : 0,
                transform: popoverIn ? "translateY(0px) scale(1)" : "translateY(14px) scale(0.88)",
                transition: popoverIn
                  ? "opacity 220ms cubic-bezier(0.16,1,0.3,1), transform 280ms cubic-bezier(0.16,1,0.3,1)"
                  : "opacity 150ms ease, transform 150ms ease",
                transformOrigin: "bottom center",
                background: "#16191C",
                borderRadius: 8,
                overflow: "hidden",
                boxShadow: "0 12px 40px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)",
                maxWidth: 140,
                minHeight: 80,
              }}
            >
              {chipPopover.preview.videoUrl ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  src={chipPopover.preview.videoUrl}
                  autoPlay loop muted playsInline
                  style={{ display: "block", width: "100%", height: "auto" }}
                />
              ) : chipPopover.preview.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={chipPopover.preview.imageUrl}
                  alt=""
                  style={{ display: "block", width: "100%", height: "auto" }}
                />
              ) : null}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
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

function TextOutIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="white">
      <path d="M1.5 2h11v2H8.5v8H5.5V4H1.5V2z" />
    </svg>
  );
}
