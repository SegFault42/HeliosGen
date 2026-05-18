import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID, createHash } from "crypto";

const DATA_DIR = join(process.cwd(), "data");
const DB_FILE  = join(DATA_DIR, "guest-db.json");

interface Generation {
  id: string;
  user_id: string | null;
  task_id: string;
  generation_type: string;
  status: string;
  prompt?: string;
  model?: string;
  aspect_ratio?: string;
  quality?: string;
  duration?: number;
  kling_mode?: string;
  sound?: boolean;
  reference_image_urls?: string[];
  image_url?: string;
  image_urls?: string[];
  video_url?: string;
  error_msg?: string;
  created_at: string;
  updated_at: string;
}

interface Upload {
  id: string;
  user_id: string;
  r2_url: string;
  mime_type?: string | null;
  source: string;
  created_at: string;
}

interface GuestDb {
  generations: Generation[];
  uploads: Upload[];
  assetCache: Record<string, { cdn_url: string; mime_type: string; byte_size: number }>;
  settings?: { kie_api_token?: string };
}

function now(): string {
  return new Date().toISOString();
}

function read(): GuestDb {
  if (!existsSync(DB_FILE)) return { generations: [], uploads: [], assetCache: {} };
  try { return JSON.parse(readFileSync(DB_FILE, "utf8")); }
  catch { return { generations: [], uploads: [], assetCache: {} }; }
}

function write(data: GuestDb): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ── Generations ────────────────────────────────────────────────────────────

export function insertGeneration(data: Omit<Generation, "id" | "created_at" | "updated_at">): void {
  const db = read();
  if (db.generations.some((g) => g.task_id === data.task_id)) return;
  db.generations.push({ ...data, id: randomUUID(), created_at: now(), updated_at: now() });
  write(db);
}

export function updateGeneration(
  taskId: string,
  updates: Partial<Pick<Generation, "status" | "image_url" | "image_urls" | "video_url" | "error_msg">>,
): void {
  const db = read();
  const gen = db.generations.find((g) => g.task_id === taskId);
  if (!gen) return;
  Object.assign(gen, updates, { updated_at: now() });
  write(db);
}

export function recoverJob(
  taskId: string,
): Pick<Generation, "status" | "video_url" | "image_url" | "image_urls" | "error_msg"> | null {
  return read().generations.find((g) => g.task_id === taskId) ?? null;
}

export function getGenerations(userId: string, type: "image" | "video"): Generation[] {
  const urlKey = type === "video" ? "video_url" : "image_url";
  return read()
    .generations
    .filter((g) => g.user_id === userId && g.generation_type === type && g.status === "done" && g[urlKey])
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 1000);
}

export function deleteGeneration(id: string, userId: string): void {
  const db = read();
  db.generations = db.generations.filter((g) => !(g.id === id && g.user_id === userId));
  write(db);
}

// ── Uploads ────────────────────────────────────────────────────────────────

export function insertUpload(data: Omit<Upload, "id" | "created_at">): void {
  const db = read();
  db.uploads.push({ ...data, id: randomUUID(), created_at: now() });
  write(db);
}

export function getUploads(userId: string, mimeTypePrefix: string): Upload[] {
  return read()
    .uploads
    .filter((u) => u.user_id === userId && (u.mime_type ?? "").startsWith(mimeTypePrefix))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 1000);
}

export function deleteUpload(id: string, userId: string): void {
  const db = read();
  db.uploads = db.uploads.filter((u) => !(u.id === id && u.user_id === userId));
  write(db);
}

// ── Asset Cache ────────────────────────────────────────────────────────────

export function lookupAssetHash(hash: string): string | null {
  const entry = read().assetCache[hash];
  if (entry) console.log("[guest/asset-cache] HIT:", hash.slice(0, 8));
  return entry?.cdn_url ?? null;
}

export function storeAssetHash(hash: string, cdnUrl: string, mimeType: string, byteSize: number): void {
  const db = read();
  db.assetCache[hash] = { cdn_url: cdnUrl, mime_type: mimeType, byte_size: byteSize };
  write(db);
}

// ── Settings ───────────────────────────────────────────────────────────────

export function getKieApiToken(): string | null {
  const dbToken = read().settings?.kie_api_token;
  if (dbToken) return dbToken;
  const envToken = process.env.KIE_API_KEY ?? "";
  // Reject the template placeholder that ships in .env.guest
  if (!envToken || envToken === "your_kie_api_key_here") return null;
  return envToken;
}

export function setKieApiToken(token: string): void {
  const db = read();
  db.settings = { ...db.settings, kie_api_token: token };
  write(db);
}

export function deleteKieApiToken(): void {
  const db = read();
  if (db.settings) delete db.settings.kie_api_token;
  write(db);
}
