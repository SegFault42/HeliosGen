import { NextRequest, NextResponse } from "next/server";
import { jobStore } from "@/lib/jobStore";
import { ensureR2 } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { IMAGE_MODELS } from "@/lib/modelConfig";

const BASE   = "https://api.kie.ai";
const CREATE = `${BASE}/api/v1/jobs/createTask`;

// Resolve every image URL to an R2 CDN URL (uploads base64 / mirrors external URLs)
async function resolveImages(imageUrls: string[]): Promise<string[]> {
  const resolved = await Promise.all(
    imageUrls.slice(0, 14).map((u) => ensureR2(u, "references").catch(() => null))
  );
  return resolved.filter((u): u is string => u !== null);
}

// Extract user_id from the Authorization header (Bearer <access_token>)
async function getUserId(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  return data.user?.id ?? null;
}

export async function POST(req: NextRequest) {
  const {
    model       = "nano-banana-2",
    prompt,
    imageUrls   = [],
    aspectRatio = "1:1",
    quality     = "1k",
  } = (await req.json()) as {
    model?:       string;
    prompt?:      string;
    imageUrls?:   string[];
    aspectRatio?: string;
    quality?:     string;
  };

  const token = process.env.KIE_API_TOKEN;
  if (!token) return NextResponse.json({ error: "KIE_API_TOKEN is not set" }, { status: 500 });

  const callbackBase = process.env.CALLBACK_BASE_URL;
  if (!callbackBase) return NextResponse.json({ error: "CALLBACK_BASE_URL is not set" }, { status: 500 });

  if (!prompt?.trim()) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });

  const callBackUrl = `${callbackBase.replace(/\/$/, "")}/api/callback`;

  try {
    // Upload all reference images to R2
    const r2ImageUrls = await resolveImages(imageUrls);

    const cfg = IMAGE_MODELS.find((m) => m.id === model);
    if (!cfg) return NextResponse.json({ error: `Unknown model: ${model}` }, { status: 400 });

    const { apiInput } = cfg;

    // Build input object from config mapping
    const input: Record<string, unknown> = {
      prompt:                       prompt.slice(0, apiInput.promptMaxLength),
      [apiInput.aspectRatioKey]:    aspectRatio,
    };

    if (apiInput.outputFormat)                         input.output_format           = apiInput.outputFormat;
    if (apiInput.imageInputKey && r2ImageUrls.length)  input[apiInput.imageInputKey] = r2ImageUrls.slice(0, cfg.maxImages);
    if (apiInput.qualityKey) {
      input[apiInput.qualityKey] = apiInput.qualityMap
        ? (apiInput.qualityMap[quality] ?? quality)
        : quality === "4k" ? "4K" : quality === "2k" ? "2K" : "1K";
    }
    if (apiInput.extra) Object.assign(input, apiInput.extra);

    const requestBody = { model: cfg.apiId, callBackUrl, input };

    const res = await fetch(CREATE, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify(requestBody),
    });

    if (!res.ok) throw new Error(await res.text());
    const d = await res.json();
    if (d.code !== undefined && d.code !== 200) throw new Error(d.msg ?? `API error ${d.code}`);

    const taskId = d.data?.taskId ?? d.data?.id ?? d.taskId ?? d.id;
    if (!taskId) throw new Error("No task ID in response");

    jobStore.set(taskId, { status: "pending" });

    // Save metadata to Supabase (fire-and-forget — don't block the response)
    const userId = await getUserId(req);
    supabaseAdmin.from("generations").insert({
      task_id:              taskId,
      user_id:              userId,
      generation_type:      "image",
      status:               "pending",
      prompt,
      model,
      aspect_ratio:         aspectRatio,
      quality,
      reference_image_urls: r2ImageUrls,
    }).then(({ error }) => {
      if (error) console.error("[generate] supabase insert error:", error.message);
    });

    return NextResponse.json({ taskId, referenceImageUrls: r2ImageUrls });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
