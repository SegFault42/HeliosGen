import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID, createHash } from "crypto";
import https from "node:https";
import http  from "node:http";
import net  from "node:net";
import dns  from "node:dns";
import { lookupAssetHash, storeAssetHash } from "./db";
import { stripMetadata } from "../mediaMetadata";
import { MEDIA_DIR as GENERATED_DIR } from "./paths";
import { toMediaUrl } from "./media";

// mirrorToStorage fetches caller-supplied URLs (reference images/video from users
// or upstream job responses) and the result is served on the LAN and may be
// re-uploaded to Google Flow, so it must never reach loopback, LAN,
// link-local, or cloud-metadata addresses (SSRF).
const BLOCKED = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16],
] as const) {
  BLOCKED.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10],
] as const) {
  BLOCKED.addSubnet(addr, prefix, "ipv6");
}

// BlockList applies the ipv4 rules to IPv4-mapped IPv6 (::ffff:a.b.c.d) as well.
function isBlocked(addr: string): boolean {
  return BLOCKED.check(addr, net.isIPv6(addr) ? "ipv6" : "ipv4");
}

const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  const opts = typeof options === "object" ? options : {};
  dns.lookup(hostname, { ...opts, all: true } as dns.LookupAllOptions, (err, addresses) => {
    if (err) return callback(err, [] as never, undefined as never);
    const bad = addresses.find((a) => isBlocked(a.address));
    if (bad) return callback(new Error(`Blocked private address ${bad.address}`), [] as never, undefined as never);
    if ((opts as { all?: boolean }).all) {
      callback(null, addresses as never, undefined as never);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  });
};

function hashBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function ext(contentType: string): string {
  if (contentType.includes("mp4"))  return "mp4";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("png"))  return "png";
  if (contentType.includes("gif"))  return "gif";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

export async function uploadBuffer(buffer: Buffer, contentType: string, folder: string): Promise<string> {
  buffer = await stripMetadata(buffer, contentType);
  const hash   = hashBuffer(buffer);
  const cached = lookupAssetHash(hash);
  if (cached) return cached;

  await mkdir(join(GENERATED_DIR, folder), { recursive: true });
  const filename = `${randomUUID()}.${ext(contentType)}`;
  await writeFile(join(GENERATED_DIR, folder, filename), buffer);
  const url = `/generated/${folder}/${filename}`;

  storeAssetHash(hash, url, contentType, buffer.byteLength);
  return url;
}

const MAX_MIRROR_BYTES = 256 * 1024 * 1024;

function fetchToBuffer(url: string, maxRedirects = 5): Promise<{ buf: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error("Too many redirects"));
    let u: URL;
    try { u = new URL(url); } catch { return reject(new Error(`Invalid URL: ${url}`)); }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return reject(new Error(`Blocked non-http(s) protocol: ${u.protocol}`));
    }

    // IP-literal hosts skip DNS lookup in Node, so check them directly.
    const host = u.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && isBlocked(host)) {
      return reject(new Error(`Blocked private address ${host}`));
    }

    const mod = u.protocol === "https:" ? https : (http as unknown as typeof https);
    mod.get(url, { lookup: safeLookup, agent: false }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).href;
        res.resume();
        return fetchToBuffer(next, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      const len = Number(res.headers["content-length"]);
      if (Number.isFinite(len) && len > MAX_MIRROR_BYTES) {
        res.destroy();
        return reject(new Error(`Response too large fetching ${url}`));
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (c: Buffer) => {
        total += c.length;
        if (total > MAX_MIRROR_BYTES) {
          res.destroy();
          return reject(new Error(`Response too large fetching ${url}`));
        }
        chunks.push(c);
      });
      res.on("end",   () => resolve({ buf: Buffer.concat(chunks), contentType: res.headers["content-type"] ?? "image/jpeg" }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

export async function mirrorToStorage(url: string, folder: string, expectedContentType?: "video/mp4"): Promise<string> {
  const { buf, contentType } = await fetchToBuffer(url);
  if (expectedContentType === "video/mp4" && (buf.length < 8 || buf.toString("ascii", 4, 8) !== "ftyp")) {
    throw new Error("Mirrored media is not an MP4 video");
  }
  return uploadBuffer(buf, expectedContentType ?? contentType, folder);
}

export async function uploadDataUrl(dataUrl: string, folder: string): Promise<string> {
  const m = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) throw new Error("Not a valid data URL");
  return uploadBuffer(Buffer.from(m[2], "base64"), m[1], folder);
}

/** Resolve any URL to a locally-stored `/generated/...` path. Remote URLs are
 *  mirrored to disk; `data:` URLs are decoded; already-local paths (including the
 *  absolute `http://localhost:<port>/generated/...` form anvil sends) pass through
 *  without a network round-trip. kie.ai reference images are made reachable
 *  separately by `lib/kieUpload.ts` (base64 upload to kie's temp store), so no
 *  public tunnel URL is needed. */
export async function ensureStorage(url: string, folder: string): Promise<string> {
  if (url.startsWith("data:")) return uploadDataUrl(url, folder);
  const local = toMediaUrl(url);
  if (local) return local;
  return mirrorToStorage(url, folder);
}
