// SSRF guard for caller-supplied media URLs in the trim-video / extract-frame
// routes and lib/heygenMcp.ts, which used to fetch(videoUrl) directly. They
// must now resolve through ensureStorage()/mediaPathFor() (see mirror-ssrf.test.cjs
// for the underlying mirrorToStorage guard itself).
const ts = require("typescript");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");

// Point MEDIA_DIR/DATA_DIR at a temp dir before any lib is loaded.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "media-input-ssrf-"));
const MEDIA = path.join(TMP, "media");
fs.mkdirSync(MEDIA);
fs.mkdirSync(path.join(MEDIA, "references"));
// A tiny real file under MEDIA_DIR/references, used for the happy-path resolution test.
fs.writeFileSync(path.join(MEDIA, "references", "clip.mp4"), "not really a video, just bytes");
process.env.HELIOS_MEDIA_DIR = MEDIA;
process.env.HELIOS_DATA_DIR = path.join(TMP, "data");
// heygenMcp reads an OAuth token file; point it somewhere that doesn't exist so
// the SSRF-blocked readMedia() call (which runs before any token access) is what
// actually fails the tests below.
process.env.HEYGEN_MCP_TOKEN_FILE = path.join(TMP, "no-such-token.json");

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) {
    request = path.join(ROOT, request.slice(2));
  }
  return originalResolve.call(this, request, ...rest);
};

require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, filename);
};

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const EVIL_URL = "http://127.0.0.1:9/x.mp4";

let fetchCalls;
let originalFetch;

beforeEach(() => {
  fetchCalls = [];
  originalFetch = globalThis.fetch;
  // fetch must never be used to reach the attacker-controlled host; record every
  // call and fail loudly so a regression shows up as a rejected promise, not a
  // silent pass.
  globalThis.fetch = async (input) => {
    fetchCalls.push(String(input));
    throw new Error(`unexpected global fetch call to ${input}`);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function loopbackFetchCalls() {
  return fetchCalls.filter((u) => u.includes("127.0.0.1") || u.includes("localhost"));
}

test("POST /api/trim-video: loopback videoUrl is rejected, fetch is never called", async () => {
  const { POST } = require("../app/api/trim-video/route.ts");
  const res = await POST(new Request("http://localhost:3000/api/trim-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ videoUrl: EVIL_URL, startTime: 0, endTime: 1 }),
  }));
  assert.ok(res.status >= 400, `expected an error status, got ${res.status}`);
  assert.equal(loopbackFetchCalls().length, 0);
});

test("POST /api/extract-frame: loopback videoUrl is rejected, fetch is never called", async () => {
  const { POST } = require("../app/api/extract-frame/route.ts");
  const res = await POST(new Request("http://localhost:3000/api/extract-frame", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ videoUrl: EVIL_URL }),
  }));
  assert.ok(res.status >= 400, `expected an error status, got ${res.status}`);
  assert.equal(loopbackFetchCalls().length, 0);
});

test("submitHeyGenVideo: loopback reference URL is rejected before any HeyGen call, fetch is never called", async () => {
  const { submitHeyGenVideo } = require("../lib/heygenMcp.ts");
  await assert.rejects(
    submitHeyGenVideo({ prompt: "hello", referenceVideoUrls: [EVIL_URL] }),
  );
  assert.equal(loopbackFetchCalls().length, 0);
});

test("happy path: a /generated/references/ file under MEDIA_DIR resolves without mirroring", async () => {
  const { ensureStorage } = require("../lib/storage.ts");
  const { mediaPathFor } = require("../lib/guest/media.ts");
  const local = await ensureStorage("/generated/references/clip.mp4", "references");
  const abs = mediaPathFor(local);
  assert.equal(abs, path.join(MEDIA, "references", "clip.mp4"));
  assert.equal(fs.readFileSync(abs, "utf8"), "not really a video, just bytes");
  assert.equal(fetchCalls.length, 0);
});
