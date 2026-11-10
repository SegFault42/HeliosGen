"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { useWorkflowStore, Toast } from "@/lib/store";

const DOT: Record<Toast["type"], string> = {
  error: "bg-error",
  success: "bg-accent",
  info: "bg-accent",
};

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useWorkflowStore((s) => s.removeToast);
  const router = useRouter();
  const isError = toast.type === "error";

  useEffect(() => {
    if (isError) return;
    const t = setTimeout(() => removeToast(toast.id), 5000);
    return () => clearTimeout(t);
  }, [toast.id, removeToast, isError]);

  function handleClick() {
    if (toast.href) {
      removeToast(toast.id);
      router.push(toast.href);
    }
  }

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    removeToast(toast.id);
  }

  return (
    <div
      onClick={toast.href ? handleClick : undefined}
      className={`animate-in slide-in-from-bottom-4 fade-in duration-200 ease-[var(--ease)] flex w-[340px] items-center gap-3 rounded-full border bg-surface py-[12px] pr-[14px] pl-4 ${
        isError ? "border-error" : "border-border-2"
      } ${toast.href ? "cursor-pointer" : ""}`}
    >
      <span className={`size-2 shrink-0 rounded-full ${DOT[toast.type]}`} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] text-text-1">
          {toast.title || toast.message}
        </span>
        {(toast.title ? toast.message : toast.preview) && (
          <span className="truncate text-[13px] text-text-2">
            {toast.title ? toast.preview : undefined}
          </span>
        )}
      </div>
      {toast.href && (
        <span className="shrink-0 text-[13px] font-semibold text-accent">
          View
        </span>
      )}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="flex shrink-0 items-center justify-center text-text-3 hover:text-text-1"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

export default function Toaster() {
  const toasts = useWorkflowStore((s) => s.toasts);

  return (
    <div
      className="pointer-events-none fixed right-5 bottom-5 z-[9999] flex flex-col gap-2"
      style={{ pointerEvents: toasts.length ? "auto" : "none" }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
