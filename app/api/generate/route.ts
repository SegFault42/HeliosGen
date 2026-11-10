import { NextRequest, NextResponse } from "next/server";
import { dlog } from "@/lib/debugLog";
import https from "node:https";
import http from "node:http";
import { spawn } from "node:child_process";
import { writeFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { MEDIA_DIR } from "@/lib/guest/paths";
import { jobStore } from "@/lib/jobStore";
import { jobEvents } from "@/lib/jobEvents";
import { pollKieJob } from "@/lib/kieJobPoller";
import { ensureKieReachableImages } from "@/lib/kieUpload";
import { ensureR2, uploadBuffer } from "@/lib/storage";
import { IMAGE_MODELS, validateAzureCustomSize } from "@/lib/modelConfig";
import { getKieTokenForUser } from "@/lib/getKieToken";
import { getAzureKeyForUser } from "@/lib/getAzureKey";
import { validateAzureEndpoint } from "@/lib/azureEndpoint";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { orderedCodexAuthFiles, markCodexLimited } from "@/lib/codexAccounts";
import { cleanCodexError, codexQualityArgs, runWithAccounts, spawnCodex, CODEX_MAX_EDIT_IMAGES } from "@/lib/codexRun";
import { submitFlowImage } from "@/lib/flowAdapter";
import { resumeFlowJob } from "@/lib/flowJobPoller";

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


// Fetch any http/https URL to a Buffer, following redirects.
// Root-relative "/generated/..." refs aren't valid URLs — read those straight
// off local disk.
function fetchBuffer(url: string, maxRedirects = 5): Promise<Buffer> {
  if (url.startsWith("/generated/")) {
    const rel = normalize(decodeURIComponent(url.slice("/generated/".length).split(/[?#]/)[0]));
    if (rel.startsWith("..") || rel.includes("\0")) {
      return Promise.reject(new Error(`Refusing to read outside media dir: ${url}`));
    }
    return readFile(join(MEDIA_DIR, rel));
  }
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
      "-s", "-m", "600",
      "-X", "POST", url,
      "-H", `Authorization: Bearer ${authKey}`,
      "-o", bodyPath,
      "-w", "%{http_code}",
    ];
    for (let i = 0; i < images.length; i++) {
      args.push("-F", `image[]=@${tmpFiles[i]};type=${images[i].mime}`);
    }
    // --form-string (not -F) for text fields: curl never treats a --form-string
    // value starting with @ or < as a file/header reference, unlike -F.
    for (const [k, v] of Object.entries(textFields)) {
      args.push("--form-string", `${k}=${v}`);
    }

    dlog("[azure/edits/curl] args:", args.map((a) => (a.startsWith("Bearer ") ? "Bearer ***" : a)));

    const runCurl = () => new Promise<{ statusStr: string; stderr: string; exitCode: number }>((resolve, reject) => {
      let out = "";
      let err = "";
      const proc = spawn("curl", args);
      proc.stdout.on("data", (d: Buffer) => out += d.toString());
      proc.stderr.on("data", (d: Buffer) => err += d.toString());
      proc.on("close",  (code) => resolve({ statusStr: out.trim(), stderr: err, exitCode: code ?? -1 }));
      proc.on("error",  (e) => reject(new Error(`curl spawn failed: ${e.message}`)));
    });

    let statusStr: string = "", stderr: string = "", exitCode: number = -1;
    for (let attempt = 1; attempt <= 3; attempt++) {
      ({ statusStr, stderr, exitCode } = await runCurl());
      dlog(`[azure/edits/curl] attempt ${attempt} exit code:`, exitCode);
      if (stderr) dlog("[azure/edits/curl] stderr:", stderr);
      if (exitCode !== 35) break; // 35 = SSL handshake failure — retry
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }

    if (exitCode! !== 0) {
      const reason = exitCode! === 28 ? "timed out (curl -m 600 exceeded)" : `curl exited with code ${exitCode}`;
      throw new Error(`Azure curl request failed: ${reason}`);
    }

    const status = parseInt(statusStr, 10) || 0;
    const body   = await readFile(bodyPath, "utf-8").catch(() => "");
    dlog("[azure/edits/curl] status:", status, "body:", body.slice(0, 1000));
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

// codex-imagegen (https://github.com/jdmnk/codex-imagegen-cli) only accepts these four sizes.
const CODEX_SIZE_MAP: Record<string, string> = {
  auto:   "auto",
  "1:1":  "1024x1024",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
  "4:3":  "1536x1024",
  "3:4":  "1024x1536",
};

/**
 * Runs the `codex-imagegen` CLI, which drives OpenAI Codex's image tool using the
 * server's local `codex login` session (~/.codex/auth.json) — a single shared
 * identity for the whole deployment, not a per-user API key. Writes reference
 * images to temp files (the CLI takes file paths, not URLs) and reads the
 * generated PNG back from its --out path.
 */
async function runCodexImagegen(opts: {
  prompt: string;
  images: Array<{ buf: Buffer; ext: string }>;
  size: string;
  quality?: string;
}): Promise<Buffer> {
  const tmpFiles: string[] = [];
  const outPath = join(tmpdir(), `codex-out-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);

  try {
    const imagePaths: string[] = [];
    for (const img of opts.images) {
      const p = join(tmpdir(), `codex-in-${Date.now()}-${Math.random().toString(36).slice(2)}.${img.ext}`);
      await writeFile(p, img.buf);
      tmpFiles.push(p);
      imagePaths.push(p);
    }

    // Prompt goes through a file so user text never reaches a shell or argv limits.
    const promptPath = join(tmpdir(), `codex-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    await writeFile(promptPath, opts.prompt, "utf8");
    tmpFiles.push(promptPath);

    const common = ["--prompt-file", promptPath, "--size", opts.size, ...codexQualityArgs(opts.quality), "--out", outPath, "--force"];
    const args = imagePaths.length > 0
      ? ["edit", ...imagePaths.flatMap((p) => ["--image", p]), ...common]
      : ["generate", ...common];

    const runOnce = (authFile: string) => new Promise<{ exitCode: number; stderr: string }>((resolve, reject) => {
      let err = "";
      const proc = spawnCodex([...args, "--auth-file", authFile]);
      proc.stderr.on("data", (d: Buffer) => err += d.toString());
      proc.on("close", (code) => resolve({ exitCode: code ?? -1, stderr: err }));
      proc.on("error", (e) => reject(new Error(`codex-imagegen spawn failed: ${e.message} — is it installed and on PATH?`)));
    });

    // Rotate across ChatGPT accounts on usage-limit or expired session (lib/codexRun.ts).
    await runWithAccounts(orderedCodexAuthFiles(), runOnce, markCodexLimited);
    return await readFile(outPath);
  } finally {
    for (const f of [...tmpFiles, outPath]) unlink(f).catch(() => {});
  }
}

export const maxDuration = 1000;

export async function POST(req: NextRequest) {
  // text/plain is a CORS "simple" request, so a cross-site page could POST here without a preflight.
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const {
    model       = "nano-banana-2",
    prompt,
    imageUrls: rawImageUrls = [],
    aspectRatio = "1:1",
    quality     = "1k",
    azureQuality,
    azureResolution,
    azureBaseUrl,
    azureDeployment,
    azureCustomWidth,
    azureCustomHeight,
    codexProvider,
    debugOnly,
  } = (await req.json()) as {
    model?:              string;
    prompt?:             string;
    imageUrls?:          string[];
    aspectRatio?:        string;
    quality?:            string;
    azureQuality?:       string;     // "auto" | "low" | "medium" | "high"
    azureResolution?:    string;     // "1k" | "2k" | "4k"
    azureBaseUrl?:       string;     // global base URL from settings
    azureDeployment?:    string;     // per-model deployment name from settings
    azureCustomWidth?:   number;     // manual size — used when aspectRatio === "custom"
    azureCustomHeight?:  number;
    codexProvider?:      boolean;    // route through the server's local codex-imagegen CLI
    debugOnly?:          boolean;
  };

  // Drop empty/non-string entries so `[""]` is neither resolved nor counted as a mirror failure.
  const imageUrls = (Array.isArray(rawImageUrls) ? rawImageUrls : []).filter((u): u is string => typeof u === "string" && u.trim() !== "");

  if (debugOnly) {
    const body = { model, prompt, imageUrls, aspectRatio, quality, azureQuality, azureResolution, azureCustomWidth, azureCustomHeight };
    dlog("[DEBUG] generate payload:", JSON.stringify(body, null, 2));
    return NextResponse.json({ ok: true });
  }

  if (!prompt?.trim()) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });

  const cfg = IMAGE_MODELS.find((m) => m.id === model);
  if (!cfg) return NextResponse.json({ error: `Unknown model: ${model}` }, { status: 400 });

  if (codexProvider && imageUrls.length > CODEX_MAX_EDIT_IMAGES) {
    return NextResponse.json({ error: `Codex accepts at most ${CODEX_MAX_EDIT_IMAGES} reference images (got ${imageUrls.length}). Remove some and retry.` }, { status: 400 });
  }

  let r2ImageUrls: string[] = [];
  try {
    r2ImageUrls = await resolveImages(imageUrls);
  } catch {
    // counted below
  }
  // Flow resolves the raw URLs itself; every other provider would silently drop the
  // reference and degrade an edit into text-to-image.
  if (!cfg.apiInput?.useFlow && r2ImageUrls.length < Math.min(imageUrls.length, 14)) {
    return NextResponse.json({ error: "Failed to prepare one or more reference images; not falling back to text-to-image. Retry." }, { status: 502 });
  }

  const currentUserId = GUEST_USER_ID;

  // ── Google Flow branch ────────────────────────────────────────────────────────
  if (cfg.apiInput?.useFlow) {
    try {
      const flowRes = await submitFlowImage({
        prompt: prompt.trim(),
        modelName: cfg.apiInput.flowModel || "Nano Banana 2",
        aspectRatio,
        referenceImages: r2ImageUrls.length > 0 ? r2ImageUrls : (imageUrls as string[]),
      });
      jobStore.set(flowRes.taskId, { status: "pending", type: "image", userId: currentUserId ?? undefined });
      guestDb.insertGeneration({
        task_id: flowRes.taskId,
        user_id: currentUserId,
        generation_type: "image",
        status: "pending",
        model,
        prompt: prompt.trim(),
        aspect_ratio: aspectRatio,
        reference_image_urls: imageUrls,
      });
      resumeFlowJob(flowRes.taskId);
      return NextResponse.json({ taskId: flowRes.taskId, provider: "flow" });
    } catch (err) {
      console.error("[generate] Google Flow image error:", err);
      return NextResponse.json({ error: (err instanceof Error && err.message) || "Google Flow image generation failed" }, { status: 500 });
    }
  }

  // ── xAI Grok Imagine branch ───────────────────────────────────────────────────
  if (cfg.apiInput?.useGrok) {
    let clientKey = process.env.GROK_CLIENT_KEY || "";
    if (!clientKey) {
      try { clientKey = (await readFile("F:/grok-pool/.client_key", "utf8")).trim(); } catch {}
    }
    if (!clientKey) {
      return NextResponse.json({ error: "Grok pool client key is unavailable" }, { status: 503 });
    }
    const grokModel = cfg.apiId || "grok-imagine-image-lite";
    try {
      const catalog = await fetch("http://127.0.0.1:8000/v1/models", {
        headers: { Authorization: `Bearer ${clientKey}` },
        signal: AbortSignal.timeout(5_000),
        cache: "no-store",
      });
      if (!catalog.ok) throw new Error(`model catalog HTTP ${catalog.status}`);
      const listing = await catalog.json() as { data?: Array<{ id?: string }> };
      if (!listing.data?.some((entry) => entry.id === grokModel)) {
        return NextResponse.json({ error: `Grok model ${grokModel} is unavailable in the connected pool; reauthenticate its Web/Console accounts` }, { status: 503 });
      }
    } catch (error) {
      return NextResponse.json({ error: `Grok pool availability check failed: ${error instanceof Error ? error.message : "unknown error"}` }, { status: 503 });
    }
    const grokTaskId = `grok-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    jobStore.set(grokTaskId, { status: "pending", type: "image", userId: currentUserId ?? undefined });
    guestDb.insertGeneration({
      task_id: grokTaskId,
      user_id: currentUserId,
      generation_type: "image",
      status: "pending",
      model,
      prompt: prompt.trim(),
      aspect_ratio: aspectRatio,
    });

    (async () => {
      try {
        const payload = {
          model: grokModel,
          prompt: prompt.trim(),
          aspect_ratio: aspectRatio || "1:1",
          response_format: "url",
        };

        const res = await fetch("http://127.0.0.1:8000/v1/images/generations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${clientKey}`,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const errText = await res.text();
          let msg = `Grok Imagine error HTTP ${res.status}`;
          try {
            const parsed = JSON.parse(errText);
            msg = parsed?.error?.message || msg;
          } catch {}
          throw new Error(msg);
        }

        const data = (await res.json()) as { data?: Array<{ url?: string }> };
        const rawUrl = data?.data?.[0]?.url;
        if (!rawUrl) throw new Error("Grok Imagine returned no image URL");

        const buf = await fetchBuffer(rawUrl);
        const imageUrl = await uploadBuffer(buf, "image/jpeg", "generated");

        const doneResult = { status: "done" as const, imageUrl };
        jobStore.set(grokTaskId, doneResult);
        jobEvents.emit(`job:${grokTaskId}`, doneResult);

        guestDb.updateGeneration(grokTaskId, { status: "done", image_url: imageUrl });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[grok-imagine] error:", msg, e);
        const errResult = { status: "error" as const, error: msg };
        jobStore.set(grokTaskId, errResult);
        jobEvents.emit(`job:${grokTaskId}`, errResult);
        guestDb.updateGeneration(grokTaskId, { status: "error", error_msg: msg });
      }
    })();

    return NextResponse.json({ taskId: grokTaskId, provider: "grok" });
  }

  // ── Azure Foundry branch ──────────────────────────────────────────────────────
  if (azureBaseUrl && azureDeployment) {
    const validatedBase = validateAzureEndpoint(azureBaseUrl);
    if (!validatedBase) {
      return NextResponse.json({ error: "Azure base URL is missing or invalid. Add a valid Azure endpoint in Settings." }, { status: 400 });
    }
    const azureKey = (await getAzureKeyForUser()) ?? process.env.AZURE_API_KEY ?? null;
    if (!azureKey) return NextResponse.json({ error: "Azure API key is not configured. Add it in Settings." }, { status: 500 });

    const resSizeMaps     = cfg.azureResolutionSizeMaps ?? {};
    const sizeMap         = (azureResolution && resSizeMaps[azureResolution]) ? resSizeMaps[azureResolution] : (cfg.azureSizeMap ?? {});
    const customSizeError = aspectRatio === "custom" && azureCustomWidth && azureCustomHeight
      ? validateAzureCustomSize(azureCustomWidth, azureCustomHeight)
      : null;
    const size            = aspectRatio === "custom" && azureCustomWidth && azureCustomHeight && !customSizeError
      ? `${azureCustomWidth}x${azureCustomHeight}`
      : (sizeMap[aspectRatio] ?? "1024x1024");
    const quality         = azureQuality || "medium";
    const base            = validatedBase;
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

          dlog("[azure/generations] request →", {
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
        dlog("[azure] raw response body:", txt.slice(0, 1000));
        if (!res.ok) {
          let displayError = `Azure error ${res.status}`;
          try {
            const parsed = JSON.parse(txt);
            const code   = parsed?.error?.code ?? parsed?.error?.type;
            const friendlyErrors: Record<string, string> = {
              EngineOverloaded: "Model is overloaded right now. Please try again.",
            };
            displayError = code ? (friendlyErrors[code] ?? code) : displayError;
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

        guestDb.insertGeneration({
          task_id: azureTaskId, user_id: azureUserId, generation_type: "image",
          status: "done", image_url: imageUrl, prompt: prompt.slice(0, 2000),
          model, aspect_ratio: aspectRatio, quality,
          azure_resolution: azureResolution,
          reference_image_urls: hasRefImages ? r2ImageUrls : undefined,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[azure] background error:", msg, e);
        jobStore.set(azureTaskId, { status: "error", error: msg });
      }
    })();

    return NextResponse.json({ taskId: azureTaskId });
  }

  // ── Codex CLI branch ───────────────────────────────────────────────────────────
  // codex-imagegen has no per-user token — it's a single shared `codex login`
  // session on this host — so there's no key lookup here, unlike the other branches.
  if (codexProvider) {
    const codexTaskId = `codex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    jobStore.set(codexTaskId, { status: "pending", type: "image", userId: currentUserId ?? undefined });

    const codexUserId = currentUserId;
    guestDb.insertGeneration({
      task_id: codexTaskId, user_id: codexUserId, generation_type: "image",
      status: "pending", prompt: prompt.slice(0, 2000),
      model, aspect_ratio: aspectRatio, quality,
    });
    const size = CODEX_SIZE_MAP[aspectRatio] ?? "auto";

    // "<<<image N>>>" tags are an in-text convention other providers resolve to a
    // URL; codex-imagegen takes images as separate file args, so just flatten the
    // tag to plain prose instead.
    // Codex's --size only offers 4 fixed canvases (no true 4:3/3:4), so spelling out
    // the intended ratio in the prompt steers composition even when the canvas itself
    // is an approximation.
    const codexPrompt = (prompt
      .slice(0, cfg.apiInput.promptMaxLength ?? 8000)
      .replace(/<<<image (\d+)>>>/gi, (_m, n) => `image ${n}`)
      + (aspectRatio && aspectRatio !== "auto" ? ` Aspect ratio: ${aspectRatio}.` : "")).trim();

    (async () => {
      try {
        const images = await Promise.all(
          r2ImageUrls.map(async (url) => {
            const buf = await fetchBuffer(url);
            const raw = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "png";
            const ext = raw === "jpg" ? "jpeg" : raw;
            return { buf, ext };
          }),
        );

        const outBuf   = await runCodexImagegen({ prompt: codexPrompt, images, size, quality });
        const imageUrl = await uploadBuffer(outBuf, "image/png", "generated");
        jobStore.set(codexTaskId, { status: "done", imageUrl });

        guestDb.updateGeneration(codexTaskId, { status: "done", image_url: imageUrl });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[codex] background error:", msg, e);
        const clean = cleanCodexError(msg);
        jobStore.set(codexTaskId, { status: "error", error: clean });
        guestDb.updateGeneration(codexTaskId, { status: "error", error_msg: clean });
      }
    })();

    return NextResponse.json({ taskId: codexTaskId });
  }

  // ── Kie.ai branch ─────────────────────────────────────────────────────────────
  const kieToken = await getKieTokenForUser();
  if (!kieToken) return NextResponse.json({ error: "No Kie.ai API key configured. Add one in Settings." }, { status: 401 });

  // The app polls kie.ai directly (see lib/kieJobPoller), so no callback URL.
  const callBackUrl = undefined;

  try {
    const { apiInput } = cfg;

    // ── Dual-mode models (e.g. GPT Image 2) ────────────────────────────────────
    const hasImages = r2ImageUrls.length > 0;
    const resolvedApiId = !hasImages && cfg.textOnlyApiId ? cfg.textOnlyApiId : cfg.apiId;

    // kie.ai can't fetch our local reference images, so push them to kie's
    // temporary file store first.
    let kieImageUrls = r2ImageUrls;
    if (hasImages) {
      kieImageUrls = await ensureKieReachableImages(r2ImageUrls, kieToken);
    }

    const input: Record<string, unknown> = {
      prompt:                    prompt.slice(0, apiInput.promptMaxLength),
      [apiInput.aspectRatioKey]: aspectRatio,
    };

    if (apiInput.outputFormat)               input.output_format           = apiInput.outputFormat;
    if (apiInput.imageInputKey && hasImages) input[apiInput.imageInputKey] = kieImageUrls.slice(0, cfg.maxImages);
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

    guestDb.insertGeneration({
      task_id: taskId, user_id: currentUserId, generation_type: "image",
      status: "pending", prompt, model, aspect_ratio: aspectRatio, quality,
      reference_image_urls: r2ImageUrls,
    });
    pollKieJob(taskId, kieToken, "image");

    return NextResponse.json({ taskId, referenceImageUrls: r2ImageUrls });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
