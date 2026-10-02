/**
 * Split Reaction + Demo compositor.
 *
 * Hard-cut concat: N seconds of an AI avatar reaction clip, then the full
 * real-product demo clip, both normalized to 1080x1920@30fps, with a bold
 * typography overlay burned in over the upper third for the whole video.
 *
 * Design choices:
 * - scale+CROP to fill (not pad+letterbox): social vertical formats read as
 *   broken with black bars; cropping the sides/top loses less than a letterbox.
 * - audio: each segment keeps its own track; a segment with no audio stream
 *   gets a synthesized silent track (anullsrc) sized to its own duration, so
 *   concat's `a=1` never fails on a mismatched stream count.
 * - overlay text has no real text-measurement — wrapping is a character-count
 *   heuristic tuned for the fixed font size below.
 *   ponytail: naive char-count wrap, upgrade to real text-metrics if copy
 *   ever needs precise line breaks.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, unlink } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import sharp from "sharp";
import { mediaPathFor, toMediaUrl } from "./guest/media";

const execFileAsync = promisify(execFile);

const MIN_REACTION_SECONDS = 3;
const MAX_REACTION_SECONDS = 5;
const DEFAULT_REACTION_SECONDS = 4;
const FFMPEG_TIMEOUT_MS = 5 * 60_000;
const FFMPEG_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Resolve a `/generated/...` URL to an existing local file, or null.
 * Rejects absolute filesystem paths, traversal attempts, directories and
 * missing files — the only trusted input shape is our own media URL scheme.
 */
export function resolveComposeInput(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  const media = toMediaUrl(url);
  const abs = media && mediaPathFor(media);
  if (!abs || !existsSync(abs)) return null;
  try {
    if (!statSync(abs).isFile()) return null;
  } catch {
    return null;
  }
  return abs;
}

export interface ComposeSplitOptions {
  reactionPath: string;
  demoPath: string;
  outPath: string;
  reactionSeconds?: number;
  overlayText?: string;
  width?: number;
  height?: number;
  fps?: number;
}

export interface ComposeSplitResult {
  outPath: string;
  durationSec: number;
  cutAtSec: number;
}

async function ffprobeDuration(path: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    path,
  ]);
  const dur = parseFloat(stdout.trim());
  if (!Number.isFinite(dur)) throw new Error(`ffprobe could not read duration for ${path}`);
  return dur;
}

async function hasAudioStream(path: string): Promise<boolean> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-select_streams", "a",
    "-show_entries", "stream=index",
    "-of", "csv=p=0",
    path,
  ]);
  return stdout.trim().length > 0;
}

/** Escape text for safe inclusion inside an SVG <text> node. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Naive char-count word wrap — no text-metrics available at this layer. */
function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Render bold white text with a thick black outline onto a transparent PNG. */
async function renderOverlayPng(text: string, width: number, height: number): Promise<Buffer> {
  const fontSize = Math.round(width * 0.075); // ~81px @1080 width
  const lineHeight = fontSize * 1.2;
  const maxCharsPerLine = Math.max(8, Math.round(width / (fontSize * 0.55)));
  const lines = wrapText(text, maxCharsPerLine);

  const topY = Math.round(height / 3 / 2); // vertically centered within the upper third
  const startY = Math.round(topY - ((lines.length - 1) * lineHeight) / 2);

  const textEls = lines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      return `<text x="${width / 2}" y="${y}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="${fontSize}" fill="white" stroke="black" stroke-width="${Math.round(fontSize * 0.12)}" paint-order="stroke" stroke-linejoin="round">${escapeXml(line)}</text>`;
    })
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${textEls}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function clampReactionSeconds(seconds: number | undefined): number {
  const v = seconds ?? DEFAULT_REACTION_SECONDS;
  return Math.min(MAX_REACTION_SECONDS, Math.max(MIN_REACTION_SECONDS, v));
}

