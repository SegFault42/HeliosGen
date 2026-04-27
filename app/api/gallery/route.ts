import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const LIMIT     = 40;
const TABLE_CAP = 1000;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mediaType = searchParams.get("type") === "video" ? "video" : "image";
  const page      = Math.max(0, Number(searchParams.get("page") ?? 0));

  const auth  = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData.user) {
    console.error("[gallery] auth error:", authError?.message);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authData.user.id;

  // ── 1. Generations ────────────────────────────────────────────────────────
  const genUrlCol = mediaType === "video" ? "video_url" : "image_url";

  const { data: gens, error: genError } = await supabaseAdmin
    .from("generations")
    .select("id, generation_type, prompt, model, aspect_ratio, image_url, image_urls, video_url, quality, created_at, reference_image_urls")
    .eq("user_id", userId)
    .eq("generation_type", mediaType)
    .eq("status", "done")
    .not(genUrlCol, "is", null)
    .order("created_at", { ascending: false })
    .limit(TABLE_CAP);

  if (genError) {
    console.error("[gallery] generations query error:", genError.message);
    // Don't bail — still try uploads
  }

  // ── 2. User uploads ───────────────────────────────────────────────────────
  const { data: uploads, error: uploadError } = await supabaseAdmin
    .from("user_uploads")
    .select("id, r2_url, mime_type, created_at")
    .eq("user_id", userId)
    .like("mime_type", `${mediaType}/%`)
    .order("created_at", { ascending: false })
    .limit(TABLE_CAP);

  if (uploadError) {
    console.error("[gallery] user_uploads query error:", uploadError.message);
  }

  console.log(`[gallery] user=${userId} type=${mediaType} gens=${gens?.length ?? 0} uploads=${uploads?.length ?? 0}`);

  // ── 3. Normalise ──────────────────────────────────────────────────────────
  type Item = {
    id: string;
    url: string;
    imageUrls?: string[];
    mediaType: "image" | "video";
    prompt?: string;
    model?: string;
    aspect_ratio?: string;
    quality?: string;
    source: "generation" | "upload";
    created_at: string;
    referenceImageUrls?: string[];
  };

  const genItems: Item[] = (gens ?? []).map((g) => ({
    id:                  g.id,
    url:                 (mediaType === "video" ? g.video_url : g.image_url) as string,
    imageUrls:           (g.image_urls as string[] | null)?.length ? (g.image_urls as string[]) : undefined,
    mediaType:           mediaType as "image" | "video",
    prompt:              g.prompt        ?? undefined,
    model:               g.model         ?? undefined,
    aspect_ratio:        g.aspect_ratio  ?? undefined,
    quality:             g.quality       ?? undefined,
    source:              "generation",
    created_at:          g.created_at,
    referenceImageUrls:  (g.reference_image_urls as string[] | null)?.length
                           ? (g.reference_image_urls as string[])
                           : undefined,
  }));

  const uploadItems: Item[] = (uploads ?? []).map((u) => ({
    id:         u.id,
    url:        u.r2_url,
    mediaType:  (u.mime_type?.startsWith("video/") ? "video" : "image") as "image" | "video",
    source:     "upload",
    created_at: u.created_at,
  }));

  // ── 4. Merge, deduplicate by URL, sort ────────────────────────────────────
  const seen = new Set<string>();
  const merged: Item[] = [];
  for (const item of [...genItems, ...uploadItems]) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    merged.push(item);
  }
  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const offset = page * LIMIT;

  return NextResponse.json({
    items:   merged.slice(offset, offset + LIMIT),
    hasMore: merged.length > offset + LIMIT,
    total:   merged.length,
    debug: {
      generationsFound: gens?.length ?? 0,
      uploadsFound:     uploads?.length ?? 0,
      genError:         genError?.message ?? null,
      uploadError:      uploadError?.message ?? null,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const auth  = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = authData.user.id;

  const { id, source } = await req.json() as { id: string; source: "generation" | "upload" };
  if (!id || !source) return NextResponse.json({ error: "Missing id or source" }, { status: 400 });

  const table = source === "generation" ? "generations" : "user_uploads";
  const { error } = await supabaseAdmin
    .from(table)
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
