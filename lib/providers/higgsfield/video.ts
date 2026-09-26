import "server-only";
import { randomUUID } from "node:crypto";
import { APIError, AuthenticationError, TimeoutError } from "@higgsfield/client/v2";
import { getHiggsfieldClient } from "./client";
import { jobStore, type JobResult } from "@/lib/jobStore";
import { jobEvents } from "@/lib/jobEvents";
import { mirrorToR2 } from "@/lib/storage";
import * as guestDb from "@/lib/guest/db";
import { GUEST_USER_ID } from "@/lib/guestMode";

export const SEEDANCE_TEXT_TO_VIDEO = "bytedance/seedance-2.0/text-to-video";
const RATIOS = new Set(["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]);
const RESOLUTIONS = new Set(["480p", "720p", "1080p", "4k"]);

export interface SeedanceInput {
  prompt: string;
  duration: number;
  resolution: string;
  aspect_ratio: string;
  generate_audio: boolean;
}

export function makeSeedanceInput(body: Record<string, unknown>): SeedanceInput {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const duration = Number(body.duration ?? 5);
  const resolution = body.resolution ?? "720p";
  const aspectRatio = body.aspectRatio ?? body.aspect_ratio ?? "16:9";
  if (!prompt) throw new Error("Seedance 2.0 requires a prompt for Higgsfield.");
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) throw new Error("Duration must be 4–15 seconds.");
  if (typeof resolution !== "string" || !RESOLUTIONS.has(resolution)) throw new Error("Unsupported Higgsfield resolution.");
  if (typeof aspectRatio !== "string" || !RATIOS.has(aspectRatio)) throw new Error("Unsupported Higgsfield aspect ratio.");
  if (body.startFrameUrl || body.endFrameUrl || body.videoRefUrl ||
      (Array.isArray(body.resources) && body.resources.length) ||
      (Array.isArray(body.referenceImageUrls) && body.referenceImageUrls.length) ||
      (Array.isArray(body.referenceVideoUrls) && body.referenceVideoUrls.length) ||
      (Array.isArray(body.referenceAudioUrls) && body.referenceAudioUrls.length)) {
    throw new Error("Higgsfield Seedance currently supports text-to-video only. Remove media references or choose Kie.ai.");
  }
  return { prompt, duration, resolution, aspect_ratio: aspectRatio, generate_audio: Boolean(body.sound ?? body.generate_audio ?? false) };
}

function settle(taskId: string, result: JobResult) {
  jobStore.set(taskId, result);
  jobEvents.emit(`job:${taskId}`, result);
  if (result.status === "done") guestDb.updateGeneration(taskId, { status: "done", video_url: result.videoUrl });
  if (result.status === "error") guestDb.updateGeneration(taskId, { status: "error", error_msg: result.error });
}

export function startSeedanceVideo(body: Record<string, unknown>): string {
  const client = getHiggsfieldClient();
  if (!client) throw new Error("Higgsfield is not configured. Add API Key ID and Secret in Settings → API Keys.");
  const input = makeSeedanceInput(body);
  const taskId = `higgsfield-${randomUUID()}`;
  jobStore.set(taskId, { status: "pending", type: "video", userId: GUEST_USER_ID });
  guestDb.insertGeneration({
    task_id: taskId, user_id: GUEST_USER_ID, generation_type: "video", status: "pending",
    model: "seedance-2", prompt: input.prompt, aspect_ratio: input.aspect_ratio,
    duration: input.duration, sound: input.generate_audio, reference_image_urls: [],
  });

  void (async () => {
    try {
      const response = await client.subscribe(SEEDANCE_TEXT_TO_VIDEO, { input, withPolling: true });
      if (response.status !== "completed" || !response.video?.url) {
        throw new Error(response.status === "failed" ? "Higgsfield generation failed." :
          response.status === "nsfw" ? "Higgsfield rejected the content." :
          `Higgsfield returned ${response.status} without a video URL.`);
      }
      let videoUrl = response.video.url;
      try { videoUrl = await mirrorToR2(videoUrl, "videos"); }
      catch { /* Retain the provider URL when local mirroring is unavailable. */ }
      settle(taskId, { status: "done", videoUrl });
    } catch (error) {
      const message = error instanceof APIError && error.statusCode === 429
        ? "Higgsfield rate limit reached. Try again later."
        : error instanceof TimeoutError
        ? "Higgsfield generation timed out. Check your account before submitting again."
        : error instanceof AuthenticationError
        ? "Higgsfield credentials are invalid. Check Settings → API Keys."
        : error instanceof Error ? error.message : "Higgsfield generation failed.";
      settle(taskId, { status: "error", error: message });
    }
  })();
  return taskId;
}
