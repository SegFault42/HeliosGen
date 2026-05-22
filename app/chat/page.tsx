"use client";

import React, { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useChatSessionStore, type StoredMessage, type ChatSession } from "@/lib/chatSessionStore";
import { getToken } from "@/lib/galleryUtils";
import { MODEL_GROUPS, MODELS, type ModelId } from "@/lib/models";
import { SYSTEM_PROMPT } from "@/lib/systemPrompt";
import { Send, ChevronUp, Copy, Check } from "lucide-react";
import { motion } from "motion/react";
import Image from "next/image";
import DotCanvasBackground from "@/components/ui/DotCanvasBackground";
import TypewriterHeading from "@/components/ui/TypewriterHeading";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore } from "@/lib/store";
import { loadAzureBaseUrl, loadAzureTextDeployment, loadAzureTextModelName } from "@/components/SettingsModal";
import type { User } from "@supabase/supabase-js";

// ── Logo ──────────────────────────────────────────────────────────────────────

function LogoIcon({ size = 40 }: { size?: number }) {
  return <Image src="/HG.svg" alt="Logo" width={size} height={size} />;
}

// ── Model picker ──────────────────────────────────────────────────────────────

function ModelPicker({
  model, onChange, direction = "up", disabledIds = [],
}: {
  model: ModelId;
  onChange: (id: ModelId) => void;
  direction?: "up" | "down";
  disabledIds?: string[];
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
                {group.models.map(m => {
                  const disabled = disabledIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => { if (!disabled) { onChange(m.id); setOpen(false); } }}
                      title={disabled ? "Configure Azure in Settings → API Keys" : undefined}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        width: "100%", padding: "7px 8px", borderRadius: "7px", border: "none",
                        background: model === m.id ? "rgba(45,212,191,0.12)" : "transparent",
                        color: disabled ? "rgba(255,255,255,0.25)" : model === m.id ? "rgba(94,234,212,0.95)" : "rgba(255,255,255,0.7)",
                        fontSize: "13px", fontFamily: "inherit",
                        cursor: disabled ? "not-allowed" : "pointer",
                        textAlign: "left", transition: "background 100ms",
                        opacity: disabled ? 0.5 : 1,
                      }}
                      onMouseEnter={e => { if (!disabled && model !== m.id) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
                      onMouseLeave={e => { if (!disabled && model !== m.id) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
                    >
                      <span>{m.label}</span>
                      <span style={{ fontSize: "10px", color: disabled ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.28)", marginLeft: "8px" }}>
                        {disabled ? "needs Azure key" : m.desc}
                      </span>
                    </button>
                  );
                })}
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
  const kieKeySet   = useWorkflowStore((s) => s.kieKeySet);
  const azureKeySet = useWorkflowStore((s) => s.azureKeySet);
  const disabledIds = azureKeySet === true ? [] : ["azure-auto"];

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
            <ModelPicker model={model} onChange={onModelChange} direction="down" disabledIds={disabledIds} />
            <button
              onClick={() => submit(input)}
              disabled={!input.trim() || kieKeySet === false || disabledIds.includes(model)}
              style={{
                width: "36px", height: "36px", borderRadius: "50%", border: "none",
                background: input.trim() && kieKeySet !== false && !disabledIds.includes(model) ? "rgba(45,212,191,0.25)" : "rgba(255,255,255,0.07)",
                color: input.trim() && kieKeySet !== false && !disabledIds.includes(model) ? "rgba(45,212,191,0.9)" : "rgba(255,255,255,0.25)",
                cursor: input.trim() && kieKeySet !== false && !disabledIds.includes(model) ? "pointer" : "not-allowed",
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
  session, onUpdate, defaultModel, onModelChange, onAuthRequired, initialMessage,
}: {
  session: ChatSession;
  onUpdate: (msgs: StoredMessage[], model: string) => void;
  defaultModel?: string;
  onModelChange?: (id: ModelId) => void;
  onAuthRequired?: () => void;
  initialMessage?: string;
}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [messages, setMessages] = useState<LiveMessage[]>(() =>
    session.messages.map((m) => ({ ...m }))
  );
  const [input, setInput] = useState("");
  const [model, setModel] = useState<ModelId>((session.model || defaultModel || "claude-sonnet-4-6") as ModelId);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const kieKeySet   = useWorkflowStore((s) => s.kieKeySet);
  const azureKeySet = useWorkflowStore((s) => s.azureKeySet);
  const disabledIds = azureKeySet === true ? [] : ["azure-auto"];

  function handleModelChange(id: ModelId) { setModel(id); onModelChange?.(id); }
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    if (onAuthRequired) { onAuthRequired(); return; }

    const contextMessages: StoredMessage[] = [
      ...session.messages,
      { role: "user", content: trimmed },
    ];

    const assistantIdx = contextMessages.length; // index in the new messages array
    flushSync(() => {
      setMessages((prev) => [
        ...prev.filter((m) => !m.streaming),
        { role: "user", content: trimmed },
        { role: "assistant", content: "", streaming: true },
      ]);
      setInput("");
      setIsStreaming(true);
    });

    onUpdate(contextMessages, model);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const token = await getToken();
      const azureConfig = model === "azure-auto" ? {
        azureEndpoint:   loadAzureBaseUrl(),
        azureDeployment: loadAzureTextDeployment(),
        azureModelName:  loadAzureTextModelName(),
      } : {};

      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...contextMessages.map((m) => ({ role: m.role, content: m.content })),
          ],
          stream: true,
          ...azureConfig,
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        let errMsg = "Request failed";
        try { const j = await res.json(); errMsg = j.error ?? errMsg; } catch { errMsg = await res.text().catch(() => errMsg); }
        setMessages((prev) => prev.map((m, i) => i === assistantIdx ? { ...m, content: `Error: ${errMsg}`, streaming: false } : m));
        setIsStreaming(false);
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
            const chunk =
              (parsed.type === "content_block_delta" ? parsed.delta?.text : null) ??
              parsed.choices?.[0]?.delta?.content ??
              null;
            if (chunk) accumulated += chunk;
          } catch { /* skip malformed SSE */ }
        }
        // One state update per network read — the await above yields to the browser for painting
        setMessages((prev) => prev.map((m, i) =>
          i === assistantIdx ? { ...m, content: accumulated } : m
        ));
      }

      const finalMessages: StoredMessage[] = [...contextMessages, { role: "assistant", content: accumulated }];
      setMessages(finalMessages.map((m) => ({ ...m })));
      onUpdate(finalMessages, model);
    } catch (err: unknown) {
      if ((err as Error)?.name !== "AbortError") {
        setMessages((prev) => prev.map((m, i) => i === assistantIdx ? { ...m, content: "Request failed.", streaming: false } : m));
      }
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, model, onAuthRequired, session, onUpdate]);

  const hasSentInitial = useRef(false);
  useEffect(() => {
    if (initialMessage && !hasSentInitial.current) {
      hasSentInitial.current = true;
      send(initialMessage);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
  }

  // ── Empty state: centered welcome + input ──────────────────────────────────
  if (messages.length === 0 && !isStreaming) {
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
              <ModelPicker model={model} onChange={handleModelChange} direction="down" disabledIds={disabledIds} />
              <button onClick={() => send(input)} disabled={!input.trim() || kieKeySet === false || disabledIds.includes(model)} style={{ width: "36px", height: "36px", borderRadius: "50%", border: "none", background: input.trim() && kieKeySet !== false && !disabledIds.includes(model) ? "rgba(45,212,191,0.25)" : "rgba(255,255,255,0.07)", color: input.trim() && kieKeySet !== false && !disabledIds.includes(model) ? "rgba(45,212,191,0.9)" : "rgba(255,255,255,0.25)", cursor: input.trim() && kieKeySet !== false && !disabledIds.includes(model) ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 150ms, color 150ms" }}>
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
                {m.streaming && (
                  m.content
                    ? <span style={{ display: "inline-block", width: "2px", height: "14px", background: "rgba(255,255,255,0.6)", borderRadius: "1px", marginLeft: "2px", verticalAlign: "text-bottom", animation: "cursorBlink 0.8s ease-in-out infinite" }} />
                    : <span style={{ display: "inline-flex", gap: "3px", alignItems: "center" }}>
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
            disabled={isStreaming}
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
            <ModelPicker model={model} onChange={handleModelChange} disabledIds={disabledIds} />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || isStreaming || kieKeySet === false || disabledIds.includes(model)}
              style={{
                width: "32px", height: "32px", borderRadius: "8px", border: "none",
                background: input.trim() && !isStreaming && kieKeySet !== false && !disabledIds.includes(model) ? "rgba(45,212,191,0.25)" : "rgba(255,255,255,0.07)",
                color: input.trim() && !isStreaming && kieKeySet !== false && !disabledIds.includes(model) ? "rgba(45,212,191,0.9)" : "rgba(255,255,255,0.25)",
                cursor: input.trim() && !isStreaming && kieKeySet !== false && !disabledIds.includes(model) ? "pointer" : "not-allowed",
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
        @keyframes cursorBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
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
  const [landingModel, setLandingModel] = useState<ModelId>("claude-sonnet-4-6");
  const [pendingMessage, setPendingMessage] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const setAuthModalOpen = useWorkflowStore((s) => s.setAuthModalOpen);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Sync landingModel from store once hydrated
  useEffect(() => { if (hydrated) setLandingModel(preferredModel as ModelId); }, [hydrated]);

  useEffect(() => {
    const unsub = useChatSessionStore.persist?.onFinishHydration(() => setHydrated(true));
    if (useChatSessionStore.persist?.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);

  const activeSession = idParam ? (sessions.find(s => s.id === idParam) ?? null) : null;

  const isGuestMode = process.env.NEXT_PUBLIC_GUEST_MODE === "true";

  function handleLandingSubmit(text: string) {
    if (!user && !isGuestMode) { setAuthModalOpen(true); return; }
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
          defaultModel={preferredModel}
          onModelChange={setPreferredModel}
          onAuthRequired={!user && !isGuestMode ? () => setAuthModalOpen(true) : undefined}
          initialMessage={pendingMessage || undefined}
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
