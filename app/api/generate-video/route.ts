import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/lib/jobStore";
import { ensureR2 } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { VIDEO_MODELS } from "@/lib/modelConfig";
import { getKieTokenForUser } from "@/lib/getKieToken";
import { GUEST_MODE, resolveUserId } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

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


export async function POST(req: NextRequest) {
  try {
  const body = await req.json();
  const {
    videoModel      = body.model || "kling-3.0",
    prompt,
    startFrameUrl:  rawStartFrame,
    endFrameUrl:    rawEndFrame,
    videoRefUrl:    rawVideoRef,
    resources       = [] as Resource[],
    klingElements   = [] as KlingElementInput[],
    referenceImageUrls:  rawRefImages     = body.imageUrls || [] as string[],
    referenceVideoUrls:  rawRefVideoUrls  = [] as string[],
    referenceAudioUrls:  rawRefAudioUrls  = [] as string[],
    sound           = false,
    duration        = 5,
    aspectRatio     = body.aspect_ratio || "16:9",
    mode            = "pro",
    resolution:     rawResolution,
    seed,
    veoMode,
    generationType: rawGenerationType,
    callBackUrl:    rawCallBackUrl,
    debugOnly       = false,
  } = body;

  const userId = await resolveUserId(req);
  const apiKey = (userId ? await getKieTokenForUser(userId) : null) ?? process.env.KIE_API_TOKEN ?? null;
  if (!apiKey) return NextResponse.json({ error: "No Kie.ai API key configured. Add one in Settings." }, { status: 401 });

  const callbackBase = process.env.CALLBACK_BASE_URL;
  const callBackUrl = rawCallBackUrl || (callbackBase ? `${callbackBase.replace(/\/$/, "")}/api/callback` : undefined);
  if (!callBackUrl) return NextResponse.json({ error: "callBackUrl or CALLBACK_BASE_URL not set" }, { status: 500 });

  const cfg = VIDEO_MODELS.find((m) => m.id === videoModel);
  if (!cfg) return NextResponse.json({ error: `Unknown video model: ${videoModel}` }, { status: 400 });

  const resolution = rawResolution || cfg.defaultResolution || "480p";
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
    // Seedance (and similar): first/last frames and reference images are mutually exclusive
    if (apiInput.referenceImagesKey && r2RefImages.length > 0 && !startFrameUrl && !endFrameUrl) input[apiInput.referenceImagesKey]  = r2RefImages;
    if (apiInput.referenceVideosKey && r2RefVideos.length > 0) input[apiInput.referenceVideosKey]  = r2RefVideos;
    if (apiInput.referenceAudiosKey && r2RefAudios.length > 0) input[apiInput.referenceAudiosKey]  = r2RefAudios;
    if (apiInput.extra)                                        Object.assign(input, apiInput.extra);

  } else if (apiInput.useHappyHorse) {
    // ── HappyHorse (Alibaba) — routes to text/image/reference endpoint ────────
    const refImageUrls = (
      await Promise.all(
        (rawRefImages as string[]).map((u) => ensureR2(u, "references").catch(() => null))
      )
    ).filter((u): u is string => u !== null);

    const startFrameUrl = rawStartFrame
      ? await ensureR2(rawStartFrame, "references").catch(() => rawStartFrame)
      : undefined;

    const maybeSeed = seed !== undefined && seed !== null && Number(seed) > 0 ? Number(seed) : undefined;

    if (refImageUrls.length > 0) {
      effectiveApiId = "happyhorse/reference-to-video";
      input = {
        prompt: prompt ?? "",
        reference_image: refImageUrls.slice(0, 9),
        [apiInput.aspectRatioKey!]: aspectRatio,
        [apiInput.durationKey!]:    clampedDuration,
      };
      if (apiInput.resolutionKey) input[apiInput.resolutionKey] = resolution;
      if (maybeSeed !== undefined && apiInput.seedKey) input[apiInput.seedKey] = maybeSeed;
    } else if (startFrameUrl) {
      effectiveApiId = "happyhorse/image-to-video";
      input = {
        image_urls:             [startFrameUrl],
        [apiInput.durationKey!]: clampedDuration,
      };
      if (prompt?.trim()) input.prompt = prompt;
      // resolution is determined by the input image — do not send it
      if (maybeSeed !== undefined && apiInput.seedKey) input[apiInput.seedKey] = maybeSeed;
    } else {
      effectiveApiId = "happyhorse/text-to-video";
      input = {
        prompt: prompt ?? "",
        [apiInput.aspectRatioKey!]: aspectRatio,
        [apiInput.durationKey!]:    clampedDuration,
      };
      if (apiInput.resolutionKey) input[apiInput.resolutionKey] = resolution;
      if (maybeSeed !== undefined && apiInput.seedKey) input[apiInput.seedKey] = maybeSeed;
    }

  } else if (apiInput.useGoogleVeo) {
    // ── Google Veo 3.1 ───────────────────────────────────────────────────────
    const [startFrameUrl, endFrameUrl, refImages] = await Promise.all([
      rawStartFrame ? ensureR2(rawStartFrame, "references").catch(() => rawStartFrame) : Promise.resolve(undefined),
      rawEndFrame   ? ensureR2(rawEndFrame,   "references").catch(() => rawEndFrame)   : Promise.resolve(undefined),
      Promise.all((rawRefImages as string[]).map((u) => ensureR2(u, "references").catch(() => u))),
    ]);

    const imageUrls: string[] = [];
    let generationType = "TEXT_2_VIDEO";

    // For veo3.1 lite, if an image is attached use: Image to video, just a text is attached, use text to video.
    // On the two other models (fast/quality), one more element is present: reference.
    const isLite = cfg.id === "veo3_lite";

    if (veoMode === "references" && !isLite) {
      generationType = "REFERENCE_2_VIDEO";
      if (refImages.length > 0) imageUrls.push(...refImages.slice(0, 3));
    } else {
      if (startFrameUrl || endFrameUrl) {
        generationType = "FIRST_AND_LAST_FRAMES_2_VIDEO";
        if (startFrameUrl) imageUrls.push(startFrameUrl);
        if (endFrameUrl) imageUrls.push(endFrameUrl);
      }
    }

    effectiveApiId = cfg.apiId; // Use veo3, veo3_fast, or veo3_lite directly

    input = {
      prompt: prompt ?? "",
      generationType: rawGenerationType || generationType,
      [apiInput.aspectRatioKey!]: aspectRatio,
      [apiInput.resolutionKey!]: resolution,
      imageUrls: imageUrls,
      watermark: "",
      enableFallback: false,
      enableTranslation: true,
      callBackUrl,
    };
    if (apiInput.extra) Object.assign(input, apiInput.extra);

  } else if (apiInput.referenceImagesKey) {
    // ── Reference-image-based models (Grok Imagine, Grok Imagine 1.5) ─────────
    const refImageUrls = (
      await Promise.all(
        (rawRefImages as string[]).map((u) => ensureR2(u, "references").catch(() => null))
      )
    ).filter((u): u is string => u !== null);

    const hasImages = refImageUrls.length > 0;
    effectiveApiId = hasImages && cfg.imageApiId ? cfg.imageApiId : cfg.apiId;

    const durationValue = apiInput.durationAsString ? String(clampedDuration) : clampedDuration;

    input = {
      prompt:                     prompt ?? "",
      [apiInput.aspectRatioKey!]: aspectRatio,
      [apiInput.durationKey!]:    durationValue,
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

  // Submit task to kie.ai
  // Google Veo models require a dedicated endpoint and a flattened structure
  const endpoint = apiInput.useGoogleVeo
    ? `${KIE_BASE}/api/v1/veo/generate`
    : `${KIE_BASE}/api/v1/jobs/createTask`;

  const kieBody = apiInput.useGoogleVeo
    ? { model: effectiveApiId, ...input }
    : { model: effectiveApiId, callBackUrl, input };

  // Debug mode — log payload to server console and return without submitting
  if (debugOnly) {
    console.log(`[DEBUG] generate-video payload → ${endpoint}`, JSON.stringify(kieBody, null, 2));
    return NextResponse.json({ debugPayload: kieBody, debugEndpoint: endpoint });
  }

  console.log(`[generate-video] sending to ${endpoint}:`, JSON.stringify(kieBody));
  const createRes = await fetch(endpoint, {
    method:  "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify(kieBody),
  });

  if (!createRes.ok) {
    if (createRes.status === 401) {
      return NextResponse.json({ error: "Invalid Kie.ai API key — please update it in Settings." }, { status: 401 });
    }
    const errText = await createRes.text();
    console.error("[generate-video] kie.ai HTTP error:", createRes.status, errText);
    return NextResponse.json({ error: errText }, { status: 500 });
  }

  const createdText = await createRes.text();
  console.log("[generate-video] kie.ai response:", createdText);
  let created: { code?: number; msg?: string; data?: { taskId?: string; id?: string } };
  try {
    created = JSON.parse(createdText);
  } catch {
    return NextResponse.json({ error: `Upstream returned non-JSON: ${createdText.slice(0, 200)}` }, { status: 500 });
  }
  if (created.code !== 200) {
    console.error("[generate-video] kie.ai API error:", created.code, created.msg, "input:", JSON.stringify(input));
    return NextResponse.json({ error: created.msg ?? "Task creation failed" }, { status: 500 });
  }

  const taskId = created.data?.taskId || created.data?.id;
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

  if (GUEST_MODE) {
    guestDb.insertGeneration({
      task_id: taskId, user_id: userId, generation_type: "video",
      status: "pending", model: videoModel, prompt, aspect_ratio: aspectRatio,
      duration: clampedDuration, kling_mode: mode,
      sound: cfg.sound ? Boolean(sound) : false,
      reference_image_urls: referenceUrls,
    });
  } else {
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
  }

  return NextResponse.json({ taskId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const cause = e instanceof Error && (e as NodeJS.ErrnoException).cause;
    console.error("[generate-video] unhandled error:", msg, cause ?? "");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
