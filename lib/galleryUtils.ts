import { createClient } from "@/lib/supabase/client";

export interface GalleryItem {
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
}

// Matches Next.js's default image `deviceSizes`/`imageSizes` buckets, so the
// generated /_next/image URL always lands on a size Next has already cached.
const NEXT_IMG_WIDTHS = [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1920, 3840];

/** Downsized CDN thumbnail URL for displaying `url` at roughly `w` px (2x for retina). */
export function thumbSrc(url: string, w = 96): string {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return url;
  const target = w * 2;
  const snapped = NEXT_IMG_WIDTHS.find(s => s >= target) ?? NEXT_IMG_WIDTHS[NEXT_IMG_WIDTHS.length - 1];
  return `/_next/image?url=${encodeURIComponent(url)}&w=${snapped}&q=75`;
}

export async function getToken(): Promise<string | undefined> {
  if (process.env.NEXT_PUBLIC_GUEST_MODE === "true") return "guest";
  const { data } = await createClient().auth.getSession();
  return data.session?.access_token;
}

const _galleryCacheMem = new Map<string, { items: GalleryItem[]; hasMore: boolean }>();

export const galleryCache = {
  get(tab: string): { items: GalleryItem[]; hasMore: boolean } | undefined {
    const mem = _galleryCacheMem.get(tab);
    if (mem) return mem;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(`nf-gallery-cache-${tab}`) : null;
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as { items: GalleryItem[]; hasMore: boolean };
      _galleryCacheMem.set(tab, parsed);
      return parsed;
    } catch { return undefined; }
  },
  set(tab: string, data: { items: GalleryItem[]; hasMore: boolean }) {
    _galleryCacheMem.set(tab, data);
    try {
      if (typeof window !== "undefined") localStorage.setItem(`nf-gallery-cache-${tab}`, JSON.stringify(data));
    } catch { }
  },
};
