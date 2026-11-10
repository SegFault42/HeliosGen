// Jobs whose work runs in-process only (no resumable poller, no DB pending row).
// A restart or child crash leaves them `pending` in the file-backed jobStore forever.
// Prefixes verified in app/api/generate/route.ts: grok-img-, azure-, codex-.
const IN_PROCESS_PREFIXES = ["grok-img-", "azure-", "codex-"];

// generate route: maxDuration = 1000s and Azure request timeout = 1_000_000 ms;
// +60s margin so a live job is never settled early.
export const ORPHAN_AFTER_MS = 1_060_000;

export const ORPHAN_ERROR = "Generation was interrupted (server restarted). Please retry.";

export function isInProcessJob(taskId: string): boolean {
  return IN_PROCESS_PREFIXES.some((p) => taskId.startsWith(p));
}

export function isOrphanedJob(taskId: string, ts: number | undefined, now = Date.now()): boolean {
  return isInProcessJob(taskId) && typeof ts === "number" && now - ts > ORPHAN_AFTER_MS;
}
