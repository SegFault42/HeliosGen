import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/lib/jobStore";
import { mirrorToR2 } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";

const RECORD_INFO = "https://api.kie.ai/api/v1/jobs/recordInfo";

// Parse resultJson string → first URL
function extractUrl(resultJson?: string): string | undefined {
  if (!resultJson) return undefined;
  try {
    const parsed = JSON.parse(resultJson);
    const urls = parsed.resultUrls ?? parsed.resultUrl;
    return Array.isArray(urls) ? urls[0] : urls;
  } catch {
    return undefined;
  }
}

// Query Kie.ai and update jobStore. Returns the latest JobResult (or undefined
// if the task is genuinely unknown to Kie).
async function syncFromKie(
  taskId: string,
  token: string,
  type?: "image" | "video",
): Promise<"pending" | "done" | "error" | "unknown"> {
  try {
    const r = await fetch(`${RECORD_INFO}?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return "unknown";
    const d = await r.json();
    if (d.code !== 200) return "unknown";

    const state = String(d.data?.state ?? "").toLowerCase();

    if (state === "success") {
      const kieUrl = extractUrl(d.data?.resultJson);
      if (kieUrl) {
        // Detect whether this is a video by the URL extension or recorded type
        const isVideo =
          type === "video" ||
          kieUrl.match(/\.(mp4|webm|mov)(\?|$)/i) !== null;
        const folder = isVideo ? "videos" : "images";

        let r2Url = kieUrl;
        try {
          r2Url = await mirrorToR2(kieUrl, folder);
        } catch (err) {
          console.error("[job-status] R2 mirror failed, using kie.ai URL:", err);
        }

        if (isVideo) {
          jobStore.set(taskId, { status: "done", videoUrl: r2Url });
          supabaseAdmin
            .from("generations")
            .update({ status: "done", video_url: r2Url })
            .eq("task_id", taskId)
            .then(({ error }) => {
              if (error) console.error("[job-status] supabase update error:", error.message);
            });
        } else {
          jobStore.set(taskId, { status: "done", imageUrl: r2Url });
          supabaseAdmin
            .from("generations")
            .update({ status: "done", image_url: r2Url })
            .eq("task_id", taskId)
            .then(({ error }) => {
              if (error) console.error("[job-status] supabase update error:", error.message);
            });
        }
        return "done";
      }
      return "unknown";
    }

    if (state === "fail") {
      const errMsg = d.data?.failMsg || "Generation failed";
      jobStore.set(taskId, { status: "error", error: errMsg });
      return "error";
    }

    // "waiting" | "queuing" | "generating" | any in-progress state
    if (["waiting", "queuing", "generating", "processing"].includes(state) || state !== "") {
      // Re-register as pending so future polls from the callback path work
      const existing = jobStore.get(taskId);
      if (!existing) jobStore.set(taskId, { status: "pending", type: type ?? "image" });
      return "pending";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }

  const token = process.env.KIE_API_TOKEN;
  const result = jobStore.get(taskId);

  // ── Task known to local store ──────────────────────────────────────────────
  if (result) {
    if (result.status === "pending") {
      // Sync from Kie in case the webhook callback was missed
      if (token) await syncFromKie(taskId, token, (result as { type?: "image" | "video" }).type);
      return NextResponse.json(jobStore.get(taskId) ?? result);
    }
    return NextResponse.json(result);
  }

  // ── Task not in local store (server restarted / cold start after refresh) ──
  // For Kie jobs: query Kie.ai directly to recover the state.
  // For Azure jobs (azure-* prefix): unrecoverable if not in jobStore
  //   (Azure has no status endpoint; jobStore is file-backed so this is rare).
  if (token && !taskId.startsWith("azure-")) {
    const kieState = await syncFromKie(taskId, token);

    if (kieState === "done" || kieState === "error") {
      return NextResponse.json(jobStore.get(taskId)!);
    }

    if (kieState === "pending") {
      // Still running on Kie's side — tell the client to keep polling
      return NextResponse.json({ status: "pending" });
    }
  }

  // Genuinely unknown (bad taskId, already expired on Kie's side, etc.)
  return NextResponse.json({ status: "not_found" });
}
