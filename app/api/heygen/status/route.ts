import { NextResponse } from "next/server";
import { getHeyGenCurrentUser, heygenClientPath, heygenTokenPath } from "@/lib/heygenMcp";

export const runtime = "nodejs";

export async function GET() {
  try {
    const account = await getHeyGenCurrentUser();
    return NextResponse.json({ ok: true, provider: "heygen-mcp", account });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HeyGen MCP check failed";
    return NextResponse.json({
      ok: false,
      provider: "heygen-mcp",
      error: message,
      tokenFile: heygenTokenPath(),
      clientFile: heygenClientPath(),
    }, { status: 502 });
  }
}
