/**
 * Grsai (https://grsai.ai) — alternative backend to kie.ai for the image models
 * it hosts (Nano Banana family, GPT Image 2 / 2.5).
 *
 * API docs: https://qmy27nhsd9.apifox.cn/452392911e0
 *   POST {base}/v1/api/generate  { model, prompt, images[], aspectRatio, ..., replyType: "async" } → { id }
 *   GET  {base}/v1/api/result?id= → { id, status: running|succeeded|failed|violation, results[{url}], progress, error }
 *
 * Reference images are sent inline as base64 data URLs (the API accepts both
 * base64 and URLs), so local `/generated/...` files need no re-hosting step.
 *
 * Grsai task IDs are namespaced locally as `grsai-<id>` so the kie.ai poller
 * and restart-recovery paths can tell them apart.
 */
import { toDataUrl } from "./kieUpload";
import { settleJob, settleJobSuccess } from "./kieJobPoller";
import * as guestDb from "./guest/db";
import { GRSAI_IMAGE_MODELS } from "./grsaiModels";

export { grsaiSupportsModel } from "./grsaiModels";

const BASE = "https://grsaiapi.com";
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_MS = 12 * 60 * 1000; // matches the SSE hard cap in job-status

export const GRSAI_TASK_PREFIX = "grsai-";

type Kind = "image" | "video";

// Grsai's documented 1K/2K/4K sizes for the pixel-sized GPT Image models.
const PIXEL_SIZES: Record<string, [string, string, string]> = {
  "1:1":  ["1024x1024", "2048x2048", "2880x2880"],
  "16:9": ["1280x720",  "2048x1152", "3840x2160"],
  "9:16": ["720x1280",  "1152x2048", "2160x3840"],
  "4:3":  ["1152x864",  "2304x1728", "3264x2448"],
  "3:4":  ["864x1152",  "1728x2304", "2448x3264"],
  "3:2":  ["1536x1024", "2048x1360", "3504x2336"],
  "2:3":  ["1024x1536", "1360x2048", "2336x3504"],
  "5:4":  ["1120x896",  "2240x1792", "3200x2560"],
  "4:5":  ["896x1120",  "1792x2240", "2560x3200"],
  "21:9": ["1456x624",  "2912x1248", "3840x1648"],
  "9:21": ["624x1456",  "1248x2912", "1648x3840"],
  "2:1":  ["1536x768",  "3072x1536", "3840x1920"],
  "1:2":  ["768x1536",  "1536x3072", "1920x3840"],
};

const TIER_INDEX: Record<string, number> = { "1k": 0, "2k": 1, "4k": 2 };
const TIER_AREA = [1024 * 1024, 2048 * 2048, 8_294_400];

/**
 * Explicit size for ratios Grsai doesn't list (e.g. 27:16, 9:8): hit the tier's
 * pixel budget, edges multiples of 16, max edge 3840, total ≥ 655,360.
 */
function computePixelSize(ratio: string, tier: number): string {
  const [rw, rh] = ratio.split(":").map(Number);
  if (!rw || !rh) return "1024x1024";
  const area = TIER_AREA[tier];
  let w = Math.sqrt((area * rw) / rh);
  let h = w * (rh / rw);
  const scale = Math.min(1, 3840 / Math.max(w, h));
  w *= scale;
  h *= scale;
  const round16 = (n: number) => Math.max(16, Math.floor(n / 16) * 16);
  let W = round16(w);
  let H = round16(h);
  while (W * H < 655_360) { W += 16; H = round16((W * rh) / rw); }
  return `${W}x${H}`;
}

function pixelSize(aspectRatio: string, quality: string): string {
  if (aspectRatio === "auto") return "auto";
  const tier = TIER_INDEX[quality] ?? 0;
  return PIXEL_SIZES[aspectRatio]?.[tier] ?? computePixelSize(aspectRatio, tier);
}

