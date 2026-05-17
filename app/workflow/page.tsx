"use client";
import WorkflowDashboard from "@/components/WorkflowDashboard";
import { useSpaceSync } from "@/lib/useSpaceSync";

export default function WorkflowPage() {
  useSpaceSync();
  return <WorkflowDashboard />;
}
