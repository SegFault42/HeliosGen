"use client";

import React, { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useChatSessionStore, type StoredMessage, type ChatSession } from "@/lib/chatSessionStore";
import { MODEL_GROUPS, MODELS, type ModelId } from "@/lib/models";
import { getToken } from "@/lib/galleryUtils";
import { SYSTEM_PROMPT } from "@/lib/systemPrompt";
import { Bot, Send, ChevronUp, Copy, Check } from "lucide-react";
import { motion } from "motion/react";
import DotCanvasBackground from "@/components/ui/DotCanvasBackground";
import TypewriterHeading from "@/components/ui/TypewriterHeading";

// ── Logo ──────────────────────────────────────────────────────────────────────

function LogoIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="#2DD4BF" stroke="none">
      <path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z" />
    </svg>
  );
}

// ── Model picker ──────────────────────────────────────────────────────────────

function ModelPicker({
  model, onChange, direction = "up",
}: {
  model: ModelId;
  onChange: (id: ModelId) => void;
  direction?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, []);

  const current = MODELS.find(m => m.id === model);
  const dropPos = direction === "up"
    ? { bottom: "calc(100% + 6px)" }
    : { top: "calc(100% + 6px)" };

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: "5px",
          padding: "0 8px", height: "32px", borderRadius: "8px",
          background: open ? "rgba(255,255,255,0.09)" : "transparent",
          border: "1px solid transparent",
          color: "rgba(255,255,255,0.5)", fontSize: "12px",
          fontFamily: "inherit", cursor: "pointer",
          transition: "background 120ms, color 120ms", whiteSpace: "nowrap",
        }}
      >
        {current?.label}
        <ChevronUp
          size={12}
          style={{
            opacity: 0.5,
            transform: direction === "up"
              ? (open ? "rotate(180deg)" : "none")
              : (open ? "none" : "rotate(180deg)"),
            transition: "transform 120ms",
          }}
        />
      </button>
      {open && (
        <div style={{
          position: "absolute", right: 0, ...dropPos,
          minWidth: "180px", background: "rgba(14,16,18,0.98)",
          border: "1px solid rgba(255,255,255,0.1)", borderRadius: "12px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)", overflow: "hidden", zIndex: 100,
        }}>
          <div style={{ padding: "4px" }}>
            {MODEL_GROUPS.map((group, gi) => (
              <div key={group.label}>
                {gi > 0 && <div style={{ height: "1px", background: "rgba(255,255,255,0.07)", margin: "4px 0" }} />}
                <div style={{ padding: "4px 8px 2px", fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(255,255,255,0.25)" }}>
                  {group.label}
                </div>
                {group.models.map(m => (
                  <button
                    key={m.id}
                    onClick={() => { onChange(m.id); setOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      width: "100%", padding: "7px 8px", borderRadius: "7px", border: "none",
                      background: model === m.id ? "rgba(45,212,191,0.12)" : "transparent",
                      color: model === m.id ? "rgba(94,234,212,0.95)" : "rgba(255,255,255,0.7)",
                      fontSize: "13px", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
                      transition: "background 100ms",
                    }}
                    onMouseEnter={e => { if (model !== m.id) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
                    onMouseLeave={e => { if (model !== m.id) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                  >
                    <span>{m.label}</span>
                    <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", marginLeft: "8px" }}>{m.desc}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cycling placeholder ───────────────────────────────────────────────────────

const PLACEHOLDER_SENTENCES = [
  "Convert this prompt into a JSON prompt",
  "Improve this prompt by giving more camera details",
  "Generate a prompt to create an image of a girl holding a flower",
  "Make this prompt more cinematic and add lighting details",
  "Rewrite this prompt for a photorealistic style",
];

function useCyclingPlaceholder(paused: boolean) {
  const [text, setText] = useState("");
  const idx = useRef(0);
  const phase = useRef<"typing" | "waiting" | "deleting">("typing");
  const char = useRef(0);

  useEffect(() => {
    if (paused) return;

    let timeout: ReturnType<typeof setTimeout>;

    function tick() {
      const sentence = PLACEHOLDER_SENTENCES[idx.current];

      if (phase.current === "typing") {
        char.current++;
        setText(sentence.slice(0, char.current));
        if (char.current >= sentence.length) {
          phase.current = "waiting";
          timeout = setTimeout(tick, 2000);
        } else {
          timeout = setTimeout(tick, 42);
        }
      } else if (phase.current === "waiting") {
        phase.current = "deleting";
        timeout = setTimeout(tick, 40);
      } else {
        char.current--;
        setText(sentence.slice(0, char.current));
        if (char.current <= 0) {
          idx.current = (idx.current + 1) % PLACEHOLDER_SENTENCES.length;
          phase.current = "typing";
          timeout = setTimeout(tick, 300);
        } else {
          timeout = setTimeout(tick, 28);
        }
      }
    }

    timeout = setTimeout(tick, 400);
    return () => clearTimeout(timeout);
  }, [paused]);

  return text;
}

// ── Landing view (no active session) ─────────────────────────────────────────


function LandingView({
  onSubmit, model, onModelChange,
}: {
  onSubmit: (text: string) => void;
  model: ModelId;
  onModelChange: (id: ModelId) => void;
}) {
  const [input, setInput] = useState("");
  const [headingDone, setHeadingDone] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const animatedPlaceholder = useCyclingPlaceholder(!headingDone || input.length > 0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function submit(text: string) {
    const trimmed = text.trim();
    if (trimmed) onSubmit(trimmed);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); }
  }

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "0 24px 80px", position: "relative", overflow: "hidden",
    }}>
      <DotCanvasBackground />
      {/* Logo */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
      <LogoIcon size={48} />

      {/* Title */}
      <TypewriterHeading text="I'm here to help you make better prompts." onDone={() => setHeadingDone(true)} />
      <motion.p
        initial={{ filter: "blur(10px)", opacity: 0 }}
        animate={{ filter: "blur(0px)", opacity: 1 }}
        transition={{ duration: 1 }}
        style={{ color: "rgba(255,255,255,0.4)", fontSize: "15px", marginBottom: "40px", textAlign: "center" }}
      >
        Give me a prompt and I&apos;ll make it better.
      </motion.p>

      {/* Input + suggestions */}
      <div style={{ width: "100%", maxWidth: "680px" }}>
        {/* Input bar */}
        <div style={{
          display: "flex", alignItems: "center",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: "18px",
          padding: "10px 10px 10px 20px",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.03) inset",
          transition: "border-color 150ms",
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={input.length > 0 ? "" : animatedPlaceholder}
            rows={1}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              resize: "none", color: "rgba(255,255,255,0.88)", fontSize: "15px",
              fontFamily: "inherit", lineHeight: "24px", maxHeight: "120px",
              overflowY: "auto", padding: 0,
            }}
            onInput={e => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "12px", flexShrink: 0 }}>
            <ModelPicker model={model} onChange={onModelChange} direction="down" />
            <button
              onClick={() => submit(input)}
              disabled={!input.trim()}
              style={{
                width: "36px", height: "36px", borderRadius: "50%", border: "none",
                background: input.trim() ? "rgba(45,212,191,0.25)" : "rgba(255,255,255,0.07)",
                color: input.trim() ? "rgba(45,212,191,0.9)" : "rgba(255,255,255,0.25)",
                cursor: input.trim() ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, transition: "background 150ms, color 150ms",
              }}
            >
              <Send size={15} />
            </button>
          </div>
        </div>

      </div>
      </div>
    </div>
  );
}

// ── Chat window ───────────────────────────────────────────────────────────────

interface LiveMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

function ChatWindow({
  session, onUpdate, initialMessage, onInitialSent, defaultModel, onModelChange,
}: {
  session: ChatSession;
  onUpdate: (msgs: StoredMessage[], model: string) => void;
  initialMessage?: string | null;
  onInitialSent?: () => void;
  defaultModel?: string;
  onModelChange?: (id: ModelId) => void;
}) {
  // Pre-populate immediately when coming from LandingView so chat mode shows on first render
  const [messages, setMessages] = useState<LiveMessage[]>(() =>
    initialMessage
      ? [{ role: "user" as const, content: initialMessage }, { role: "assistant" as const, content: "", streaming: true }]
      : session.messages
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(!!initialMessage);
  const [model, setModel] = useState<ModelId>((session.model || defaultModel || "claude-sonnet-4-6") as ModelId);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  function handleModelChange(id: ModelId) { setModel(id); onModelChange?.(id); }
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // key={session.id} in parent ensures remount on session change — no reset effect needed

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (streaming) return;
    const stored = messages.filter(m => !m.streaming && m.content).map(m => ({ role: m.role, content: m.content }));
    if (stored.length > 0) onUpdate(stored, model);
  }, [streaming]);

  // Shared SSE fetch — called by both send() and the initialMessage effect
  const runStream = useCallback(async (
    apiMessages: { role: string; content: string }[],
    assistantIdx: number,
    signal: AbortSignal,
    currentModel: string,
  ) => {
    try {
      const token = await getToken();
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ model: currentModel, messages: apiMessages, stream: true }),
        signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => "Unknown error");
        setMessages(prev => prev.map((m, i) => i === assistantIdx ? { ...m, content: `Error: ${err}`, streaming: false } : m));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") continue;
          try {
            const parsed = JSON.parse(json);
            const chunk = (parsed.type === "content_block_delta" ? parsed.delta?.text : null)
              ?? parsed.choices?.[0]?.delta?.content ?? null;
            if (chunk) {
              accumulated += chunk;
              setMessages(prev => prev.map((m, i) => i === assistantIdx ? { ...m, content: accumulated } : m));
            }
          } catch { /* skip */ }
        }
      }
      setMessages(prev => prev.map((m, i) => i === assistantIdx ? { ...m, streaming: false } : m));
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        setMessages(prev => prev.map((m, i) => i === assistantIdx ? { ...m, content: "Request failed.", streaming: false } : m));
      }
    } finally {
      setStreaming(false);
    }
  }, []);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    const newMessages: LiveMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages([...newMessages, { role: "assistant", content: "", streaming: true }]);
    setInput("");
    setStreaming(true);
    const abort = new AbortController();
    abortRef.current = abort;
    const apiMessages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      ...newMessages.map(m => ({ role: m.role, content: m.content })),
    ];
    await runStream(apiMessages, newMessages.length, abort.signal, model);
  }, [messages, streaming, model, runStream]);

  // Fire API call for the pre-populated initial message
  const initialFired = useRef(false);
  useEffect(() => {
    if (!initialMessage || initialFired.current) return;
    initialFired.current = true;
    onInitialSent?.();
    const abort = new AbortController();
    abortRef.current = abort;
    runStream([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: initialMessage },
    ], 1, abort.signal, model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  // ── Empty state: centered welcome + input ──────────────────────────────────
  if (messages.length === 0 && !streaming) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 24px 80px", minWidth: 0 }}>
        <LogoIcon size={48} />
        <TypewriterHeading text="I'm here to help you make better prompts." />
        <div style={{ width: "100%", maxWidth: "680px" }}>
          <div style={{ display: "flex", alignItems: "center", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "18px", padding: "10px 10px 10px 20px", transition: "border-color 150ms" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Describe your image or video idea…"
              rows={1}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", resize: "none", color: "rgba(255,255,255,0.88)", fontSize: "15px", fontFamily: "inherit", lineHeight: "24px", maxHeight: "120px", overflowY: "auto", padding: 0 }}
              onInput={e => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "12px", flexShrink: 0 }}>
              <ModelPicker model={model} onChange={handleModelChange} direction="down" />
              <button onClick={() => send(input)} disabled={!input.trim()} style={{ width: "36px", height: "36px", borderRadius: "50%", border: "none", background: input.trim() ? "rgba(45,212,191,0.25)" : "rgba(255,255,255,0.07)", color: input.trim() ? "rgba(45,212,191,0.9)" : "rgba(255,255,255,0.25)", cursor: input.trim() ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 150ms, color 150ms" }}>
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
        <style>{`@keyframes chatDot { 0%,80%,100%{opacity:.3;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} } @keyframes cursorBlink { 0%,100%{opacity:.6} 50%{opacity:0} }`}</style>
      </div>
    );
  }

  // ── Normal chat layout ─────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
      {/* Header */}
      <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <h2 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#fff", letterSpacing: "-0.02em" }}>
          {session.title}
        </h2>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "72%" }}>
              <div style={{
                padding: "10px 14px",
                borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                background: m.role === "user" ? "rgba(45,212,191,0.15)" : "rgba(255,255,255,0.06)",
                border: m.role === "user" ? "1px solid rgba(45,212,191,0.25)" : "1px solid rgba(255,255,255,0.07)",
                fontSize: "14px", lineHeight: 1.6,
                color: m.role === "user" ? "#FFFFFF" : "rgba(255,255,255,0.88)",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {m.content}
                {m.streaming && !m.content && (
                  <span style={{ display: "inline-flex", gap: "3px", alignItems: "center" }}>
                    {[0, 1, 2].map(d => (
                      <span key={d} style={{ width: "4px", height: "4px", borderRadius: "50%", background: "rgba(255,255,255,0.4)", animation: `chatDot 1s ${d * 0.2}s infinite` }} />
                    ))}
                  </span>
                )}
              </div>
              {m.role === "assistant" && !m.streaming && m.content && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(m.content);
                    setCopiedIdx(i);
                    setTimeout(() => setCopiedIdx(null), 1500);
                  }}
                  title="Copy response"
                  style={{
                    marginTop: "4px",
                    display: "flex", alignItems: "center", gap: "4px",
                    padding: "3px 8px", borderRadius: "6px", border: "none",
                    background: "transparent", color: copiedIdx === i ? "rgba(45,212,191,0.8)" : "rgba(255,255,255,0.25)",
                    fontSize: "11px", fontFamily: "inherit", cursor: "pointer",
                    transition: "color 150ms, background 150ms",
                  }}
                  onMouseEnter={e => { if (copiedIdx !== i) (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.55)"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = copiedIdx === i ? "rgba(45,212,191,0.8)" : "rgba(255,255,255,0.25)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                >
                  {copiedIdx === i ? <Check size={11} /> : <Copy size={11} />}
                  {copiedIdx === i ? "Copied" : "Copy"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input bar */}
      <div style={{ padding: "16px", borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "12px",
          padding: "8px 8px 8px 14px",
          transition: "border-color 150ms",
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Send a message…"
            rows={1}
            disabled={streaming}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              resize: "none", color: "rgba(255,255,255,0.88)", fontSize: "14px",
              fontFamily: "inherit", lineHeight: "22px", maxHeight: "120px",
              overflowY: "auto", padding: 0,
            }}
            onInput={e => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "8px", flexShrink: 0 }}>
            <ModelPicker model={model} onChange={handleModelChange} />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || streaming}
              style={{
                width: "32px", height: "32px", borderRadius: "8px", border: "none",
                background: input.trim() && !streaming ? "rgba(45,212,191,0.25)" : "rgba(255,255,255,0.07)",
                color: input.trim() && !streaming ? "rgba(45,212,191,0.9)" : "rgba(255,255,255,0.25)",
                cursor: input.trim() && !streaming ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, transition: "background 150ms, color 150ms",
              }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes chatDot {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// ── Inner page (uses useSearchParams) ────────────────────────────────────────

function ChatInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id");

  const { sessions, createSession, upsertSession, preferredModel, setPreferredModel } = useChatSessionStore();
  const [hydrated, setHydrated] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [landingModel, setLandingModel] = useState<ModelId>("claude-sonnet-4-6");

  // Sync landingModel from store once hydrated
  useEffect(() => { if (hydrated) setLandingModel(preferredModel as ModelId); }, [hydrated]);

  useEffect(() => {
    const unsub = useChatSessionStore.persist.onFinishHydration(() => setHydrated(true));
    if (useChatSessionStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  const activeSession = idParam ? (sessions.find(s => s.id === idParam) ?? null) : null;

  function handleLandingSubmit(text: string) {
    const id = createSession(landingModel, text.slice(0, 50));
    setPendingMessage(text);
    router.push(`/chat?id=${id}`);
  }

  if (!hydrated) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.3)", fontSize: "14px" }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {activeSession ? (
        <ChatWindow
          key={activeSession.id}
          session={activeSession}
          onUpdate={(msgs, mdl) => upsertSession(activeSession.id, msgs, mdl)}
          initialMessage={pendingMessage}
          onInitialSent={() => setPendingMessage(null)}
          defaultModel={preferredModel}
          onModelChange={setPreferredModel}
        />
      ) : (
        <LandingView
          onSubmit={handleLandingSubmit}
          model={landingModel}
          onModelChange={id => { setLandingModel(id); setPreferredModel(id); }}
        />
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <Suspense fallback={<div style={{ flex: 1 }} />}>
        <ChatInner />
      </Suspense>
    </div>
  );
}
