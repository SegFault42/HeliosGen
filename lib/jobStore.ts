import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "./guest/paths";

export type JobResult =
  | { status: "pending"; type?: "image" | "video"; userId?: string }
  | { status: "done"; imageUrl?: string; imageUrls?: string[]; videoUrl?: string }
  | { status: "error"; error: string };

type Stored = JobResult & { ts?: number };

// DATA_DIR is the repo in dev and a writable per-user dir in the packaged
// desktop app (the install dir is read-only there).
const FILE = join(DATA_DIR, ".job-store.json");
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // settled jobs older than a week are dropped

// Single-process server: keep the map in memory and only touch disk on writes.
// The old version re-read and rewrote the whole file on every get/set, with no
// atomicity and no expiry, so it grew forever.
let cache: Record<string, Stored> | null = null;

function load(): Record<string, Stored> {
  if (cache) return cache;
  if (!existsSync(FILE)) return (cache = {});
  try { cache = JSON.parse(readFileSync(FILE, "utf8")); }
  catch { cache = {}; }
  return cache!;
}

function prune(data: Record<string, Stored>): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, r] of Object.entries(data)) {
    if (r.status !== "pending" && (r.ts ?? 0) < cutoff) delete data[id];
  }
}

function flush(data: Record<string, Stored>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), "utf8");
  renameSync(tmp, FILE); // atomic on the same filesystem
}

export const jobStore = {
  get(taskId: string): JobResult | undefined {
    return load()[taskId];
  },
  set(taskId: string, result: JobResult): void {
    const data = load();
    data[taskId] = { ...result, ts: Date.now() };
    prune(data);
    flush(data);
  },
};
