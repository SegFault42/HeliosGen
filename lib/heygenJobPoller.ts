import { jobEvents } from "./jobEvents";
import { jobStore } from "./jobStore";
import * as guestDb from "./guest/db";
import { getHeyGenAgentSession, getHeyGenVideo, listHeyGenAgentVideos } from "./heygenMcp";
import { heygenVideoAssetUrl } from "./heygenVideoResult";
import { mirrorToStorage } from "./storage";
import { HEYGEN_DEADLINE_MS, heygenFailureReason, heygenPhase, isFatalHeyGenError } from "./heygenPollPolicy";

// Per process, not per route bundle: job-status and the submit route must share it.
const ACTIVE_KEY = Symbol.for("heliosgen.heygen-poller.active");
const active = ((globalThis as typeof globalThis & { [ACTIVE_KEY]?: Set<string> })[ACTIVE_KEY] ??= new Set<string>());
const POLL_MS = 5_000;

type JobResult =
  | { status: "pending"; type?: "video" }
  | { status: "done"; videoUrl: string }
  | { status: "error"; error: string };

function stringAt(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const found = stringAt(item, keys); if (found) return found; }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  for (const key of keys) if (typeof object[key] === "string" && object[key]) return object[key] as string;
  for (const item of Object.values(object)) { const found = stringAt(item, keys); if (found) return found; }
  return undefined;
}

function statusOf(value: unknown): string {
  return (stringAt(value, ["status", "state", "sessionStatus", "session_status"]) ?? "").toLowerCase();
}

function videoIdOf(value: unknown): string | undefined {
  return stringAt(value, ["videoId", "video_id"]);
}

function sessionIdFromTask(taskId: string): string | null {
  return taskId.startsWith("heygen-agent:") ? taskId.slice("heygen-agent:".length) : null;
}

function settle(taskId: string, result: JobResult): void {
  jobStore.set(taskId, result);
  if (result.status === "done") {
    guestDb.updateGeneration(taskId, { status: "done", video_url: result.videoUrl });
  } else if (result.status === "error") {
    guestDb.updateGeneration(taskId, { status: "error", error_msg: result.error });
  }
  jobEvents.emit(`job:${taskId}`, result);
}

async function poll(taskId: string): Promise<void> {
  const sessionId = sessionIdFromTask(taskId);
  if (!sessionId) return;
  const createdAt = Date.parse(guestDb.recoverJob(taskId)?.created_at ?? "") || Date.now();
  const deadline = createdAt + HEYGEN_DEADLINE_MS;
  while (Date.now() < deadline) {
    try {
      const session = await getHeyGenAgentSession(sessionId);
      const state = statusOf(session);
      const phase = heygenPhase(state);
      let url = heygenVideoAssetUrl(session);
      let videoId = videoIdOf(session);
      if (!url && (phase === "completed" || videoId)) {
        const videos = await listHeyGenAgentVideos(sessionId);
        url = heygenVideoAssetUrl(videos);
        videoId = videoId ?? videoIdOf(videos);
      }
      if (!url && videoId && phase === "completed") {
        url = heygenVideoAssetUrl(await getHeyGenVideo(videoId).catch(() => null));
      }
      if (url) {
        const localUrl = await mirrorToStorage(url, "videos", "video/mp4");
        settle(taskId, { status: "done", videoUrl: localUrl });
        return;
      }
      if (phase === "failed") {
        const video = videoId ? await getHeyGenVideo(videoId).catch(() => null) : null;
        const reason = heygenFailureReason(session, video);
        const message = reason ? `HeyGen failed: ${reason}` : `HeyGen video agent ended with status: ${state}`;
        console.error(`[HeyGenPoller] ${taskId} failed: ${message}`);
        settle(taskId, { status: "error", error: message });
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isFatalHeyGenError(error)) {
        console.error(`[HeyGenPoller] ${taskId} fatal: ${message}`);
        settle(taskId, { status: "error", error: `HeyGen error: ${message}` });
        return;
      }
      console.warn(`[HeyGenPoller] ${taskId} transient error: ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  console.error(`[HeyGenPoller] ${taskId} timed out after ${HEYGEN_DEADLINE_MS / 60_000} min`);
  settle(taskId, { status: "error", error: `HeyGen video generation timed out after ${HEYGEN_DEADLINE_MS / 60_000} min` });
}

/** Start or resume a HeyGen job. The set prevents duplicate pollers after repeated status requests. */
export function resumeHeyGenJob(taskId: string): void {
  if (!taskId.startsWith("heygen-agent:") || active.has(taskId)) return;
  active.add(taskId);
  void poll(taskId).finally(() => active.delete(taskId));
}
