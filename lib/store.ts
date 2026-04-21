import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { edgeStyle } from "./edgeStyles";
import {
  Node,
  Edge,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
  Connection,
} from "@xyflow/react";

export type NodeStatus = "idle" | "running" | "done" | "error";
export type GenerateMode = "t2i" | "t2v" | "i2i" | "i2v";

export interface NodeData extends Record<string, unknown> {
  label: string;
  status?: NodeStatus;
  // shared
  prompt?: string;
  // generate node
  mode?: GenerateMode;
  model?: string;
  aspectRatio?: string;
  duration?: number;
  // image (input or output)
  imageUrl?: string;
  inputImage?: string;      // base64 data URL — only kept while session is active
  r2Url?: string;           // R2 CDN URL — durable, used instead of inputImage after upload
  imageNaturalRatio?: string;
  // generation settings
  quality?: string;
  // video output
  videoUrl?: string;
  // video model
  videoModel?: string;
  // kling 3.0 settings
  sound?: boolean;
  klingMode?: string;
  count?: number;
  // grok imagine settings
  grokMode?: string;
  grokResolution?: string;
  // error
  errorMsg?: string;
  // validation
  hasError?: boolean;
  // pending job
  taskId?: string;
}

/** Human-readable label for each node type, including the counter */
export function getNodeLabel(type: string, n: number): string {
  const map: Record<string, string> = {
    promptNode:          `Text #${n}`,
    imageInputNode:      `Image #${n}`,
    generateNode:        `Image Generator #${n}`,
    videoGeneratorNode:  `Video Generator #${n}`,
  };
  return map[type] ?? `Node #${n}`;
}

// ── Space ─────────────────────────────────────────────────────────────────────

export interface Space {
  id: string;
  name: string;
  nodes: Node<NodeData>[];
  edges: Edge[];
  nodeCounters: Record<string, number>;
  createdAt: number;
  updatedAt?: number;
  viewport?: { x: number; y: number; zoom: number };
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function makeSpace(name: string, partial?: Partial<Space>): Space {
  return {
    id:           uid(),
    name,
    nodes:        [],
    edges:        [],
    nodeCounters: {},
    createdAt:    Date.now(),
    ...partial,
  };
}

// Sync the current nodes/edges/nodeCounters back into the spaces array.
// Call this inside every action that mutates those fields.
function syncSpace(
  spaces: Space[],
  activeId: string,
  nodes: Node<NodeData>[],
  edges: Edge[],
  nodeCounters: Record<string, number>,
): Space[] {
  return spaces.map((sp) =>
    sp.id === activeId ? { ...sp, nodes, edges, nodeCounters, updatedAt: Date.now() } : sp
  );
}

// ── Store interface ────────────────────────────────────────────────────────────

interface WorkflowStore {
  // ── Spaces
  spaces:        Space[];
  activeSpaceId: string;

  // ── Live state (mirrors the active space; kept in sync on every mutation)
  nodes:        Node<NodeData>[];
  edges:        Edge[];
  isRunning:    boolean;
  debugMode:    boolean;
  nodeCounters: Record<string, number>;

  // ── Space actions
  createSpace: (name: string) => void;
  switchSpace: (id: string)   => void;
  renameSpace: (id: string, name: string) => void;
  deleteSpace: (id: string)   => void;

