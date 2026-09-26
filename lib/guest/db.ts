import { randomUUID, createHash } from "crypto";
import { db } from "./sqlite";

/**
 * Guest-mode data access. SQLite-backed (see ./sqlite), but the exported API is
 * unchanged from the old JSON implementation so every caller stays the same.
 */

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
  azure_resolution?: string;
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

interface FolderRecord {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
  color?: string | null;
}

interface FolderItemRecord {
  folder_id: string;
  item_id: string;
  user_id: string;
  created_at: string;
}

const now = (): string => new Date().toISOString();
const parseArr = (v: unknown): string[] | undefined =>
  typeof v === "string" && v ? (JSON.parse(v) as string[]) : undefined;

type GenRow = Record<string, unknown>;
function rowToGeneration(r: GenRow): Generation {
  return {
    id: r.id as string,
    user_id: (r.user_id as string) ?? null,
    task_id: r.task_id as string,
    generation_type: r.generation_type as string,
    status: r.status as string,
    prompt: (r.prompt as string) ?? undefined,
    model: (r.model as string) ?? undefined,
    aspect_ratio: (r.aspect_ratio as string) ?? undefined,
    quality: (r.quality as string) ?? undefined,
    azure_resolution: (r.azure_resolution as string) ?? undefined,
    duration: (r.duration as number) ?? undefined,
    kling_mode: (r.kling_mode as string) ?? undefined,
    sound: r.sound == null ? undefined : Boolean(r.sound),
    reference_image_urls: parseArr(r.reference_image_urls),
    image_url: (r.image_url as string) ?? undefined,
    image_urls: parseArr(r.image_urls),
    video_url: (r.video_url as string) ?? undefined,
    error_msg: (r.error_msg as string) ?? undefined,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
  };
}

export function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ── Generations ────────────────────────────────────────────────────────────

export function insertGeneration(data: Omit<Generation, "id" | "created_at" | "updated_at">): void {
  const ts = now();
  db()
    .prepare(`
      INSERT INTO generations
        (id, user_id, task_id, generation_type, status, prompt, model, aspect_ratio,
         quality, azure_resolution, duration, kling_mode, sound, reference_image_urls,
         image_url, image_urls, video_url, error_msg, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO NOTHING
    `)
    .run(
      randomUUID(), data.user_id ?? null, data.task_id, data.generation_type, data.status,
      data.prompt ?? null, data.model ?? null, data.aspect_ratio ?? null, data.quality ?? null,
      data.azure_resolution ?? null, data.duration ?? null, data.kling_mode ?? null,
      data.sound ? 1 : 0,
      data.reference_image_urls ? JSON.stringify(data.reference_image_urls) : null,
      data.image_url ?? null, data.image_urls ? JSON.stringify(data.image_urls) : null,
      data.video_url ?? null, data.error_msg ?? null, ts, ts,
    );
}

export function updateGeneration(
  taskId: string,
  updates: Partial<Pick<Generation, "status" | "image_url" | "image_urls" | "video_url" | "error_msg">>,
): void {
  const sets: string[] = ["updated_at = ?"];
  const vals: unknown[] = [now()];
  if ("status" in updates) { sets.push("status = ?"); vals.push(updates.status ?? null); }
  if ("image_url" in updates) { sets.push("image_url = ?"); vals.push(updates.image_url ?? null); }
  if ("image_urls" in updates) { sets.push("image_urls = ?"); vals.push(updates.image_urls ? JSON.stringify(updates.image_urls) : null); }
  if ("video_url" in updates) { sets.push("video_url = ?"); vals.push(updates.video_url ?? null); }
  if ("error_msg" in updates) { sets.push("error_msg = ?"); vals.push(updates.error_msg ?? null); }
  vals.push(taskId);
  db().prepare(`UPDATE generations SET ${sets.join(", ")} WHERE task_id = ?`).run(...(vals as never[]));
}

export function recoverJob(
  taskId: string,
): Pick<Generation, "status" | "video_url" | "image_url" | "image_urls" | "error_msg"> | null {
  const r = db().prepare("SELECT * FROM generations WHERE task_id = ?").get(taskId) as GenRow | undefined;
  return r ? rowToGeneration(r) : null;
}

