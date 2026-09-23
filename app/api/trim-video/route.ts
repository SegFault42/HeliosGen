/**
 * POST /api/trim-video
 * Body: { videoUrl: string, startTime: number, endTime: number }
 * Downloads the video, trims it with ffmpeg, uploads result to R2.
 * Returns: { cdnUrl: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { uploadBuffer, ensureStorage } from "@/lib/storage";
import { mediaPathFor } from "@/lib/guest/media";
import { readFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let outputPath: string | null = null;

  try {
    const { videoUrl, startTime, endTime } = await req.json();

    if (!videoUrl || startTime === undefined || endTime === undefined) {
      return NextResponse.json({ error: "videoUrl, startTime and endTime are required" }, { status: 400 });
    }
    if (endTime <= startTime) {
      return NextResponse.json({ error: "endTime must be greater than startTime" }, { status: 400 });
    }

    // Resolve to a local file: mirrors remote URLs through the SSRF-guarded
    // fetch, decodes data: URLs, and passes already-local /generated/ paths through.
    let inputPath: string | null;
    try {
      const local = await ensureStorage(videoUrl, "references");
      inputPath = mediaPathFor(local);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `Failed to fetch video: ${msg}` }, { status: 400 });
    }
    if (!inputPath) {
      return NextResponse.json({ error: "Could not resolve video" }, { status: 400 });
    }

    const tmpDir  = await mkdtemp(join(tmpdir(), "trim-"));
    outputPath = join(tmpDir, "output.mp4");

    // Trim with ffmpeg: -ss before -i = fast seek; -t = duration; -c copy = no re-encode
    await execFileAsync("ffmpeg", [
      "-ss", String(startTime),
      "-i",  inputPath,
      "-t",  String(endTime - startTime),
      "-c",  "copy",
      "-avoid_negative_ts", "1",
      "-y",
      outputPath,
    ]);

    const outputBuffer = await readFile(outputPath);
    const cdnUrl = await uploadBuffer(outputBuffer, "video/mp4", "references");

    return NextResponse.json({ cdnUrl });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[trim-video] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    // Cleanup temp output file (the resolved input lives under MEDIA_DIR, not ours to delete)
    if (outputPath) await unlink(outputPath).catch(() => {});
  }
}
