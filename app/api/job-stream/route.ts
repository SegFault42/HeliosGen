import { NextRequest } from "next/server";
import { jobStore, type JobResult } from "@/lib/jobStore";
import { jobEvents, JOB_STREAM_BUDGET_MS } from "@/lib/jobEvents";
import { resumeKieJob } from "@/lib/kieJobPoller";
import { resumeHeyGenJob } from "@/lib/heygenJobPoller";
import { resumeFlowJob } from "@/lib/flowJobPoller";
import * as guestDb from "@/lib/guest/db";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};

const TIMEOUT_MS = JOB_STREAM_BUDGET_MS;
const RECHECK_MS = 5_000; // safety net if an emit is missed

function immediate(payload: JobResult): Response {
  return new Response(`data: ${JSON.stringify(payload)}\n\n`, { headers: SSE_HEADERS });
}

function recoverJob(taskId: string): JobResult | null {
  const gen = guestDb.recoverJob(taskId);
  if (gen?.status === "done") {
    return gen.video_url
      ? { status: "done", videoUrl: gen.video_url }
      : { status: "done", imageUrl: gen.image_url ?? undefined, imageUrls: gen.image_urls ?? undefined };
  }
  if (gen?.status === "error") {
    return { status: "error", error: gen.error_msg ?? "Generation failed" };
  }
  if (gen) return { status: "pending", type: gen.generation_type === "video" ? "video" : "image" };
  return null;
}

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) return new Response("taskId required", { status: 400 });

  // Already settled in jobStore — respond immediately, no stream needed
  const existing = jobStore.get(taskId);
  if (existing && existing.status !== "pending") {
    return immediate(existing);
  }

  if (!existing) {
    const recovered = recoverJob(taskId);
    if (recovered) {
      jobStore.set(taskId, recovered);
      if (recovered.status !== "pending") return immediate(recovered);
    } else {
      // No DB record either — truly not found
      return immediate({ status: "error", error: "Job not found" });
    }
  }

  // Restart the provider-specific poller if a server restart lost it.
  if (taskId.startsWith("heygen-agent:")) resumeHeyGenJob(taskId);
  else if (taskId.startsWith("flow-video:") || taskId.startsWith("flow-image:")) resumeFlowJob(taskId);
  else if (!taskId.startsWith("azure-") && !taskId.startsWith("grok-img-")) resumeKieJob(taskId, existing?.type === "video" ? "video" : "image");

  // Job is pending — open an SSE stream and wait for the poller/callback to fire
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(recheck);
        clearTimeout(timeout);
        controller.close();
      };

      const send = (payload: JobResult) => {
        if (closed) return;
        controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
        close();
      };

      // Keepalive comment every 25 s (proxies drop idle SSE connections)
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(enc.encode(": ping\n\n"));
      }, 25_000);

      // Re-read jobStore so a missed event cannot hang the stream
      const recheck = setInterval(() => {
        const cur = jobStore.get(taskId);
        if (cur && cur.status !== "pending") {
          jobEvents.off(`job:${taskId}`, send);
          send(cur);
        }
      }, RECHECK_MS);

      // Hard cap — emit error if callback never arrives
      const timeout = setTimeout(() => {
        send({ status: "error", error: "Generation timed out" });
      }, TIMEOUT_MS);

      jobEvents.once(`job:${taskId}`, send);

      req.signal.addEventListener("abort", () => {
        jobEvents.off(`job:${taskId}`, send);
        close();
      });
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
