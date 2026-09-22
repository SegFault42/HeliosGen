import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { codexLoginStore } from "@/lib/codexLoginStore";

// 15 minutes, matching the device code's own expiry (plus a little slack).
const CODE_LIFETIME_MS = 16 * 60 * 1000;

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function checkLoginStatus(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("codex", ["login", "status"], { shell: process.platform === "win32" });
    let out = "";
    proc.stdout.on("data", (d: Buffer) => out += d.toString());
    // "Logged in using ChatGPT" vs "Not logged in" both contain "logged in" as a
    // substring — anchor to the start of the (trimmed) line so "Not …" doesn't match.
    proc.on("close", () => resolve(/^logged in/im.test(out.trim())));
    proc.on("error", () => resolve(false));
    // Don't let a wedged CLI hang the login verdict forever.
    setTimeout(() => { proc.kill(); resolve(false); }, 10_000);
  });
}

// The on-disk credential file, same source of truth /api/settings/codex-status
// keys off. The CLI wipes it when a login *starts* and rewrites it only on
// success, so at `codex login` exit its presence is a reliable success signal.
function codexAuthExists(): boolean {
  const authPath = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json");
  return existsSync(authPath);
}

// `codex login --device-auth` can exit a beat before auth.json is flushed, and a
// lone `codex login status` fired immediately after sometimes reports stale
// "not logged in" state. Retry briefly and accept the credential file as proof,
// so a successful browser confirmation never surfaces as a red error.
async function confirmLoggedIn(): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (codexAuthExists() || await checkLoginStatus()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export async function GET() {
  return NextResponse.json(codexLoginStore.get());
}

export async function POST() {
  const current = codexLoginStore.get();

  // A device code is already pending and still within its lifetime — don't
  // spawn a second `codex login` on top of it (and never kill the first: the
  // CLI wipes any existing credentials as soon as a new login starts, so a
  // half-finished second attempt would leave the user logged out).
  if (current.status === "pending" && Date.now() - current.startedAt < CODE_LIFETIME_MS) {
    return NextResponse.json(current);
  }

  const result = await new Promise<CodexLoginPostResult>((resolve) => {
    let buf = "";
    let settled = false;

    const proc = spawn("codex", ["login", "--device-auth"], { shell: process.platform === "win32" });

    const trySettle = () => {
      if (settled) return;
      const clean = stripAnsi(buf);
      const urlMatch  = clean.match(/https:\/\/\S+/);
      const codeMatch = clean.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4,8})\b/);
      if (urlMatch && codeMatch) {
        settled = true;
        const state = { status: "pending" as const, url: urlMatch[0], code: codeMatch[1], startedAt: Date.now() };
        codexLoginStore.set(state);
        resolve(state);
      }
    };

    proc.stdout.on("data", (d: Buffer) => { buf += d.toString(); trySettle(); });
    proc.stderr.on("data", (d: Buffer) => { buf += d.toString(); trySettle(); });

    proc.on("error", (e) => {
      if (!settled) {
        settled = true;
        const state = { status: "error" as const, error: `codex spawn failed: ${e.message} — is it installed and on PATH?` };
        codexLoginStore.set(state);
        resolve(state);
      }
    });

    // The CLI keeps running after printing the code, polling in the background
    // until the user confirms in their browser (or the code expires). Let it
    // run to completion asynchronously — the store gets the final verdict once
    // it exits, and the frontend polls GET for that.
    proc.on("close", async (exitCode) => {
      const loggedIn = await confirmLoggedIn();
      if (loggedIn) {
        codexLoginStore.set({ status: "success" });
      } else {
        codexLoginStore.set({ status: "error", error: stripAnsi(buf).trim().slice(-300) || `codex login exited with code ${exitCode}` });
      }
    });

    // Fallback if the CLI hangs without printing anything parseable.
    setTimeout(() => {
      if (!settled) {
        settled = true;
        const state = { status: "error" as const, error: "Timed out waiting for codex login to print a device code." };
        resolve(state);
      }
    }, 10_000);
  });

  return NextResponse.json(result);
}

type CodexLoginPostResult =
  | { status: "pending"; url: string; code: string; startedAt: number }
  | { status: "error"; error: string };
