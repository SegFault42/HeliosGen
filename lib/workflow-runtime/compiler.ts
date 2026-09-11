import { createHash, randomUUID } from "node:crypto";
import type { GuestSpace } from "../guest/spaces";
import type { Node, Edge } from "@xyflow/react";
import type { NodeData } from "../store";
import { IMAGE_MODELS, VIDEO_MODELS } from "../modelConfig";
import { resolveNodeInputs, buildImagePayload, buildVideoPayload } from "./generationPayloads";
import { WorkflowRuntimeError, type Plan, type PlanInput, type PlanStep, type WorkflowSnapshot, type RuntimeError } from "./contracts";

const EXEC = new Set(["generateNode", "videoGeneratorNode"]);
const DECORATION = new Set(["groupNode", "commentNode"]);
const INPUTS = new Set(["promptNode", "imageInputNode"]);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export function fingerprintSnapshot(value: unknown): string {
  const normalize = (x: unknown): unknown => Array.isArray(x) ? x.map(normalize) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x as Record<string, unknown>).sort().map(k => [k, normalize((x as Record<string, unknown>)[k])])) : x;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}
function err(code: string, message: string, nodeId?: string): RuntimeError { return { code, message, ...(nodeId ? { nodeId } : {}) }; }
function nodeIdOf(n: unknown): string { return String((n as { id?: unknown }).id ?? ""); }
function dataOf(n: unknown): NodeData { return ((n as { data?: NodeData }).data ?? {}) as NodeData; }

export function compilePlan(space: GuestSpace, input: PlanInput, now = new Date()): { plan: Plan; snapshot: WorkflowSnapshot } {
  const nodes = (space.nodes as Node<NodeData>[]).map(clone);
  const edges = (space.edges as Edge[]).map(clone);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const errors: RuntimeError[] = [];
  for (const id of input.outputNodeIds) if (!byId.has(id)) errors.push(err("missing_output", `Output node '${id}' does not exist`, id));
  const closure = new Set<string>();
  const visit = (id: string) => {
    if (closure.has(id)) return; closure.add(id);
    const n = byId.get(id); if (!n) return;
    if (!EXEC.has(n.type ?? "") && !INPUTS.has(n.type ?? "") && !DECORATION.has(n.type ?? "")) errors.push(err("unsupported_node", `Unsupported node type '${n.type}'`, id));
    for (const e of edges.filter(x => x.target === id)) {
      if (!byId.has(e.source)) { errors.push(err("dangling_edge", `Edge references missing source '${e.source}'`, id)); continue; }
      if (DECORATION.has(byId.get(e.source)!.type ?? "")) { errors.push(err("layout_edge", "Group/comment edges cannot be executed", id)); continue; }
      visit(e.source);
    }
  };
  input.outputNodeIds.forEach(visit);
  for (const e of edges) if (!byId.has(e.target)) errors.push(err("dangling_edge", `Edge references missing target '${e.target}'`, e.target));
  const deps = new Map<string, string[]>();
  for (const id of closure) deps.set(id, edges.filter(e => e.target === id && closure.has(e.source) && EXEC.has(byId.get(e.source)?.type ?? "")).map(e => e.source));
  const ordered: string[] = []; const remaining = new Set([...closure].filter(id => EXEC.has(byId.get(id)?.type ?? "")));
  while (remaining.size) { const ready = [...remaining].filter(id => (deps.get(id) ?? []).every(d => ordered.includes(d))); if (!ready.length) { errors.push(err("workflow_cycle", "Selected graph contains a cycle")); break; } ready.forEach(id => { ordered.push(id); remaining.delete(id); }); }
  const providers = input.providers ?? {};
  const steps: PlanStep[] = [];
  const snapshot = clone(space) as WorkflowSnapshot;
  snapshot.providers = clone(providers); snapshot.outputNodeIds = [...input.outputNodeIds];
  snapshot.nodes = nodes as unknown[]; snapshot.edges = edges as unknown[];
  for (const id of ordered) {
    const n = byId.get(id)!; const d = dataOf(n); const kind = n.type === "generateNode" ? "image" : "video";
    const modelId = String(kind === "image" ? d.model ?? "nano-banana-2" : d.videoModel ?? "kling-3.0");
    const model = (kind === "image" ? IMAGE_MODELS : VIDEO_MODELS).find(m => m.id === modelId);
    const provider = kind === "image" ? providers[id] : "kie";
    if (!model) errors.push(err("invalid_model", `Unknown ${kind} model '${modelId}'`, id));
    if (kind === "image" && !provider) errors.push(err("provider_required", "Choose a provider for every image generator", id));
    if (kind === "image" && provider && provider !== "codex" && provider !== "kie") errors.push(err("invalid_provider", "Unsupported image provider", id));
    const inps = resolveNodeInputs(id, nodes, edges);
    const payload = kind === "image" ? buildImagePayload(d, inps, provider ?? "kie") : buildVideoPayload(d, inps);
    const payloadPreview: Record<string, unknown> = { ...payload };
    for (const key of ["imageUrls", "startFrameUrl", "endFrameUrl", "videoRefUrl", "referenceImageUrls", "referenceVideoUrls", "referenceAudioUrls"]) if (key in payloadPreview) payloadPreview[key] = "resolved_at_runtime";
    const inputOverride = input.overrides?.[id]; if (inputOverride) errors.push(err("invalid_override", "Overrides may target prompt/image input nodes only", id));
    steps.push({ nodeId: id, kind, model: modelId, provider: provider ?? "kie", dependsOn: deps.get(id) ?? [], payloadPreview });
  }
  for (const [id, o] of Object.entries(input.overrides ?? {})) { const n = byId.get(id); if (!n || !INPUTS.has(n.type ?? "")) errors.push(err("invalid_override", "Override target must be a prompt or image input node", id)); else if (o.prompt !== undefined && n.type !== "promptNode" || o.assetUrl !== undefined && n.type !== "imageInputNode") errors.push(err("invalid_override", "Prompt and asset overrides must match node type", id)); }
  if (errors.length) throw new WorkflowRuntimeError(errors);
  for (const n of nodes) { const o = input.overrides?.[n.id]; if (!o) continue; n.data = { ...n.data, ...(o.prompt !== undefined ? { prompt: o.prompt } : {}), ...(o.assetUrl !== undefined ? { r2Url: o.assetUrl, imageUrl: o.assetUrl } : {}) }; }
  snapshot.nodes = nodes as unknown[];
  const fingerprint = fingerprintSnapshot({ spaceId: space.id, nodes, edges, providers, outputNodeIds: input.outputNodeIds });
  const plan: Plan = { planId: randomUUID(), fingerprint, spaceId: space.id, spaceName: space.name, steps, warnings: [], expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString() };
  return { plan, snapshot };
}
