/**
 * Server-side helpers for the `asset_cache` table.
 *
 * Schema (run once in Supabase SQL editor):
 *
 *   CREATE TABLE IF NOT EXISTS public.asset_cache (
 *     hash       TEXT PRIMARY KEY,
 *     cdn_url    TEXT NOT NULL,
 *     mime_type  TEXT,
 *     byte_size  BIGINT,
 *     created_at TIMESTAMPTZ DEFAULT now()
 *   );
 */
import { createHash } from "crypto";
import { supabaseAdmin } from "./supabase/admin";
import { GUEST_MODE } from "./guestMode";
import * as guestDb from "./guest/db";

/** Compute SHA-256 hex from a Node.js Buffer (server-side). */
export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Look up a previously-uploaded asset by its SHA-256 hash.
 * Returns the CDN URL if found, null otherwise.
 */
export async function lookupAssetHash(hash: string): Promise<string | null> {
  if (GUEST_MODE) return guestDb.lookupAssetHash(hash);
  try {
    const { data, error } = await supabaseAdmin
      .from("asset_cache")
      .select("cdn_url")
      .eq("hash", hash)
      .maybeSingle();
    if (error) {
      console.error("[asset-cache] lookup error:", error.message);
      return null;
    }
    if (data) console.log("[asset-cache] HIT for hash:", hash.slice(0, 8), "->", data.cdn_url);
    else console.log("[asset-cache] MISS for hash:", hash.slice(0, 8));
    return data?.cdn_url ?? null;
  } catch (err) {
    console.error("[asset-cache] unexpected lookup error:", err);
    return null;
  }
}

/**
 * Store a hash → CDN URL mapping.
 * Uses upsert so re-uploading the same file is idempotent.
 */
export async function storeAssetHash(
  hash: string,
  cdnUrl: string,
  mimeType: string,
  byteSize: number,
): Promise<void> {
  if (GUEST_MODE) { guestDb.storeAssetHash(hash, cdnUrl, mimeType, byteSize); return; }
  console.log("[asset-cache] storing hash:", hash.slice(0, 8), "->", cdnUrl);
  const { error } = await supabaseAdmin
    .from("asset_cache")
    .upsert(
      { hash, cdn_url: cdnUrl, mime_type: mimeType, byte_size: byteSize },
      { onConflict: "hash" },
    );
  if (error) console.error("[asset-cache] store error:", error.message);
}
