import type { Node } from "@xyflow/react";
import type { NodeData } from "../store";
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS, IMAGE_MODELS } from "../modelConfig";
import { resolveInputs } from "../executor";
import { resolveMentions } from "../mentions";
import { needsVideoRights, videoRightsAffirmed } from "../videoRights";

export type ResolvedInputs = ReturnType<typeof resolveInputs>;
export function buildImagePayload(data: NodeData, inputs: ResolvedInputs, provider: "codex" | "kie" | "flow" | "grok"): Record<string, unknown> {
  const model = String(data.model ?? "nano-banana-2");
  const { resolvedPrompt, orderedUrls } = resolveMentions(inputs.prompt ?? String(data.prompt ?? ""), inputs.imageNodeLabels, inputs.imageUrls);
  // Same default and fallback the node shows (GenerateNode: "9:16", else the model's first ratio).
  const rawRatio = String(data.aspectRatio ?? "9:16"); const ratios = IMAGE_MODELS.find((m) => m.id === model)?.ratios;
  const aspectRatio = !ratios || ratios.includes(rawRatio) || rawRatio === "custom" ? rawRatio : (ratios[0] ?? "1:1");
  return { model, prompt: resolvedPrompt, imageUrls: orderedUrls, aspectRatio, quality: String(data.quality ?? "1k"), ...(provider === "codex" ? { codexProvider: true } : {}) };
}
export function buildVideoPayload(data: NodeData, inputs: ResolvedInputs): Record<string, unknown> {
  const model = String(data.videoModel ?? DEFAULT_VIDEO_MODEL);
  const config = VIDEO_MODELS.find((item) => item.id === model);
  // Flow does not expose a duration control for Omni Flash. The plan must
  // reflect the provider's fixed output length, even for older 5s canvas nodes.
  const fixedFlowDuration = config?.apiInput.useFlow && config.durations.length === 1
    ? config.durations[0] : undefined;
  const resources = inputs.resources;
  // Kie-style @mention rewriting is Kie-only: HeyGen and Flow take the prompt verbatim and every resource.
  const ownTags = !!config && (("useHeyGenMcp" in config.apiInput && config.apiInput.useHeyGenMcp === true) || ("useFlow" in config.apiInput && config.apiInput.useFlow === true));
  const rawPrompt = String(inputs.prompt ?? data.prompt ?? "");
  const { resolvedPrompt, orderedUrls } = ownTags
    ? { resolvedPrompt: rawPrompt, orderedUrls: resources.map(r => r.url) }
    : resolveMentions(rawPrompt, resources.map(r => r.label), resources.map(r => r.url));
  // HeyGen has no duration control; a stale data.duration must not reach the plan or the approval cap.
  const isHeyGen = !!config && "useHeyGenMcp" in config.apiInput && config.apiInput.useHeyGenMcp === true;
  return {
    videoModel: model,
    prompt: resolvedPrompt,
    aspectRatio: String(data.aspectRatio ?? "9:16"),
    duration: isHeyGen ? (config?.defaultDuration ?? 0) : fixedFlowDuration ?? Number(data.duration ?? config?.defaultDuration ?? 5),
    ...(data.klingMode ? { mode: data.klingMode } : {}),
    ...(data.grokResolution ? { resolution: data.grokResolution } : {}),
    ...(data.sound !== undefined ? { sound: Boolean(data.sound) } : {}),
    ...(data.heygenAvatarId ? { avatarId: String(data.heygenAvatarId) } : {}),
    ...(data.heygenVoiceId ? { voiceId: String(data.heygenVoiceId) } : {}),
    startFrameUrl: inputs.startFrameUrl,
    endFrameUrl: inputs.endFrameUrl,
    videoRefUrl: inputs.videoRefUrl,
    resources: orderedUrls.map(url => resources.find(r => r.url === url) ?? { url, label: "element" }),
    referenceImageUrls: orderedUrls,
    referenceVideoUrls: inputs.referenceVideoUrls,
    referenceAudioUrls: inputs.referenceAudioUrls,
    // Sent only when the user declared the rights for exactly these clips on the node.
    ...(needsVideoRights(model, inputs.referenceVideoUrls) && videoRightsAffirmed(data.videoRightsAffirmedFor, inputs.referenceVideoUrls)
      ? { affirmVideoRights: true } : {}),
  };
}
export function resolveNodeInputs(nodeId: string, nodes: Node<NodeData>[], edges: Parameters<typeof resolveInputs>[2]): ResolvedInputs { return resolveInputs(nodeId, nodes, edges); }
