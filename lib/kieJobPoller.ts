/**
 * Desktop / guest-mode replacement for the kie.ai webhook (`/api/callback`).
 *
 * A packaged desktop app has no public URL for kie.ai to POST results to, so
 * instead we poll `GET /api/v1/jobs/recordInfo?taskId=` until the task reaches a
 * terminal state, then run the exact same settle logic the callback route does:
 * mirror the output into local storage, update the guest DB, write `jobStore`,
 * and emit the `job:<taskId>` event that the `/api/job-status` SSE stream waits
 * on. The frontend is unchanged.
 *
 * Not covered yet: Google Veo models (`/api/v1/veo/generate` +
 * `/api/v1/veo/record-info`, which use a different response shape).
 */
import { jobStore, type JobResult } from "./jobStore";
import { jobEvents } from "./jobEvents";
import { mirrorToR2 } from "./storage";
import * as guestDb from "./guest/db";

const BASE = "https://api.kie.ai";
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_MS = 12 * 60 * 1000; // matches the SSE hard cap in job-status

type Kind = "image" | "video";

// Tasks currently being polled by this process — guards against double-starts.
const active = new Set<string>();

export function isPolling(taskId: string): boolean {
  return active.has(taskId);
}

/** Start polling a kie.ai job in the background. Safe to call more than once. */
export function pollKieJob(taskId: string, apiKey: string, kind: Kind): void {
  if (!taskId || active.has(taskId)) return;
  active.add(taskId);
  void loop(taskId, apiKey, kind)
    .catch((e) => {
      console.error(`[kie-poller] ${taskId} crashed:`, e);
      settle(taskId, kind, { status: "error", error: "Generation failed (poller error)" });
    })
    .finally(() => active.delete(taskId));
}

// Local-only providers mint prefixed task IDs (`azure-…`, `codex-…`) and have no
// kie.ai job behind them. Polling kie.ai's recordInfo for one of these just
// comes back `{ msg: "recordInfo is null" }`, which the loop then settles as a
// spurious error — clobbering the real job that's still running locally.
function isKieTaskId(taskId: string): boolean {
  return !taskId.startsWith("azure-") && !taskId.startsWith("codex-") && !taskId.startsWith("higgsfield-");
}

/**
 * Resume polling a job whose poller was lost to a server restart (guest mode
 * only — reads the kie.ai key from the guest DB). No-op if already polling, if
 * no key is configured, or if the task belongs to a non-kie local provider.
 */
export function resumeKieJob(taskId: string, kind: Kind): void {
  if (active.has(taskId) || !isKieTaskId(taskId)) return;
  const key = guestDb.getKieApiToken();
  if (!key) return;
  pollKieJob(taskId, key, kind);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop(taskId: string, apiKey: string, kind: Kind): Promise<void> {
  const deadline = Date.now() + MAX_POLL_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    let data: Record<string, unknown>;
    try {
      const res = await fetch(
        `${BASE}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      const json = await res.json();
      if (json?.code !== undefined && json.code !== 200 && json.code !== 0) {
        settle(taskId, kind, { status: "error", error: json.msg ?? `kie.ai error ${json.code}` });
        return;
      }
      data = (json?.data ?? json) as Record<string, unknown>;
    } catch (e) {
      console.warn(`[kie-poller] ${taskId} transient poll error:`, (e as Error).message);
      continue;
    }

    const state = String(data.state ?? data.status ?? "").toLowerCase();

    if (state === "success" || state === "succeeded") {
      const urls = extractUrls(data);
      if (urls.length === 0) {
        settle(taskId, kind, { status: "error", error: "Generation succeeded but returned no output" });
        return;
      }
      await settleSuccess(taskId, kind, urls);
      return;
    }

    if (state === "fail" || state === "failed" || state === "error") {
      const msg =
        (data.failMsg as string) ?? (data.error as string) ?? (data.failReason as string) ?? "Generation failed";
      settle(taskId, kind, { status: "error", error: msg });
      return;
    }
    // waiting / queuing / generating / running → keep polling
  }

  settle(taskId, kind, { status: "error", error: "Generation timed out" });
}

function extractUrls(data: Record<string, unknown>): string[] {
  const out: string[] = [];

  const resultJson = data.resultJson as string | undefined;
  if (resultJson) {
    try {
      const parsed = JSON.parse(resultJson);
      const urls = parsed.resultUrls ?? parsed.resultUrl;
      if (Array.isArray(urls)) out.push(...urls.filter(Boolean));
      else if (urls) out.push(urls);
    } catch {
      /* fall through to the other shapes */
    }
  }
  if (out.length === 0 && typeof data.videoUrl === "string") out.push(data.videoUrl);
  if (out.length === 0) {
    const output = data.output as unknown;
    if (Array.isArray(output) && output[0]) out.push(String(output[0]));
    else if (typeof output === "string") out.push(output);
  }
  return out;
}

async function settleSuccess(taskId: string, kind: Kind, kieUrls: string[]): Promise<void> {
  const folder = kind === "video" ? "videos" : "images";
  let storedUrls: string[];
  try {
    storedUrls = await Promise.all(kieUrls.map((u) => mirrorToR2(u, folder)));
  } catch (e) {
    console.error(`[kie-poller] ${taskId} storage mirror failed, using source URLs:`, (e as Error).message);
    storedUrls = kieUrls;
  }

  settle(
    taskId,
    kind,
    kind === "video"
      ? { status: "done", videoUrl: storedUrls[0] }
      : { status: "done", imageUrl: storedUrls[0], imageUrls: storedUrls },
  );
}

/** Write jobStore, emit the SSE event, and mirror into the guest DB. */
function settle(taskId: string, kind: Kind, result: JobResult): void {
  jobStore.set(taskId, result);
  jobEvents.emit(`job:${taskId}`, result);

  if (result.status === "done") {
    guestDb.updateGeneration(
      taskId,
      kind === "video"
        ? { status: "done", video_url: result.videoUrl }
        : { status: "done", image_url: result.imageUrl, image_urls: result.imageUrls },
    );
  } else if (result.status === "error") {
    guestDb.updateGeneration(taskId, { status: "error", error_msg: result.error });
  }
}
