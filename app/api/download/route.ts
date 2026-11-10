/**
 * GET /api/download?url=<encoded-url>&filename=<name>
 *
 * Server-side proxy that fetches the asset and returns it with
 * Content-Disposition: attachment so the browser saves it to disk.
 * Only allowed origins are proxied.
 */
import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = [
  "https://cdn.kie.ai",
  "https://api.kie.ai",
  "https://replicate.delivery",
  "https://pbxt.replicate.delivery",
].map((o) => o.replace(/\/$/, ""));

function isAllowed(url: string, origin?: string): boolean {
  if (url.startsWith("/generated/")) return true; // local disk, served same-origin
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false; // userinfo can't hide a foreign host from origin checks below
    // Same-origin /generated/ file, e.g. a caller that already has the full URL of this server.
    if (origin && parsed.origin === origin && parsed.pathname.startsWith("/generated/")) return true;
    // Exact match against an allow-listed CDN origin (https, no path games).
    if (parsed.protocol === "https:" && ALLOWED_ORIGINS.includes(parsed.origin)) return true;
  } catch {
    // not an absolute URL
  }
  return false;
}

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  const filename = req.nextUrl.searchParams.get("filename") ?? "download";

  if (!url) return new NextResponse("Missing url", { status: 400 });
  if (!isAllowed(url, req.nextUrl.origin)) return new NextResponse("Forbidden", { status: 403 });

  let fetchUrl = url;
  if (url.startsWith("/generated/")) {
    const resolved = new URL(url, req.nextUrl.origin);
    // Re-check after normalization: rejects "/generated/../api/..." traversal
    // that would otherwise turn this proxy into same-origin SSRF.
    if (!resolved.pathname.startsWith("/generated/")) return new NextResponse("Forbidden", { status: 403 });
    fetchUrl = resolved.toString();
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith("/generated/")) {
        const resolved = new URL(parsed.pathname, req.nextUrl.origin);
        fetchUrl = resolved.toString();
      }
    } catch {}
  }

  let upstream: Response;
  try {
    upstream = await fetch(fetchUrl);
  } catch {
    return new NextResponse("Fetch failed", { status: 502 });
  }

  if (!upstream.ok) {
    return new NextResponse("Upstream error", { status: upstream.status });
  }

  let contentType = upstream.headers.get("content-type");
  if (!contentType || contentType === "application/octet-stream") {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext === "png") contentType = "image/png";
    else if (ext === "jpg" || ext === "jpeg") contentType = "image/jpeg";
    else if (ext === "webp") contentType = "image/webp";
    else if (ext === "gif") contentType = "image/gif";
    else if (ext === "mp4") contentType = "video/mp4";
    else contentType = "application/octet-stream";
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
