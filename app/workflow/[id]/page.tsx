"use client";
import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useWorkflowStore } from "@/lib/store";
import { useSpaceSync } from "@/lib/useSpaceSync";
import { QuickAssist } from "@/components/QuickAssist";

const WorkflowCanvas = dynamic(() => import("@/components/WorkflowCanvas"), {
  ssr: false,
});

export default function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const switchSpace = useWorkflowStore((s) => s.switchSpace);

  useSpaceSync();

  // Guard: if this ID doesn't exist in the store, redirect home.
  // Also ensures the correct space is active on direct URL access.
  useEffect(() => {
    const spaces = useWorkflowStore.getState().spaces;
    if (!spaces.some((sp) => sp.id === id)) {
      router.replace("/");
      return;
    }
    switchSpace(id);
  }, [id, switchSpace, router]);

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <WorkflowCanvas />
      <QuickAssist />
    </div>
  );
}
