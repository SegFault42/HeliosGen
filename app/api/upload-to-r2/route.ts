import { NextRequest, NextResponse } from "next/server";
import { uploadDataUrl, mirrorToR2 } from "@/lib/r2";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function getUserId(req: NextRequest): Promise<string | null> {
  const auth  = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const { data } = await supabaseAdmin.auth.getUser(token);
  return data.user?.id ?? null;
}

/**
 * POST { dataUrl: string, folder?: string, mimeType?: string }
 *   → uploads a base64 data URL or remote URL to R2
 *   → records the upload in user_uploads if authenticated
 *   → returns { cdnUrl: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { dataUrl, folder = "uploads", mimeType } = await req.json() as {
      dataUrl:   string;
      folder?:   string;
      mimeType?: string;
    };

    if (!dataUrl) {
      return NextResponse.json({ error: "dataUrl is required" }, { status: 400 });
    }

    let cdnUrl: string;
    if (dataUrl.startsWith("data:")) {
      cdnUrl = await uploadDataUrl(dataUrl, folder);
    } else if (dataUrl.startsWith("http")) {
      cdnUrl = await mirrorToR2(dataUrl, folder);
    } else {
      return NextResponse.json({ error: "dataUrl must be a data: or http: URL" }, { status: 400 });
    }

    // Record in DB (fire-and-forget — don't block the response)
    const userId = await getUserId(req);
    if (userId) {
      supabaseAdmin.from("user_uploads").insert({
        user_id:   userId,
        r2_url:    cdnUrl,
        mime_type: mimeType ?? null,
        source:    "user_upload",
      }).then(({ error }) => {
        if (error) console.error("[upload-to-r2] db insert error:", error.message);
      });
    }

    return NextResponse.json({ cdnUrl });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
