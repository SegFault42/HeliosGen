// SSRF hardening for lib/guest/localStorage.ts mirrorToStorage/ensureStorage,
// the /api/generate content-type guard, and lib/kieUpload.ts local-file reads.
const ts = require("typescript");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");

// Point MEDIA_DIR/DATA_DIR at a temp dir before any lib is loaded.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-ssrf-"));
const MEDIA = path.join(TMP, "media");
fs.mkdirSync(MEDIA);
fs.writeFileSync(path.join(MEDIA, "ok.png"), "x");
const SECRET = path.join(TMP, "secret.txt");
fs.writeFileSync(SECRET, "do not upload");
process.env.HELIOS_MEDIA_DIR = MEDIA;
process.env.HELIOS_DATA_DIR = path.join(TMP, "data");

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

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

let server;
let port;
let hits = 0;

before(async () => {
  server = http.createServer((req, res) => {
    hits++;
    res.writeHead(200, { "content-type": "image/png" });
    res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  hits = 0;
});

test("POST /api/generate: non-JSON content-type is refused with 415", async () => {
  const { POST } = require("../app/api/generate/route.ts");
  const res = await POST(new Request("http://localhost:3000/api/generate", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ model: "no-such-model", prompt: "x" }),
  }));
  assert.equal(res.status, 415);
});

test("mirrorToStorage: raw loopback IPv4 URL is rejected", async () => {
  const { mirrorToStorage } = require("../lib/guest/localStorage.ts");
  await assert.rejects(mirrorToStorage(`http://127.0.0.1:${port}/a.png`, "references"));
  assert.equal(hits, 0);
});

test("mirrorToStorage: localhost hostname (DNS lookup path) is rejected", async () => {
  const { mirrorToStorage } = require("../lib/guest/localStorage.ts");
  await assert.rejects(mirrorToStorage(`http://localhost:${port}/a.png`, "references"));
  assert.equal(hits, 0);
});

test("mirrorToStorage: IPv4-mapped IPv6 literal is rejected", async () => {
  const { mirrorToStorage } = require("../lib/guest/localStorage.ts");
  await assert.rejects(mirrorToStorage(`http://[::ffff:127.0.0.1]:${port}/a.png`, "references"));
  assert.equal(hits, 0);
});

test("mirrorToStorage: cloud metadata address is rejected", { timeout: 5000 }, async () => {
  const { mirrorToStorage } = require("../lib/guest/localStorage.ts");
  await assert.rejects(
    mirrorToStorage("http://169.254.169.254/latest/meta-data/", "references"),
    /blocked/i,
  );
});

test("ensureStorage: loopback /generated/ URL resolves locally without mirroring", async () => {
  const { ensureStorage } = require("../lib/guest/localStorage.ts");
  const result = await ensureStorage(`http://localhost:${port}/generated/ok.png`, "references");
  assert.equal(result, "/generated/ok.png");
  assert.equal(hits, 0);
});

test("ensureKieReachableImages: path traversal outside MEDIA_DIR is rejected", async () => {
  const { ensureKieReachableImages } = require("../lib/kieUpload.ts");
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200, json: async () => ({ data: { downloadUrl: "https://x/y" } }) };
  };
  try {
    await assert.rejects(ensureKieReachableImages(["/generated/../secret.txt"], "k"));
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
