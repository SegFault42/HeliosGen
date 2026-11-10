import { NextRequest, NextResponse } from "next/server";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as guestDb from "@/lib/guest/db";
import { removeMediaIfOrphan } from "@/lib/guest/media";

const LIMIT = 20;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mediaType = searchParams.get("type") === "video" ? "video" : "image";
  const page      = Math.max(0, Number(searchParams.get("page") ?? 0));
  const source    = searchParams.get("source") as "generation" | "upload" | null;

  type Item = {
    id: string;
    url: string;
    imageUrls?: string[];
    mediaType: "image" | "video";
    prompt?: string;
    model?: string;
    aspect_ratio?: string;
    quality?: string;
    azure_resolution?: string;
    source: "generation" | "upload";
    created_at: string;
    referenceImageUrls?: string[];
  };

  const genItems: Item[] = (!source || source === "generation")
    ? guestDb.getGenerations(GUEST_USER_ID, mediaType).map((g) => ({
        id:                 g.id,
        url:                (mediaType === "video" ? g.video_url : g.image_url) as string,
        imageUrls:          g.image_urls?.length ? g.image_urls : undefined,
        mediaType:          mediaType as "image" | "video",
        prompt:             g.prompt       ?? undefined,
        model:              g.model            ?? undefined,
        aspect_ratio:       g.aspect_ratio     ?? undefined,
        quality:            g.quality          ?? undefined,
        azure_resolution:   g.azure_resolution ?? undefined,
        source:             "generation" as const,
        created_at:         g.created_at,
        referenceImageUrls: g.reference_image_urls?.length ? g.reference_image_urls : undefined,
      }))
    : [];

  const uploadItems: Item[] = (!source || source === "upload")
    ? guestDb.getUploads(GUEST_USER_ID, mediaType).map((u) => ({
        id:        u.id,
        url:       u.r2_url,
        mediaType: (u.mime_type?.startsWith("video/") ? "video" : "image") as "image" | "video",
        source:    "upload" as const,
        created_at: u.created_at,
      }))
    : [];

  const allItems: Item[] = source
    ? [...genItems, ...uploadItems]
    : (() => {
        const seen = new Set<string>();
        const merged: Item[] = [];
        for (const item of [...genItems, ...uploadItems]) {
          if (!item.url || seen.has(item.url)) continue;
          seen.add(item.url);
          merged.push(item);
        }
        return merged;
      })();

  allItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const offset = page * LIMIT;
  return NextResponse.json({
    items:   allItems.slice(offset, offset + LIMIT),
    hasMore: allItems.length > offset + LIMIT,
    total:   allItems.length,
  });
}

export async function DELETE(req: NextRequest) {
  const { id, source } = await req.json() as { id: string; source: "generation" | "upload" };
  if (!id || !source) return NextResponse.json({ error: "Missing id or source" }, { status: 400 });

  // Collect the file URLs first, drop the row, then unlink whatever nothing
  // else references. Before this the row went away and the file stayed forever.
  const urls = source === "generation"
    ? guestDb.getGenerationUrls(id, GUEST_USER_ID)
    : guestDb.getUploadUrls(id, GUEST_USER_ID);
  if (source === "generation") guestDb.deleteGeneration(id, GUEST_USER_ID);
  else guestDb.deleteUpload(id, GUEST_USER_ID);
  let freed = 0;
  for (const u of urls) freed += removeMediaIfOrphan(u);
  return NextResponse.json({ ok: true, freedBytes: freed });
}
