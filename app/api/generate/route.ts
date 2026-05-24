import { NextRequest, NextResponse } from "next/server";
import https from "node:https";
import http from "node:http";
import { spawn } from "node:child_process";
import { writeFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobStore } from "@/lib/jobStore";
import { ensureR2, uploadBuffer } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { IMAGE_MODELS } from "@/lib/modelConfig";
import { getKieTokenForUser } from "@/lib/getKieToken";
import { getAzureKeyForUser } from "@/lib/getAzureKey";
import { GUEST_MODE, resolveUserId } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

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
  timeoutMs = 1_000_000, // Azure image gen (gpt-image-2) can be slow; 1000s gives ample headroom
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


// Fetch any http/https URL to a Buffer, following redirects
function fetchBuffer(url: string, maxRedirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("Too many redirects"));
    const u   = new URL(url);
    const mod = u.protocol === "https:" ? https : (http as unknown as typeof https);
    mod.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} fetching image`));
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end",  () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}


// Send a multipart/form-data request via curl (bypasses Node.js TLS quirks with Azure)
async function curlMultipartPost(
  url:        string,
  authKey:    string,
  images:     Array<{ buf: Buffer; mime: string; ext: string }>,
  textFields: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: string }> {
  const tmpFiles: string[] = [];
  const bodyPath = join(tmpdir(), `azure-resp-${Date.now()}.json`);

  try {
    for (const img of images) {
      const p = join(tmpdir(), `azure-img-${Date.now()}-${Math.random().toString(36).slice(2)}.${img.ext}`);
      await writeFile(p, img.buf);
      tmpFiles.push(p);
    }

    const args = [
      "-s", "-m", "180",
      "-X", "POST", url,
      "-H", `Authorization: Bearer ${authKey}`,
      "-o", bodyPath,
      "-w", "%{http_code}",
    ];
    for (let i = 0; i < images.length; i++) {
      args.push("-F", `image[]=@${tmpFiles[i]};type=${images[i].mime}`);
    }
    for (const [k, v] of Object.entries(textFields)) {
      args.push("-F", `${k}=${v}`);
    }

    console.log("[azure/edits/curl] args:", args.map((a) => (a.startsWith("Bearer ") ? "Bearer ***" : a)));

    const { statusStr, stderr, exitCode } = await new Promise<{ statusStr: string; stderr: string; exitCode: number }>((resolve, reject) => {
      let out = "";
      let err = "";
      const proc = spawn("curl", args);
      proc.stdout.on("data", (d: Buffer) => out += d.toString());
      proc.stderr.on("data", (d: Buffer) => err += d.toString());
      proc.on("close",  (code) => resolve({ statusStr: out.trim(), stderr: err, exitCode: code ?? -1 }));
      proc.on("error",  (e) => reject(new Error(`curl spawn failed: ${e.message}`)));
    });

    console.log("[azure/edits/curl] exit code:", exitCode);
    if (stderr) console.log("[azure/edits/curl] stderr:", stderr);

    const status = parseInt(statusStr, 10) || 0;
    const body   = await readFile(bodyPath, "utf-8").catch(() => "");
    console.log("[azure/edits/curl] status:", status, "body:", body.slice(0, 1000));
    return { ok: status >= 200 && status < 300, status, body };
  } finally {
    for (const f of [...tmpFiles, bodyPath]) unlink(f).catch(() => {});
  }
}

// Resolve every image URL to an R2 CDN URL (uploads base64 / mirrors external URLs)
async function resolveImages(imageUrls: string[]): Promise<string[]> {
  const resolved = await Promise.all(
    imageUrls.slice(0, 14).map((u) => ensureR2(u, "references").catch(() => null))
  );
  return resolved.filter((u): u is string => u !== null);
}


export const maxDuration = 1000;

export async function POST(req: NextRequest) {
  const {
    model       = "nano-banana-2",
    prompt,
    imageUrls   = [],
    aspectRatio = "1:1",
    quality     = "1k",
    azureQuality,
    azureResolution,
    azureBaseUrl,
    azureDeployment,
    debugOnly,
  } = (await req.json()) as {
    model?:           string;
    prompt?:          string;
    imageUrls?:       string[];
    aspectRatio?:     string;
    quality?:         string;
    azureQuality?:    string;     // "auto" | "low" | "medium" | "high"
    azureResolution?: string;     // "1k" | "2k" | "4k"
    azureBaseUrl?:    string;     // global base URL from settings
    azureDeployment?: string;     // per-model deployment name from settings
    debugOnly?:       boolean;
  };

  if (debugOnly) {
    const body = { model, prompt, imageUrls, aspectRatio, quality, azureQuality, azureResolution };
    console.log("[DEBUG] generate payload:", JSON.stringify(body, null, 2));
    return NextResponse.json({ ok: true });
  }

  if (!prompt?.trim()) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });

  const cfg = IMAGE_MODELS.find((m) => m.id === model);
  if (!cfg) return NextResponse.json({ error: `Unknown model: ${model}` }, { status: 400 });

  let r2ImageUrls: string[] = [];
  try {
    r2ImageUrls = await resolveImages(imageUrls);
  } catch {
    // image mirroring failures are non-fatal — proceed without reference images
  }

  const currentUserId = await resolveUserId(req).catch(() => null);

  // ── Azure Foundry branch ──────────────────────────────────────────────────────
  if (azureBaseUrl && azureDeployment) {
    const azureKey = currentUserId
      ? await getAzureKeyForUser(currentUserId)
      : process.env.AZURE_API_KEY ?? null;
    if (!azureKey) return NextResponse.json({ error: "Azure API key is not configured. Add it in Settings." }, { status: 500 });

    const resSizeMaps     = cfg.azureResolutionSizeMaps ?? {};
    const sizeMap         = (azureResolution && resSizeMaps[azureResolution]) ? resSizeMaps[azureResolution] : (cfg.azureSizeMap ?? {});
    const size            = sizeMap[aspectRatio] ?? "1024x1024";
    const quality         = azureQuality || "medium";
    const base            = azureBaseUrl.replace(/\/$/, "");
    const azureApiVersion = cfg.azureApiVersion ?? "2025-04-01-preview";
    const truncatedPrompt = prompt.slice(0, cfg.apiInput.promptMaxLength ?? 32000);

    const azureTaskId = `azure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    jobStore.set(azureTaskId, { status: "pending", type: "image", userId: currentUserId ?? undefined });

    const azureUserId = currentUserId;

    const hasRefImages = r2ImageUrls.length > 0;

    (async () => {
      try {
        let res: { ok: boolean; status: number; text: () => Promise<string> };

        if (hasRefImages) {
          // ── Image-to-image: multipart /images/edits via curl ─────────────
          const azureUrl = `${base}/openai/deployments/${azureDeployment}/images/edits?api-version=${azureApiVersion}`;

          const images = await Promise.all(
            r2ImageUrls.slice(0, cfg.maxImages).map(async (imgUrl) => {
              const buf  = await fetchBuffer(imgUrl);
              const raw  = imgUrl.split("?")[0].split(".").pop()?.toLowerCase() ?? "png";
              const ext  = raw === "jpg" ? "jpeg" : raw;
              const mime = ext === "jpeg" ? "image/jpeg" : "image/png";
              return { buf, ext, mime };
            }),
          );

          const textFields: Record<string, string> = {
            prompt:        truncatedPrompt,
            quality,
            output_format: "png",
            n:             "1",
          };
          if (size && size !== "auto") textFields.size = size;

          const curl = await curlMultipartPost(azureUrl, azureKey, images, textFields);
          res = { ok: curl.ok, status: curl.status, text: () => Promise.resolve(curl.body) };
        } else {
          // ── Text-to-image: JSON /images/generations ────────────────────────
          const azureUrl = `${base}/openai/deployments/${azureDeployment}/images/generations?api-version=${azureApiVersion}`;

          const body: Record<string, unknown> = {
            prompt:             truncatedPrompt,
            n:                  1,
            output_format:      "png",
            output_compression: 100,
            quality,
          };
          if (size && size !== "auto") body.size = size;

          console.log("[azure/generations] request →", {
            url:    azureUrl,
            method: "POST",
            body,
          });

          res = await httpsPost(
            azureUrl,
            { "Content-Type": "application/json", Authorization: `Bearer ${azureKey}` },
            JSON.stringify(body),
          );
        }

        const txt = await res.text();
        console.log("[azure] raw response body:", txt.slice(0, 1000));
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

        if (GUEST_MODE) {
          guestDb.insertGeneration({
            task_id: azureTaskId, user_id: azureUserId, generation_type: "image",
            status: "done", image_url: imageUrl, prompt: prompt.slice(0, 2000),
            model, aspect_ratio: aspectRatio, quality,
            reference_image_urls: hasRefImages ? r2ImageUrls : undefined,
          });
        } else {
          supabaseAdmin.from("generations").insert({
            task_id:              azureTaskId,
            user_id:              azureUserId,
            generation_type:      "image",
            status:               "done",
            image_url:            imageUrl,
            prompt:               prompt.slice(0, 2000),
            model,
            aspect_ratio:         aspectRatio,
            quality,
            reference_image_urls: hasRefImages ? r2ImageUrls : undefined,
          }).then(({ error }) => {
            if (error) console.error("[azure] supabase insert error:", error.message);
          });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[azure] background error:", msg, e);
        jobStore.set(azureTaskId, { status: "error", error: msg });
      }
    })();

    return NextResponse.json({ taskId: azureTaskId });
  }

  // ── Kie.ai branch ─────────────────────────────────────────────────────────────
  const kieToken = currentUserId ? await getKieTokenForUser(currentUserId) : null;
  if (!kieToken) return NextResponse.json({ error: "No Kie.ai API key configured. Add one in Settings." }, { status: 401 });

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
        : quality === "4k" ? "4K" : quality === "2k" ? "2K" : quality === "1k" ? "1K" : quality;
    }
    if (apiInput.extra) Object.assign(input, apiInput.extra);

    const requestBody = { model: resolvedApiId, callBackUrl, input };

    const res = await fetch(CREATE, {
      method:  "POST",
      headers: { Authorization: `Bearer ${kieToken}`, "Content-Type": "application/json" },
      body:    JSON.stringify(requestBody),
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error("Invalid Kie.ai API key — please update it in Settings.");
      throw new Error(await res.text());
    }
    const d = await res.json();
    if (d.code !== undefined && d.code !== 200) throw new Error(d.msg ?? `API error ${d.code}`);

    const taskId = d.data?.taskId ?? d.data?.id ?? d.taskId ?? d.id;
    if (!taskId) throw new Error("No task ID in response");

    jobStore.set(taskId, { status: "pending", userId: currentUserId ?? undefined });

    if (GUEST_MODE) {
      guestDb.insertGeneration({
        task_id: taskId, user_id: currentUserId, generation_type: "image",
        status: "pending", prompt, model, aspect_ratio: aspectRatio, quality,
        reference_image_urls: r2ImageUrls,
      });
    } else {
      supabaseAdmin.from("generations").insert({
        task_id:              taskId,
        user_id:              currentUserId,
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
    }

    return NextResponse.json({ taskId, referenceImageUrls: r2ImageUrls });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
