import { jobEvents } from "./jobEvents";
import { jobStore } from "./jobStore";
import * as guestDb from "./guest/db";
import { getHeyGenAgentSession, getHeyGenVideo, listHeyGenAgentVideos } from "./heygenMcp";

const active = new Set<string>();
const POLL_MS = 5_000;
const MAX_POLLS = 144; // 12 minutes, aligned with job-stream's hard cap

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

function videoUrlOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const found = videoUrlOf(item); if (found) return found; }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  for (const key of ["videoUrl", "video_url", "downloadUrl", "download_url", "mp4Url", "mp4_url"]) {
    if (typeof object[key] === "string" && object[key].startsWith("http")) return object[key] as string;
  }
  for (const [key, item] of Object.entries(object)) {
    if (key.toLowerCase().includes("video") && typeof item === "string" && item.startsWith("http")) return item;
    const found = videoUrlOf(item);
    if (found) return found;
  }
  return undefined;
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
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    try {
      const session = await getHeyGenAgentSession(sessionId);
      const state = statusOf(session);
      let url = videoUrlOf(session);
      let videoId = videoIdOf(session);
      if (!url && (state.includes("complete") || state.includes("success") || state === "done" || videoId)) {
        const videos = await listHeyGenAgentVideos(sessionId);
        url = videoUrlOf(videos);
        videoId = videoId ?? videoIdOf(videos);
      }
      if (!url && videoId && (state.includes("complete") || state.includes("success") || state === "done")) {
        url = videoUrlOf(await getHeyGenVideo(videoId));
      }
      if (url) {
        settle(taskId, { status: "done", videoUrl: url });
        return;
      }
      if (state.includes("error") || state.includes("fail") || state.includes("cancel") || state === "stopped") {
        settle(taskId, { status: "error", error: `HeyGen video agent ended with status: ${state}` });
        return;
      }
    } catch (error) {
      // A transient MCP/network failure should not turn a still-running HeyGen job into a false failure.
      if (attempt === MAX_POLLS - 1) {
        settle(taskId, { status: "error", error: error instanceof Error ? error.message : "HeyGen polling failed" });
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  settle(taskId, { status: "error", error: "HeyGen video generation timed out" });
}

/** Start or resume a HeyGen job. The set prevents duplicate pollers after repeated status requests. */
export function resumeHeyGenJob(taskId: string): void {
  if (!taskId.startsWith("heygen-agent:") || active.has(taskId)) return;
  active.add(taskId);
  void poll(taskId).finally(() => active.delete(taskId));
}
