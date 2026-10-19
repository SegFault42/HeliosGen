import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Same-origin guard for the local API.
 *
 * The desktop sidecar listens on a fixed loopback port with no auth, so any web
 * page open in the user's browser could otherwise fire cross-origin requests at
 * it (spend kie.ai credits, overwrite/delete keys, redirect the Azure key via
 * `azureBaseUrl`). Responses are unreadable cross-origin, but the side effects
 * still happen. Only the app's own webview should be calling these routes.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function hostnameOf(host: string): string {
  // "127.0.0.1:41730" → "127.0.0.1", "[::1]:41730" → "[::1]"
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";

  // DNS rebinding: an attacker domain resolving to 127.0.0.1 arrives with its
  // own Host header. Skipped in dev so `next dev` stays reachable over the LAN.
  if (process.env.NODE_ENV === "production" && !LOOPBACK_HOSTS.has(hostnameOf(host))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Browsers send Sec-Fetch-Site on every request; only same-origin calls (or
  // direct navigation, "none") are allowed. "same-site" is rejected too, since
  // other localhost ports count as the same site.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fallback for engines without Fetch Metadata: a present Origin must match.
  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // "null" (sandboxed iframes, file://) or malformed — treat as foreign.
    }
    if (originHost !== host) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
