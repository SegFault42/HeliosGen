import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { isAuthError, isUsageLimitError } from "./codexAccounts";

export const CODEX_MAX_EDIT_IMAGES = 5;
export const CODEX_REAUTH_HINT = "Re-login in Settings > Codex (Reauth).";

/** codex-imagegen --quality takes auto|low|medium|high; its canvas is always 1024-scale, so 2k/4k cannot be honored. */
export function codexQualityArgs(quality: string | undefined): string[] {
  const q = quality === "4k" ? "high" : quality === "2k" ? "medium" : null;
  return q ? ["--quality", q] : [];
}

/**
 * codex-imagegen's stderr wraps the failure as `codex-imagegen exited with code N:
 * <tmp path> Error: <detail>` (JSON blob or prose ending in `;`). Extract the
 * useful part and, for expired sessions, point at Settings.
 */
export function cleanCodexError(raw: string): string {
  const match = raw.match(/Error:\s*([\s\S]*)$/);
  const tail = (match ? match[1] : raw).trim();
  let msg: string | undefined;

  const braceIdx = tail.indexOf("{");
  if (braceIdx !== -1) {
    try {
      const m = JSON.parse(tail.slice(braceIdx))?.error?.message;
      if (typeof m === "string" && m) msg = m;
    } catch { /* not valid JSON, fall through */ }
  }
  if (!msg) {
    const semiIdx = tail.indexOf(";");
    msg = (semiIdx !== -1 ? tail.slice(0, semiIdx).trim() : tail) || raw;
  }
  return isAuthError(msg) && !msg.includes("Settings") ? `${msg} ${CODEX_REAUTH_HINT}` : msg;
}

/** Windows: prefer the real .exe, fall back to an npm .cmd/.bat shim (needs a shell). */
export function resolveCodexExecutable(
  platform: string = process.platform,
  pathEnv: string = process.env.PATH ?? process.env.Path ?? "",
  exists: (p: string) => boolean = existsSync,
): { cmd: string; shell: boolean } {
  if (platform !== "win32") return { cmd: "codex-imagegen", shell: false };
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  for (const ext of [".exe", ".cmd", ".bat"]) {
    for (const d of dirs) {
      const p = join(d, `codex-imagegen${ext}`);
      if (exists(p)) return { cmd: p, shell: ext !== ".exe" };
    }
  }
  return { cmd: "codex-imagegen", shell: false };
}

/**
 * Spawns codex-imagegen. User text never travels as an argument: callers pass the
 * prompt via --prompt-file, so args are only server-generated paths and flags. In
 * shell mode (.cmd shim) args are double-quoted and anything cmd could interpret
 * is refused.
 */
export function spawnCodex(args: string[], exe = resolveCodexExecutable()): ChildProcessWithoutNullStreams {
  if (!exe.shell) return spawn(exe.cmd, args);
  for (const a of [exe.cmd, ...args]) {
    if (/["%^&|<>\r\n]/.test(a)) throw new Error("codex-imagegen: unsafe character in argument for shell launch");
  }
  return spawn(`"${exe.cmd}"`, args.map((a) => `"${a}"`), { shell: true });
}

export type CodexRunResult = { exitCode: number; stderr: string };

/**
 * Tries each account in order. Usage-limit and auth/session errors move on to the
 * next account; any other failure throws at once (bad prompts are not retried).
 * Returns the auth file that succeeded.
 */
export async function runWithAccounts(
  authFiles: string[],
  runOnce: (authFile: string) => Promise<CodexRunResult>,
  onLimited: (authFile: string) => void = () => {},
): Promise<string> {
  if (authFiles.length === 0) throw new Error("No Codex auth.json found. Run `codex login` and choose ChatGPT.");
  let limited = 0, expired = 0;
  for (const authFile of authFiles) {
    const { exitCode, stderr } = await runOnce(authFile);
    if (exitCode === 0) return authFile;
    if (isUsageLimitError(stderr)) {
      console.warn(`[codex-imagegen] usage limit on ${authFile}, trying next account`);
      onLimited(authFile);
      limited++;
    } else if (isAuthError(stderr)) {
      console.warn(`[codex-imagegen] session expired on ${authFile}, trying next account`);
      expired++;
    } else {
      console.error("[codex-imagegen] full stderr:", stderr || "(empty)");
      throw new Error(`codex-imagegen exited with code ${exitCode}: ${stderr.slice(-4000) || "no stderr output"}`);
    }
  }
  const parts = [expired && `${expired} session expired`, limited && `${limited} hit the usage limit`].filter(Boolean).join(", ");
  throw new Error(`Error: All ${authFiles.length} Codex account(s) failed (${parts}). ${expired ? CODEX_REAUTH_HINT : "Try again later or add another account with CODEX_HOME=~/.codex/profiles/<name> codex login --device-auth."}`);
}
