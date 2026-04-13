"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore } from "@/lib/store";

type View = "signin" | "signup" | "forgot";

export default function AuthModal() {
  const open         = useWorkflowStore((s) => s.authModalOpen);
  const setOpen      = useWorkflowStore((s) => s.setAuthModalOpen);

  const [mode, setMode]         = useState<View>("signin");
  const [forgotSent, setForgotSent] = useState(false);
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [busy, setBusy]         = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const supabase    = createClient();

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  // Reset form when modal opens
  useEffect(() => {
    if (open) { setEmail(""); setPassword(""); setError(""); setMode("signin"); setForgotSent(false); }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");

    if (mode === "forgot") {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      setBusy(false);
      if (err) { setError(err.message); return; }
      setForgotSent(true);
      return;
    }

    const fn = mode === "signin"
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password });

    const { error: err } = await fn;
    setBusy(false);

    if (err) { setError(err.message); return; }
    if (mode === "signup") {
      setError("Check your email to confirm your account.");
      return;
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) setOpen(false); }}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="w-80 rounded-xl border border-[#1A100C] bg-[#0D1012] shadow-2xl p-6 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white tracking-tight">
            {mode === "forgot" ? "Reset password" : "Sign in to generate"}
          </h2>
          <button
            onClick={() => setOpen(false)}
            className="text-[#8D8E89] hover:text-white transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>

        {mode === "forgot" ? (
          forgotSent ? (
            <p className="text-[12px] text-[#77E544] text-center py-2">
              Check your email for a reset link.
            </p>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-2.5">
              <p className="text-[11px] text-[#8D8E89] leading-tight">
                Enter your email and we'll send you a reset link.
              </p>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="node-input text-[12px] py-2"
              />
              {error && <p className="text-[11px] text-red-400 leading-tight">{error}</p>}
              <button type="submit" disabled={busy} className="toolbar-btn-primary text-[12px] py-2 mt-1">
                {busy ? "…" : "Send reset link"}
              </button>
              <button
                type="button"
                onClick={() => { setMode("signin"); setError(""); }}
                className="text-[11px] text-[#8D8E89] hover:text-white transition-colors text-center"
              >
                Back to sign in
              </button>
            </form>
          )
        ) : (
          <>
            {/* Mode toggle */}
            <div className="flex rounded overflow-hidden border border-[#1A100C]">
              {(["signin", "signup"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(""); }}
                  className={`flex-1 text-[11px] py-1.5 transition-colors ${
                    mode === m ? "bg-[#1A100C] text-white" : "text-[#8D8E89] hover:text-white"
                  }`}
                >
                  {m === "signin" ? "Sign in" : "Sign up"}
                </button>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={submit} className="flex flex-col gap-2.5">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="node-input text-[12px] py-2"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="node-input text-[12px] py-2"
              />

              {error && (
                <p className={`text-[11px] leading-tight ${
                  error.startsWith("Check") ? "text-[#8D8E89]" : "text-red-400"
                }`}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="toolbar-btn-primary text-[12px] py-2 mt-1"
              >
                {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
              </button>

              {mode === "signin" && (
                <button
                  type="button"
                  onClick={() => { setMode("forgot"); setError(""); }}
                  className="text-[11px] text-[#8D8E89] hover:text-white transition-colors text-center"
                >
                  Forgot password?
                </button>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
