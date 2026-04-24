import { NextRequest, NextResponse } from "next/server";
import https from "node:https";
import { jobStore } from "@/lib/jobStore";
import { ensureR2, uploadBuffer } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { IMAGE_MODELS } from "@/lib/modelConfig";

const BASE   = "https://api.kie.ai";
const CREATE = `${BASE}/api/v1/jobs/createTask`;

/**
 * A minimal HTTPS POST that uses Node.js core — NOT Next.js's patched `fetch`.
 * Next.js ties its patched fetch to the request's AbortSignal, which cancels
 * any pending calls when the HTTP response commits. This helper is immune to
 * that because it goes through the raw TLS stack.
 */
function httpsPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs = 120_000, // Azure image gen can take up to 60s; 120s gives comfortable headroom
): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    const u       = new URL(url);
    const bodyBuf = Buffer.from(body, "utf8");

    const req = https.request(
      {
        hostname: u.hostname,
        port:     u.port ? Number(u.port) : 443,
        path:     u.pathname + u.search,
        method:   "POST",
        headers:  { ...headers, "Content-Length": bodyBuf.byteLength },
      },
      (res) => {
        const chunks: Buffer[] = [];

        // Response stream errors (e.g. ECONNRESET mid-body) must be caught here
        res.on("error", reject);
        res.on("data",  (c: Buffer) => chunks.push(c));
        res.on("end",   () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok:     (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            status: res.statusCode ?? 0,
            text:   () => Promise.resolve(raw),
          });
        });
      },
    );

    // Disable Nagle and keep-alive so the socket stays alive for long responses
    req.on("socket", (socket) => {
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 10_000);
      socket.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Azure request timed out after ${timeoutMs / 1000}s`));
      });
    });

    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}


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
    azureQuality,
    azureBaseUrl,
    azureDeployment,
  } = (await req.json()) as {
    model?:          string;
    prompt?:         string;
    imageUrls?:      string[];
    aspectRatio?:    string;
    quality?:        string;
    azureQuality?:   string;     // "auto" | "low" | "medium" | "high"
    azureBaseUrl?:   string;     // global base URL from settings
    azureDeployment?: string;    // per-model deployment name from settings
  };

  if (!prompt?.trim()) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });

  const cfg = IMAGE_MODELS.find((m) => m.id === model);
  if (!cfg) return NextResponse.json({ error: `Unknown model: ${model}` }, { status: 400 });

  const r2ImageUrls = await resolveImages(imageUrls);

  // ── Azure Foundry branch ──────────────────────────────────────────────────────
  if (azureBaseUrl && azureDeployment) {
    const azureKey = process.env.AZURE_API_KEY;
    if (!azureKey) return NextResponse.json({ error: "AZURE_API_KEY is not set" }, { status: 500 });

    const sizeMap = cfg.azureSizeMap ?? {};
    const size    = sizeMap[aspectRatio] ?? "1024x1024";

    const body: Record<string, unknown> = {
      prompt:             prompt.slice(0, cfg.apiInput.promptMaxLength ?? 32000),
      n:                  1,
      output_format:      "png",
      output_compression: 100,
    };
    if (size && size !== "auto") body.size = size;
    body.quality = azureQuality || "medium";

    const base            = azureBaseUrl.replace(/\/$/, "");
    const azureApiVersion = cfg.azureApiVersion ?? "2024-02-01";
    const azureUrl        = `${base}/openai/deployments/${azureDeployment}/images/generations?api-version=${azureApiVersion}`;

    const azureTaskId = `azure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    jobStore.set(azureTaskId, { status: "pending", type: "image" });

    // Resolve user before the async fire-and-forget (req context will be gone)
    const azureUserId = await getUserId(req);

    (async () => {
      try {
        const res = await httpsPost(
          azureUrl,
          { "Content-Type": "application/json", Authorization: `Bearer ${azureKey}` },
          JSON.stringify(body),
        );

        const txt = await res.text();
        if (!res.ok) {
          let displayError = `Azure error ${res.status}`;
          try {
            const parsed = JSON.parse(txt);
            const code   = parsed?.error?.code ?? parsed?.error?.type;
            displayError  = code ? code : displayError;
          } catch { /* not JSON */ }
          jobStore.set(azureTaskId, { status: "error", error: displayError });
          return;
        }

        const azureJson = JSON.parse(txt);
        const b64 = azureJson?.data?.[0]?.b64_json as string | undefined;
        if (!b64) {
          jobStore.set(azureTaskId, { status: "error", error: "Azure returned no image data" });
          return;
        }

        const buf      = Buffer.from(b64, "base64");
        const imageUrl = await uploadBuffer(buf, "image/png", "generated");
        jobStore.set(azureTaskId, { status: "done", imageUrl });

        // Persist to Supabase so the gallery can find it
        supabaseAdmin.from("generations").insert({
          task_id:         azureTaskId,
          user_id:         azureUserId,
          generation_type: "image",
          status:          "done",
          image_url:       imageUrl,
          prompt:          prompt.slice(0, 2000),
          model,
          aspect_ratio:    aspectRatio,
          quality:         azureQuality ?? "medium",
        }).then(({ error }) => {
          if (error) console.error("[azure] supabase insert error:", error.message);
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[azure] background error:", msg);
        jobStore.set(azureTaskId, { status: "error", error: msg });
      }
    })();

    return NextResponse.json({ taskId: azureTaskId });
  }

  // ── Kie.ai branch ─────────────────────────────────────────────────────────────
  const kieToken = process.env.KIE_API_TOKEN;
  if (!kieToken) return NextResponse.json({ error: "KIE_API_TOKEN is not set" }, { status: 500 });

  const callbackBase = process.env.CALLBACK_BASE_URL;
  if (!callbackBase) return NextResponse.json({ error: "CALLBACK_BASE_URL is not set" }, { status: 500 });

  const callBackUrl = `${callbackBase.replace(/\/$/, "")}/api/callback`;

  try {
    const { apiInput } = cfg;

    // ── Dual-mode models (e.g. GPT Image 2) ────────────────────────────────────
    const hasImages = r2ImageUrls.length > 0;
    const resolvedApiId = !hasImages && cfg.textOnlyApiId ? cfg.textOnlyApiId : cfg.apiId;

    const input: Record<string, unknown> = {
      prompt:                    prompt.slice(0, apiInput.promptMaxLength),
      [apiInput.aspectRatioKey]: aspectRatio,
    };

    if (apiInput.outputFormat)               input.output_format           = apiInput.outputFormat;
    if (apiInput.imageInputKey && hasImages) input[apiInput.imageInputKey] = r2ImageUrls.slice(0, cfg.maxImages);
    if (apiInput.qualityKey) {
      input[apiInput.qualityKey] = apiInput.qualityMap
        ? (apiInput.qualityMap[quality] ?? quality)
        : quality === "4k" ? "4K" : quality === "2k" ? "2K" : "1K";
    }
    if (apiInput.extra) Object.assign(input, apiInput.extra);

    const requestBody = { model: resolvedApiId, callBackUrl, input };

    const res = await fetch(CREATE, {
      method:  "POST",
      headers: { Authorization: `Bearer ${kieToken}`, "Content-Type": "application/json" },
      body:    JSON.stringify(requestBody),
    });

    if (!res.ok) throw new Error(await res.text());
    const d = await res.json();
    if (d.code !== undefined && d.code !== 200) throw new Error(d.msg ?? `API error ${d.code}`);

    const taskId = d.data?.taskId ?? d.data?.id ?? d.taskId ?? d.id;
    if (!taskId) throw new Error("No task ID in response");

    jobStore.set(taskId, { status: "pending" });

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
