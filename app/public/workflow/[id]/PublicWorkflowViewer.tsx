"use client";
import { useEffect, useState } from "react";
import GitHubButton from "react-github-btn";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Node,
  Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MousePointer2, Hand } from "lucide-react";

import { ReadOnlyCtx } from "@/lib/readOnlyContext";
import { useWorkflowStore } from "@/lib/store";
import PromptNode from "@/components/nodes/PromptNode";
import ImageInputNode from "@/components/nodes/ImageInputNode";
import VideoInputNode from "@/components/nodes/VideoInputNode";
import GenerateNode from "@/components/nodes/GenerateNode";
import VideoGeneratorNode from "@/components/nodes/VideoGeneratorNode";
import AssistantNode from "@/components/nodes/AssistantNode";
import GroupNode from "@/components/nodes/GroupNode";
import CuttableEdge from "@/components/edges/CuttableEdge";

const nodeTypes = {
  promptNode: PromptNode,
  imageInputNode: ImageInputNode,
  videoInputNode: VideoInputNode,
  generateNode: GenerateNode,
  videoGeneratorNode: VideoGeneratorNode,
  assistantNode: AssistantNode,
  groupNode: GroupNode,
};

const edgeTypes = {
  default: CuttableEdge,
};

interface SpaceData {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  viewport: { x: number; y: number; zoom: number } | null;
}

type ToolId = "select" | "hand";

export default function PublicWorkflowViewer({ id }: { id: string }) {
  const [spaceMeta, setSpaceMeta] = useState<{ name: string; viewport: { x: number; y: number; zoom: number } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolId>("hand");
  const [hoveredTool, setHoveredTool] = useState<ToolId | null>(null);

  // Controlled mode: read nodes/edges from the store so updateNodeData (used by
  // carousel navigation) causes re-renders.
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);

  useEffect(() => {
    fetch(`/api/public/space/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Workflow not found or not public");
        return r.json();
      })
      .then((data: SpaceData) => {
        // Seed the store with the fetched data so:
        // 1. Nodes render with correct data props
        // 2. Handle-connected CSS classes compute correctly
        // 3. Carousel navigation (updateNodeData) works via controlled mode
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useWorkflowStore.setState({ nodes: data.nodes as any, edges: data.edges });
        setSpaceMeta({ name: data.name, viewport: data.viewport });
      })
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "100vw", height: "100vh",
        background: "#0a0a0c", color: "rgba(255,255,255,0.4)",
        fontSize: 14,
      }}>
        {error}
      </div>
    );
  }

  if (!spaceMeta) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "100vw", height: "100vh",
        background: "#0a0a0c",
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 0.9s linear infinite" }}>
          <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
          <path d="M12 2 A10 10 0 0 1 22 12" />
        </svg>
      </div>
    );
  }

  const defaultViewport = spaceMeta.viewport ?? { x: 0, y: 0, zoom: 1 };

  return (
    <ReadOnlyCtx.Provider value={true}>
      <div style={{ width: "100vw", height: "100vh", background: "#0a0a0c" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          defaultViewport={defaultViewport}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={activeTool === "select"}
          panOnDrag={activeTool === "hand" ? [0, 1, 2] : [1, 2]}
          selectionOnDrag={activeTool === "select"}
          panOnScroll={false}
          zoomOnScroll={true}
          zoomOnPinch={true}
          minZoom={0.05}
          colorMode="dark"
          style={{ background: "transparent" }}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={28} size={1.5} color="#888888" />
          <Controls
            showInteractive={false}
            className="[&>button]:!bg-[#0B0E14] [&>button]:!border-[#1A2030] [&>button]:!text-[#A0A0A0] [&>button:hover]:!text-white"
          />
        </ReactFlow>

        {/* Minimal left toolbar: select + hand */}
        <div style={{
          position: "fixed", left: "16px", top: "50%", transform: "translateY(-50%)",
          zIndex: 100, display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
          padding: "8px 5px", borderRadius: "16px",
          background: "rgba(13,13,15,0.94)",
          backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.07)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset",
          userSelect: "none",
        }}>
          {(["select", "hand"] as ToolId[]).map((tool) => {
            const isActive = activeTool === tool;
            const isHovered = hoveredTool === tool;
            return (
              <button
                key={tool}
                title={tool === "select" ? "Select (V)" : "Hand (H)"}
                onClick={() => setActiveTool(tool)}
                onMouseEnter={() => setHoveredTool(tool)}
                onMouseLeave={() => setHoveredTool(null)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: "34px", height: "34px", borderRadius: "10px",
                  border: "none", cursor: "pointer", flexShrink: 0,
                  transition: "background 150ms, color 150ms",
                  background: isActive
                    ? "rgba(255,255,255,0.92)"
                    : isHovered ? "rgba(255,255,255,0.08)" : "transparent",
                  color: isActive ? "#111" : isHovered ? "#fff" : "rgba(255,255,255,0.6)",
                }}
              >
                {tool === "select"
                  ? <MousePointer2 size={15} strokeWidth={1.8} />
                  : <Hand size={15} strokeWidth={1.8} />}
              </button>
            );
          })}
        </div>

        <div style={{
          position: "fixed", top: 16, right: 16,
          zIndex: 100, display: "flex", gap: "8px", alignItems: "center",
        }}>
          <GitHubButton
            href="https://github.com/segfault42/HeliosGen"
            data-color-scheme="no-preference: light; light: light; dark: dark;"
            data-icon="octicon-star"
            data-size="large"
            data-show-count="true"
            aria-label="Star segfault42/HeliosGen on GitHub"
          >
            Star
          </GitHubButton>
          <GitHubButton
            href="https://github.com/segfault42/HeliosGen/fork"
            data-color-scheme="no-preference: light; light: light; dark: dark;"
            data-icon="octicon-repo-forked"
            data-size="large"
            data-show-count="true"
            aria-label="Fork segfault42/HeliosGen on GitHub"
          >
            Fork
          </GitHubButton>
        </div>

        <div style={{
          position: "fixed", bottom: 16, right: 16,
          color: "rgba(255,255,255,0.2)", fontSize: 11,
          pointerEvents: "none", userSelect: "none",
        }}>
          {spaceMeta.name}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </ReadOnlyCtx.Provider>
  );
}
