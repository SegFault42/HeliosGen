import type { Node } from "@xyflow/react";
import type { NodeData } from "../store";
import { resolveInputs } from "../executor";
import { resolveMentions } from "../mentions";

export type ResolvedInputs = ReturnType<typeof resolveInputs>;
export function buildImagePayload(data: NodeData, inputs: ResolvedInputs, provider: "codex" | "kie"): Record<string, unknown> {
  const model = String(data.model ?? "nano-banana-2");
  const { resolvedPrompt, orderedUrls } = resolveMentions(inputs.prompt ?? String(data.prompt ?? ""), inputs.imageNodeLabels, inputs.imageUrls);
  return { model, prompt: resolvedPrompt, imageUrls: orderedUrls, aspectRatio: String(data.aspectRatio ?? "1:1"), quality: String(data.quality ?? "1k"), ...(provider === "codex" ? { codexProvider: true } : {}) };
}
export function buildVideoPayload(data: NodeData, inputs: ResolvedInputs): Record<string, unknown> {
  const model = String(data.videoModel ?? "kling-3.0");
  const resources = inputs.resources;
  const { resolvedPrompt, orderedUrls } = resolveMentions(String(inputs.prompt ?? data.prompt ?? ""), resources.map(r => r.label), resources.map(r => r.url));
  return { videoModel: model, prompt: resolvedPrompt, aspectRatio: String(data.aspectRatio ?? "9:16"), duration: Number(data.duration ?? 5), ...(data.klingMode ? { mode: data.klingMode } : {}), ...(data.grokResolution ? { resolution: data.grokResolution } : {}), ...(data.sound !== undefined ? { sound: Boolean(data.sound) } : {}), startFrameUrl: inputs.startFrameUrl, endFrameUrl: inputs.endFrameUrl, videoRefUrl: inputs.videoRefUrl, resources: orderedUrls.map(url => resources.find(r => r.url === url) ?? { url, label: "element" }), referenceImageUrls: orderedUrls, referenceVideoUrls: inputs.referenceVideoUrls, referenceAudioUrls: inputs.referenceAudioUrls };
}
export function resolveNodeInputs(nodeId: string, nodes: Node<NodeData>[], edges: Parameters<typeof resolveInputs>[2]): ResolvedInputs { return resolveInputs(nodeId, nodes, edges); }
