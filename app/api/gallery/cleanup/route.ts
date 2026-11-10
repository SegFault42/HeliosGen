/**
 * POST /api/gallery/cleanup → { files, bytes }
 * Deletes media files under MEDIA_DIR that no generation, upload, asset-cache
 * row or saved workflow references any more (files younger than 1 h are kept).
 */
import { NextResponse } from "next/server";
import { sweepOrphans } from "@/lib/guest/media";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(sweepOrphans());
}
