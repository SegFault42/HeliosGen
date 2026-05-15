"use client";
import WorkflowDashboard from "@/components/WorkflowDashboard";
import { useSpaceSync } from "@/lib/useSpaceSync";

export default function Home() {
  useSpaceSync();
  return <WorkflowDashboard />;
}
