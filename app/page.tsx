"use client";
import dynamic from "next/dynamic";
import Sidebar from "@/components/Sidebar";

const WorkflowCanvas = dynamic(() => import("@/components/WorkflowCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center text-gray-600">
      Loading canvas…
    </div>
  ),
});

export default function Home() {
  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <Sidebar />
      <WorkflowCanvas />
    </div>
  );
}
