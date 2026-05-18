"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore } from "@/lib/store";

type View = "signin" | "signup" | "forgot";

function PasswordStrengthBar({ password }: { password: string }) {
  const score = !password
    ? 0
    : password.length < 6
    ? 1
    : password.length < 10 || !/[^a-zA-Z0-9]/.test(password)
    ? 2
    : password.length < 14
    ? 3
    : 4;

  const label = ["", "WEAK", "FAIR", "GOOD", "STRONG"][score];
  const color = ["", "#ef4444", "#f59e0b", "#2DD4BF", "#2DD4BF"][score];
  const segments = 4;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
      <div style={{ display: "flex", gap: "4px" }}>
        {Array.from({ length: segments }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: "3px",
              borderRadius: "99px",
              background: i < score ? color : "rgba(255,255,255,0.1)",
              transition: "background 250ms",
            }}
          />
        ))}
      </div>
      {password.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: "10px", letterSpacing: "0.08em", color: "rgba(255,255,255,0.4)" }}>
            STRENGTH
          </span>
          <span style={{ fontSize: "10px", letterSpacing: "0.08em", color, fontWeight: 600 }}>
            {label}
          </span>
        </div>
      )}
    </div>
  );
}

const ANIM_MS = 220;

export default function AuthModal() {
  const open = useWorkflowStore((s) => s.authModalOpen);
  const setOpen = useWorkflowStore((s) => s.setAuthModalOpen);
  const authModalView = useWorkflowStore((s) => s.authModalView);

  const [mode, setMode] = useState<View>("signin");
  const [forgotSent, setForgotSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  // Mount → paint → fade in; fade out → unmount
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), ANIM_MS);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      setEmail(""); setPassword(""); setError("");
      setMode(authModalView); setForgotSent(false); setShowPassword(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");

    if (mode === "forgot") {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/`,
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

  if (!mounted) return null;

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) setOpen(false); }}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)",
        opacity: visible ? 1 : 0,
        transition: `opacity ${ANIM_MS}ms ease`,
      }}
    >
      <div style={{
        display: "flex",
        width: "780px",
        transform: visible ? "translateY(0) scale(1)" : "translateY(12px) scale(0.97)",
        opacity: visible ? 1 : 0,
        transition: `transform ${ANIM_MS}ms cubic-bezier(0.16,1,0.3,1), opacity ${ANIM_MS}ms ease`,
        maxWidth: "calc(100vw - 32px)",
        borderRadius: "18px",
        overflow: "hidden",
        boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}>

        {/* ── Left brand panel ── */}
        <div style={{
          width: "320px",
          flexShrink: 0,
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Full-size static image */}
          <img
            src="/1.webp"
            alt=""
            style={{
              position: "absolute", inset: 0,
              width: "100%", height: "100%",
              objectFit: "cover",
            }}
          />

          {/* Dark overlay so logo is readable */}
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.05) 50%, rgba(0,0,0,0.3) 100%)",
            pointerEvents: "none",
          }} />

          {/* Logo top-left */}
          <div style={{
            position: "relative",
            padding: "24px",
            display: "flex", alignItems: "center", gap: "10px",
          }}>
            <Image src="/HG.svg" alt="HeliosGen" width={28} height={28} />
            <span style={{
              fontSize: "15px", fontWeight: 600, color: "#fff",
              letterSpacing: "-0.01em", textShadow: "0 1px 4px rgba(0,0,0,0.6)",
            }}>
              HeliosGen
            </span>
          </div>
        </div>

        {/* ── Right form panel ── */}
        <div style={{
          flex: 1,
          background: "#161a1f",
          padding: "28px 32px 28px",
          display: "flex",
          flexDirection: "column",
        }}>
          {/* Top row */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "20px" }}>
            <div>
              <p style={{
                fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em",
                color: "rgba(255,255,255,0.38)", marginBottom: "6px",
              }}>
                {mode === "forgot" ? "RESET PASSWORD" : mode === "signup" ? "CREATE ACCOUNT" : "WELCOME BACK"}
              </p>
              <h2 style={{
                fontSize: "24px", fontWeight: 700, color: "#fff",
                letterSpacing: "-0.02em", lineHeight: 1.2,
              }}>
                {mode === "forgot"
                  ? "Reset your password"
                  : mode === "signup"
                  ? "Sign up with email"
                  : "Sign in with email"}
              </h2>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                width: "28px", height: "28px", borderRadius: "8px", border: "none",
                background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", flexShrink: 0, marginTop: "2px",
                transition: "background 150ms, color 150ms",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M1 1l10 10M11 1L1 11" />
              </svg>
            </button>
          </div>

          {/* Forgot / sent state */}
          {mode === "forgot" ? (
            forgotSent ? (
              <div style={{
                flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", gap: "12px", textAlign: "center",
              }}>
                <div style={{
                  width: "48px", height: "48px", borderRadius: "14px",
                  background: "rgba(45,212,191,0.12)", display: "flex",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    <path d="m16 19 2 2 4-4" />
                  </svg>
                </div>
                <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
                  Reset link sent — check your inbox.
                </p>
                <button
                  onClick={() => { setMode("signin"); setError(""); setForgotSent(false); }}
                  style={{
                    fontSize: "13px", color: "#2DD4BF", background: "none",
                    border: "none", cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <form onSubmit={submit} style={{ flex: 1, display: "flex", flexDirection: "column", gap: "14px" }}>
                <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
                  Enter your email and we'll send you a reset link.
                </p>
                <FieldLabel label="EMAIL" />
                <InputWithIcon
                  icon={<EmailIcon />}
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={setEmail}
                  autoFocus
                />
                {error && <ErrorMsg text={error} />}
                <PrimaryButton busy={busy} label="Send reset link" />
                <div style={{ textAlign: "center" }}>
                  <button
                    type="button"
                    onClick={() => { setMode("signin"); setError(""); }}
                    style={{
                      fontSize: "13px", color: "rgba(255,255,255,0.4)", background: "none",
                      border: "none", cursor: "pointer", fontFamily: "inherit",
                      transition: "color 150ms",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = "#fff"; }}
                    onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
                  >
                    Back to sign in
                  </button>
                </div>
              </form>
            )
          ) : (
            <form onSubmit={submit} style={{ flex: 1, display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <FieldLabel label="EMAIL" />
                <InputWithIcon
                  icon={<EmailIcon />}
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={setEmail}
                  autoFocus
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <FieldLabel label="PASSWORD" />
                <InputWithIcon
                  icon={<LockIcon />}
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••••"
                  value={password}
                  onChange={setPassword}
                  suffix={
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      style={{
                        background: "none", border: "none", padding: "0 2px",
                        color: showPassword ? "#2DD4BF" : "rgba(255,255,255,0.3)",
                        cursor: "pointer", display: "flex", alignItems: "center",
                        transition: "color 150ms",
                      }}
                    >
                      {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  }
                />
                <div style={{ visibility: mode === "signup" ? "visible" : "hidden" }}>
                  <PasswordStrengthBar password={password} />
                </div>
              </div>

              {error && (
                <ErrorMsg
                  text={error}
                  muted={error.startsWith("Check")}
                />
              )}

              <PrimaryButton
                busy={busy}
                label={mode === "signin" ? "Sign in" : "Create account"}
                arrow
              />

              {/* Footer link */}
              <p style={{
                fontSize: "13px", color: "rgba(255,255,255,0.38)",
                textAlign: "center", marginTop: "2px",
              }}>
                {mode === "signin" ? (
                  <>
                    New to HeliosGen?{" "}
                    <button
                      type="button"
                      onClick={() => { setMode("signup"); setError(""); }}
                      style={{
                        color: "#2DD4BF", background: "none", border: "none",
                        cursor: "pointer", fontFamily: "inherit", fontSize: "13px",
                        fontWeight: 500,
                      }}
                    >
                      Create an account
                    </button>
                  </>
                ) : (
                  <>
                    Already on HeliosGen?{" "}
                    <button
                      type="button"
                      onClick={() => { setMode("signin"); setError(""); }}
                      style={{
                        color: "#2DD4BF", background: "none", border: "none",
                        cursor: "pointer", fontFamily: "inherit", fontSize: "13px",
                        fontWeight: 500,
                      }}
                    >
                      Sign in instead
                    </button>
                  </>
                )}
              </p>

              <div style={{ textAlign: "center", marginTop: "-6px", visibility: mode === "signin" ? "visible" : "hidden" }}>
                <button
                  type="button"
                  onClick={() => { setMode("forgot"); setError(""); }}
                  style={{
                    fontSize: "12px", color: "rgba(255,255,255,0.3)", background: "none",
                    border: "none", cursor: "pointer", fontFamily: "inherit",
                    transition: "color 150ms",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.3)"; }}
                >
                  Forgot password?
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Shared sub-components ─────────────────────────────────────── */

function FieldLabel({ label }: { label: string }) {
  return (
    <p style={{
      fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em",
      color: "rgba(255,255,255,0.38)", marginBottom: "7px",
    }}>
      {label}
    </p>
  );
}

function InputWithIcon({
  icon, type, placeholder, value, onChange, autoFocus, suffix,
}: {
  icon: React.ReactNode;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  suffix?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "10px",
      background: "#0e1116",
      border: `1px solid ${focused ? "rgba(45,212,191,0.5)" : "rgba(255,255,255,0.08)"}`,
      borderRadius: "10px", padding: "0 14px",
      height: "46px",
      transition: "border-color 150ms",
    }}>
      <span style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0, display: "flex" }}>{icon}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        required
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1, background: "none", border: "none", outline: "none",
          fontSize: "14px", color: "#fff", fontFamily: "inherit",
          letterSpacing: type === "password" && value ? "0.08em" : "normal",
        }}
      />
      {suffix}
    </div>
  );
}

function PrimaryButton({ busy, label, arrow }: { busy: boolean; label: string; arrow?: boolean }) {
  return (
    <button
      type="submit"
      disabled={busy}
      style={{
        width: "100%", height: "48px", borderRadius: "12px", border: "none",
        background: busy ? "rgba(45,212,191,0.5)" : "#2DD4BF",
        color: "#000", fontSize: "15px", fontWeight: 600,
        cursor: busy ? "not-allowed" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
        fontFamily: "inherit", letterSpacing: "-0.01em",
        transition: "background 150ms, opacity 150ms",
        marginTop: "4px",
      }}
    >
      {busy ? "…" : (
        <>
          {label}
          {arrow && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          )}
        </>
      )}
    </button>
  );
}

function ErrorMsg({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <p style={{
      fontSize: "12px", lineHeight: 1.5,
      color: muted ? "rgba(255,255,255,0.45)" : "#f87171",
      padding: "8px 12px", borderRadius: "8px",
      background: muted ? "rgba(255,255,255,0.04)" : "rgba(248,113,113,0.08)",
    }}>
      {text}
    </p>
  );
}

function EmailIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
