"use client";
import React, { useState } from "react";

interface Props {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  extracting?: boolean;
  warningMessages?: string[];
}

export default function GenerateButton({ onClick, busy, disabled, extracting, warningMessages }: Props) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const hasWarning = !!(warningMessages?.length);

  const bg = hasWarning
    ? "var(--bg-2)"
    : extracting
    ? "var(--bg-2)"
    : "var(--accent)";

  const border = hasWarning
    ? "1px solid var(--bg-2)"
    : extracting
    ? "1px solid var(--bg-2)"
    : "1px solid var(--accent)";

  return (
    <div
      style={{ position: "relative", flexShrink: 0 }}
      onMouseEnter={() => hasWarning && setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
    >
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        disabled={disabled || busy || extracting}
        className="h-7 px-3 rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-50 hover:brightness-110"
        style={{
          background: bg,
          border,
          cursor: disabled || busy || hasWarning ? "not-allowed" : "pointer",
        }}
      >
        {busy ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite" }}>
            <circle cx="5" cy="5" r="4" stroke="var(--on-accent)" strokeWidth="1.5" opacity="0.35" />
            <path d="M5 1 A4 4 0 0 1 9 5" stroke="var(--on-accent)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : extracting ? (
          <>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}>
              <circle cx="5" cy="5" r="4" stroke="var(--bg-2)" strokeWidth="1.5" />
              <path d="M5 1 A4 4 0 0 1 9 5" stroke="var(--warning)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="text-[12px] font-medium" style={{ color: "var(--warning)" }}>Extracting…</span>
          </>
        ) : (
          <>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={hasWarning ? "var(--error)" : "var(--on-accent)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            <span className="text-[12px] font-medium" style={{ color: hasWarning ? "var(--error)" : "var(--on-accent)" }}>Generate</span>
          </>
        )}
      </button>

      {tooltipVisible && warningMessages && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 5px)",
            right: 0,
            background: "var(--bg-0)",
            border: "1px solid var(--bg-2)",
            borderRadius: 6,
            padding: "5px 9px",
            whiteSpace: "nowrap",
            fontSize: 12,
            color: "var(--text-2)",
            zIndex: 200,
            pointerEvents: "none",
          }}
        >
          {warningMessages.map((msg, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--error)", fontSize: 12 }}>●</span>
              {msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
