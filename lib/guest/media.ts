/**
 * Physical media files under MEDIA_DIR (`/generated/<folder>/<file>` URLs).
 *
 * The DB rows (generations, uploads, asset_cache) and the workflow spaces all
 * point at these files by URL. Deleting a row used to leave the file behind
 * forever; `removeMediaIfOrphan` unlinks a file once nothing references it,
 * and `sweepOrphans` catches whatever slipped through.
 */
import { existsSync, readdirSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { MEDIA_DIR } from "./paths";
import { db } from "./sqlite";

const URL_PREFIX = "/generated/";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `/generated/...` for one of our media URLs, including the absolute
 *  `http://localhost:<port>/generated/...` form CLI callers (anvil) send; else null. */
export function toMediaUrl(url: string): string | null {
  if (url.startsWith(URL_PREFIX)) return url;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !LOOPBACK_HOSTS.has(u.hostname)) return null;
  return u.pathname.startsWith(URL_PREFIX) ? u.pathname : null;
}

/** Absolute path for a `/generated/...` URL, or null if it is not one of ours. */
export function mediaPathFor(url: string): string | null {
  if (!url.startsWith(URL_PREFIX)) return null;
  let rel: string;
  try { rel = decodeURIComponent(url.slice(URL_PREFIX.length).replace(/[?#].*$/, "")); } catch { return null; }
  const root = resolve(MEDIA_DIR);
  const abs = join(root, rel);
  // path traversal guard: must stay inside MEDIA_DIR
  if (!abs.startsWith(root + sep)) return null;
  // symlink/junction guard: a file on disk must really live inside MEDIA_DIR too
  try {
    if (!realpathSync(abs).startsWith(realpathSync(root) + sep)) return null;
  } catch { /* not on disk (yet): the lexical check above is all there is */ }
  return abs;
}

/** True when any DB row (or any saved workflow) still mentions this URL. */
export function isMediaReferenced(url: string): boolean {
  const d = db();
  const like = `%${url}%`;
  const gen = d.prepare(
    `SELECT 1 FROM generations WHERE image_url = ? OR video_url = ?
       OR image_urls LIKE ? OR reference_image_urls LIKE ? LIMIT 1`,
  ).get(url, url, like, like);
  if (gen) return true;
  if (d.prepare("SELECT 1 FROM uploads WHERE r2_url = ? LIMIT 1").get(url)) return true;
  if (d.prepare("SELECT 1 FROM spaces WHERE data LIKE ? LIMIT 1").get(like)) return true;
  return false;
}

/** Unlink the file behind `url` if no row references it any more. Returns bytes freed. */
export function removeMediaIfOrphan(url: string): number {
  const abs = mediaPathFor(url);
  if (!abs || !existsSync(abs)) return 0;
  if (isMediaReferenced(url)) return 0;
  const size = statSync(abs).size;
  try { unlinkSync(abs); } catch { return 0; }
  db().prepare("DELETE FROM asset_cache WHERE cdn_url = ?").run(url);
  return size;
}

const SWEEP_FOLDERS = ["generated", "uploads", "images", "references"];
const MIN_AGE_MS = 60 * 60 * 1000; // never touch a file younger than 1 h (a job may still be writing its row)

/** Delete every media file no row references. Returns what was removed. */
export function sweepOrphans(): { files: number; bytes: number } {
  let files = 0, bytes = 0;
  const cutoff = Date.now() - MIN_AGE_MS;
  for (const folder of SWEEP_FOLDERS) {
    const dir = join(MEDIA_DIR, folder);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const abs = join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (!st.isFile() || st.mtimeMs > cutoff) continue;
      const url = `${URL_PREFIX}${folder}/${name}`;
      if (isMediaReferenced(url)) continue;
      try { unlinkSync(abs); } catch { continue; }
      db().prepare("DELETE FROM asset_cache WHERE cdn_url = ?").run(url);
      files++; bytes += st.size;
    }
  }
  return { files, bytes };
}
