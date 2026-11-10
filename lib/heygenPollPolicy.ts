// Pure decisions for lib/heygenJobPoller.ts (same split as flowPollPolicy.ts).
export const HEYGEN_DEADLINE_MS = 30 * 60_000; // renders observed up to ~22 min

export type HeyGenPhase = "completed" | "failed" | "pending";

/** waiting_for_input, reviewing, thinking, generating, unknown: all non-terminal. */
export function heygenPhase(state: string): HeyGenPhase {
  const s = state.toLowerCase();
  if (s.includes("error") || s.includes("fail") || s.includes("cancel") || s === "stopped") return "failed";
  if (s.includes("complete") || s.includes("success") || s === "done") return "completed";
  return "pending";
}

const FATAL_STATUS = new Set([400, 401, 403, 422]);
const FATAL_MESSAGE =
  /token refresh (failed \(4\d\d\)|returned)|no refresh token|token file|unauthori[sz]ed|forbidden|permission/i;

/** Fatal = auth/permission or a 400/422 validation status. Everything else (404, "not found"/"invalid" text, network, 5xx, 429, timeouts) is transient; the deadline decides. */
export function isFatalHeyGenError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  if (typeof status === "number") return FATAL_STATUS.has(status);
  const message = error instanceof Error ? error.message : String(error ?? "");
  return FATAL_MESSAGE.test(message);
}

export function heygenFailureReason(...sources: unknown[]): string | undefined {
  for (const source of sources) {
    const o = source as Record<string, unknown> | null | undefined;
    if (!o || typeof o !== "object") continue;
    const err = o.error;
    const candidates = [o.failure_message, o.error_message, typeof err === "string" ? err : (err as { message?: unknown } | null)?.message];
    for (const c of candidates) if (typeof c === "string" && c.trim()) return c.trim();
  }
  return undefined;
}
