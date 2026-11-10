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

  const { dbLoaded } = useSpaceSync();

  // Ensures the correct space is active on direct URL access, and redirects
  // home when the ID does not exist. A space missing from the store is only
  // "not found" once the DB has answered: a fresh browser (or another origin,
  // or cleared storage) knows nothing locally and used to bounce a valid link.
  useEffect(() => {
    const spaces = useWorkflowStore.getState().spaces;
    if (spaces.some((sp) => sp.id === id)) {
      switchSpace(id);
      return;
    }
    if (dbLoaded) router.replace("/");
  }, [id, switchSpace, router, dbLoaded]);

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <WorkflowCanvas />
      <QuickAssist />
    </div>
  );
}
