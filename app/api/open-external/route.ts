/**
 * Opens a URL in the OS default browser. The desktop shell's webview traps
 * `window.open` / `target="_blank"`, so external links are routed here instead
 * (the Next.js server runs as a local child of the app and can shell out).
 *
 * http(s) URLs only.
 */
import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const runtime = "nodejs";

function opener(): { cmd: string; args: string[] } {
  if (process.platform === "darwin") return { cmd: "open", args: [] };
  // Never `cmd /c start`: cmd.exe parses the URL, so `http://x/&calc` ran calc.
  if (process.platform === "win32") return { cmd: "rundll32.exe", args: ["url.dll,FileProtocolHandler"] };
  return { cmd: "xdg-open", args: [] };
}

export async function POST(req: NextRequest) {
  let url: string;
  try {
    const parsed = new URL((await req.json()).url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "unsupported protocol" }, { status: 400 });
    }
    url = parsed.href;
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  const { cmd, args } = opener();
  try {
    const child = spawn(cmd, [...args, url], { detached: true, stdio: "ignore" });
    child.unref();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
