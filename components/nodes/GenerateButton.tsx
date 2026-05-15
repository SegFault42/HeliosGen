"use client";
import React from "react";

interface Props {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}

export default function GenerateButton({ onClick, busy, disabled }: Props) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled || busy}
      className="shrink-0 h-7 px-3 rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-30 hover:brightness-110"
      style={{
        background: "rgba(45,212,191,0.18)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(45,212,191,0.55)",
      }}
    >
      {busy ? (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite" }}>
          <circle cx="5" cy="5" r="4" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" />
          <path d="M5 1 A4 4 0 0 1 9 5" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ) : (
        <>
          <svg width="9" height="9" viewBox="0 0 8 8" fill="currentColor" style={{ color: "rgba(255,255,255,0.9)", flexShrink: 0 }}>
            <polygon points="1,0.5 7.5,4 1,7.5" />
          </svg>
          <span className="text-[11px] font-medium text-white/90">Generate</span>
        </>
      )}
    </button>
  );
}
