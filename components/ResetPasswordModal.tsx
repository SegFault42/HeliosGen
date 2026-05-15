"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore } from "@/lib/store";

export default function ResetPasswordModal() {
  const open = useWorkflowStore((s) => s.resetPasswordModalOpen);
  const setOpen = useWorkflowStore((s) => s.setResetPasswordModalOpen);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) { setPassword(""); setConfirm(""); setError(""); setSuccess(false); }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }

    setBusy(true);
    setError("");
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (err) { setError(err.message); return; }
    setSuccess(true);
    setTimeout(() => setOpen(false), 1800);
  };

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      onClick={(e) => { if (e.target === backdropRef.current) setOpen(false); }}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="w-80 rounded-xl border border-[#1A2030] bg-[#0B0E14] shadow-2xl p-6 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white tracking-tight">Reset password</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-[#A0A0A0] hover:text-white transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>

        {success ? (
          <p className="text-[12px] text-[#2DD4BF] text-center py-2">
            Password updated successfully.
          </p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-2.5">
            <input
              type="password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              className="node-input text-[12px] py-2"
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className="node-input text-[12px] py-2"
            />

            {error && (
              <p className="text-[11px] text-red-400 leading-tight">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="toolbar-btn-primary text-[12px] py-2 mt-1"
            >
              {busy ? "…" : "Set new password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
