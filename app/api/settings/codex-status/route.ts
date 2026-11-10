import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnCodex } from "@/lib/codexRun";

/**
 * codex-imagegen has no per-user credentials to save from the browser — it's a
 * single shared `codex login` session on this host. This just reports whether
 * that host-level setup is in place, for the "READY / NOT CONFIGURED" badge.
 */
function binaryOnPath(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const proc = spawnCodex(["--help"]);
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    } catch { resolve(false); }
  });
}

export async function GET() {
  const authPath = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "auth.json");
  const [installed, authFound] = await Promise.all([
    binaryOnPath(),
    Promise.resolve(existsSync(authPath)),
  ]);
  return NextResponse.json({ installed, authFound, ready: installed && authFound });
}
