import { createHash, randomUUID } from "node:crypto";
import { basename, extname, join } from "node:path";
import { readFile, rename, writeFile } from "node:fs/promises";
import { ensureStorage } from "@/lib/storage";
import { mediaPathFor } from "@/lib/guest/media";

const MCP_URL = process.env.HEYGEN_MCP_URL ?? "https://mcp.heygen.com/mcp/v1/";
const OAUTH_TOKEN_URL = process.env.HEYGEN_MCP_TOKEN_URL ?? "https://api2.heygen.com/v1/oauth/token";
const DEFAULT_HERMES_HOME = process.env.HERMES_HOME ?? "F:/CLAUDE/hermes";
const DEFAULT_TOKEN_FILE = join(DEFAULT_HERMES_HOME, "mcp-tokens", "heygen.json");
const DEFAULT_CLIENT_FILE = join(DEFAULT_HERMES_HOME, "mcp-tokens", "heygen.client.json");
const DEFAULT_CLIENT_ID = "https://nousresearch.github.io/hermes-agent/docs/oauth/client-metadata.json";
const REFRESH_SKEW_MS = 90_000;

function fetchTimeoutMs(): number {
  const n = Number(process.env.HEYGEN_FETCH_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

interface OAuthTokenFile {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  expires_at?: number;
  [key: string]: unknown;
}

interface RpcResponse {
  json: Record<string, unknown>;
  sessionId: string | null;
}

export interface HeyGenVideoInput {
  prompt: string;
  aspectRatio?: string;
  avatarId?: string;
  voiceId?: string;
  resources?: Array<{ url: string; label?: string }>;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  startFrameUrl?: string;
  endFrameUrl?: string;
}

function tokenFilePath(): string {
  return process.env.HEYGEN_MCP_TOKEN_FILE ?? DEFAULT_TOKEN_FILE;
}

function clientFilePath(): string {
  return process.env.HEYGEN_MCP_CLIENT_FILE ?? DEFAULT_CLIENT_FILE;
}

export function sanitizeError(message: string): string {
  return message
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/(access_token|refresh_token|token|api[_-]?key|secret)=[^\s&]+/gi, "$1=[redacted]");
}

// Refreshed tokens that could not be written to disk; HeyGen may have rotated the refresh token.
let memoryToken: OAuthTokenFile | null = null;

export function _resetHeyGenTokenMemory(): void { memoryToken = null; }

async function readTokenFile(): Promise<OAuthTokenFile> {
  const fromFile = await readTokenFileOnly();
  return memoryToken && (memoryToken.expires_at ?? 0) > (fromFile.expires_at ?? 0) ? memoryToken : fromFile;
}

async function readTokenFileOnly(): Promise<OAuthTokenFile> {
  let raw: string;
  try {
    raw = await readFile(tokenFilePath(), "utf8");
  } catch {
    throw new Error(`HeyGen MCP token file not found: ${tokenFilePath()}`);
  }
  let token: OAuthTokenFile;
  try {
    token = JSON.parse(raw) as OAuthTokenFile;
  } catch {
    throw new Error("HeyGen MCP token file is not valid JSON");
  }
  if (!token.access_token) throw new Error("HeyGen MCP token file has no access token");
  return token;
}

async function readClientId(): Promise<string> {
  try {
    const raw = await readFile(clientFilePath(), "utf8");
    const parsed = JSON.parse(raw) as { client_id?: string };
    if (parsed.client_id) return parsed.client_id;
  } catch {
    // The public CIMD client id is a safe fallback for this OAuth client.
  }
  return process.env.HEYGEN_MCP_CLIENT_ID ?? DEFAULT_CLIENT_ID;
}

async function persistToken(token: OAuthTokenFile): Promise<void> {
  const path = tokenFilePath();
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(token), { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(current: OAuthTokenFile): Promise<string> {
  if (!current.refresh_token) {
    throw new Error("HeyGen MCP access token expired and no refresh token is available; run Hermes OAuth again");
  }
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refresh_token!,
      client_id: await readClientId(),
    });
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body,
      signal: AbortSignal.timeout(fetchTimeoutMs()),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HeyGen MCP token refresh failed (${response.status})`);
    let next: Record<string, unknown>;
    try {
      next = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error("HeyGen MCP token refresh returned invalid JSON");
    }
    const accessToken = typeof next.access_token === "string" ? next.access_token : "";
    if (!accessToken) throw new Error("HeyGen MCP token refresh returned no access token");
    const expiresIn = typeof next.expires_in === "number" ? next.expires_in : 86400;
    const merged: OAuthTokenFile = {
      ...current,
      ...next,
      expires_at: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    } as OAuthTokenFile;
    memoryToken = merged;
    await persistToken(merged).catch((e) => console.error("[heygen] token persist failed", e instanceof Error ? e.message : "error"));
    return accessToken;
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function accessToken(): Promise<string> {
  const token = await readTokenFile();
  if (!token.expires_at || token.expires_at > Date.now() + REFRESH_SKEW_MS) return token.access_token;
  return refreshAccessToken(token);
}

function parseMcpBody(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try { return JSON.parse(trimmed) as Record<string, unknown>; } catch { /* SSE below */ }
  const messages: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try { messages.push(JSON.parse(data) as Record<string, unknown>); } catch { /* ignore keepalive/non-json */ }
  }
  return messages.findLast((value) => "result" in value || "error" in value) ?? messages.at(-1) ?? {};
}

async function rpc(body: Record<string, unknown>, token: string, sessionId?: string): Promise<RpcResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "User-Agent": "ANVIL-HeliosGen/1.0",
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
    headers["MCP-Protocol-Version"] = "2025-06-18";
  }
  const response = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(fetchTimeoutMs()) });
  const text = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(sanitizeError(`HeyGen MCP HTTP ${response.status} ${text.slice(0, 300)}`.trim())), { status: response.status });
  }
  return { json: parseMcpBody(text), sessionId: response.headers.get("mcp-session-id") ?? sessionId ?? null };
}

function textFromResult(result: Record<string, unknown>): string | null {
  const content = result.content;
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
      return (item as { text: string }).text;
    }
  }
  return null;
}

function decodeToolResult(response: Record<string, unknown>): unknown {
  if (response.error && typeof response.error === "object") {
    const message = (response.error as { message?: unknown }).message;
    throw new Error(sanitizeError(String(message ?? "HeyGen MCP request failed")));
  }
  const result = (response.result ?? {}) as Record<string, unknown>;
  if (result.isError) {
    const text = textFromResult(result);
    throw new Error(sanitizeError(text ?? "HeyGen MCP tool failed"));
  }
  const text = textFromResult(result);
  if (!text) return result;
  try { return JSON.parse(text); } catch { return text; }
}

/** Call a real HeyGen MCP tool through the existing OAuth session. */
export async function heygenMcpCall<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  let token = await accessToken();
  // Reads may be retried on a gateway blip (HeyGen sits behind Cloudflare); never a
  // create, which could start (and bill) a second render.
  const readOnly = /^(get|list)_/.test(name);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await callWithToken<T>(name, args, token);
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401) {
        token = await refreshAccessToken(await readTokenFile());
        return callWithToken<T>(name, args, token);
      }
      if (!readOnly || attempt >= 2 || !(status === 502 || status === 503 || status === 504)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
    }
  }
}

async function callWithToken<T>(name: string, args: Record<string, unknown>, token: string): Promise<T> {
  const initialized = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ANVIL-HeliosGen", version: "1.0.0" },
    },
  }, token);
  const sessionId = initialized.sessionId;
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, token, sessionId ?? undefined);
  const called = await rpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: args },
  }, token, sessionId ?? undefined);
  return decodeToolResult(called.json) as T;
}

function findString(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findString(item, keys); if (found) return found; }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  for (const key of keys) if (typeof object[key] === "string" && object[key]) return object[key] as string;
  for (const item of Object.values(object)) { const found = findString(item, keys); if (found) return found; }
  return undefined;
}

function findObject(value: unknown, keys: string[]): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findObject(item, keys); if (found) return found; }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    if (object[key] && typeof object[key] === "object" && !Array.isArray(object[key])) return object[key] as Record<string, string>;
  }
  for (const item of Object.values(object)) { const found = findObject(item, keys); if (found) return found; }
  return undefined;
}

function decodeDataUrl(value: string): { bytes: Buffer; contentType: string } | null {
  const match = value.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) return null;
  const contentType = match[1] ?? "application/octet-stream";
  const bytes = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
  return { bytes, contentType };
}

export function defaultContentType(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg": case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".heic": return "image/heic";
    case ".avif": return "image/avif";
    case ".webm": return "video/webm";
    case ".m4a": return "audio/mp4";
    case ".mp4": return "video/mp4";
    case ".mov": return "video/quicktime";
    case ".mp3": return "audio/mpeg";
    case ".wav": return "audio/wav";
    default: return "application/octet-stream";
  }
}

async function readMedia(url: string): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
  const data = decodeDataUrl(url);
  if (data) return { ...data, filename: `anvil-${randomUUID()}.bin` };
  if (url.startsWith("blob:")) throw new Error("HeyGen cannot use a browser blob URL; save the asset in ANVIL first");
  // ensureStorage passes already-local /generated/ URLs through untouched and mirrors
  // remote URLs through the SSRF-guarded fetch in lib/guest/localStorage.ts.
  const local = await ensureStorage(url, "references");
  const abs = mediaPathFor(local);
  if (!abs) throw new Error("Could not read ANVIL media");
  const bytes = await readFile(abs);
  const pathPart = local.split("?")[0].split("#")[0];
  const filename = basename(pathPart) || `anvil-${randomUUID()}.bin`;
  return { bytes, contentType: defaultContentType(filename), filename };
}

async function uploadBytes(filename: string, contentType: string, bytes: Buffer): Promise<string> {
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const created = await heygenMcpCall<unknown>("create_asset_upload", {
    filename,
    contentType,
    sizeBytes: bytes.byteLength,
    checksumSha256: checksum,
  });
  const assetId = findString(created, ["assetId", "asset_id"]);
  const uploadUrl = findString(created, ["uploadUrl", "upload_url", "presignedUrl", "presigned_url"]);
  const uploadHeaders = findObject(created, ["uploadHeaders", "upload_headers", "headers"]);
  if (!assetId || !uploadUrl) throw new Error("HeyGen asset upload did not return an upload URL");
  const headers: Record<string, string> = { ...(uploadHeaders ?? {}) };
  if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) headers["Content-Type"] = contentType;
  const uploaded = await fetch(uploadUrl, { method: "PUT", headers, body: new Uint8Array(bytes), signal: AbortSignal.timeout(fetchTimeoutMs()) });
  if (!uploaded.ok) throw new Error(`HeyGen asset upload failed (${uploaded.status})`);
  await heygenMcpCall("complete_asset_upload", { assetId, checksumSha256: checksum });
  return assetId;
}

async function uploadAsset(url: string): Promise<string> {
  const media = await readMedia(url);
  return uploadBytes(media.filename, media.contentType, media.bytes);
}

/** Upload a local source image/video through the HeyGen MCP asset flow. */
export async function uploadHeyGenLocalAsset(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return uploadBytes(basename(filePath), defaultContentType(filePath), Buffer.from(bytes));
}

/** Create a photo avatar from a local file using only HeyGen MCP OAuth. */
export async function createHeyGenPhotoAvatar(name: string, filePath: string, avatarGroupId?: string): Promise<unknown> {
  const assetId = await uploadHeyGenLocalAsset(filePath);
  const args: Record<string, unknown> = {
    name,
    file: { type: "asset_id", asset_id: assetId },
  };
  if (avatarGroupId) args.avatarGroupId = avatarGroupId;
  return heygenMcpCall("create_photo_avatar", args);
}

function uniqueUrls(input: HeyGenVideoInput): string[] {
  return [...new Set([
    ...(input.resources ?? []).map((item) => item.url),
    ...(input.referenceImageUrls ?? []),
    ...(input.referenceVideoUrls ?? []),
    ...(input.referenceAudioUrls ?? []),
    ...(input.startFrameUrl ? [input.startFrameUrl] : []),
    ...(input.endFrameUrl ? [input.endFrameUrl] : []),
  ].filter(Boolean))];
}

function orientationFor(ratio: string | undefined): "portrait" | "landscape" | undefined {
  if (ratio === "9:16" || ratio === "4:5") return "portrait";
  if (ratio === "16:9" || ratio === "5:4" || ratio === "1:1") return "landscape";
  return undefined;
}

/** Submit one ANVIL video request to HeyGen Video Agent and return a durable task id. */
export async function submitHeyGenVideo(input: HeyGenVideoInput): Promise<{ taskId: string; sessionId: string }> {
  if (!input.prompt.trim()) throw new Error("HeyGen requires a non-empty prompt");
  const files: Array<{ type: "asset_id"; asset_id: string }> = [];
  for (const url of uniqueUrls(input).slice(0, 20)) files.push({ type: "asset_id", asset_id: await uploadAsset(url) });
  const args: Record<string, unknown> = {
    prompt: input.prompt,
    mode: "generate",
    visibility: "private",
    incognitoMode: true,
  };
  const orientation = orientationFor(input.aspectRatio);
  if (orientation) args.orientation = orientation;
  if (files.length) args.files = files;
  const avatarId = input.avatarId ?? process.env.HEYGEN_AVATAR_ID;
  const voiceId = input.voiceId ?? process.env.HEYGEN_VOICE_ID;
  if (avatarId) args.avatarId = avatarId;
  if (voiceId) args.voiceId = voiceId;
  const created = await heygenMcpCall<unknown>("create_video_agent", args);
  const sessionId = findString(created, ["sessionId", "session_id"]);
  if (!sessionId) throw new Error("HeyGen did not return a video-agent session id");
  return { sessionId, taskId: `heygen-agent:${sessionId}` };
}

export async function getHeyGenAgentSession(sessionId: string): Promise<unknown> {
  return heygenMcpCall("get_video_agent_session", { sessionId });
}

export async function listHeyGenAgentVideos(sessionId: string): Promise<unknown> {
  return heygenMcpCall("list_video_agent_session_videos", { sessionId });
}

export async function getHeyGenVideo(videoId: string): Promise<unknown> {
  return heygenMcpCall("get_video", { videoId });
}

export async function getHeyGenCurrentUser(): Promise<unknown> {
  return heygenMcpCall("get_current_user", {});
}

export function heygenTokenPath(): string { return tokenFilePath(); }
export function heygenClientPath(): string { return clientFilePath(); }
