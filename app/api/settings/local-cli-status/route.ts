import { NextResponse } from "next/server";
import { isLocalCliInstalled, localCliBinary } from "@/lib/localCli";

/**
 * The local CLI has no per-user credentials to save from the browser — it runs
 * on whatever `claude` session is logged in on this host. This just reports
 * whether the binary is reachable, for the Settings status badge.
 */
export async function GET() {
  const claude = await isLocalCliInstalled("claude-cli");
  return NextResponse.json({
    claude: { installed: claude, binary: localCliBinary("claude-cli") },
  });
}
