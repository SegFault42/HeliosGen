/**
 * GET /generated/<folder>/<file>
 *
 * Serves guest-mode media. In web/dev these files live under `public/generated/`
 * and Next's static handler answers first — this route never runs. In the
 * packaged desktop app the bytes live in a per-user app-data dir (MEDIA_DIR),
 * outside `public/`, so this fallback streams them with the right content type.
 */
import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "fs";
import { join, normalize, extname } from "path";
import { Readable } from "stream";
import { MEDIA_DIR } from "@/lib/guest/paths";
import { parseByteRange } from "@/lib/byteRange";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;

  // Reject traversal — the joined path must stay inside MEDIA_DIR.
  const rel = normalize(segments.join("/"));
  if (rel.startsWith("..") || rel.includes("\0")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const filePath = join(MEDIA_DIR, rel);
  if (!filePath.startsWith(normalize(MEDIA_DIR)) || !existsSync(filePath)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { size } = statSync(filePath);
  const type = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const headers = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  // Byte ranges: a <video> can only seek when the server answers 206. Under
  // `next start` this route also serves every file written after boot (Next
  // lists public/ once at startup), so without ranges a freshly generated
  // video could not be scrubbed until the server restarted.
  const range = parseByteRange(req.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  if (range) {
    const part = Readable.toWeb(createReadStream(filePath, range)) as unknown as ReadableStream;
    return new NextResponse(part, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream;
  return new NextResponse(stream, { headers: { ...headers, "Content-Length": String(size) } });
}
