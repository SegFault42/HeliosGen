"use client";
/**
 * Narrow store subscriptions for node components.
 *
 * Every node used to subscribe to the whole `nodes` / `edges` arrays, so
 * dragging one node re-rendered every node on the canvas. These hooks return
 * only the slice a node actually reads; `useShallow` keeps the returned array
 * referentially stable while its members are unchanged (applyNodeChanges
 * preserves the objects of untouched nodes), so unrelated edits no longer
 * re-render this node.
 */
import { useShallow } from "zustand/react/shallow";
import type { Edge, Node } from "@xyflow/react";
import { useWorkflowStore, type NodeData } from "./store";

/** Edges that start or end at this node. */
export function useNodeEdges(id: string): Edge[] {
  return useWorkflowStore(useShallow((s) => s.edges.filter((e) => e.source === id || e.target === id)));
}

/** This node plus every node one edge away from it. */
export function useNeighborNodes(id: string): Node<NodeData>[] {
  return useWorkflowStore(useShallow((s) => {
    const ids = new Set<string>([id]);
    for (const e of s.edges) {
      if (e.source === id) ids.add(e.target);
      else if (e.target === id) ids.add(e.source);
    }
    return s.nodes.filter((n) => ids.has(n.id));
  }));
}

/** Ids of the generators this prompt node feeds. */
function downstreamIds(edges: Edge[], id: string): Set<string> {
  const out = new Set<string>();
  for (const e of edges) if (e.source === id) out.add(e.target);
  return out;
}

/**
 * Prompt scope (two hops): the prompt's downstream generators and everything
 * else wired into those generators — that is the set of @mentionable nodes.
 */
export function usePromptScopeNodes(id: string): Node<NodeData>[] {
  return useWorkflowStore(useShallow((s) => {
    const targets = downstreamIds(s.edges, id);
    const ids = new Set<string>([id, ...targets]);
    for (const e of s.edges) if (targets.has(e.target)) ids.add(e.source);
    return s.nodes.filter((n) => ids.has(n.id));
  }));
}

/** Edges touching this prompt node plus every edge into its downstream generators. */
export function usePromptScopeEdges(id: string): Edge[] {
  return useWorkflowStore(useShallow((s) => {
    const targets = downstreamIds(s.edges, id);
    return s.edges.filter((e) => e.source === id || e.target === id || targets.has(e.target));
  }));
}

/** Currently selected nodes. */
export function useSelectedNodes(): Node<NodeData>[] {
  return useWorkflowStore(useShallow((s) => s.nodes.filter((n) => n.selected)));
}
