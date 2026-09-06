import { jobStore, jobProvider, serverInstanceId, type JobResult } from "./jobStore";
import { resumeKieJob } from "./kieJobPoller";
import * as guestDb from "./guest/db";

/** One recovery policy for both status polling and SSE. Never resubmits work. */
export function reconcileJob(taskId: string): JobResult | undefined {
  const existing = jobStore.get(taskId);
  if (existing && existing.status !== "pending" && existing.phase !== "interrupted") return existing;
  const saved = guestDb.recoverJob(taskId);
  if (saved?.status === "done") {
    jobStore.set(taskId, saved.video_url
      ? { status: "done", videoUrl: saved.video_url }
      : { status: "done", imageUrl: saved.image_url, imageUrls: saved.image_urls });
  } else if (saved?.status === "error") {
    jobStore.set(taskId, { status: "error", error: saved.error_msg ?? "Generation failed" });
  } else if (jobProvider(taskId) !== "kie") {
    if (existing?.status === "pending" && existing.serverInstanceId === serverInstanceId) return existing;
    jobStore.set(taskId, { status: "error", phase: "interrupted", error: "The local generation was interrupted by a server restart. It was not automatically retried." });
  } else if (existing || saved) {
    const kind = existing?.status === "pending" && existing.type === "video" ? "video" : saved?.generation_type === "video" ? "video" : "image";
    if (!existing || existing.phase === "interrupted") jobStore.set(taskId, { status: "pending", type: kind, phase: "generating" });
    if (!resumeKieJob(taskId, kind)) jobStore.set(taskId, { status: "error", phase: "interrupted", error: "Configure the Kie connection to resume status tracking. The provider may still be running." });
  } else return undefined;
  return jobStore.get(taskId);
}
