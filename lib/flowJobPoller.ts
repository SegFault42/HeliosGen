import path from "node:path";
import { jobEvents } from "./jobEvents";
import { jobStore } from "./jobStore";
import * as guestDb from "./guest/db";
import { MEDIA_DIR } from "./guest/paths";
import { refreshFlowJob, getFlowJob, downloadFlowJob } from "./flowAdapter";
import { dlog } from "./debugLog";

const active = new Set<string>();
const POLL_MS = 4_000;
const MAX_POLLS = 150; // ~10 minutes

type FlowJobResult =
  | { status: "pending"; type?: "video" | "image" }
  | { status: "done"; videoUrl?: string; imageUrl?: string }
  | { status: "error"; error: string };

function settle(taskId: string, result: FlowJobResult, isVideo: boolean): void {
  jobStore.set(taskId, result as any);
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

  const jobId = isVideo
    ? taskId.slice("flow-video:".length)
    : taskId.slice("flow-image:".length);

  dlog(`[FlowPoller] Polling started for ${taskId} (job ${jobId})`);

  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    try {
      // 1. Verifica no banco se ja foi finalizado
      const dbGen = guestDb.recoverJob(taskId);
      if (dbGen && dbGen.status === "done") {
        if (isVideo && dbGen.video_url) {
          settle(taskId, { status: "done", videoUrl: dbGen.video_url }, true);
          return;
        }
        if (!isVideo && (dbGen.image_url || dbGen.video_url)) {
          settle(taskId, { status: "done", imageUrl: dbGen.image_url || dbGen.video_url }, false);
          return;
        }
      }

      const job = await refreshFlowJob(jobId);
      const status = (job?.status ?? "").toLowerCase();

      if (status === "completed" || status === "ready" || (job?.generatedAssets && job.generatedAssets.length > 0)) {
        let files: string[] = job.downloadedFiles ?? [];
        if (files.length === 0 && job.generatedAssets?.length) {
          // Let the MCP's own downloadTracked() resolve the real asset (it re-checks
          // the live DOM identity and distinguishes video src from poster/thumbnail).
          // Grabbing the first "url:https://" key here ourselves used to race the
          // video element before its real src populated, silently saving the poster
          // frame (or the reference start-frame) as the "video".
          try {
            const downloaded = await downloadFlowJob(jobId);
            files = downloaded?.downloadedFiles ?? [];
          } catch (error) {
            dlog(`[FlowPoller] downloadFlowJob failed for ${jobId}: ${error}`);
          }
        }
        if (files.length > 0) {
          const mediaUrl = resolveMediaUrl(files[0]);
          dlog(`[FlowPoller] Job ${jobId} finished successfully: ${mediaUrl}`);
          if (isVideo) {
            settle(taskId, { status: "done", videoUrl: mediaUrl }, true);
          } else {
            settle(taskId, { status: "done", imageUrl: mediaUrl }, false);
          }
          return;
        }
      }

      if (status === "failed" || status === "needs_attention") {
        const errMsg = job?.error || `Flow generation failed with status: ${status}`;
        dlog(`[FlowPoller] Job ${jobId} failed: ${errMsg}`);
        settle(taskId, { status: "error", error: errMsg }, isVideo);
        return;
      }
    } catch (error) {
      dlog(`[FlowPoller] Transient error polling ${jobId}: ${error}`);
      if (attempt === MAX_POLLS - 1) {
        settle(
          taskId,
          { status: "error", error: error instanceof Error ? error.message : "Flow polling timed out" },
          isVideo
        );
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  settle(taskId, { status: "error", error: "Flow generation timed out" }, isVideo);
}

export function resumeFlowJob(taskId: string): void {
  if ((!taskId.startsWith("flow-video:") && !taskId.startsWith("flow-image:")) || active.has(taskId)) {
    return;
  }
  active.add(taskId);
  void poll(taskId).finally(() => active.delete(taskId));
}