export function getGenerations(userId: string, type: "image" | "video"): Generation[] {
  const urlCol = type === "video" ? "video_url" : "image_url";
  const rows = db()
    .prepare(`
      SELECT * FROM generations
      WHERE user_id = ? AND generation_type = ? AND status = 'done'
        AND ${urlCol} IS NOT NULL AND ${urlCol} != ''
      ORDER BY created_at DESC
      LIMIT 5000
    `)
    .all(userId, type) as GenRow[];
  return rows.map(rowToGeneration);
}

export function deleteGeneration(id: string, userId: string): void {
  db().prepare("DELETE FROM generations WHERE id = ? AND user_id = ?").run(id, userId);
}

// ── Uploads ────────────────────────────────────────────────────────────────

export function insertUpload(data: Omit<Upload, "id" | "created_at">): void {
  db()
    .prepare("INSERT INTO uploads (id, user_id, r2_url, mime_type, source, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), data.user_id, data.r2_url, data.mime_type ?? null, data.source, now());
}

export function getUploads(userId: string, mimeTypePrefix: string): Upload[] {
  const rows = db()
    .prepare(`
      SELECT * FROM uploads
      WHERE user_id = ? AND COALESCE(mime_type, '') LIKE ? || '%'
      ORDER BY created_at DESC LIMIT 5000
    `)
    .all(userId, mimeTypePrefix) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    user_id: r.user_id as string,
    r2_url: r.r2_url as string,
    mime_type: (r.mime_type as string) ?? null,
    source: r.source as string,
    created_at: r.created_at as string,
  }));
}

export function deleteUpload(id: string, userId: string): void {
  db().prepare("DELETE FROM uploads WHERE id = ? AND user_id = ?").run(id, userId);
}

// ── Asset Cache ────────────────────────────────────────────────────────────

export function lookupAssetHash(hash: string): string | null {
  const r = db().prepare("SELECT cdn_url FROM asset_cache WHERE hash = ?").get(hash) as
    | { cdn_url: string }
    | undefined;
  if (r) console.log("[guest/asset-cache] HIT:", hash.slice(0, 8));
  return r?.cdn_url ?? null;
}

export function storeAssetHash(hash: string, cdnUrl: string, mimeType: string, byteSize: number): void {
  db()
    .prepare(`
      INSERT INTO asset_cache (hash, cdn_url, mime_type, byte_size) VALUES (?, ?, ?, ?)
      ON CONFLICT(hash) DO UPDATE SET cdn_url = excluded.cdn_url,
        mime_type = excluded.mime_type, byte_size = excluded.byte_size
    `)
    .run(hash, cdnUrl, mimeType, byteSize);
}

// ── Settings ───────────────────────────────────────────────────────────────

function getSetting(key: string): string | null {
  const r = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return r?.value ?? null;
}
function setSetting(key: string, value: string): void {
  db()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}
