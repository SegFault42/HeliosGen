"use client";
import React from "react";
import { NodeToolbar, Position } from "@xyflow/react";

interface Props {
  visible: boolean;
  hasContent: boolean;
  isSaving?: boolean;
  onPreview?: () => void;
  onDelete: () => void;
  onSave?: () => void;
  onDuplicate: () => void;
  onRename?: () => void;
}

function Btn({
  onClick,
  disabled,
  title,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-30 disabled:cursor-not-allowed ${
        danger
          ? "text-[var(--text-1)] hover:text-red-400 hover:bg-red-400/10"
          : "text-[var(--text-1)] hover:bg-[var(--bg-2)]"
      }`}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" />
      <path d="M12 2 A10 10 0 0 1 22 12" style={{ animation: "spin 0.75s linear infinite" }} />
    </svg>
  );
}

export default function NodeActionBar({ visible, hasContent, isSaving, onPreview, onDelete, onSave, onDuplicate, onRename }: Props) {
  return (
    // offset 28: the label sits at top:-20px; at 16 the bar overlapped it and
    // swallowed the second click of a rename double-click.
    <NodeToolbar isVisible={visible} position={Position.Top} offset={28}>
      <div
        className="flex items-center gap-0.5 px-1.5 py-1 node-action-bar-enter"
        style={{
          borderRadius: 999,
          background: "var(--bg-0)",
          border: "1px solid var(--border-1)",
          whiteSpace: "nowrap",
          zIndex: 10,
        }}
      >
        {onPreview !== undefined && (
          <Btn onClick={onPreview} disabled={!hasContent} title="Open preview">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </Btn>
        )}

        <span className="w-px h-4 bg-[var(--bg-2)] mx-0.5 shrink-0" />

        {onRename && (
          <Btn onClick={onRename} title="Rename node (or double-click its label)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </Btn>
        )}

        <Btn onClick={onDuplicate} title="Duplicate node">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </Btn>

        <Btn onClick={onDelete} title="Delete node" danger>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4h6v2" />
          </svg>
        </Btn>

        {onSave !== undefined && (
          <Btn onClick={onSave} disabled={!hasContent || isSaving} title={isSaving ? "Downloading…" : "Save to disk"}>
            {isSaving ? <Spinner /> : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
          </Btn>
        )}
      </div>
    </NodeToolbar>
  );
}