export async function composeSplitReaction(opts: ComposeSplitOptions): Promise<ComposeSplitResult> {
  const width = opts.width ?? 1080;
  const height = opts.height ?? 1920;
  const fps = opts.fps ?? 30;
  const requestedReactionSeconds = clampReactionSeconds(opts.reactionSeconds);

  const [demoDuration, reactionDuration, reactionHasAudio, demoHasAudio] = await Promise.all([
    ffprobeDuration(opts.demoPath),
    ffprobeDuration(opts.reactionPath),
    hasAudioStream(opts.reactionPath),
    hasAudioStream(opts.demoPath),
  ]);
  // never cut past the actual reaction footage — Flow clips can land shorter
  // than the requested window.
  const reactionSeconds = Math.min(requestedReactionSeconds, reactionDuration);

  const tmpDir = await mkdtemp(join(tmpdir(), "compose-split-"));
  try {
    const inputs: string[] = ["-i", opts.reactionPath, "-i", opts.demoPath];
    let nextInputIndex = 2;
    let reactionAudioInputIndex: number | null = null;
    let demoAudioInputIndex: number | null = null;

    if (!reactionHasAudio) {
      inputs.push("-f", "lavfi", "-t", String(reactionSeconds), "-i", "anullsrc=r=44100:cl=stereo");
      reactionAudioInputIndex = nextInputIndex++;
    }
    if (!demoHasAudio) {
      inputs.push("-f", "lavfi", "-t", String(demoDuration), "-i", "anullsrc=r=44100:cl=stereo");
      demoAudioInputIndex = nextInputIndex++;
    }

    const overlayPngPath = join(tmpDir, "overlay.png");
    if (opts.overlayText) {
      const png = await renderOverlayPng(opts.overlayText, width, height);
      await sharp(png).toFile(overlayPngPath);
    }
    const hasOverlay = !!opts.overlayText;
    let overlayInputIndex: number | null = null;
    if (hasOverlay) {
      inputs.push("-i", overlayPngPath);
      overlayInputIndex = nextInputIndex++;
    }

    const scaleCrop = (label: string) =>
      `[${label}]trim=start=0${label === "0:v" ? `:duration=${reactionSeconds}` : ""},setpts=PTS-STARTPTS,` +
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps}[${label === "0:v" ? "v0" : "v1"}]`;

    const filters: string[] = [];
    filters.push(scaleCrop("0:v"));
    filters.push(scaleCrop("1:v"));

    const audioFormat = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo";
    if (reactionAudioInputIndex !== null) {
      filters.push(`[${reactionAudioInputIndex}:a]${audioFormat}[a0]`);
    } else {
      filters.push(`[0:a]atrim=start=0:duration=${reactionSeconds},asetpts=PTS-STARTPTS,${audioFormat}[a0]`);
    }
    if (demoAudioInputIndex !== null) {
      filters.push(`[${demoAudioInputIndex}:a]${audioFormat}[a1]`);
    } else {
      filters.push(`[1:a]asetpts=PTS-STARTPTS,${audioFormat}[a1]`);
    }

    filters.push(`[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]`);

    let finalVideoLabel = "outv";
    if (hasOverlay && overlayInputIndex !== null) {
      filters.push(`[outv][${overlayInputIndex}:v]overlay=0:0:format=auto[final]`);
      finalVideoLabel = "final";
    }

    await mkdir(dirname(opts.outPath), { recursive: true });

    const args = [
      "-y",
      "-nostats", "-loglevel", "error",
      ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", `[${finalVideoLabel}]`,
      "-map", "[outa]",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      opts.outPath,
    ];

    try {
      await execFileAsync("ffmpeg", args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_BUFFER });
    } catch (e) {
      if (existsSync(opts.outPath)) await unlink(opts.outPath).catch(() => {});
      throw e;
    }

    const durationSec = reactionSeconds + demoDuration;
    return { outPath: opts.outPath, durationSec, cutAtSec: reactionSeconds };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
