/**
 * POST /api/extract-frame
 * Body: { videoUrl: string, timeSeconds?: number, lastFrame?: boolean }
 * Extracts a single JPEG frame from a video using ffmpeg and uploads to R2.
 * Returns: { cdnUrl: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { uploadBuffer } from "@/lib/r2";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let inputPath: string | null  = null;
  let outputPath: string | null = null;

  try {
    const { videoUrl, timeSeconds = 0, lastFrame = false } = await req.json();

    if (!videoUrl) {
      return NextResponse.json({ error: "videoUrl is required" }, { status: 400 });
    }

    const res = await fetch(videoUrl);
    if (!res.ok) {
      return NextResponse.json({ error: `Failed to fetch video: ${res.status}` }, { status: 400 });
    }
    const videoBuffer = Buffer.from(await res.arrayBuffer());

    const tmpDir  = await mkdtemp(join(tmpdir(), "frame-"));
    inputPath  = join(tmpDir, "input.mp4");
    outputPath = join(tmpDir, "frame.jpg");
    await writeFile(inputPath, videoBuffer);

    const ffmpegArgs = lastFrame
      ? ["-sseof", "-0.5", "-i", inputPath, "-frames:v", "1", "-q:v", "2", "-y", outputPath]
      : ["-ss", String(Math.max(0, timeSeconds)), "-i", inputPath, "-frames:v", "1", "-q:v", "2", "-y", outputPath];

    await execFileAsync("ffmpeg", ffmpegArgs);

    const frameBuffer = await readFile(outputPath);
    const cdnUrl = await uploadBuffer(frameBuffer, "image/jpeg", "references");

    return NextResponse.json({ cdnUrl });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract-frame] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    await Promise.all([
      inputPath  ? unlink(inputPath).catch(() => {})  : Promise.resolve(),
      outputPath ? unlink(outputPath).catch(() => {}) : Promise.resolve(),
    ]);
  }
}
