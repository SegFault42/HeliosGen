import path from "node:path";
import { jobEvents } from "./jobEvents";
import { jobStore } from "./jobStore";
import * as guestDb from "./guest/db";
import { MEDIA_DIR } from "./guest/paths";
import { refreshFlowJob, getFlowJob, downloadFlowJob } from "./flowAdapter";
import { dlog } from "./debugLog";
import { flowDeadlineMs, flowErrorMessage, isFatalFlowError } from "./flowPollPolicy";

// Per process, not per route bundle: job-status and the submit route must share it.
const ACTIVE_KEY = Symbol.for("heliosgen.flow-poller.active");
const active = ((globalThis as typeof globalThis & { [ACTIVE_KEY]?: Set<string> })[ACTIVE_KEY] ??= new Set<string>());
const POLL_MS = 4_000;

type FlowJobResult =
  | { status: "pending"; type?: "video" | "image" }
  | { status: "done"; videoUrl?: string; imageUrl?: string }
  | { status: "error"; error: string };

function settle(taskId: string, result: FlowJobResult, isVideo: boolean): void {
  jobStore.set(taskId, result);
  if (result.status === "done") {
    if (isVideo && result.videoUrl) {
      guestDb.updateGeneration(taskId, { status: "done", video_url: result.videoUrl });
    } else if (!isVideo && result.imageUrl) {
      guestDb.updateGeneration(taskId, { status: "done", image_url: result.imageUrl });
    }
  } else if (result.status === "error") {
    guestDb.updateGeneration(taskId, { status: "error", error_msg: result.error });
  }
  jobEvents.emit(`job:${taskId}`, result);
}

function resolveMediaUrl(filePath: string): string {
  const rel = path.relative(MEDIA_DIR, filePath).replace(/\\/g, "/");
  return `/generated/${rel}`;
}

async function poll(taskId: string): Promise<void> {
  const isVideo = taskId.startsWith("flow-video:");
  const isImage = taskId.startsWith("flow-image:");
  if (!isVideo && !isImage) return;

  const jobId = isVideo ? taskId.slice("flow-video:".length) : taskId.slice("flow-image:".length);
  const createdAt = Date.parse(guestDb.recoverJob(taskId)?.created_at ?? "") || Date.now();
  const deadline = createdAt + flowDeadlineMs(isVideo);

  dlog(`[FlowPoller] Polling started for ${taskId} (job ${jobId})`);

  while (Date.now() < deadline) {
    try {
      const dbGen = guestDb.recoverJob(taskId);
      if (dbGen?.status === "done") {
        if (isVideo && dbGen.video_url) {
          settle(taskId, { status: "done", videoUrl: dbGen.video_url }, true);
          return;
        }
        if (!isVideo && (dbGen.image_url || dbGen.video_url)) {
          settle(taskId, { status: "done", imageUrl: dbGen.image_url || dbGen.video_url }, false);
          return;
        }
      }

      let job = await refreshFlowJob(jobId);
      const status = (job?.status ?? "").toLowerCase();

      if (status === "failed" || status === "needs_attention") {
        const message = flowErrorMessage(job?.error || `Flow generation failed with status: ${status}`, job?.diagnosticScreenshot);
        console.error(`[FlowPoller] ${taskId} failed: ${message}`);
        settle(taskId, { status: "error", error: message }, isVideo);
        return;
      }

      if (status === "completed" || status === "ready" || (job?.generatedAssets?.length ?? 0) > 0) {
        if (!(job.downloadedFiles?.length) && job.generatedAssets?.length) {
          job = await downloadFlowJob(jobId);
        }
        const files: string[] = job?.downloadedFiles ?? [];
        if (files.length > 0) {
          const mediaUrl = resolveMediaUrl(files[0]);
          dlog(`[FlowPoller] ${taskId} finished: ${mediaUrl}`);
          settle(taskId, isVideo ? { status: "done", videoUrl: mediaUrl } : { status: "done", imageUrl: mediaUrl }, isVideo);
          return;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isFatalFlowError(error)) {
        const job = await getFlowJob(jobId).catch(() => null);
        const full = flowErrorMessage(message, job?.diagnosticScreenshot);
        console.error(`[FlowPoller] ${taskId} fatal: ${full}`);
        settle(taskId, { status: "error", error: full }, isVideo);
        return;
      }
      console.warn(`[FlowPoller] ${taskId} transient error: ${message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  const minutes = Math.round(flowDeadlineMs(isVideo) / 60_000);
  console.error(`[FlowPoller] ${taskId} timed out after ${minutes} min`);
  settle(taskId, { status: "error", error: `Flow timed out after ${minutes} min` }, isVideo);
}

export function resumeFlowJob(taskId: string): void {
  if ((!taskId.startsWith("flow-video:") && !taskId.startsWith("flow-image:")) || active.has(taskId)) {
    return;
  }
  active.add(taskId);
  void poll(taskId).finally(() => active.delete(taskId));
}
