import { NextRequest, NextResponse } from "next/server";
import { uploadDataUrl, mirrorToStorage } from "@/lib/storage";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";

/**
 * POST { dataUrl: string, folder?: string, mimeType?: string }
 *   → stores a base64 data URL or remote URL on local disk
 *   → records it in uploads
 *   → returns { cdnUrl: string }
 */
export async function POST(req: NextRequest) {
  // text/plain is a CORS "simple" request, so a cross-site page could POST here without a preflight.
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const { dataUrl, folder = "uploads", mimeType } = await req.json() as {
      dataUrl:   string;
      folder?:   string;
      mimeType?: string;
    };

    if (!dataUrl) {
      return NextResponse.json({ error: "dataUrl is required" }, { status: 400 });
    }
    // folder becomes MEDIA_DIR/<folder>: a single plain name, never a path
    if (typeof folder !== "string" || !/^[\w-]+$/.test(folder)) {
      return NextResponse.json({ error: "folder must be a single name like \"uploads\"" }, { status: 400 });
    }

    let cdnUrl: string;
    if (dataUrl.startsWith("data:")) {
      cdnUrl = await uploadDataUrl(dataUrl, folder);
    } else if (dataUrl.startsWith("http")) {
      cdnUrl = await mirrorToStorage(dataUrl, folder);
    } else {
      return NextResponse.json({ error: "dataUrl must be a data: or http: URL" }, { status: 400 });
    }

    guestDb.insertUpload({ user_id: GUEST_USER_ID, r2_url: cdnUrl, mime_type: mimeType ?? null, source: "user_upload" });

    return NextResponse.json({ cdnUrl });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
