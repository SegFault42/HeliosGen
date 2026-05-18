import { NextRequest, NextResponse } from "next/server";
import { uploadBuffer } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { GUEST_MODE, resolveUserId } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    // Raw binary body — client sends the file bytes directly with Content-Type set to
    // the video MIME type. This avoids Next.js multipart/form-data parsing issues.
    const mimeType = req.headers.get("content-type") || "video/mp4";
    if (!mimeType.startsWith("video/")) {
      return NextResponse.json({ error: "Only video files are accepted" }, { status: 400 });
    }

    const MAX_BYTES = 100 * 1024 * 1024; // 100 MB
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 100 MB limit" }, { status: 413 });
    }

    const bytes  = await req.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (buffer.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "File exceeds 100 MB limit" }, { status: 413 });
    }

    const cdnUrl = await uploadBuffer(buffer, mimeType, "references");

    const userId = await resolveUserId(req);
    if (userId) {
      if (GUEST_MODE) {
        guestDb.insertUpload({ user_id: userId, r2_url: cdnUrl, mime_type: mimeType, source: "user_upload" });
      } else {
        supabaseAdmin.from("user_uploads").insert({
          user_id:   userId,
          r2_url:    cdnUrl,
          mime_type: mimeType,
          source:    "user_upload",
        }).then(({ error }) => {
          if (error) console.error("[upload-video] db insert error:", error.message);
        });
      }
    }

    return NextResponse.json({ cdnUrl });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
