import { dlog } from "../debugLog";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, statSync, mkdirSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "./paths";

/**
 * Guest-mode store, backed by SQLite (`node:sqlite`, built into Node 22 — no
 * dependency, no native build). Only ever loaded server-side, i.e. the
 * desktop app; hosted/Vercel never touches this file.
 *
 * On first open it imports any pre-existing `guest-db.json` / `guest-spaces.json`
 * (from the cloud importer or an older build), idempotently — re-running the
 * importer and relaunching merges new rows.
 */

const DB_PATH = join(DATA_DIR, "guest.db");

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  const database = new DatabaseSync(DB_PATH);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  createSchema(database);
  _db = database;
  migrateFromJson(database);
  return _db;
}

function createSchema(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS generations (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      task_id TEXT UNIQUE,
      generation_type TEXT,
      status TEXT,
      prompt TEXT, model TEXT, aspect_ratio TEXT, quality TEXT,
      azure_resolution TEXT, duration INTEGER, kling_mode TEXT, sound INTEGER,
      reference_image_urls TEXT,
      image_url TEXT, image_urls TEXT,
      video_url TEXT, error_msg TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_gen_gallery
      ON generations (user_id, generation_type, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY, user_id TEXT, r2_url TEXT, mime_type TEXT,
      source TEXT, created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads (user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS asset_cache (
      hash TEXT PRIMARY KEY, cdn_url TEXT, mime_type TEXT, byte_size INTEGER
    );

    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY, user_id TEXT, name TEXT, parent_id TEXT,
      order_index INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, color TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_folders_user ON folders (user_id, order_index);

    CREATE TABLE IF NOT EXISTS folder_items (
      folder_id TEXT, item_id TEXT, user_id TEXT, created_at TEXT,
      PRIMARY KEY (folder_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY, name TEXT, data TEXT, updated_at INTEGER
    );
  `);
}

// ── one-time JSON import ────────────────────────────────────────────────────

function jsonNeedsImport(d: DatabaseSync, file: string, marker: string): boolean {
  if (!existsSync(file)) return false;
  const mtime = String(statSync(file).mtimeMs);
  const row = d.prepare("SELECT value FROM settings WHERE key = ?").get(marker) as
    | { value: string }
    | undefined;
  return row?.value !== mtime;
}

function markImported(d: DatabaseSync, file: string, marker: string): void {
  d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(marker, String(statSync(file).mtimeMs));
}

function migrateFromJson(d: DatabaseSync): void {
  const dbJson = join(DATA_DIR, "guest-db.json");
  if (jsonNeedsImport(d, dbJson, "_import_guest_db")) {
    try {
      importGuestDbJson(d, JSON.parse(readFileSync(dbJson, "utf8")));
      markImported(d, dbJson, "_import_guest_db");
      dlog("[guest/sqlite] imported guest-db.json");
    } catch (e) {
      console.error("[guest/sqlite] guest-db.json import failed:", (e as Error).message);
    }
  }

  const spacesJson = join(DATA_DIR, "guest-spaces.json");
  if (jsonNeedsImport(d, spacesJson, "_import_guest_spaces")) {
    try {
      const parsed = JSON.parse(readFileSync(spacesJson, "utf8"));
      const list = Array.isArray(parsed) ? parsed : (parsed.spaces ?? []);
      const stmt = d.prepare(
        "INSERT INTO spaces (id, name, data, updated_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(id) DO NOTHING",
      );
      d.exec("BEGIN");
      for (const s of list) {
        stmt.run(s.id, s.name ?? "Untitled", JSON.stringify(s), Number(s.updatedAt ?? s.createdAt ?? Date.now()));
      }
      d.exec("COMMIT");
      markImported(d, spacesJson, "_import_guest_spaces");
      dlog(`[guest/sqlite] imported guest-spaces.json (${list.length})`);
    } catch (e) {
      console.error("[guest/sqlite] guest-spaces.json import failed:", (e as Error).message);
    }
  }
}

interface JsonDb {
  generations?: Record<string, unknown>[];
  uploads?: Record<string, unknown>[];
  assetCache?: Record<string, { cdn_url: string; mime_type: string; byte_size: number }>;
  settings?: Record<string, string>;
  folders?: Record<string, unknown>[];
  folder_items?: Record<string, unknown>[];
}

function importGuestDbJson(d: DatabaseSync, data: JsonDb): void {
  d.exec("BEGIN");

  const genStmt = d.prepare(`
    INSERT INTO generations
      (id, user_id, task_id, generation_type, status, prompt, model, aspect_ratio,
       quality, azure_resolution, duration, kling_mode, sound, reference_image_urls,
       image_url, image_urls, video_url, error_msg, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  for (const g of data.generations ?? []) {
    const r = g as Record<string, unknown>;
    genStmt.run(
      r.id as string, (r.user_id as string) ?? null, r.task_id as string,
      r.generation_type as string, r.status as string,
      (r.prompt as string) ?? null, (r.model as string) ?? null,
      (r.aspect_ratio as string) ?? null, (r.quality as string) ?? null,
      (r.azure_resolution as string) ?? null,
      (r.duration as number | null) ?? null, (r.kling_mode as string) ?? null,
      r.sound ? 1 : 0,
      r.reference_image_urls ? JSON.stringify(r.reference_image_urls) : null,
      (r.image_url as string) ?? null,
      r.image_urls ? JSON.stringify(r.image_urls) : null,
      (r.video_url as string) ?? null, (r.error_msg as string) ?? null,
      (r.created_at as string) ?? new Date().toISOString(),
      (r.updated_at as string) ?? new Date().toISOString(),
    );
  }

  const upStmt = d.prepare(
    "INSERT INTO uploads (id, user_id, r2_url, mime_type, source, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
  );
  for (const u of data.uploads ?? []) {
    const r = u as Record<string, unknown>;
    upStmt.run(
      r.id as string, r.user_id as string, r.r2_url as string,
      (r.mime_type as string) ?? null, (r.source as string) ?? "user_upload",
      (r.created_at as string) ?? new Date().toISOString(),
    );
  }

  const acStmt = d.prepare(
    "INSERT INTO asset_cache (hash, cdn_url, mime_type, byte_size) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(hash) DO NOTHING",
  );
  for (const [hash, v] of Object.entries(data.assetCache ?? {})) {
    acStmt.run(hash, v.cdn_url, v.mime_type, v.byte_size);
  }

  const setStmt = d.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
  );
  for (const [k, v] of Object.entries(data.settings ?? {})) {
    if (typeof v === "string") setStmt.run(k, v);
  }

  const fStmt = d.prepare(`
    INSERT INTO folders (id, user_id, name, parent_id, order_index, created_at, updated_at, color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
  `);
  for (const f of data.folders ?? []) {
    const r = f as Record<string, unknown>;
    fStmt.run(
      r.id as string, r.user_id as string, r.name as string,
      (r.parent_id as string) ?? null, (r.order_index as number) ?? 0,
      (r.created_at as string) ?? new Date().toISOString(),
      (r.updated_at as string) ?? new Date().toISOString(),
      (r.color as string) ?? null,
    );
  }

  const fiStmt = d.prepare(
    "INSERT INTO folder_items (folder_id, item_id, user_id, created_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(folder_id, item_id) DO NOTHING",
  );
  for (const fi of data.folder_items ?? []) {
    const r = fi as Record<string, unknown>;
    fiStmt.run(
      r.folder_id as string, r.item_id as string, r.user_id as string,
      (r.created_at as string) ?? new Date().toISOString(),
    );
  }

  d.exec("COMMIT");
}
