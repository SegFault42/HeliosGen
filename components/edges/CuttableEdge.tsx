"use client";
import { useState, useRef } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { edgeStyle } from "@/lib/edgeStyles";

export default function CuttableEdge({
  id,
  sourceX, sourceY,
  targetX, targetY,
  sourcePosition, targetPosition,
  targetHandleId,
  markerEnd,
}: EdgeProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const style = edgeStyle(targetHandleId);
  const color = (style.stroke as string) ?? "#555";

  const [edgePath] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  function handleMouseMove(e: React.MouseEvent) {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }

    const cursor = screenToFlowPosition({ x: e.clientX, y: e.clientY });

    // Find the point on the curve closest to the cursor
    const el = pathRef.current;
    if (el) {
      const total = el.getTotalLength();
      let lo = 0, hi = total;
      // Coarse scan first
      let best = el.getPointAtLength(0);
      let bestDist = Infinity;
      const STEPS = 64;
      for (let i = 0; i <= STEPS; i++) {
        const pt = el.getPointAtLength((i / STEPS) * total);
        const d = Math.hypot(pt.x - cursor.x, pt.y - cursor.y);
        if (d < bestDist) { bestDist = d; best = pt; lo = Math.max(0, (i - 1) / STEPS * total); hi = Math.min(total, (i + 1) / STEPS * total); }
      }
      // Binary search refinement
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        const ptLo  = el.getPointAtLength(mid - (hi - lo) / 4);
        const ptHi  = el.getPointAtLength(mid + (hi - lo) / 4);
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
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{ ...style, pointerEvents: "none" }}
      />

      {/* Wide transparent hit area on top */}
      <path
        ref={pathRef}
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: "pointer", pointerEvents: "stroke" }}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)`,
            pointerEvents: visible ? "all" : "none",
            zIndex: 10,
            opacity: visible ? 1 : 0,
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
            border: `2px solid ${color}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: `0 2px 12px rgba(0,0,0,0.6), 0 0 8px ${color}44`,
          }}>
            <ScissorIcon color={color} />
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
