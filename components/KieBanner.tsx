"use client";
import { TriangleAlertIcon } from "lucide-react";
import { useWorkflowStore } from "@/lib/store";

export default function KieBanner() {
  const kieKeySet = useWorkflowStore((s) => s.kieKeySet);
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);

  if (kieKeySet !== false) return null;

  return (
    <div className="flex h-10 w-full shrink-0 items-center gap-3 bg-warning px-5">
      <TriangleAlertIcon className="size-4 shrink-0 text-on-accent" />
      <span className="text-[13px] font-bold text-on-accent">
        No Kie.ai API key configured
      </span>
      <span className="text-[13px] text-on-accent">
        — generation is disabled.
      </span>
      <div className="flex-1" />
      <button
        onClick={() => setSettingsOpen(true)}
        className="flex h-[26px] shrink-0 items-center rounded-full bg-on-accent px-3 text-[12px] font-semibold text-text-1"
      >
        Add in Settings →
      </button>
    </div>
  );
}
