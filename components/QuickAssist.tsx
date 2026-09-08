"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { flushSync } from "react-dom";
import { getToken } from "@/lib/galleryUtils";
import { MODEL_GROUPS, MODELS, type ModelId } from "@/lib/models";
import { useChatSessionStore } from "@/lib/chatSessionStore";
import { SYSTEM_PROMPT } from "@/lib/systemPrompt";
import { useWorkflowStore } from "@/lib/store";
import { loadAzureBaseUrl, loadAzureTextDeployment, loadAzureTextModelName } from "@/components/SettingsModal";
import { Sparkles, RotateCcw, X, ChevronUp, ArrowRight } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}


export function QuickAssist() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const { preferredModel, setPreferredModel } = useChatSessionStore();
  const [model, setModel] = useState<ModelId>(preferredModel as ModelId);
  const [modelOpen, setModelOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { createSession, upsertSession } = useChatSessionStore();
  const azureKeySet = useWorkflowStore((s) => s.azureKeySet);
  const disabledIds = azureKeySet === true ? [] : ["azure-auto"];

  // Sync to store when streaming stops
  useEffect(() => {
    if (streaming || !sessionId) return;
    const stored = messages
      .filter(m => !m.streaming && m.content)
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
    if (stored.length > 0) upsertSession(sessionId, stored, model);
  }, [streaming, sessionId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setOpen(o => !o); }
      if (e.key === "Escape") { setOpen(false); setModelOpen(false); }
    }
    function onPointer(e: PointerEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-model-picker]")) setModelOpen(false);
      if (open && containerRef.current && !containerRef.current.contains(t)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onPointer); };
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  function resetChat() {
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
    setStreaming(false);
    setSessionId(null);
  }

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;

    // Create session on first message
    let sid = sessionId;
    if (!sid) {
      sid = createSession(model, trimmed.slice(0, 50));
      setSessionId(sid);
    }

    const newMessages: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages([...newMessages, { role: "assistant", content: "", streaming: true }]);
    setInput("");
    setStreaming(true);

    const assistantIdx = newMessages.length;
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const token = await getToken();
      const reqHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (token) reqHeaders["Authorization"] = `Bearer ${token}`;
      const azureConfig = model === "azure-auto" ? {
        azureEndpoint:   loadAzureBaseUrl(),
        azureDeployment: loadAzureTextDeployment(),
        azureModelName:  loadAzureTextModelName(),
      } : {};
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...newMessages.map(m => ({ role: m.role, content: m.content })),
          ],
          stream: true,
          thinkingFlag: true,
          max_tokens: 1024,
          ...azureConfig,
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        let errMsg = "Request failed";
        try { const j = await res.json(); errMsg = j.error ?? errMsg; } catch { errMsg = await res.text().catch(() => errMsg); }
        setMessages(prev => prev.map((m, i) => i === assistantIdx ? { ...m, content: `Error: ${errMsg}`, streaming: false } : m));
        setStreaming(false);
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
            const claudeChunk = parsed.type === "content_block_delta" ? parsed.delta?.text : null;
            const openaiChunk = parsed.choices?.[0]?.delta?.content ?? null;
            const chunk = claudeChunk ?? openaiChunk ?? null;
            if (chunk) {
              accumulated += chunk;
              flushSync(() => {
                setMessages(prev => prev.map((m, i) => i === assistantIdx ? { ...m, content: accumulated } : m));
              });
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
  }, [messages, streaming, model, sessionId, createSession]);

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
    if (e.key === "Escape") setOpen(false);
  }

  const isEmpty = messages.length === 0;

  return (
    <div ref={containerRef}>
      {/* Trigger pill */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: "fixed", bottom: "8px", right: "24px", zIndex: 1000,
          display: "flex", alignItems: "center", gap: "8px",
          padding: "0 16px 0 12px", height: "40px", borderRadius: "var(--r-pill)",
          background: "var(--surface)", border: "1px solid var(--border-2)",
          color: "var(--text-1)", fontSize: "var(--fs-3)", fontWeight: 500,
          fontFamily: "var(--font-ui)", cursor: "pointer",
          transition: "border-color var(--dur-1)",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--text-2)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-2)"; }}
      >
        <Sparkles size={14} color="var(--text-2)" strokeWidth={2} />
        <span>Assistant</span>
        <span className="label" style={{ marginLeft: "2px", padding: "2px 6px", borderRadius: "var(--r-1)", background: "var(--bg-2)", color: "var(--text-3)" }}>⌘K</span>
      </button>

      {/* Panel */}
      {open && (
        <div style={{
          position: "fixed", bottom: "56px", right: "24px", zIndex: 1001,
          width: "380px", maxHeight: "600px",
          display: "flex", flexDirection: "column",
          borderRadius: "var(--r-3)", background: "var(--bg-1)",
          border: "1px solid var(--border-1)",
          overflow: "hidden", animation: "qaSlideUp 180ms var(--ease)",
        }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", padding: "var(--sp-4)", borderBottom: "1px solid var(--border-1)", flexShrink: 0 }}>
            <Sparkles size={16} color="var(--text-2)" strokeWidth={2} />
            <span style={{ marginLeft: "8px", fontSize: "var(--fs-5)", fontWeight: 600, color: "var(--text-1)" }}>Assistant</span>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
              {!isEmpty && (
                <button
                  onClick={resetChat}
                  title="New chat"
                  style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--border-2)", background: "transparent", color: "var(--text-2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "border-color var(--dur-1), color var(--dur-1)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--text-2)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-1)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-2)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-2)"; }}
                >
                  <RotateCcw size={13} strokeWidth={2} />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--border-2)", background: "transparent", color: "var(--text-2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "border-color var(--dur-1), color var(--dur-1)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--text-2)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-1)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-2)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-2)"; }}
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* ── Chat area ── */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: isEmpty ? "32px 24px 16px" : "16px", display: "flex", flexDirection: "column", gap: isEmpty ? "0" : "12px", minHeight: 0 }}>
            {isEmpty ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                <div style={{ width: "52px", height: "52px", borderRadius: "var(--r-2)", background: "var(--bg-2)", border: "1px solid var(--border-1)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px" }}>
                  <Sparkles size={22} color="var(--text-2)" strokeWidth={2} />
                </div>
                <p style={{ margin: "0 0 8px", fontSize: "var(--fs-5)", fontWeight: 600, color: "var(--text-1)" }}>How can I help you?</p>
                <p style={{ margin: "0", fontSize: "var(--fs-3)", color: "var(--text-3)", lineHeight: "var(--lh-body)" }}>Give me a prompt, I will make it better.</p>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
                  {m.role === "assistant" && (
                    <span className="label" style={{ color: "var(--text-3)", marginBottom: "4px" }}>
                      {MODELS.find(mm => mm.id === model)?.label ?? "ASSISTANT"}
                    </span>
                  )}
                  <div style={{
                    maxWidth: "85%", padding: "9px 13px",
                    borderRadius: m.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background: m.role === "user" ? "var(--surface)" : "var(--bg-2)",
                    border: m.role === "user" ? "1px solid var(--border-2)" : "none",
                    fontSize: "var(--fs-4)",
                    color: m.role === "user" ? "var(--text-1)" : "var(--text-2)",
                    lineHeight: "var(--lh-body)", whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {m.streaming && !m.content ? (
                      <span style={{ display: "inline-flex", gap: "8px", alignItems: "center" }}>
                        <span style={{ width: "10px", height: "10px", borderRadius: "50%", border: "2px solid var(--border-2)", borderTopColor: "transparent", animation: "spin 1s linear infinite" }} />
                        <span className="label" style={{ color: "var(--text-3)" }}>Thinking</span>
                      </span>
                    ) : (
                      <>
                        {m.content}
                        {m.streaming && (
                          <span style={{ display: "inline-block", width: "2px", height: "13px", background: "var(--text-2)", borderRadius: "1px", marginLeft: "2px", verticalAlign: "text-bottom", animation: "qaCursorBlink 0.8s ease-in-out infinite" }} />
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* ── Input ── */}
          <div style={{ borderTop: "1px solid var(--border-1)", padding: "12px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--bg-2)", border: "1px solid var(--border-2)", borderRadius: "var(--r-pill)", padding: "8px 8px 8px 16px", minHeight: "44px" }}>
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey} placeholder="Describe your idea…" rows={1} disabled={streaming} style={{ flex: 1, background: "transparent", border: "none", outline: "none", resize: "none", color: "var(--text-1)", fontSize: "var(--fs-3)", fontFamily: "var(--font-ui)", lineHeight: "22px", maxHeight: "96px", overflowY: "auto", padding: 0, cursor: streaming ? "not-allowed" : "text" }}
                onInput={e => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 96) + "px"; }} />
              <button onClick={() => send(input)} disabled={!input.trim() || streaming || disabledIds.includes(model)} style={{
                width: "32px", height: "32px", borderRadius: "50%", border: "none",
                background: "var(--accent)", color: "var(--on-accent)",
                boxShadow: "0 2px 0 var(--accent-edge)",
                opacity: input.trim() && !streaming && !disabledIds.includes(model) ? 1 : 0.4,
                cursor: input.trim() && !streaming && !disabledIds.includes(model) ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0,
              }}>
                <ArrowRight size={14} strokeWidth={2.5} />
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", padding: "0 2px" }}>
              {/* Model picker */}
              <div data-model-picker="" style={{ position: "relative" }}>
                <button onClick={() => setModelOpen(o => !o)} className="label" style={{ display: "flex", alignItems: "center", gap: "5px", padding: "3px 8px", borderRadius: "var(--r-1)", background: modelOpen ? "var(--bg-2)" : "transparent", border: "none", color: "var(--text-3)", cursor: "pointer", transition: "background var(--dur-1), color var(--dur-1)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-2)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-2)"; }}
                  onMouseLeave={e => { if (!modelOpen) { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-3)"; } }}>
                  {MODELS.find(m => m.id === model)?.label}
                  <ChevronUp size={11} strokeWidth={2.5} style={{ opacity: 0.7 }} />
                </button>
                {modelOpen && (
                  <div style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, minWidth: "180px", background: "var(--surface)", border: "1px solid var(--border-2)", borderRadius: "var(--r-2)", overflow: "hidden", zIndex: 10, animation: "qaSlideDown 120ms var(--ease)" }}>
                    <div style={{ padding: "6px" }}>
                      {MODEL_GROUPS.map((group, gi) => (
                        <div key={group.label}>
                          {gi > 0 && <div style={{ height: "1px", background: "var(--border-1)", margin: "4px 0" }} />}
                          <div className="label" style={{ padding: "4px 8px 2px", color: "var(--text-3)" }}>{group.label}</div>
                          {group.models.map(m => {
                            const isDisabled = disabledIds.includes(m.id);
                            const isSelected = model === m.id;
                            return (
                            <button key={m.id}
                              onClick={() => { if (!isDisabled) { setModel(m.id); setPreferredModel(m.id); setModelOpen(false); } }}
                              title={isDisabled ? "Configure Azure in Settings → API Keys" : undefined}
                              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "7px 8px", borderRadius: "var(--r-1)", border: "none", background: isSelected ? "var(--text-1)" : "transparent", color: isDisabled ? "var(--text-3)" : isSelected ? "var(--on-accent)" : "var(--text-2)", fontSize: "var(--fs-3)", fontFamily: "var(--font-ui)", fontWeight: isSelected ? 600 : 400, cursor: isDisabled ? "not-allowed" : "pointer", textAlign: "left", transition: "background var(--dur-1)", opacity: isDisabled ? 0.4 : 1 }}
                              onMouseEnter={e => { if (!isDisabled && !isSelected) (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-2)"; }}
                              onMouseLeave={e => { if (!isDisabled && !isSelected) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
                              <span>{m.label}</span>
                              <span className="label" style={{ color: isSelected ? "var(--on-accent)" : "var(--text-3)", marginLeft: "8px", opacity: 0.8 }}>{isDisabled ? "needs key" : m.desc}</span>
                            </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <span className="label" style={{ color: "var(--text-3)", display: "flex", gap: "8px", alignItems: "center" }}>
                <span style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                  <kbd style={{ padding: "1px 4px", borderRadius: "4px", background: "var(--bg-2)", border: "1px solid var(--border-1)", fontSize: "var(--fs-2)", color: "var(--text-3)" }}>↵</kbd>
                  SEND
                </span>
                <span>·</span>
                <span style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                  <kbd style={{ padding: "1px 4px", borderRadius: "4px", background: "var(--bg-2)", border: "1px solid var(--border-1)", fontSize: "var(--fs-2)", color: "var(--text-3)" }}>ESC</kbd>
                  CLOSE
                </span>
              </span>
            </div>
          </div>

        </div>
      )}

      <style>{`
        @keyframes qaSlideUp {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes qaSlideDown {
          from { opacity: 0; transform: translateY(6px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes qaCursorBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
