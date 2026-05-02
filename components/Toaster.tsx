"use client";
import { useEffect } from "react";
import { useWorkflowStore, Toast } from "@/lib/store";

const COLORS: Record<Toast["type"], { bg: string; border: string; icon: string }> = {
  error:   { bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)",  icon: "rgba(239,68,68,0.9)"  },
  success: { bg: "rgba(74,222,128,0.10)", border: "rgba(74,222,128,0.3)", icon: "rgba(74,222,128,0.9)" },
  info:    { bg: "rgba(96,165,250,0.10)", border: "rgba(96,165,250,0.3)", icon: "rgba(96,165,250,0.9)" },
};

const ICONS: Record<Toast["type"], string> = {
  error:   "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
  success: "M20 6 9 17l-5-5",
  info:    "M12 16v-4m0-4h.01M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z",
};

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useWorkflowStore((s) => s.removeToast);
  const c = COLORS[toast.type];

  useEffect(() => {
    const t = setTimeout(() => removeToast(toast.id), 4000);
    return () => clearTimeout(t);
  }, [toast.id, removeToast]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "12px 14px",
        borderRadius: "10px",
        background: c.bg,
        border: `1px solid ${c.border}`,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        backdropFilter: "blur(8px)",
        maxWidth: "360px",
        animation: "toastIn 200ms cubic-bezier(0.22,1,0.36,1) both",
      }}
    >
      <svg
        width="16" height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke={c.icon}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: "1px" }}
      >
        <path d={ICONS[toast.type]} />
      </svg>
      <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.85)", lineHeight: 1.45, flex: 1 }}>
        {toast.message}
      </span>
      <button
        onClick={() => removeToast(toast.id)}
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "rgba(255,255,255,0.3)", padding: "0", flexShrink: 0, lineHeight: 1,
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export default function Toaster() {
  const toasts = useWorkflowStore((s) => s.toasts);

  return (
    <>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          top: "24px",
          right: "24px",
          zIndex: 99999,
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          pointerEvents: toasts.length ? "auto" : "none",
        }}
      >
        {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
      </div>
    </>
  );
}
