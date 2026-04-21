"use client";
import { useState, useRef, useEffect } from "react";
import {
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  useNodes,
  type EdgeProps,
} from "@xyflow/react";
import { edgeStyle, getSourceHandleColor } from "@/lib/edgeStyles";

export default function CuttableEdge({
  id,
  source,
  sourceX, sourceY,
  targetX, targetY,
  sourcePosition, targetPosition,
  sourceHandleId,
  targetHandleId,
  markerEnd,
  data,
}: EdgeProps) {
  const edgeData = data as Record<string, unknown> | undefined;
  const dying    = edgeData?.dying    === true;
  const error    = edgeData?.error    === true;
  const dimmed   = edgeData?.dimmed   === true;
  const colorKey = typeof edgeData?.colorKey === "string" ? edgeData.colorKey : undefined;

  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [pathLength, setPathLength] = useState(0);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const nodes = useNodes();
  const srcNode = nodes.find((n) => n.id === source);

  const tgtStyle   = edgeStyle(colorKey ?? targetHandleId);
  const tgtColor   = (tgtStyle.stroke as string) ?? "#555";
  const srcColor   = getSourceHandleColor(srcNode?.type, sourceHandleId);
  const strokeWidth = (tgtStyle.strokeWidth as number) ?? 2;

  // Per-edge gradient ID — unique within the SVG document
  const gradId     = `eg-${id}`;
  const useGradient = srcColor !== tgtColor;
  // stroke value: URL ref for gradient, solid color otherwise
  const strokeValue = useGradient ? `url(#${gradId})` : tgtColor;
  // --edge-color used by the error-blink keyframe; must be a resolvable stroke value
  const edgeColorVar = strokeValue;
  // Scissor badge uses mid-point color (average of both ends for simplicity)
  const badgeColor = useGradient ? tgtColor : tgtColor;

  const [edgePath] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  // Measure path length after render
  useEffect(() => {
    if (pathRef.current) setPathLength(pathRef.current.getTotalLength());
  }, [edgePath]);

  function handleMouseMove(e: React.MouseEvent) {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    const cursor = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const el = pathRef.current;
    if (el) {
      const total = el.getTotalLength();
      let lo = 0, hi = total;
      let best = el.getPointAtLength(0);
      let bestDist = Infinity;
      const STEPS = 64;
      for (let i = 0; i <= STEPS; i++) {
        const pt = el.getPointAtLength((i / STEPS) * total);
        const d = Math.hypot(pt.x - cursor.x, pt.y - cursor.y);
        if (d < bestDist) {
          bestDist = d; best = pt;
          lo = Math.max(0, (i - 1) / STEPS * total);
          hi = Math.min(total, (i + 1) / STEPS * total);
        }
      }
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        const ptLo = el.getPointAtLength(mid - (hi - lo) / 4);
        const ptHi = el.getPointAtLength(mid + (hi - lo) / 4);
        const dLo = Math.hypot(ptLo.x - cursor.x, ptLo.y - cursor.y);
        const dHi = Math.hypot(ptHi.x - cursor.x, ptHi.y - cursor.y);
        if (dLo < dHi) { hi = mid; best = ptLo; } else { lo = mid; best = ptHi; }
      }
      setPos({ x: best.x, y: best.y });
    } else {
      setPos(cursor);
    }
    setVisible(true);
  }

  function handleMouseLeave() {
    leaveTimer.current = setTimeout(() => setVisible(false), 80);
  }

  function handleBadgeEnter() {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
  }

  return (
    <>
      {/* Gradient definition — userSpaceOnUse so it follows the edge direction */}
      {useGradient && (
        <defs>
          <linearGradient
            id={gradId}
            gradientUnits="userSpaceOnUse"
            x1={sourceX} y1={sourceY}
            x2={targetX} y2={targetY}
          >
            <stop offset="0%"   stopColor={srcColor} />
            <stop offset="100%" stopColor={tgtColor} />
          </linearGradient>
        </defs>
      )}

      {/* Visible edge line — animates out right-to-left when dying */}
      <path
        ref={pathRef}
        d={edgePath}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={pathLength > 0 ? pathLength : undefined}
        strokeDashoffset={dying ? pathLength : 0}
        style={{
          stroke: strokeValue,
          ["--edge-color" as string]: edgeColorVar,
          pointerEvents: "none",
          opacity: dimmed ? 0.15 : 1,
          transition: [
            dying  ? "stroke-dashoffset 0.42s ease-in" : null,
            "opacity 150ms",
          ].filter(Boolean).join(", "),
          animation: error ? "edge-error-blink 1.4s ease 1 forwards" : undefined,
        }}
      />

      {/* Wide transparent hit area on top */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: "pointer", pointerEvents: dying ? "none" : "stroke" }}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)`,
            pointerEvents: visible && !dying ? "all" : "none",
            zIndex: 10,
            opacity: visible && !dying ? 1 : 0,
            transition: "opacity 180ms ease",
          }}
          onMouseEnter={handleBadgeEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "#0D1012",
            border: `2px solid ${badgeColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: `0 2px 12px rgba(0,0,0,0.6), 0 0 8px ${badgeColor}44`,
          }}>
            <ScissorIcon color={badgeColor} />
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function ScissorIcon({ color }: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
    </svg>
  );
}
