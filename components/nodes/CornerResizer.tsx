"use client";
import { NodeResizeControl } from "@xyflow/react";
import type { ControlPosition } from "@xyflow/react";

interface Props {
  keepAspectRatio?: boolean;
  minWidth?: number;
  minHeight?: number;
}

const S = 8;     // handle bounding box (px)
const T = 1.5;   // border thickness (px)
const R = 4;     // corner radius
const O = -6;    // offset: push handle outside the card border
const C = "#707070"; // muted gray

type CornerDef = {
  position: ControlPosition;
  style: React.CSSProperties;
};

function corner(
  position: ControlPosition,
  borderStyle: React.CSSProperties,
  offset: { top?: number; right?: number; bottom?: number; left?: number }
): CornerDef {
  return {
    position,
    style: {
      width: S,
      height: S,
      background: "transparent",
      border: "none",
      ...borderStyle,
      ...offset,
    },
  };
}

const CORNERS: CornerDef[] = [
  corner(
    "top-left",
    { borderTop: `${T}px solid ${C}`, borderLeft: `${T}px solid ${C}`, borderTopLeftRadius: R },
    { top: O, left: O }
  ),
  corner(
    "top-right",
    { borderTop: `${T}px solid ${C}`, borderRight: `${T}px solid ${C}`, borderTopRightRadius: R },
    { top: O, right: O }
  ),
  corner(
    "bottom-left",
    { borderBottom: `${T}px solid ${C}`, borderLeft: `${T}px solid ${C}`, borderBottomLeftRadius: R },
    { bottom: O, left: O }
  ),
  corner(
    "bottom-right",
    { borderBottom: `${T}px solid ${C}`, borderRight: `${T}px solid ${C}`, borderBottomRightRadius: R },
    { bottom: O, right: O }
  ),
];

export default function CornerResizer({ keepAspectRatio, minWidth = 100, minHeight = 60 }: Props) {
  return (
    <>
      {CORNERS.map(({ position, style }) => (
        <NodeResizeControl
          key={position}
          position={position}
          minWidth={minWidth}
          minHeight={minHeight}
          keepAspectRatio={keepAspectRatio}
          className="corner-handle"
          style={style}
        />
      ))}
    </>
  );
}
