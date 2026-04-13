import { NextRequest, NextResponse } from "next/server";
import { ensureR2, mirrorToR2 } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { VIDEO_MODELS } from "@/lib/modelConfig";

const KIE_BASE = "https://api.kie.ai";

interface Resource {
  url: string;
  label: string;
}

function extractVideoUrl(resultJson?: string): string | undefined {
  if (!resultJson) return undefined;
  try {
    const parsed = JSON.parse(resultJson);
    const urls = parsed.resultUrls ?? parsed.resultUrl ?? parsed.videoUrl;
    return Array.isArray(urls) ? urls[0] : urls;
  } catch {
    return undefined;
  }
}

async function getUserId(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  return data.user?.id ?? null;
}

export async function POST(req: NextRequest) {
  const {
    videoModel      = "kling-3.0",
    prompt,
    startFrameUrl:  rawStartFrame,
    endFrameUrl:    rawEndFrame,
    resources       = [] as Resource[],
    referenceImageUrls: rawRefImages = [] as string[],
    sound           = false,
    duration        = 5,
    aspectRatio     = "16:9",
    mode            = "pro",
    resolution      = "480p",
  } = await req.json();

  const apiKey = process.env.KIE_API_TOKEN;
  if (!apiKey) {
    return NextResponse.json({ error: "KIE_API_TOKEN not set" }, { status: 500 });
  }

  const cfg = VIDEO_MODELS.find((m) => m.id === videoModel);
  if (!cfg) {
    return NextResponse.json({ error: `Unknown video model: ${videoModel}` }, { status: 400 });
  }

  const { apiInput } = cfg;

  // Clamp duration to model limits
  const clampedDuration = Math.max(apiInput.durationMin, Math.min(apiInput.durationMax, Number(duration)));

  let input: Record<string, unknown>;

  if (apiInput.referenceImagesKey) {
    // ── Reference-image-based models (Grok Imagine) ───────────────────────────
    const refImageUrls = (
      await Promise.all(
        (rawRefImages as string[]).map((u) => ensureR2(u, "references").catch(() => null))
      )
    ).filter((u): u is string => u !== null);

    input = {
      prompt:                          prompt ?? "",
      [apiInput.aspectRatioKey]:       aspectRatio,
      [apiInput.durationKey]:          clampedDuration,
    };

    if (apiInput.modeKey)       input[apiInput.modeKey]       = mode;
    if (apiInput.resolutionKey) input[apiInput.resolutionKey] = resolution;
    if (apiInput.extra)         Object.assign(input, apiInput.extra);

    // Include reference images when connected (switches to image-guided mode)
    if (refImageUrls.length > 0) input[apiInput.referenceImagesKey] = refImageUrls;

  } else {
    // ── Start/end-frame + elements models (Kling) ─────────────────────────────
    const [startFrameUrl, endFrameUrl, r2Resources] = await Promise.all([
      rawStartFrame ? ensureR2(rawStartFrame, "references") : Promise.resolve(undefined),
      rawEndFrame   ? ensureR2(rawEndFrame,   "references") : Promise.resolve(undefined),
      Promise.all(
        (resources as Resource[]).slice(0, 3).map(async (r) => ({
          ...r,
          url: await ensureR2(r.url, "references").catch(() => r.url),
        }))
      ),
    ]);

    input = {
      prompt:                    prompt ?? "",
      [apiInput.aspectRatioKey]: aspectRatio,
      [apiInput.durationKey]:    apiInput.durationAsString ? String(clampedDuration) : clampedDuration,
    };

    if (apiInput.modeKey)  input[apiInput.modeKey]  = mode;
    if (apiInput.soundKey) input[apiInput.soundKey] = Boolean(sound);
    if (apiInput.extra)    Object.assign(input, apiInput.extra);

    if (apiInput.useImageUrls) {
      const image_urls: string[] = [];
      if (startFrameUrl) image_urls.push(startFrameUrl);
      if (endFrameUrl)   image_urls.push(endFrameUrl);
      if (image_urls.length > 0) input.image_urls = image_urls;
    }

    if (apiInput.useKlingElements) {
      const kling_elements = r2Resources.map((r) => {
        const safeName = r.label.toLowerCase().replace(/\s+#/g, "_").replace(/[^a-z0-9_]/g, "") || "element";
        return { name: safeName, description: r.label, element_input_urls: [r.url, r.url] };
      });
      if (kling_elements.length > 0) input.kling_elements = kling_elements;
    }
  }

  // Submit task
  const createRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ model: cfg.apiId, input }),
  });

  if (!createRes.ok) {
    return NextResponse.json({ error: await createRes.text() }, { status: 500 });
  }

  const created = await createRes.json();
  if (created.code !== 200) {
    return NextResponse.json({ error: created.msg ?? "Task creation failed" }, { status: 500 });
  }

  const taskId = created.data?.taskId;
  if (!taskId) {
    return NextResponse.json({ error: "No taskId returned" }, { status: 500 });
  }

  // Save pending record to Supabase
  const userId = await getUserId(req);

  // Collect reference URLs for DB record from whichever input fields were used
  const referenceUrls: string[] = apiInput.referenceImagesKey
    ? (input[apiInput.referenceImagesKey] as string[] | undefined) ?? []
    : [
        ...((input.image_urls as string[] | undefined) ?? []),
        ...((input.kling_elements as Array<{ element_input_urls: string[] }> | undefined)
          ?.map((el) => el.element_input_urls[0]) ?? []),
      ];

  supabaseAdmin.from("generations").insert({
    task_id:              taskId,
    user_id:              userId,
    generation_type:      "video",
    status:               "pending",
    model:                videoModel,
    prompt,
    aspect_ratio:         aspectRatio,
    duration:             clampedDuration,
    kling_mode:           mode,
    sound:                cfg.sound ? Boolean(sound) : false,
    reference_image_urls: referenceUrls,
  }).then(({ error }) => {
    if (error) console.error("[generate-video] supabase insert error:", error.message);
  });

  // Poll recordInfo — up to 5 min (60 × 5 s)
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const poll = await fetch(
      `${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!poll.ok) continue;

    const data = await poll.json();
    if (data.code !== 200) continue;

    const state = String(data.data?.state ?? "").toLowerCase();

    if (state === "success") {
      const kieVideoUrl = extractVideoUrl(data.data?.resultJson);
      if (!kieVideoUrl) {
        return NextResponse.json({ error: "Generation succeeded but no video URL found" }, { status: 500 });
      }

      // Upload video to R2
      let videoUrl = kieVideoUrl;
      try {
        videoUrl = await mirrorToR2(kieVideoUrl, "videos");
      } catch (err) {
        console.error("[generate-video] R2 upload failed, using kie.ai URL:", err);
      }

      // Update Supabase record
      supabaseAdmin
        .from("generations")
        .update({ status: "done", video_url: videoUrl })
        .eq("task_id", taskId)
        .then(({ error }) => {
          if (error) console.error("[generate-video] supabase update error:", error.message);
        });

      return NextResponse.json({ videoUrl });
    }

    if (state === "fail") {
      const errMsg = data.data?.failMsg ?? "Generation failed";
      supabaseAdmin
        .from("generations")
        .update({ status: "error", error_msg: errMsg })
        .eq("task_id", taskId)
        .then(() => {});
      return NextResponse.json({ error: errMsg }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Timed out after 5 minutes" }, { status: 504 });
}
