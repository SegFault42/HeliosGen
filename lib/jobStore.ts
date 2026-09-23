import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { DATA_DIR } from "./guest/paths";
import { randomUUID } from "crypto";

export interface JobMetadata {
  phase?: "queued" | "generating" | "interrupted";
  provider?: "codex" | "azure" | "kie";
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  serverInstanceId?: string;
}

export type JobResult = JobMetadata & (
  | { status: "pending"; type?: "image" | "video"; userId?: string }
  | { status: "done"; imageUrl?: string; imageUrls?: string[]; videoUrl?: string }
  | { status: "error"; error: string });

const processState = globalThis as typeof globalThis & { heliosJobInstance?: string };
export const serverInstanceId = processState.heliosJobInstance ??= randomUUID();
export const jobProvider = (taskId: string): NonNullable<JobMetadata["provider"]> =>
  taskId.startsWith("codex-") ? "codex" : taskId.startsWith("azure-") ? "azure" : "kie";

// DATA_DIR is the repo in dev and a writable per-user dir in the packaged
// desktop app (the install dir is read-only there).
const FILE = join(DATA_DIR, ".job-store.json");

function read(): Record<string, JobResult> {
  if (!existsSync(FILE)) return {};
  try { return JSON.parse(readFileSync(FILE, "utf8")); }
  catch { return {}; }
}

function write(data: Record<string, JobResult>): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(data), "utf8");
}

export const jobStore = {
  get(taskId: string): JobResult | undefined {
    return read()[taskId];
  },
  set(taskId: string, result: JobResult): void {
    const data = read();
    const previous = data[taskId];
    const now = new Date().toISOString();
    const provider = result.provider ?? previous?.provider ?? jobProvider(taskId);
    const phase = result.phase ?? (result.status === "pending" ? previous?.phase ?? (provider === "kie" ? "queued" : "generating") : undefined);
    data[taskId] = {
      ...previous, ...result, provider, phase,
      createdAt: result.createdAt ?? previous?.createdAt ?? now,
      startedAt: result.startedAt ?? previous?.startedAt ?? (result.status === "pending" && phase === "generating" ? now : undefined),
      finishedAt: result.status === "pending" ? undefined : result.finishedAt ?? previous?.finishedAt ?? now,
      serverInstanceId: result.serverInstanceId ?? previous?.serverInstanceId ?? (provider !== "kie" ? serverInstanceId : undefined),
    };
    write(data);
  },
};
