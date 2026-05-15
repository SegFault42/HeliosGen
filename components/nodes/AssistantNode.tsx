"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import GenerateButton from "@/components/nodes/GenerateButton";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { useAnimatedPopup } from "@/lib/useAnimatedPopup";
import CornerResizer from "./CornerResizer";
import { createClient } from "@/lib/supabase/client";
import { useGeneratingBorderAnimation } from "@/lib/useGeneratingBorderAnimation";

type AssistantNodeType = Node<NodeData, "assistantNode">;

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

export default function AssistantNode({ id, data, selected }: NodeProps<AssistantNodeType>) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const addNode = useWorkflowStore((s) => s.addNode);
  const insertEdge = useWorkflowStore((s) => s.insertEdge);
  const edges = useWorkflowStore((s) => s.edges);

  const cardRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const prevSelectedRef = useRef(selected);
  const abortRef = useRef<AbortController | null>(null);
  const selectedRef = useRef(selected);
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

  const status = (data.status as string) ?? "idle";
  const outputText = (data.outputText as string) ?? "";
  const localPrompt = (data.localPrompt as string) ?? "";
  const model = (data.model as string) ?? "claude-sonnet-4-6";

  const [viewMode, setViewMode] = useState<"input" | "output">("input");
  const [loading, setLoading] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const modelPopup = useAnimatedPopup(modelOpen);
  const modelBarRef = useRef<HTMLDivElement>(null);

  // ── Elevate the RF node z-index while the menu is open ───────────────────
  useEffect(() => {
    const rfNode = cardRef.current?.closest<HTMLElement>(".react-flow__node");
    if (!rfNode) return;
    if (modelOpen) {
      rfNode.style.zIndex = "10000";
    } else {
      rfNode.style.zIndex = "";
    }
    return () => { rfNode.style.zIndex = ""; };
  }, [modelOpen]);

  useEffect(() => {
    if (!modelOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelBarRef.current && !modelBarRef.current.contains(e.target as unknown as globalThis.Node)) {
        setModelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelOpen]);

  const busy = loading || status === "running";

  useGeneratingBorderAnimation(cardRef, busy);

  const hasOutput = !!outputText;
  const hasPrompt = !!localPrompt.trim();
  const sourceConnected = edges.some((e) => e.source === id);

  // Auto-switch to output as soon as generation starts (or finishes)
  useEffect(() => {
    if (status === "running" || (status === "done" && outputText)) {
      setViewMode("output");
    }
  }, [status, outputText]);

  // Keep textarea in sync with store
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta && ta.value !== localPrompt) ta.value = localPrompt;
  }, [localPrompt]);


  const handleDelete = useCallback(() => {
    onNodesChange([{ type: "remove", id }]);
  }, [id, onNodesChange]);

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
      data: { ...src.data, status: "idle" as const, outputText: undefined },
    });
    state.edges
      .filter((e) => (e.source === id || e.target === id) && e.deletable !== false)
      .forEach((e) => insertEdge({
        ...e,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        source: e.source === id ? newId : e.source,
        target: e.target === id ? newId : e.target,
      }));
  }, [id, addNode, insertEdge, onNodesChange]);

  const handleGenerate = useCallback(async () => {
    if (busy || !hasPrompt) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    updateNodeData(id, { status: "running", outputText: "", errorMsg: undefined });

    try {
      const { data: { session } } = await createClient().auth.getSession();
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          prompt: localPrompt,
          model,
          systemPrompt:
            "You are a senior prompt engineer specializing in optimizing prompts for clarity, precision, and effectiveness. Your task is to take an existing user prompt and rewrite it to improve its structure, specificity, and performance for an AI model. Preserve the original intent while enhancing wording, removing ambiguity, and adding useful detail where appropriate. Do not change the task itself. Output only the improved prompt. Do not include any explanations, comments, formatting markers, or quotation marks.",
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Generation failed" }));
        throw new Error(err.error ?? "Generation failed");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break outer;
          try {
            const parsed = JSON.parse(payload);
            // Anthropic streaming: content_block_delta with text_delta type
            if (
              parsed.type === "content_block_delta" &&
              parsed.delta?.type === "text_delta"
            ) {
              const delta = parsed.delta.text ?? "";
              if (delta) {
                accumulated += delta;
                updateNodeData(id, { outputText: accumulated });
              }
            }
          } catch { /* skip malformed SSE lines */ }
        }
      }

      updateNodeData(id, { status: "done", outputText: accumulated });
    } catch (e: unknown) {
      if ((e as Error)?.name === "AbortError") {
        updateNodeData(id, { status: "idle" });
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        updateNodeData(id, { status: "error", errorMsg: msg });
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [busy, hasPrompt, localPrompt, id, updateNodeData]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    updateNodeData(id, { status: "idle" });
  }, [id, updateNodeData]);

  return (
    <div
      ref={cardRef}
      className={`node-card w-full h-full flex flex-col${busy ? " node-generating" : ""}`}
      style={{ minWidth: 260 }}
    >
      <CornerResizer minWidth={200} minHeight={120} />

      <span className="node-above-label">{data.label as string}</span>

      {/* ── Action bar ─────────────────────────────────────────────────── */}
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
        <button onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleDuplicate(); }} title="Duplicate node"
          className="w-7 h-7 flex items-center justify-center rounded-full text-[#777] hover:text-white hover:bg-white/10 transition-colors duration-150">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        <span className="w-px h-4 bg-white/[0.08] mx-0.5 shrink-0" />
        <button onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleDelete(); }} title="Delete node"
          className="w-7 h-7 flex items-center justify-center rounded-full text-[#777] hover:text-red-400 hover:bg-red-400/10 transition-colors duration-150">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
          </svg>
        </button>
      </div>

      {/* ── Toggle switch — absolute on card, truly top-left ───────────── */}
      <div
        className="absolute top-1.5 left-1.5 z-30 flex items-center p-1 rounded-full gap-0.5"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Sliding indicator */}
        <div style={{
          position: "absolute",
          top: 4, left: 4,
          width: 28, height: 28,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.18)",
          border: "1.5px solid rgba(255,255,255,0.45)",
          transform: `translateX(${viewMode === "output" ? 30 : 0}px)`,
          transition: "transform 220ms cubic-bezier(0.34,1.56,0.64,1)",
          pointerEvents: "none",
          zIndex: 20,
        }} />

        {/* Input — text lines icon */}
        <button
          onClick={(e) => { e.stopPropagation(); setViewMode("input"); }}
          className="w-7 h-7 rounded-full flex items-center justify-center relative z-10"
          title="Show input"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            style={{ color: viewMode === "input" ? "white" : "rgba(255,255,255,0.35)", transition: "color 220ms" }}>
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="15" y2="18" />
          </svg>
        </button>

        {/* Output — text lines + sparkle icon; disabled until output exists */}
        <button
          onClick={(e) => { e.stopPropagation(); if (hasOutput) setViewMode("output"); }}
          disabled={!hasOutput}
          className="w-7 h-7 rounded-full flex items-center justify-center relative z-10 disabled:cursor-not-allowed"
          title={hasOutput ? "Show output" : "Generate first to see output"}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" strokeLinecap="round"
            style={{
              color: !hasOutput ? "rgba(255,255,255,0.18)" : viewMode === "output" ? "white" : "rgba(255,255,255,0.35)",
              transition: "color 220ms",
            }}>
            <line x1="3" y1="8" x2="16" y2="8" stroke="currentColor" strokeWidth="2" />
            <line x1="3" y1="13" x2="13" y2="13" stroke="currentColor" strokeWidth="2" />
            {/* Sparkle */}
            <path d="M19 2 L19.7 4.3 L22 5 L19.7 5.7 L19 8 L18.3 5.7 L16 5 L18.3 4.3 Z"
              fill="currentColor" stroke="none" />
            <path d="M21 13 L21.4 14.4 L23 15 L21.4 15.6 L21 17 L20.6 15.6 L19 15 L20.6 14.4 Z"
              fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex-1 p-2.5 min-h-0">
        <div className="relative h-full rounded-[7px] overflow-hidden">

          {/* Output display — nowheel tells React Flow to skip its scroll-to-pan handler */}
          <div
            ref={outputRef}
            className="nowheel absolute inset-0 px-3 pt-10 pb-10 text-[13px] text-white leading-[1.6] overflow-y-auto select-text"
            style={{ whiteSpace: "pre-wrap", overscrollBehavior: "contain", display: viewMode === "output" ? undefined : "none" }}
            onMouseDown={(e) => { if (selected) e.stopPropagation(); }}
          >
            {outputText}
            {busy && (
              <span className="inline-flex items-center gap-0.5 ml-1 align-middle">
                {[0, 120, 240].map((d) => (
                  <span key={d} className="w-[3px] h-[3px] rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                ))}
              </span>
            )}
          </div>

          {/* Editable textarea — input mode */}
          {viewMode === "input" && (
            <>
              {!localPrompt && (
                <div
                  aria-hidden
                  className="absolute inset-0 px-3 pt-10 pb-10 text-[13px] text-[#3A4055] leading-[1.6] pointer-events-none select-none"
                >
                  Describe what you want to generate…
                </div>
              )}
              <textarea
                ref={textareaRef}
                className="relative w-full h-full px-3 pt-10 pb-10 bg-transparent text-[13px] text-white leading-[1.6] resize-none outline-none overflow-y-auto z-10"
                style={{ caretColor: "white", overscrollBehavior: "contain" }}
                defaultValue={localPrompt}
                onChange={(e) => updateNodeData(id, { localPrompt: e.target.value })}
                onMouseDown={(e) => { if (selected) e.stopPropagation(); else e.preventDefault(); }}
              />
            </>
          )}

          {/* Error */}
          {status === "error" && (
            <div className="absolute inset-x-0 bottom-12 flex justify-center pointer-events-none">
              <span className="text-[10px] text-red-400 px-2 py-0.5 rounded bg-red-900/30">
                {(data.errorMsg as string) ?? "Generation failed"}
              </span>
            </div>
          )}

          {/* ── Bottom controls ────────────────────────────────────────── */}
          <div
            ref={modelBarRef}
            className="absolute bottom-0 inset-x-0 px-2.5 pb-1.5 pt-1 flex items-center justify-between z-[1001]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Model dropdown */}
            <div className="relative">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); if (!busy) setModelOpen((o) => !o); }}
                className="flex items-center gap-1"
              >
                <span className="text-[11px] text-[#A0A0A0] hover:text-white transition-colors">
                  {MODELS.find((m) => m.id === model)?.label ?? model}
                </span>
                <ChevronIcon open={modelOpen} />
              </button>

              {modelPopup.visible && (
                <div className={`absolute bottom-full left-0 mb-2 w-44 bg-[#111622] border border-[#1E2840] rounded-md overflow-hidden z-[1002] shadow-2xl ${modelPopup.className}`}>
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); updateNodeData(id, { model: m.id }); setModelOpen(false); }}
                      className={`w-full text-left px-3 py-[7px] text-[11px] hover:bg-[#141C28] transition-colors ${model === m.id ? "text-white" : "text-[#A0A0A0]"}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Generate / Stop */}
            {busy ? (
              <button
                onClick={(e) => { e.stopPropagation(); handleCancel(); }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium hover:bg-white/5 transition-colors"
                style={{ border: "1px solid #333", color: "#888", background: "rgba(255,255,255,0.04)" }}
              >
                <svg width="7" height="7" viewBox="0 0 8 8" fill="currentColor"><rect width="8" height="8" rx="1.5" /></svg>
                Stop
              </button>
            ) : (
              <GenerateButton onClick={handleGenerate} disabled={!hasPrompt} />
            )}
          </div>
        </div>
      </div>

      {/* ── Assistant output handle ───────────────────────────────────── */}
      <Handle
        type="source"
        position={Position.Right}
        id="textOut"
        style={{ top: 20 }}
        className={`node-handle-icon node-handle-icon-out-text node-handle-icon-out-assistant${sourceConnected ? " node-handle-connected" : ""}`}
        title="Assistant output"
      >
        <BrainIcon />
      </Handle>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none"
      stroke="#5A5A55" strokeWidth="1.5" strokeLinecap="round"
      className={`shrink-0 transition-transform duration-100 ${open ? "rotate-180" : ""}`}
    >
      <path d="M1 2.5 4 5.5 7 2.5" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}
