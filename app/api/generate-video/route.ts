import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/lib/jobStore";
import { ensureR2 } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { VIDEO_MODELS } from "@/lib/modelConfig";
import { getKieTokenForUser } from "@/lib/getKieToken";

const KIE_BASE = "https://api.kie.ai";

interface Resource {
  url: string;
  label: string;
}

interface KlingElementInput {
  name: string;
  description: string;
  imageUrls: string[];
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
    videoRefUrl:    rawVideoRef,
    resources       = [] as Resource[],
    klingElements   = [] as KlingElementInput[],
    referenceImageUrls:  rawRefImages     = [] as string[],
    referenceVideoUrls:  rawRefVideoUrls  = [] as string[],
    referenceAudioUrls:  rawRefAudioUrls  = [] as string[],
    sound           = false,
    duration        = 5,
    aspectRatio     = "16:9",
    mode            = "pro",
    resolution      = "480p",
    debugOnly       = false,
  } = await req.json();

  const userId = await getUserId(req);
  const apiKey = userId ? await getKieTokenForUser(userId) : null;
  if (!apiKey) return NextResponse.json({ error: "No Kie.ai API key configured. Add one in Settings." }, { status: 401 });

  const callbackBase = process.env.CALLBACK_BASE_URL;
  if (!callbackBase) return NextResponse.json({ error: "CALLBACK_BASE_URL not set" }, { status: 500 });

  const callBackUrl = `${callbackBase.replace(/\/$/, "")}/api/callback`;

  const cfg = VIDEO_MODELS.find((m) => m.id === videoModel);
  if (!cfg) return NextResponse.json({ error: `Unknown video model: ${videoModel}` }, { status: 400 });

  const { apiInput } = cfg;

  // Clamp duration to model limits (motion-control has no duration field)
  const clampedDuration = apiInput.durationMax > 0
    ? Math.max(apiInput.durationMin, Math.min(apiInput.durationMax, Number(duration)))
    : 0;

  let input: Record<string, unknown>;
  let effectiveApiId = cfg.apiId;

  if (apiInput.useMotionControl) {
    // ── Kling 2.6 motion control ──────────────────────────────────────────────
    // { prompt, input_urls, video_urls, mode, character_orientation }
    const [inputImageUrl, inputVideoUrl] = await Promise.all([
      rawStartFrame ? ensureR2(rawStartFrame, "references").catch(() => rawStartFrame) : Promise.resolve(undefined),
      rawVideoRef   ? ensureR2(rawVideoRef,   "references").catch(() => rawVideoRef)   : Promise.resolve(undefined),
    ]);

    input = {
      prompt:                prompt ?? "",
      input_urls:            inputImageUrl ? [inputImageUrl] : [],
      video_urls:            inputVideoUrl ? [inputVideoUrl] : [],
      mode:                  resolution,   // "720p" or "1080p"
      character_orientation: mode,         // "image" or "video"
    };

  } else if (apiInput.firstFrameKey) {
    // ── Seedance-style models (separate frame keys + multi-ref arrays) ─────────
    const [startFrameUrl, endFrameUrl, r2RefImages, r2RefVideos, r2RefAudios] = await Promise.all([
      rawStartFrame ? ensureR2(rawStartFrame, "references").catch(() => rawStartFrame) : Promise.resolve(undefined),
      rawEndFrame   ? ensureR2(rawEndFrame,   "references").catch(() => rawEndFrame)   : Promise.resolve(undefined),
      Promise.all((rawRefImages    as string[]).map((u) => ensureR2(u, "references").catch(() => u))),
      Promise.all((rawRefVideoUrls as string[]).map((u) => ensureR2(u, "references").catch(() => u))),
      Promise.all((rawRefAudioUrls as string[]).map((u) => ensureR2(u, "references").catch(() => u))),
    ]);

    input = {
      [apiInput.aspectRatioKey!]: aspectRatio,
      [apiInput.durationKey!]:    clampedDuration,
    };

    if (prompt?.trim())                                        input.prompt                       = prompt;
    if (apiInput.firstFrameKey  && startFrameUrl)              input[apiInput.firstFrameKey]       = startFrameUrl;
    if (apiInput.lastFrameKey   && endFrameUrl)                input[apiInput.lastFrameKey]        = endFrameUrl;
    if (apiInput.resolutionKey)                                input[apiInput.resolutionKey]       = resolution;
    if (apiInput.soundKey)                                     input[apiInput.soundKey]            = Boolean(sound);
    if (apiInput.referenceImagesKey && r2RefImages.length > 0) input[apiInput.referenceImagesKey]  = r2RefImages;
    if (apiInput.referenceVideosKey && r2RefVideos.length > 0) input[apiInput.referenceVideosKey]  = r2RefVideos;
    if (apiInput.referenceAudiosKey && r2RefAudios.length > 0) input[apiInput.referenceAudiosKey]  = r2RefAudios;
    if (apiInput.extra)                                        Object.assign(input, apiInput.extra);

  } else if (apiInput.referenceImagesKey) {
    // ── Reference-image-based models (Grok Imagine) ───────────────────────────
    const refImageUrls = (
      await Promise.all(
        (rawRefImages as string[]).map((u) => ensureR2(u, "references").catch(() => null))
      )
    ).filter((u): u is string => u !== null);

    const hasImages = refImageUrls.length > 0;
    effectiveApiId = hasImages ? "grok-imagine/image-to-video" : "grok-imagine/text-to-video";

    input = {
      prompt:                     prompt ?? "",
      [apiInput.aspectRatioKey!]: aspectRatio,
      [apiInput.durationKey!]:    String(clampedDuration),
    };

    if (apiInput.modeKey)       input[apiInput.modeKey]       = mode;
    if (apiInput.resolutionKey) input[apiInput.resolutionKey] = resolution;
    if (apiInput.extra)         Object.assign(input, apiInput.extra);
    if (hasImages) input[apiInput.referenceImagesKey] = refImageUrls;

  } else {
    // ── Start/end-frame + elements models (Kling) ─────────────────────────────
    const hasNewElements = (klingElements as KlingElementInput[]).length > 0;

    const [startFrameUrl, endFrameUrl, r2Resources, uploadedElements] = await Promise.all([
      rawStartFrame ? ensureR2(rawStartFrame, "references") : Promise.resolve(undefined),
      rawEndFrame   ? ensureR2(rawEndFrame,   "references") : Promise.resolve(undefined),
      hasNewElements
        ? Promise.resolve([] as Resource[])
        : Promise.all(
            (resources as Resource[]).slice(0, 3).map(async (r) => ({
              ...r,
              url: await ensureR2(r.url, "references").catch(() => r.url),
            }))
          ),
      hasNewElements
        ? Promise.all(
            (klingElements as KlingElementInput[]).slice(0, 3).map(async (el) => ({
              name:        el.name,
              description: el.description,
              imageUrls:   await Promise.all(
                el.imageUrls.map((u) => ensureR2(u, "references").catch(() => u))
              ),
            }))
          )
        : Promise.resolve([] as { name: string; description: string; imageUrls: string[] }[]),
    ]);

    input = {
      prompt:                     prompt ?? "",
      [apiInput.aspectRatioKey!]: aspectRatio,
      [apiInput.durationKey!]:    apiInput.durationAsString ? String(clampedDuration) : clampedDuration,
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
      let kling_elements: { name: string; description: string; element_input_urls: string[] }[] = [];
      if (hasNewElements) {
        kling_elements = uploadedElements.map((el) => ({
          name:               el.name,
          description:        el.description,
          element_input_urls: el.imageUrls.length >= 2 ? el.imageUrls : [el.imageUrls[0], el.imageUrls[0]],
        }));
      } else {
        kling_elements = r2Resources.map((r) => {
          const safeName = r.label.toLowerCase().replace(/\s+#/g, "_").replace(/[^a-z0-9_]/g, "") || "element";
          return { name: safeName, description: r.label, element_input_urls: [r.url, r.url] };
        });
      }
      if (kling_elements.length > 0) input.kling_elements = kling_elements;
    }
  }

  // Debug mode — return the exact kie.ai payload without submitting
  if (debugOnly) {
    return NextResponse.json({ debugPayload: { model: effectiveApiId, callBackUrl, input } });
  }

  // Submit task to kie.ai
  const createRes = await fetch(`${KIE_BASE}/api/v1/jobs/createTask`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ model: effectiveApiId, callBackUrl, input }),
  });

  if (!createRes.ok) {
    return NextResponse.json({ error: await createRes.text() }, { status: 500 });
  }

  const created = await createRes.json();
  if (created.code !== 200) {
    return NextResponse.json({ error: created.msg ?? "Task creation failed" }, { status: 500 });
  }

  const taskId = created.data?.taskId;
  if (!taskId) return NextResponse.json({ error: "No taskId returned" }, { status: 500 });

  // Register as pending so the frontend can poll job-status
  jobStore.set(taskId, { status: "pending", type: "video", userId: userId ?? undefined });

  // Save to Supabase (fire-and-forget)

  const referenceUrls: string[] = apiInput.useMotionControl
    ? [
        ...((input.input_urls as string[] | undefined) ?? []),
        ...((input.video_urls as string[] | undefined) ?? []),
      ]
    : apiInput.referenceImagesKey
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

  return NextResponse.json({ taskId });
}
