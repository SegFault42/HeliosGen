"use client";
import { useCallback } from "react";
import { NodeProps, Node, NodeResizer } from "@xyflow/react";
import { useWorkflowStore, NodeData } from "@/lib/store";
import { useReadOnly } from "@/lib/readOnlyContext";

type CommentNodeType = Node<NodeData, "commentNode">;

const ACCENT = "var(--warning)"; // amber-400

export default function CommentNode({ id, data, selected }: NodeProps<CommentNodeType>) {
  const readOnly = useReadOnly();
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);

  const editable = selected && !readOnly;

  const handleDelete = useCallback(() => {
    onNodesChange([{ type: "remove", id }]);
  }, [id, onNodesChange]);

  return (
    <div
      className="w-full h-full flex flex-col rounded-lg overflow-hidden shadow-lg"
      style={{
        background: "var(--bg-2)",
        border: `1px solid ${ACCENT}44`,
        }}
    >
      <NodeResizer
        isVisible={editable}
        minWidth={140}
        minHeight={90}
        color={ACCENT}
        handleStyle={{ width: 8, height: 8, borderRadius: 2 }}
      />

      {/* Header — doubles as the drag handle */}
      <div
        className="flex items-center justify-between gap-2 px-2.5 py-1.5 select-none"
        style={{
          borderBottom: `1px solid ${ACCENT}22`,
          background: "var(--bg-2)",
        }}
      >
        <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: `${ACCENT}dd` }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Comment
        </span>
        {editable && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
            title="Delete comment"
            className="nodrag flex items-center justify-center w-5 h-5 rounded transition-colors"
            style={{ color: `${ACCENT}99` }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--error)"; e.currentTarget.style.background = "var(--bg-2)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = `${ACCENT}99`; e.currentTarget.style.background = "transparent"; }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
          </button>
        )}
      </div>

      {/* Text input — editable only while the node is selected, so an unselected
          note can be dragged from anywhere on its body. */}
      <textarea
        className="nokey nodrag nowheel flex-1 w-full bg-transparent text-[13px] leading-relaxed p-2.5 resize-none focus:outline-none placeholder:text-yellow-200/35"
        style={{
          color: "var(--text-1)",
          pointerEvents: editable ? "auto" : "none",
        }}
        placeholder="Write a comment…"
        value={(data.comment as string) ?? ""}
        readOnly={readOnly}
        onChange={(e) => updateNodeData(id, { comment: e.target.value })}
      />
    </div>
  );
}
