/**
 * POST /api/compose-split
 * Body: { reactionUrl: string, demoUrl: string, overlayText?: string, reactionSeconds?: number }
 *
 * Local-only ffmpeg compositor: hard-cuts a trimmed AI-avatar reaction clip
 * into a real product demo clip with a burned-in typography overlay.
 * `reactionUrl` / `demoUrl` must be a `/generated/...` URL (resolved under
 * MEDIA_DIR) or an absolute local filesystem path that exists on disk.
 * Never fetches a remote URL.
 *
 * Returns: { url: "/generated/compose/<id>.mp4", durationSec, cutAtSec }
 */
import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { composeSplitReaction } from "@/lib/composeSplit";
import { mediaPathFor } from "@/lib/guest/media";
import { MEDIA_DIR } from "@/lib/guest/paths";

export const maxDuration = 120;

/** Resolve `/generated/...` or an existing absolute local path to a real file. */
function resolveLocalPath(input: unknown): string | null {
  if (typeof input !== "string" || !input) return null;
  if (input.startsWith("/generated/")) {
    const abs = mediaPathFor(input);
    return abs && existsSync(abs) ? abs : null;
  }
  if (isAbsolute(input) && existsSync(input)) return input;
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { reactionUrl, demoUrl, overlayText, reactionSeconds } = body as Record<string, unknown>;

  const reactionPath = resolveLocalPath(reactionUrl);
  if (!reactionPath) {
    return NextResponse.json({ error: "reactionUrl must be a /generated/... URL or an existing absolute local path" }, { status: 400 });
  }
  const demoPath = resolveLocalPath(demoUrl);
  if (!demoPath) {
    return NextResponse.json({ error: "demoUrl must be a /generated/... URL or an existing absolute local path" }, { status: 400 });
  }

  if (overlayText !== undefined && typeof overlayText !== "string") {
    return NextResponse.json({ error: "overlayText must be a string" }, { status: 400 });
  }

  let reactionSecondsNum: number | undefined;
  if (reactionSeconds !== undefined) {
    if (typeof reactionSeconds !== "number" || !Number.isFinite(reactionSeconds)) {
      return NextResponse.json({ error: "reactionSeconds must be a number" }, { status: 400 });
    }
    if (reactionSeconds < 3 || reactionSeconds > 5) {
      return NextResponse.json({ error: "reactionSeconds must be between 3 and 5" }, { status: 400 });
    }
    reactionSecondsNum = reactionSeconds;
  }

  const id = randomUUID();
  const outPath = join(MEDIA_DIR, "compose", `${id}.mp4`);

  try {
    const result = await composeSplitReaction({
      reactionPath,
      demoPath,
      outPath,
      reactionSeconds: reactionSecondsNum,
      overlayText: overlayText as string | undefined,
    });

    return NextResponse.json({
      url: `/generated/compose/${id}.mp4`,
      durationSec: result.durationSec,
      cutAtSec: result.cutAtSec,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[compose-split] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
