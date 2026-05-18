import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import https from "node:https";
import http  from "node:http";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import sharp from "sharp";
import { hashBuffer, lookupAssetHash, storeAssetHash } from "./assetCache";
import { GUEST_MODE } from "./guestMode";
import * as localStore from "./guest/localStorage";

const execFileAsync = promisify(execFile);

async function stripMetadata(buffer: Buffer, contentType: string): Promise<Buffer> {
  if (contentType.startsWith("image/")) {
    return sharp(buffer).toBuffer();
  }
  if (contentType.startsWith("video/")) {
    const extension = contentType.includes("webm") ? "webm" : "mp4";
    const tmpDir = await mkdtemp(join(tmpdir(), "strip-meta-"));
    const inputPath  = join(tmpDir, `input.${extension}`);
    const outputPath = join(tmpDir, `output.${extension}`);
    try {
      await writeFile(inputPath, buffer);
      await execFileAsync("ffmpeg", [
        "-i", inputPath,
        "-map_metadata", "-1",
        "-c", "copy",
        "-y", outputPath,
      ]);
      return await readFile(outputPath);
    } finally {
      await Promise.all([
        unlink(inputPath).catch(() => {}),
        unlink(outputPath).catch(() => {}),
      ]);
    }
  }
  return buffer;
}

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return _s3;
}

function cdnUrl(key: string): string {
  return `${process.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${key}`;
}

function ext(contentType: string): string {
  if (contentType.includes("mp4"))  return "mp4";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("png"))  return "png";
  if (contentType.includes("gif"))  return "gif";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

/** Upload a Buffer to R2 (or local disk in guest mode) and return the public URL. */
export async function uploadBuffer(
  buffer: Buffer,
  contentType: string,
  folder: string
): Promise<string> {
  if (GUEST_MODE) return localStore.uploadBuffer(buffer, contentType, folder);
  buffer = await stripMetadata(buffer, contentType);
  const hash = hashBuffer(buffer);
  const cached = await lookupAssetHash(hash);
  if (cached) return cached;

  const key = `${folder}/${randomUUID()}.${ext(contentType)}`;
  const url = cdnUrl(key);

  await getS3().send(
    new PutObjectCommand({
      Bucket:      process.env.R2_BUCKET_NAME!,
      Key:         key,
      Body:        buffer,
      ContentType: contentType,
    })
  );

  // Store hash and wait for it
  try {
    await storeAssetHash(hash, url, contentType, buffer.byteLength);
  } catch (err) {
    console.error("[r2] Failed to store asset hash:", err);
  }

  return url;
}

/** Fetch a remote URL to a Buffer using Node.js core (immune to Next.js AbortSignal patching). */
function fetchToBuffer(url: string, maxRedirects = 5): Promise<{ buf: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("Too many redirects"));
    const u   = new URL(url);
    const mod = u.protocol === "https:" ? https : (http as unknown as typeof https);
    mod.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchToBuffer(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      const chunks: Buffer[] = [];
      res.on("data",  (c: Buffer) => chunks.push(c));
      res.on("end",   () => resolve({ buf: Buffer.concat(chunks), contentType: res.headers["content-type"] ?? "image/jpeg" }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

/** Fetch a remote URL, upload to R2 (or local disk in guest mode), return URL. */
export async function mirrorToR2(sourceUrl: string, folder: string): Promise<string> {
  if (GUEST_MODE) return localStore.mirrorToStorage(sourceUrl, folder);
  const { buf, contentType } = await fetchToBuffer(sourceUrl);
  return uploadBuffer(buf, contentType, folder);
}

/** Upload a base64 data URL to R2 (or local disk in guest mode), return URL. */
export async function uploadDataUrl(dataUrl: string, folder: string): Promise<string> {
  if (GUEST_MODE) return localStore.uploadDataUrl(dataUrl, folder);
  const m = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) throw new Error("uploadDataUrl: not a valid data URL");
  const contentType = m[1];
  const buf = Buffer.from(m[2], "base64");
  return uploadBuffer(buf, contentType, folder);
}

/** Resolve any URL to a stored URL (R2 or local disk in guest mode). */
export async function ensureR2(url: string, folder: string): Promise<string> {
  if (GUEST_MODE) return localStore.ensureStorage(url, folder);
  const cdnBase = process.env.R2_PUBLIC_URL ?? "";
  if (url.startsWith("data:"))        return uploadDataUrl(url, folder);
  if (cdnBase && url.startsWith(cdnBase)) return url;
  return mirrorToR2(url, folder);
}
