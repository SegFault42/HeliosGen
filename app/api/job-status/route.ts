import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/lib/jobStore";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_MODE } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

async function recoverJob(taskId: string): Promise<"done" | "error" | "pending" | "not_found"> {
  if (GUEST_MODE) {
    const gen = guestDb.recoverJob(taskId);
    if (!gen) return "not_found";
    if (gen.status === "done") {
      const result = gen.video_url
        ? { status: "done" as const, videoUrl: gen.video_url }
        : { status: "done" as const, imageUrl: gen.image_url ?? undefined, imageUrls: gen.image_urls ?? undefined };
      jobStore.set(taskId, result);
      return "done";
    }
    if (gen.status === "error") {
      jobStore.set(taskId, { status: "error", error: gen.error_msg ?? "Generation failed" });
      return "error";
    }
    return "pending";
  }

  const { data: gen } = await supabaseAdmin
    .from("generations")
    .select("status, video_url, image_url, image_urls, error_msg")
    .eq("task_id", taskId)
    .single();

  if (!gen) return "not_found";

  if (gen.status === "done") {
    const result = gen.video_url
      ? { status: "done" as const, videoUrl: gen.video_url }
      : { status: "done" as const, imageUrl: gen.image_url, imageUrls: gen.image_urls };
    jobStore.set(taskId, result);
    return "done";
  }

  if (gen.status === "error") {
    jobStore.set(taskId, { status: "error", error: gen.error_msg ?? "Generation failed" });
    return "error";
  }

  return "pending";
}

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const result = jobStore.get(taskId);

  // Task known to local store — return as-is, no kie.ai polling
  if (result) {
    return NextResponse.json(result);
  }

  // Task not in local store (server restarted / cold start).
  // Azure jobs have no Supabase record and can't be recovered.
  if (taskId.startsWith("azure-")) {
    return NextResponse.json({ status: "not_found" });
  }

  const recovered = await recoverJob(taskId);

  if (recovered === "done" || recovered === "error") {
    return NextResponse.json(jobStore.get(taskId)!);
  }

  if (recovered === "pending") {
    return NextResponse.json({ status: "pending" });
  }

  return NextResponse.json({ status: "not_found" });
}
