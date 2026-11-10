"use client";
import React, { useEffect, useRef, useState } from "react";
import { useWorkflowStore } from "@/lib/store";
import { useReadOnly } from "@/lib/readOnlyContext";

/**
 * The small label above a node. Double-click to rename; Enter saves, Esc
 * cancels. Renaming rewrites @mentions everywhere (store.renameNode). A name
 * that is empty or already used by another node is refused and the field
 * turns red until you change it.
 */
export const RENAME_EVENT = "anvil:rename-node";
/** Ask the label of node `id` to enter edit mode (used by action-bar pencil buttons). */
export function requestRename(id: string) {
  window.dispatchEvent(new CustomEvent(RENAME_EVENT, { detail: id }));
}

export default function NodeLabel({
  id, label, children, style,
}: { id: string; label: string; children?: React.ReactNode; style?: React.CSSProperties }) {
  const renameNode = useWorkflowStore((s) => s.renameNode);
  const readOnly = useReadOnly();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  // Pencil buttons elsewhere (action bars) open the editor through this event.
  useEffect(() => {
    if (readOnly) return;
    const onRename = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) return;
      setDraft(label);
      setEditing(true);
    };
    window.addEventListener(RENAME_EVENT, onRename);
    return () => window.removeEventListener(RENAME_EVENT, onRename);
  }, [id, label, readOnly]);

  const commit = () => {
    if (renameNode(id, draft)) { setEditing(false); setInvalid(false); }
    else setInvalid(true);
  };
  const cancel = () => { setEditing(false); setInvalid(false); setDraft(label); };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setInvalid(false); }}
        onKeyDown={(e) => {
          e.stopPropagation(); // keep Delete/Backspace/Enter away from the canvas
          if (e.key === "Enter" || e.keyCode === 13) commit();
          else if (e.key === "Escape") cancel();
        }}
        onBlur={commit}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="node-above-label nodrag"
        spellCheck={false}
        maxLength={40}
        style={{
          ...style,
          background: "var(--bg-1)",
          border: `1px solid ${invalid ? "var(--error)" : "var(--accent)"}`,
          color: invalid ? "var(--error)" : "var(--text-1)",
          borderRadius: 4,
          padding: "1px 6px",
          outline: "none",
          width: `${Math.max(8, draft.length + 2)}ch`,
        }}
        title={invalid ? "Empty or already used by another node" : undefined}
      />
    );
  }

  return (
    // nodrag: otherwise React Flow's drag handler captures the pointer on the
    // first mousedown and the browser fires dblclick on the node wrapper, not here.
    <span
      className="node-above-label nodrag"
      style={style}
      title={readOnly ? undefined : "Double-click to rename"}
      onDoubleClick={(e) => {
        if (readOnly) return;
        e.stopPropagation();
        setDraft(label);
        setEditing(true);
      }}
    >
      {children}
      {label}
    </span>
  );
}
