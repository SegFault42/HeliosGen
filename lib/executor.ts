import { Node, Edge } from "@xyflow/react";
import { NodeData } from "./store";

/** Topological sort — returns node ids in execution order */
export function topoSort(nodes: Node<NodeData>[], edges: Edge[]): string[] {
  const adj: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};

  for (const n of nodes) {
    adj[n.id] = [];
    inDegree[n.id] = 0;
  }
  for (const e of edges) {
    adj[e.source].push(e.target);
    inDegree[e.target] = (inDegree[e.target] || 0) + 1;
  }

  const queue = Object.entries(inDegree)
    .filter(([, d]) => d === 0)
    .map(([id]) => id);
  const order: string[] = [];

  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adj[id]) {
      inDegree[next]--;
      if (inDegree[next] === 0) queue.push(next);
    }
  }
  return order;
}

/** Returns waves of generation node IDs in dependency order.
 *  Nodes in the same wave have no inter-dependencies and run in parallel.
 *  Each wave must complete before the next starts. */
export function buildPipelineWaves(nodes: Node<NodeData>[], edges: Edge[]): string[][] {
  const genIds = new Set(
    nodes
      .filter(n => n.type === "generateNode" || n.type === "videoGeneratorNode")
      .map(n => n.id)
  );
  if (genIds.size === 0) return [];

  // Only edges between gen nodes affect ordering
  const deps = new Map<string, Set<string>>();
  for (const id of genIds) deps.set(id, new Set());
  for (const e of edges) {
    if (genIds.has(e.source) && genIds.has(e.target)) {
      deps.get(e.target)!.add(e.source);
    }
  }

  const waves: string[][] = [];
  const remaining = new Set(genIds);
  while (remaining.size > 0) {
    const wave = [...remaining].filter(id =>
      [...(deps.get(id) ?? [])].every(dep => !remaining.has(dep))
    );
    if (wave.length === 0) break; // cycle guard
    waves.push(wave);
    for (const id of wave) remaining.delete(id);
  }
  return waves;
}

/** Resolve upstream prompt + images for a target node */
export function resolveInputs(
  nodeId: string,
  nodes: Node<NodeData>[],
  edges: Edge[]
): {
  prompt?: string;
  imageUrls: string[];
  /** Node labels in the same order as imageUrls — used to resolve @mentions */
  imageNodeLabels: string[];
  startFrameUrl?: string;
  endFrameUrl?: string;
  videoRefUrl?: string;
  resources: Array<{ url: string; label: string }>;
  referenceVideoUrls: string[];
  referenceAudioUrls: string[];
} {
  const incoming = edges.filter((e) => e.target === nodeId);
  const result = {
    imageUrls:          [] as string[],
    imageNodeLabels:    [] as string[],
    resources:          [] as Array<{ url: string; label: string }>,
    startFrameUrl:      undefined as string | undefined,
    endFrameUrl:        undefined as string | undefined,
    videoRefUrl:        undefined as string | undefined,
    prompt:             undefined as string | undefined,
    referenceVideoUrls: [] as string[],
    referenceAudioUrls: [] as string[],
  };

  for (const edge of incoming) {
    const src = nodes.find((n) => n.id === edge.source);
    if (!src) continue;

    // Prompt sources
    if (src.type === "promptNode") {
      result.prompt = src.data.prompt as string | undefined;
    }
    if (src.type === "assistantNode") {
      result.prompt = src.data.outputText as string | undefined;
    }

    // "image" handle — multi-image input for generateNode (up to 14)
    if (edge.targetHandle === "image") {
      const imgSrc = (src.data.capturedFrameUrl ?? src.data.r2Url ?? src.data.inputImage ?? src.data.imageUrl) as string | undefined;
      if (imgSrc) {
        result.imageUrls.push(imgSrc);
        result.imageNodeLabels.push((src.data.label as string | undefined) ?? "");
      }
      // Carry upstream prompt if current node doesn't have one
      if ((src.type === "generateNode" || src.type === "videoGeneratorNode") && src.data.prompt && !result.prompt) {
        result.prompt = src.data.prompt as string;
      }
    }

    // "startFrame" handle — Kling first frame
    if (edge.targetHandle === "startFrame") {
      const url = (src.data.capturedFrameUrl ?? src.data.r2Url ?? src.data.inputImage ?? src.data.imageUrl) as string | undefined;
      if (url) result.startFrameUrl = url;
    }

    // "endFrame" handle — Kling last frame
    if (edge.targetHandle === "endFrame") {
      const url = (src.data.capturedFrameUrl ?? src.data.r2Url ?? src.data.inputImage ?? src.data.imageUrl) as string | undefined;
      if (url) result.endFrameUrl = url;
    }

    // "resource" handle — reference images (cap enforced at node level via maxResources)
    if (edge.targetHandle === "resource") {
      const url = (src.data.capturedFrameUrl ?? src.data.r2Url ?? src.data.inputImage ?? src.data.imageUrl) as string | undefined;
      const label = src.data.label as string | undefined;
      if (url) result.resources.push({ url, label: label ?? "element" });
    }

    // "videoRef" handle — motion-control reference video (single)
    if (edge.targetHandle === "videoRef") {
      const url = src.data.videoUrl as string | undefined;
      if (url) result.videoRefUrl = url;
    }

    // "referenceVideo" handle — multi-video references (e.g. Seedance)
    if (edge.targetHandle === "referenceVideo") {
      const url = (src.data.videoUrl ?? src.data.r2Url) as string | undefined;
      if (url) result.referenceVideoUrls.push(url);
    }

    // "audioRef" handle — audio references (e.g. Seedance)
    if (edge.targetHandle === "audioRef") {
      const url = (src.data.audioUrl ?? src.data.r2Url) as string | undefined;
      if (url) result.referenceAudioUrls.push(url);
    }

    // Upstream video generator — carry its prompt downstream
    if (src.type === "videoGeneratorNode") {
      if (src.data.prompt && !result.prompt) result.prompt = src.data.prompt as string;
    }
  }
  return result;
}