function deleteSetting(key: string): void {
  db().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

export function getKieApiToken(): string | null {
  const dbToken = getSetting("kie_api_token");
  if (dbToken) return dbToken;
  const envToken = process.env.KIE_API_KEY ?? "";
  if (!envToken || envToken === "your_kie_api_key_here") return null;
  return envToken;
}

export function setKieApiToken(token: string): void {
  setSetting("kie_api_token", token);
}

export function deleteKieApiToken(): void {
  deleteSetting("kie_api_token");
}

export function getHiggsfieldCredentials(): { keyId: string; keySecret: string } | null {
  const keyId = getSetting("higgsfield_key_id") || process.env.HF_API_KEY_ID;
  const keySecret = getSetting("higgsfield_key_secret") || process.env.HF_API_KEY_SECRET;
  return keyId && keySecret ? { keyId, keySecret } : null;
}

export function setHiggsfieldCredentials(keyId: string, keySecret: string): void {
  setSetting("higgsfield_key_id", keyId);
  setSetting("higgsfield_key_secret", keySecret);
}

export function deleteHiggsfieldCredentials(): void {
  deleteSetting("higgsfield_key_id");
  deleteSetting("higgsfield_key_secret");
}

export function getAzureApiKey(): string | null {
  const dbKey = getSetting("azure_api_key");
  if (dbKey) return dbKey;
  const envKey = process.env.AZURE_API_KEY ?? "";
  return envKey || null;
}

export function setAzureApiKey(key: string): void {
  setSetting("azure_api_key", key);
}

export function deleteAzureApiKey(): void {
  deleteSetting("azure_api_key");
}

// ── Folders ────────────────────────────────────────────────────────────────

function rowToFolder(r: Record<string, unknown>): FolderRecord {
  return {
    id: r.id as string,
    user_id: r.user_id as string,
    name: r.name as string,
    parent_id: (r.parent_id as string) ?? null,
    order_index: (r.order_index as number) ?? 0,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    color: (r.color as string) ?? null,
  };
}

export function getFolders(userId: string): FolderRecord[] {
  const rows = db()
    .prepare("SELECT * FROM folders WHERE user_id = ? ORDER BY order_index")
    .all(userId) as Record<string, unknown>[];
  return rows.map(rowToFolder);
}

export function insertFolder(data: Omit<FolderRecord, "created_at" | "updated_at">): FolderRecord {
  const ts = now();
  db()
    .prepare(`
      INSERT INTO folders (id, user_id, name, parent_id, order_index, created_at, updated_at, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(data.id, data.user_id, data.name, data.parent_id ?? null, data.order_index ?? 0, ts, ts, data.color ?? null);
  return { ...data, parent_id: data.parent_id ?? null, created_at: ts, updated_at: ts };
}

export function updateFolder(
  id: string,
  userId: string,
  updates: Partial<Pick<FolderRecord, "name" | "parent_id" | "order_index" | "color">>,
): void {
  const sets: string[] = ["updated_at = ?"];
  const vals: unknown[] = [now()];
  if ("name" in updates) { sets.push("name = ?"); vals.push(updates.name); }
  if ("parent_id" in updates) { sets.push("parent_id = ?"); vals.push(updates.parent_id ?? null); }
  if ("order_index" in updates) { sets.push("order_index = ?"); vals.push(updates.order_index); }
  if ("color" in updates) { sets.push("color = ?"); vals.push(updates.color ?? null); }
  vals.push(id, userId);
  db().prepare(`UPDATE folders SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).run(...(vals as never[]));
}

export function deleteFolder(id: string, userId: string): void {
  const d = db();
  d.exec("BEGIN");
  d.prepare("DELETE FROM folders WHERE id = ? AND user_id = ?").run(id, userId);
  d.prepare("DELETE FROM folder_items WHERE folder_id = ?").run(id);
  d.exec("COMMIT");
}

// ── Folder Items ───────────────────────────────────────────────────────────

export function getFolderItems(userId: string): FolderItemRecord[] {
  const rows = db()
    .prepare("SELECT * FROM folder_items WHERE user_id = ?")
    .all(userId) as Record<string, unknown>[];
  return rows.map((r) => ({
    folder_id: r.folder_id as string,
    item_id: r.item_id as string,
    user_id: r.user_id as string,
    created_at: r.created_at as string,
  }));
}

export function insertFolderItems(folderId: string, itemIds: string[], userId: string): void {
  const stmt = db().prepare(
    "INSERT INTO folder_items (folder_id, item_id, user_id, created_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(folder_id, item_id) DO NOTHING",
  );
  const ts = now();
  for (const itemId of itemIds) stmt.run(folderId, itemId, userId, ts);
}

export function deleteFolderItems(folderId: string, itemIds: string[], userId: string): void {
  if (itemIds.length === 0) return;
  const placeholders = itemIds.map(() => "?").join(", ");
  db()
    .prepare(`DELETE FROM folder_items WHERE folder_id = ? AND user_id = ? AND item_id IN (${placeholders})`)
    .run(folderId, userId, ...itemIds);
}
