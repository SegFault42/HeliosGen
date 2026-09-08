import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATA_DIR } from "./guest/paths";

/**
 * Multiple ChatGPT accounts for codex-imagegen. The default `codex login`
 * session lives at $CODEX_HOME/auth.json; extra accounts are added with
 *   CODEX_HOME=~/.codex/profiles/<name> codex login --device-auth
 * which drops a second auth.json under profiles/<name>/. Each generation is
 * tried against the accounts in order, skipping the ones that hit the ChatGPT
 * usage limit recently (cooldown persisted on disk, like lib/jobStore.ts).
 */
const CODEX_HOME = process.env.CODEX_HOME ?? join(homedir(), ".codex");
const PROFILES_DIR = join(CODEX_HOME, "profiles");
const LIMITS_FILE = join(DATA_DIR, ".codex-limits.json");
// ponytail: fixed cooldown; parse the reset time out of the error if it ever matters.
const COOLDOWN_MS = 3 * 60 * 60 * 1000;

export function listCodexAuthFiles(): string[] {
  const files = [join(CODEX_HOME, "auth.json")];
  if (existsSync(PROFILES_DIR)) {
    for (const name of readdirSync(PROFILES_DIR)) files.push(join(PROFILES_DIR, name, "auth.json"));
  }
  return files.filter(existsSync);
}

function readLimits(): Record<string, number> {
  if (!existsSync(LIMITS_FILE)) return {};
  try { return JSON.parse(readFileSync(LIMITS_FILE, "utf8")); } catch { return {}; }
}

export function markCodexLimited(authFile: string): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(LIMITS_FILE, JSON.stringify({ ...readLimits(), [authFile]: Date.now() + COOLDOWN_MS }), "utf8");
}

export function isCodexLimited(authFile: string): boolean {
  return (readLimits()[authFile] ?? 0) > Date.now();
}

/** Accounts not on cooldown first; cooled-down ones last, in case the quota reset early. */
export function orderedCodexAuthFiles(): string[] {
  const all = listCodexAuthFiles();
  return [...all.filter((f) => !isCodexLimited(f)), ...all.filter(isCodexLimited)];
}

export function isUsageLimitError(stderr: string): boolean {
  return /usage limit/i.test(stderr);
}
