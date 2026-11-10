/**
 * HeliosGen has no auth: it trusts whoever can reach it. Two browser-borne
 * attacks reach it anyway, so every request goes through this guard
 * (wired in proxy.ts):
 *  - CSRF: any web page can POST text/plain, form or multipart bodies here
 *    without a CORS preflight. Browsers label those (Sec-Fetch-Site, Origin).
 *  - DNS rebinding: a page on attacker.com re-resolves its own name to
 *    127.0.0.1 and then talks to us "same-origin", but its Host header still
 *    says attacker.com.
 * Non-browser clients (anvil, curl, the workflow runner) send no Origin and a
 * loopback Host, so they pass. Reaching the app by a hostname other than
 * localhost or an IP needs HELIOS_ALLOWED_HOSTS=name1,name2.
 */
import { isIP } from "node:net";
import { NextResponse, type NextRequest } from "next/server";

const EXTRA_HOSTS = new Set(
  (process.env.HELIOS_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function allowedHost(host: string | null): boolean {
  if (!host) return true; // HTTP/1.0 clients; browsers always send Host
  let name: string;
  try { name = new URL(`http://${host}`).hostname; } catch { return false; }
  return name === "localhost" || name.endsWith(".localhost")
    || isIP(name.replace(/^\[|\]$/g, "")) !== 0 || EXTRA_HOSTS.has(name);
}

function crossSite(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "cross-site";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host !== req.headers.get("host"); } catch { return true; }
}

/** A 403 response when the request must be refused, else null. */
export function guardRequest(req: NextRequest): NextResponse | null {
  if (!allowedHost(req.headers.get("host"))) {
    return NextResponse.json({ error: "Host not allowed; add it to HELIOS_ALLOWED_HOSTS" }, { status: 403 });
  }
  if (!SAFE_METHODS.has(req.method) && crossSite(req)) {
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  }
  return null;
}