  // ── Workflow actions
  onNodesChange:      (changes: NodeChange[]) => void;
  onEdgesChange:      (changes: EdgeChange[]) => void;
  onConnect:          (connection: Connection) => void;
  addNode:            (node: Node<NodeData>) => void;
  insertEdge:         (edge: Edge) => void;
  removeEdgesForHandle: (nodeId: string, handleId: string) => void;
  killEdgesForHandles:  (nodeId: string, handleIds: string[]) => void;
  remapTargetHandle:    (nodeId: string, fromHandle: string, toHandle: string) => void;
  flashEdgeError:       (edgeId: string) => void;
  updateNodeData:     (id: string, data: Partial<NodeData>) => void;
  updateNodeSize:     (id: string, width: number, height: number) => void;
  setIsRunning:       (v: boolean) => void;
  toggleDebug:        () => void;
  /** The type being dragged during an active connection ("prompt" | "image" | "video" | null) */
  connectingHandleType: string | null;
  setConnectingHandleType: (type: string | null) => void;
  authModalOpen:           boolean;
  setAuthModalOpen:        (v: boolean) => void;
  resetPasswordModalOpen:  boolean;
  setResetPasswordModalOpen: (v: boolean) => void;
  saveViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  loadSpacesFromDB: (spaces: Space[]) => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useWorkflowStore = create<WorkflowStore>()(
  persist(
    (set) => {
      const defaultSpace = makeSpace("Space 1");

      return {
        spaces:        [defaultSpace],
        activeSpaceId: defaultSpace.id,

        nodes:        [],
        edges:        [],
        isRunning:    false,
        debugMode:    false,
        nodeCounters: {},

        // ── Space actions ──────────────────────────────────────────────────

        createSpace: (name) =>
          set((s) => {
            const sp = makeSpace(name);
            // Save current live state into the active space before switching
            const spaces = [
              ...syncSpace(s.spaces, s.activeSpaceId, s.nodes, s.edges, s.nodeCounters),
              sp,
            ];
            return {
              spaces,
              activeSpaceId: sp.id,
              nodes:         [],
              edges:         [],
              nodeCounters:  {},
            };
          }),

        switchSpace: (id) =>
          set((s) => {
            if (id === s.activeSpaceId) return {};
            const target = s.spaces.find((sp) => sp.id === id);
            if (!target) return {};
            // Save current live state first
            const spaces = syncSpace(s.spaces, s.activeSpaceId, s.nodes, s.edges, s.nodeCounters);
            return {
              spaces,
              activeSpaceId: id,
              nodes:         target.nodes,
              edges:         target.edges,
              nodeCounters:  target.nodeCounters,
            };
          }),

        renameSpace: (id, name) =>
          set((s) => ({
            spaces: s.spaces.map((sp) => (sp.id === id ? { ...sp, name } : sp)),
          })),

        deleteSpace: (id) =>
          set((s) => {
            if (s.spaces.length <= 1) return {}; // must have at least one
            const remaining = s.spaces.filter((sp) => sp.id !== id);
            if (s.activeSpaceId !== id) return { spaces: remaining };
            const next = remaining[0];
            return {
              spaces:        remaining,
              activeSpaceId: next.id,
              nodes:         next.nodes,
              edges:         next.edges,
              nodeCounters:  next.nodeCounters,
            };
          }),

        // ── Workflow actions (each syncs back to spaces) ────────────────────

        onNodesChange: (changes) =>
          set((s) => {
            const nodes = applyNodeChanges(changes, s.nodes) as Node<NodeData>[];
            const removedIds = new Set(
              changes
                .filter((c): c is Extract<NodeChange, { type: "remove" }> => c.type === "remove")
                .map((c) => c.id)
            );
            const edges = removedIds.size > 0
              ? s.edges.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target))
              : s.edges;
            return {
              nodes,
              edges,
              spaces: syncSpace(s.spaces, s.activeSpaceId, nodes, edges, s.nodeCounters),
            };
          }),

        onEdgesChange: (changes) =>
          set((s) => {
            const edges = applyEdgeChanges(changes, s.edges);
            return {
              edges,
              spaces: syncSpace(s.spaces, s.activeSpaceId, s.nodes, edges, s.nodeCounters),
            };
          }),

        onConnect: (connection) =>
          set((s) => {
            // Detect Motion Control's startFrame (displayed as "Character") for correct edge color
            let colorKey: string | undefined;
            if (connection.targetHandle === "startFrame") {
              const targetNode = s.nodes.find((n) => n.id === connection.target);
              const videoModelId = (targetNode?.data?.videoModel as string | undefined) ?? "";
              if (videoModelId === "kling-2.6-motion-control") colorKey = "character";
            }
            const edges = addEdge(
              {
                ...connection,
                animated: false,
                style: edgeStyle(connection.targetHandle),
                ...(colorKey ? { data: { colorKey } } : {}),
              },
              s.edges
            );
            return {
              edges,
              spaces: syncSpace(s.spaces, s.activeSpaceId, s.nodes, edges, s.nodeCounters),
            };
          }),

        addNode: (node) =>
          set((s) => {
            const type         = node.type ?? "unknown";
            const count        = (s.nodeCounters[type] ?? 0) + 1;
            const label        = getNodeLabel(type, count);
            const nodes        = [...s.nodes, { ...node, data: { ...node.data, label } }];
            const nodeCounters = { ...s.nodeCounters, [type]: count };
            return {
              nodes,
              nodeCounters,
              spaces: syncSpace(s.spaces, s.activeSpaceId, nodes, s.edges, nodeCounters),
            };
          }),

        insertEdge: (edge) =>
          set((s) => {
            const edges = [...s.edges, edge];
            return {
              edges,
              spaces: syncSpace(s.spaces, s.activeSpaceId, s.nodes, edges, s.nodeCounters),
            };
          }),

        removeEdgesForHandle: (nodeId, handleId) =>
          set((s) => {
            const edges = s.edges.filter(
              (e) => !(e.target === nodeId && e.targetHandle === handleId)
            );
            return {
              edges,
              spaces: syncSpace(s.spaces, s.activeSpaceId, s.nodes, edges, s.nodeCounters),
            };
          }),

        killEdgesForHandles: (nodeId, handleIds) => {
          const handleSet = new Set(handleIds);
          // Mark matching edges as dying
          set((s) => ({
            edges: s.edges.map((e) =>
              e.target === nodeId && handleSet.has(e.targetHandle ?? "")
                ? { ...e, data: { ...e.data, dying: true } }
                : e
            ),
          }));
          // Remove after animation
          setTimeout(() => {
            set((s) => {
              const edges = s.edges.filter(
                (e) => !(e.target === nodeId && handleSet.has(e.targetHandle ?? ""))
              );
              return {
                edges,
                spaces: syncSpace(s.spaces, s.activeSpaceId, s.nodes, edges, s.nodeCounters),
              };
            });
          }, 450);
        },

        remapTargetHandle: (nodeId, fromHandle, toHandle) =>
          set((s) => {
            const edges = s.edges.map((e) =>
              e.target === nodeId && e.targetHandle === fromHandle
                ? { ...e, targetHandle: toHandle }
                : e
            );
            return { edges, spaces: syncSpace(s.spaces, s.activeSpaceId, s.nodes, edges, s.nodeCounters) };
          }),

        flashEdgeError: (edgeId) => {
          const setError = (val: boolean) =>
            set((s) => ({
              edges: s.edges.map((e) =>
                e.id === edgeId ? { ...e, data: { ...e.data, error: val } } : e
              ),
            }));
          setError(true);
          setTimeout(() => setError(false), 1400);
        },

        updateNodeData: (id, data) =>
          set((s) => {
            const nodes = s.nodes.map((n) =>
              n.id === id ? { ...n, data: { ...n.data, ...data } } : n
            );
            return {
              nodes,
              spaces: syncSpace(s.spaces, s.activeSpaceId, nodes, s.edges, s.nodeCounters),
            };
          }),

        updateNodeSize: (id, width, height) =>
          set((s) => {
            const GROUP_PADDING = 24;

            // Update the resized node first
            let nodes = s.nodes.map((n) =>
              n.id === id
                ? { ...n, width, height, style: { ...n.style, width, height } }
                : n
            );

            // Expand the group if the resized node now exceeds its bounds (never shrink)
            nodes = nodes.map((g) => {
              if (g.type !== "groupNode") return g;
              const memberIds = g.data?.memberIds as string[] | undefined;
              if (!memberIds?.includes(id)) return g;

              const node = nodes.find((n) => n.id === id);
              if (!node) return g;

              const gx = g.position.x;
              const gy = g.position.y;
              const gw = (g.style?.width  as number | undefined) ?? 0;
              const gh = (g.style?.height as number | undefined) ?? 0;

              // Right and bottom edges the node now occupies
              const nodeR = node.position.x + width;
              const nodeB = node.position.y + height;

              // Required group extents to contain the node (with padding)
              const reqX = Math.min(gx, node.position.x - GROUP_PADDING);
              const reqY = Math.min(gy, node.position.y - GROUP_PADDING);
              const reqR = Math.max(gx + gw, nodeR + GROUP_PADDING);
              const reqB = Math.max(gy + gh, nodeB + GROUP_PADDING);

              if (reqX === gx && reqY === gy && reqR === gx + gw && reqB === gy + gh) return g;

              return {
                ...g,
                position: { x: reqX, y: reqY },
                style: { ...g.style, width: reqR - reqX, height: reqB - reqY },
              };
            });

            return {
              nodes,
              spaces: syncSpace(s.spaces, s.activeSpaceId, nodes, s.edges, s.nodeCounters),
            };
          }),

        setIsRunning:     (v) => set({ isRunning: v }),
        toggleDebug:      () => set((s) => ({ debugMode: !s.debugMode })),

        connectingHandleType: null,
        setConnectingHandleType: (type) => set({ connectingHandleType: type }),

        saveViewport: (viewport) =>
          set((s) => ({
            spaces: s.spaces.map((sp) =>
              sp.id === s.activeSpaceId ? { ...sp, viewport } : sp
            ),
          })),

        loadSpacesFromDB: (dbSpaces) =>
          set((s) => {
            if (!dbSpaces.length) return {};

            // Build a lookup of local spaces by id
            const localById = new Map(s.spaces.map((sp) => [sp.id, sp]));

            // For each DB space, prefer whichever version is newer (local wins on tie)
            const merged = dbSpaces.map((dbSp) => {
              const local = localById.get(dbSp.id);
              if (!local) return dbSp;
              const localTs = local.updatedAt ?? local.createdAt ?? 0;
              const dbTs    = dbSp.updatedAt  ?? dbSp.createdAt  ?? 0;
              return localTs >= dbTs ? local : dbSp;
            });

            // Add any local-only spaces not in the DB (created offline)
            const dbIds = new Set(dbSpaces.map((sp) => sp.id));
            for (const sp of s.spaces) {
              if (!dbIds.has(sp.id)) merged.push(sp);
            }

            const activeId = merged.find((sp) => sp.id === s.activeSpaceId)?.id ?? merged[0].id;
            const active   = merged.find((sp) => sp.id === activeId)!;
            return {
              spaces:        merged,
              activeSpaceId: activeId,
              nodes:         active.nodes,
              edges:         active.edges,
              nodeCounters:  active.nodeCounters,
            };
          }),

        authModalOpen:             false,
        setAuthModalOpen:          (v) => set({ authModalOpen: v }),
        resetPasswordModalOpen:    false,
        setResetPasswordModalOpen: (v) => set({ resetPasswordModalOpen: v }),
      };
    },
    {
      name: "ai-workflow",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        spaces: s.spaces.map((sp) => ({
          ...sp,
          viewport: sp.viewport,
          // Strip base64 inputImage — only the durable r2Url survives reload
          nodes: sp.nodes.map((n) => ({
            ...n,
            data: { ...n.data, inputImage: undefined },
          })),
        })),
        activeSpaceId: s.activeSpaceId,
        // Also persist the live copies so a page refresh rehydrates correctly
        nodes: s.nodes.map((n) => ({
          ...n,
          data: { ...n.data, inputImage: undefined },
        })),
        edges:        s.edges,
        nodeCounters: s.nodeCounters,
        debugMode:    s.debugMode,
      }),

      // Migration: v0 had flat nodes/edges/nodeCounters; wrap them in a space
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // If there are no spaces (old format), migrate
        if (!state.spaces || state.spaces.length === 0) {
          const sp = makeSpace("Space 1", {
            nodes:        state.nodes        ?? [],
            edges:        state.edges        ?? [],
            nodeCounters: state.nodeCounters ?? {},
          });
          state.spaces        = [sp];
          state.activeSpaceId = sp.id;
        }
      },
    }
  )
);
