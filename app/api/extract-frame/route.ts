/**
 * POST /api/extract-frame
 * Body: { videoUrl: string, timeSeconds?: number, lastFrame?: boolean }
 * Extracts a single JPEG frame from a video using ffmpeg and uploads to R2.
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

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let outputPath: string | null = null;

  try {
    const { videoUrl, timeSeconds = 0, lastFrame = false } = await req.json();

    if (!videoUrl) {
      return NextResponse.json({ error: "videoUrl is required" }, { status: 400 });
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

    const tmpDir  = await mkdtemp(join(tmpdir(), "frame-"));
    outputPath = join(tmpDir, "frame.jpg");

    const { stdout: probeOut } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inputPath,
    ]);
    const dur = parseFloat(probeOut.trim());
    const safeDur = isNaN(dur) ? undefined : dur;

    let ffmpegArgs: string[];
    if (lastFrame) {
      const seekTime = safeDur !== undefined ? Math.max(0, safeDur - 0.1) : 0;
      ffmpegArgs = ["-ss", String(seekTime), "-i", inputPath, "-frames:v", "1", "-q:v", "2", "-y", outputPath];
    } else {
      // Clamp to 0.1s before the video end so ffmpeg always finds a frame to encode.
      const clampedTime = safeDur !== undefined
        ? Math.min(Math.max(0, timeSeconds), Math.max(0, safeDur - 0.1))
        : Math.max(0, timeSeconds);
      ffmpegArgs = ["-ss", String(clampedTime), "-i", inputPath, "-frames:v", "1", "-q:v", "2", "-y", outputPath];
    }

    await execFileAsync("ffmpeg", ffmpegArgs);

    const frameBuffer = await readFile(outputPath);
    const cdnUrl = await uploadBuffer(frameBuffer, "image/jpeg", "references");

    return NextResponse.json({ cdnUrl });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-frame] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    // Cleanup temp output file (the resolved input lives under MEDIA_DIR, not ours to delete)
    if (outputPath) await unlink(outputPath).catch(() => {});
  }
}
