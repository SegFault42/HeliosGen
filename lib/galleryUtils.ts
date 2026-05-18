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
  source: "generation" | "upload";
  created_at: string;
  referenceImageUrls?: string[];
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
