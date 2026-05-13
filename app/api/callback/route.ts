import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/lib/jobStore";
import { mirrorToR2 } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";

function extractUrls(resultJson?: string): string[] {
  if (!resultJson) return [];
  try {
    const parsed = JSON.parse(resultJson);
    const urls = parsed.resultUrls ?? parsed.resultUrl;
    if (Array.isArray(urls)) return urls.filter(Boolean);
    if (urls) return [urls];
    return [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  console.log("[callback] received:", JSON.stringify(body, null, 2));

  const data   = body.data ?? body;
  const taskId = data.taskId ?? data.id ?? body.taskId ?? body.id;
  const state  = String(data.state ?? data.status ?? "").toLowerCase();

  console.log("[callback] taskId:", taskId, "state:", state);

  if (!taskId) {
    console.log("[callback] could not extract taskId");
    return NextResponse.json({ received: true });
  }

  if (state === "success") {
    let kieUrls = extractUrls(data.resultJson);
    if (kieUrls.length === 0 && data.videoUrl) {
      kieUrls = [data.videoUrl];
    }
    if (kieUrls.length === 0 && (data.output?.[0] ?? data.output)) {
      kieUrls.push(data.output?.[0] ?? data.output);
    }
    if (kieUrls.length > 0) {
      const existing = jobStore.get(taskId);
      const isVideo  = existing?.status === "pending" && (existing as { type?: string }).type === "video";
      const folder   = isVideo ? "videos" : "images";

      Promise.all(kieUrls.map((u) => mirrorToR2(u, folder)))
        .then((r2Urls) => {
          if (isVideo) {
            jobStore.set(taskId, { status: "done", videoUrl: r2Urls[0] });
            return supabaseAdmin.from("generations").update({ status: "done", video_url: r2Urls[0] }).eq("task_id", taskId);
          } else {
            jobStore.set(taskId, { status: "done", imageUrl: r2Urls[0], imageUrls: r2Urls });
            return supabaseAdmin.from("generations").update({ status: "done", image_url: r2Urls[0], image_urls: r2Urls }).eq("task_id", taskId);
          }
        })
        .then(({ error }) => {
          if (error) console.error("[callback] supabase update error:", error.message);
        })
        .catch((err) => {
          console.error("[callback] R2 upload failed, storing kie.ai URLs:", err.message);
          if (isVideo) {
            jobStore.set(taskId, { status: "done", videoUrl: kieUrls[0] });
            supabaseAdmin.from("generations").update({ status: "done", video_url: kieUrls[0] }).eq("task_id", taskId).then(() => {});
          } else {
            jobStore.set(taskId, { status: "done", imageUrl: kieUrls[0], imageUrls: kieUrls });
            supabaseAdmin.from("generations").update({ status: "done", image_url: kieUrls[0], image_urls: kieUrls }).eq("task_id", taskId).then(() => {});
          }
        });
    } else {
      console.log("[callback] success but no URL found in resultJson");
    }
  } else if (state === "fail" || state === "failed" || state === "error") {
    const error = data.failMsg ?? data.error ?? body.msg ?? "Generation failed";
    jobStore.set(taskId, { status: "error", error });

    supabaseAdmin
      .from("generations")
      .update({ status: "error", error_msg: error })
      .eq("task_id", taskId)
      .then(({ error: e }) => {
        if (e) console.error("[callback] supabase error update failed:", e.message);
      });
  } else {
    console.log("[callback] intermediate state, ignoring:", state);
  }

  return NextResponse.json({ received: true });
}
