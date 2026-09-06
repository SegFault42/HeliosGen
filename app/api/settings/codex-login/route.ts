import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { checkCodexLogin } from "@/lib/codexStatus.mjs";
import { codexLoginStore } from "@/lib/codexLoginStore";

// 15 minutes, matching the device code's own expiry (plus a little slack).
const CODE_LIFETIME_MS = 16 * 60 * 1000;

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// `codex login --device-auth` can exit a beat before auth.json is flushed, and a
// lone `codex login status` fired immediately after sometimes reports stale
// "not logged in" state. Retry briefly, requiring a ChatGPT login verdict.
async function confirmLoggedIn(): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await checkCodexLogin() === "chatgpt") return true;
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

    const proc = spawn("codex", ["login", "--device-auth"]);

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
