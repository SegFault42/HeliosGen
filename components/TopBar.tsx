"use client";
import { useEffect, useRef, useState } from "react";

interface TopBarProps {
  isRunning: boolean;
  canRun: boolean;
  onRunAll: () => void;
  hasNodes: boolean;
  onClear: () => void;
  debugMode: boolean;
  onToggleDebug: () => void;
  onOpenSettings: () => void;
}

export default function TopBar({
  isRunning, canRun, onRunAll, hasNodes, onClear, debugMode, onToggleDebug, onOpenSettings,
}: TopBarProps) {
  const prevRunning = useRef(false);

  const initialDPR = useRef(typeof window !== "undefined" ? window.devicePixelRatio : 1);
  const [counterZoom, setCounterZoom] = useState(1);
  useEffect(() => {
    const update = () => {
      const browserZoom = window.devicePixelRatio / initialDPR.current;
      setCounterZoom(1 / browserZoom);
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Refresh navbar credits after a run completes by dispatching a custom event
  useEffect(() => {
    if (prevRunning.current && !isRunning) {
      window.dispatchEvent(new Event("credits-refresh"));
    }
    prevRunning.current = isRunning;
  }, [isRunning]);

  return (
    <div
      style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "flex-end",
        height:         "40px",
        padding:        "0 12px",
        borderBottom:   "1px solid rgba(255,255,255,0.05)",
        background:     "#080A0C",
        flexShrink:     0,
        userSelect:     "none",
        position:       "relative",
        zIndex:         10,
        zoom:           counterZoom,
        gap:            "8px",
      }}
    >
      <button
        onClick={onToggleDebug}
        className={`toolbar-btn flex items-center gap-1.5 ${debugMode ? "!border-amber-500/60 !text-amber-400" : ""}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${debugMode ? "bg-amber-400" : "bg-[#333333]"}`} />
        Debug
      </button>

      {hasNodes && (
        <button onClick={onClear} disabled={isRunning} className="toolbar-btn">
          Clear
        </button>
      )}

      <button onClick={onRunAll} disabled={!canRun} className="toolbar-btn-primary">
        {isRunning ? (
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 border border-[#2A1A14] border-t-transparent rounded-full animate-spin" />
            Running
          </span>
        ) : (
          "Run all"
        )}
      </button>

      <button onClick={onOpenSettings} className="toolbar-btn" title="Settings">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  );
}
