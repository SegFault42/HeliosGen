import { NextRequest } from "next/server";
import { jobStore, type JobResult } from "@/lib/jobStore";
import { jobEvents } from "@/lib/jobEvents";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_MODE } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};

const TIMEOUT_MS = 12 * 60 * 1000; // 12 min hard cap

function immediate(payload: JobResult): Response {
  return new Response(`data: ${JSON.stringify(payload)}\n\n`, { headers: SSE_HEADERS });
}

async function recoverJob(taskId: string): Promise<JobResult | null> {
  if (GUEST_MODE) {
    const gen = guestDb.recoverJob(taskId);
    if (gen?.status === "done") {
      return gen.video_url
        ? { status: "done", videoUrl: gen.video_url }
        : { status: "done", imageUrl: gen.image_url ?? undefined, imageUrls: gen.image_urls ?? undefined };
    }
    if (gen?.status === "error") {
      return { status: "error", error: gen.error_msg ?? "Generation failed" };
    }
    return null;
  }

  const { data: gen } = await supabaseAdmin
    .from("generations")
    .select("status, video_url, image_url, image_urls, error_msg")
    .eq("task_id", taskId)
    .single();

  if (gen?.status === "done") {
    return gen.video_url
      ? { status: "done", videoUrl: gen.video_url }
      : { status: "done", imageUrl: gen.image_url, imageUrls: gen.image_urls };
  }
  if (gen?.status === "error") {
    return { status: "error", error: gen.error_msg ?? "Generation failed" };
  }
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
    const recovered = await recoverJob(taskId);
    if (recovered) {
      jobStore.set(taskId, recovered);
      return immediate(recovered);
    }
    // Not in Supabase either — truly not found
    return immediate({ status: "error", error: "Job not found" });
  }

  // Job is pending — open an SSE stream and wait for the callback to fire
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
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
