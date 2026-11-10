/**
 * POST /api/compose-split
 * Body: { reactionUrl: string, demoUrl: string, overlayText?: string, reactionSeconds?: number }
 *
 * Local-only ffmpeg compositor: hard-cuts a trimmed AI-avatar reaction clip
 * into a real product demo clip with a burned-in typography overlay.
 * `reactionUrl` / `demoUrl` must be a `/generated/...` URL (resolved under
 * MEDIA_DIR, upload local files via /api/upload-video first). Never accepts
 * an arbitrary filesystem path and never fetches a remote URL.
 *
 * Returns: { url: "/generated/compose/<id>.mp4", durationSec, cutAtSec }
 */
import { NextRequest, NextResponse } from "next/server";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { composeSplitReaction, resolveComposeInput } from "@/lib/composeSplit";
import { MEDIA_DIR } from "@/lib/guest/paths";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { reactionUrl, demoUrl, overlayText, reactionSeconds } = body as Record<string, unknown>;

  const reactionPath = resolveComposeInput(reactionUrl);
  if (!reactionPath) {
    return NextResponse.json({ error: "reactionUrl must be an existing /generated/... URL" }, { status: 400 });
  }
  const demoPath = resolveComposeInput(demoUrl);
  if (!demoPath) {
    return NextResponse.json({ error: "demoUrl must be an existing /generated/... URL" }, { status: 400 });
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