/** Build the /v1/api/generate body for an app image model. */
export async function buildGrsaiImageBody(opts: {
  modelId: string;
  prompt: string;
  imageUrls: string[];
  aspectRatio: string;
  quality: string;
  maxImages: number;
}): Promise<Record<string, unknown>> {
  const cfg = GRSAI_IMAGE_MODELS[opts.modelId];
  if (!cfg) throw new Error(`Grsai does not support model ${opts.modelId}`);

  const images = await Promise.all(
    opts.imageUrls.slice(0, opts.maxImages).map((u) => (/^https?:\/\//i.test(u) && !isLocalhost(u) ? u : toDataUrl(u))),
  );

  const body: Record<string, unknown> = {
    model: cfg.model,
    prompt: opts.prompt,
    images,
    aspectRatio: cfg.sizing === "pixels" ? pixelSize(opts.aspectRatio, opts.quality) : opts.aspectRatio,
    replyType: "async",
  };
  if (cfg.imageSize) body.imageSize = (opts.quality || "1k").toUpperCase();
  return body;
}

function isLocalhost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
  } catch {
    return true;
  }
}

/** Submit a generation. Returns the namespaced local task ID (`grsai-<id>`). */
export async function createGrsaiTask(body: Record<string, unknown>, apiKey: string): Promise<string> {
  const res = await fetch(`${BASE}/v1/api/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }

  if (res.status === 401 || res.status === 403) throw new Error("Invalid Grsai API key — please update it in Settings.");
  const id = json?.id as string | undefined;
  if (!res.ok || !id || json?.status === "failed" || json?.status === "violation") {
    const msg = (json?.error as string) || (json?.msg as string) || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(`Grsai: ${msg}`);
  }
  return `${GRSAI_TASK_PREFIX}${id}`;
}

// ── Polling ───────────────────────────────────────────────────────────────────

const active = new Set<string>();

export function isGrsaiTaskId(taskId: string): boolean {
  return taskId.startsWith(GRSAI_TASK_PREFIX);
}

/** Start polling a Grsai job in the background. Safe to call more than once. */
export function pollGrsaiJob(taskId: string, apiKey: string, kind: Kind): void {
  if (!taskId || active.has(taskId)) return;
  active.add(taskId);
  void loop(taskId, apiKey, kind)
    .catch((e) => {
      console.error(`[grsai-poller] ${taskId} crashed:`, e);
      settleJob(taskId, kind, { status: "error", error: "Generation failed (poller error)" });
    })
    .finally(() => active.delete(taskId));
}

/** Resume polling after a server restart (reads the key from the guest DB). */
export function resumeGrsaiJob(taskId: string, kind: Kind): void {
  if (active.has(taskId) || !isGrsaiTaskId(taskId)) return;
  const key = guestDb.getGrsaiApiKey();
  if (!key) return;
  pollGrsaiJob(taskId, key, kind);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop(taskId: string, apiKey: string, kind: Kind): Promise<void> {
  const remoteId = taskId.slice(GRSAI_TASK_PREFIX.length);
  const deadline = Date.now() + MAX_POLL_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    let data: Record<string, unknown>;
    try {
      const res = await fetch(`${BASE}/v1/api/result?id=${encodeURIComponent(remoteId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      data = (await res.json()) as Record<string, unknown>;
      // The result endpoint may wrap the task as { code, data } — accept both shapes.
      if (data?.data && typeof data.data === "object" && !data.status) data = data.data as Record<string, unknown>;
    } catch (e) {
      console.warn(`[grsai-poller] ${taskId} transient poll error:`, (e as Error).message);
      continue;
    }

    const status = String(data.status ?? "").toLowerCase();

    if (status === "succeeded") {
      const results = (data.results as { url?: string }[] | undefined) ?? [];
      const urls = results.map((r) => r?.url).filter((u): u is string => !!u);
      if (urls.length === 0) {
        settleJob(taskId, kind, { status: "error", error: "Generation succeeded but returned no output" });
        return;
      }
      await settleJobSuccess(taskId, kind, urls);
      return;
    }

    if (status === "failed" || status === "violation") {
      const err = (data.error as string) || (status === "violation" ? "Rejected by content moderation" : "Generation failed");
      settleJob(taskId, kind, { status: "error", error: `Grsai: ${err}` });
      return;
    }
    // running → keep polling
  }

  settleJob(taskId, kind, { status: "error", error: "Generation timed out" });
}
