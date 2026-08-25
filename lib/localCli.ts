// ─────────────────────────────────────────────────────────────────────────────
// LOCAL CLI — drives the `claude` CLI installed on this machine so the Assistant
// can run on your own subscription instead of Kie.ai credits.
//
// This spawns a process on the host and uses whatever session that CLI is logged
// into — a single shared identity, not a per-user key. Meant for local /
// self-hosted single-user setups. It runs without tool access (`--tools ""`) and
// from a temp cwd, so it can't read or write the project it's serving.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export const LOCAL_CLI_MODELS = ["claude-cli"] as const;
export type LocalCliModelId = (typeof LOCAL_CLI_MODELS)[number];

export function isLocalCliModel(model: string): model is LocalCliModelId {
  return (LOCAL_CLI_MODELS as readonly string[]).includes(model);
}

const BINARIES: Record<LocalCliModelId, string> = {
  "claude-cli": process.env.CLAUDE_CLI_PATH || "claude",
};

export function localCliBinary(model: LocalCliModelId): string {
  return BINARIES[model];
}

/**
 * Resolves the binary to an absolute path instead of letting spawn search PATH,
 * because the server's PATH is not the one you get in a terminal:
 *  - `claude` installs to ~/.local/bin, which a dev server launched from an IDE
 *    or a login shell often doesn't have;
 *  - a PATH entry that is a *file* rather than a directory (a common .zshrc slip,
 *    e.g. `/opt/homebrew/bin/python3`) makes spawn fail outright with ENOTDIR,
 *    even when the binary sits in a later, valid entry.
 * Returns null when nothing executable is found.
 */
function resolveBinary(name: string): string | null {
  if (name.includes("/")) {
    try { accessSync(name, constants.X_OK); return name; } catch { return null; }
  }

  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(homedir(), ".local", "bin"),   // default `claude` install location
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];

  for (const dir of dirs) {
    if (!dir) continue;
    try {
      if (!statSync(dir).isDirectory()) continue;
      const candidate = join(dir, name);
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch { /* not here — keep looking */ }
  }
  return null;
}

/** `<bin> --version` — backs the Settings badge and the fail-fast check on send. */
export function isLocalCliInstalled(model: LocalCliModelId): Promise<boolean> {
  const bin = resolveBinary(BINARIES[model]);
  if (!bin) return Promise.resolve(false);
  return new Promise((resolve) => {
    const proc = spawn(bin, ["--version"], { cwd: tmpdir() });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

function buildArgs(systemPrompt: string): string[] {
  return [
    "--print",
    "--tools", "",                    // text-only assistant — no file or shell access
    "--no-session-persistence",
    "--output-format", "stream-json",
    "--include-partial-messages",     // token-level deltas instead of whole messages
    "--verbose",                      // required alongside --output-format stream-json
    ...(systemPrompt ? ["--system-prompt", systemPrompt] : []),
    ...(process.env.CLAUDE_CLI_MODEL ? ["--model", process.env.CLAUDE_CLI_MODEL] : []),
  ];
}

/**
 * Pulls the assistant text (or the failure) out of one JSONL line.
 *
 * `claude --output-format stream-json` wraps raw Anthropic SSE events:
 *   {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"…"}}}
 * and closes with a {"type":"result"} line carrying `is_error` — the process still
 * exits 0 on an API failure, so that flag is the only signal.
 */
function extractText(line: string): { text: string; error?: string } {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(line); } catch { return { text: "" }; }

  const event = parsed.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
  if (parsed.type === "stream_event" && event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
    return { text: event.delta.text ?? "" };
  }
  if (parsed.type === "result" && parsed.is_error) {
    return { text: "", error: typeof parsed.result === "string" ? parsed.result : "claude CLI returned an error" };
  }
  return { text: "" };
}

/** Streams the CLI's answer as text chunks. Throws on spawn / CLI failure. */
export async function* runLocalCli(opts: {
  model: LocalCliModelId;
  systemPrompt: string;
  prompt: string;
}): AsyncGenerator<string> {
  const configured = BINARIES[opts.model];
  const bin = resolveBinary(configured);
  if (!bin) {
    throw new Error(`\`${configured}\` was not found on this machine. Install it, or point CLAUDE_CLI_PATH at it.`);
  }
  const proc = spawn(bin, buildArgs(opts.systemPrompt), { cwd: tmpdir() });

  // "error" fires instead of "close" when the binary isn't on PATH; whichever
  // lands first tells us how the process ended.
  const closed = new Promise<{ code: number; spawnError?: string }>((resolve) => {
    proc.on("error", (e) => resolve({ code: -1, spawnError: e.message }));
    proc.on("close", (c) => resolve({ code: c ?? -1 }));
  });

  let stderr = "";
  proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

  proc.stdin.on("error", () => { /* CLI exited before reading stdin — `closed` explains why */ });
  proc.stdin.end(opts.prompt);

  let cliError: string | null = null;
  let buf = "";

  try {
    try {
      for await (const chunk of proc.stdout) {
        buf += (chunk as Buffer).toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const { text, error } = extractText(line.trim());
          if (error) { cliError = error; break; }
          if (text) yield text;
        }
        if (cliError) break;
      }
      if (!cliError) {
        const { text, error } = extractText(buf.trim());
        if (error) cliError = error;
        else if (text) yield text;
      }
    } catch { /* stdout torn down (e.g. spawn failure) — `closed` explains why */ }

    const { code, spawnError } = await closed;
    if (spawnError) throw new Error(`${bin} could not be started (${spawnError}) — is it installed and on PATH?`);
    if (cliError) throw new Error(cliError);
    if (code !== 0) throw new Error(`${bin} exited with code ${code}: ${stderr.trim().slice(0, 500) || "no stderr output"}`);
  } finally {
    // No-op once the process has exited; stops it when the browser disconnects
    // mid-answer and the consumer closes this generator early.
    proc.kill();
  }
}
