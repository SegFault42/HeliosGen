// Local media path guards: nothing outside MEDIA_DIR may be read (Flow uploads
// reference files to Google) or written (/api/upload).
const ts = require("typescript");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");

// Point MEDIA_DIR at a temp dir before lib/guest/paths.ts is loaded.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "flow-local-path-"));
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

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveLocalPath } = require("../lib/flowAdapter.ts");

test("resolveLocalPath: /generated/ file inside MEDIA_DIR resolves", () => {
  assert.equal(resolveLocalPath("/generated/ok.png"), path.join(MEDIA, "ok.png"));
});

test("resolveLocalPath: traversal out of MEDIA_DIR is rejected", () => {
  assert.equal(resolveLocalPath("/generated/../secret.txt"), null);
  assert.equal(resolveLocalPath("/generated/%2e%2e/secret.txt"), null);
  assert.equal(resolveLocalPath("/generated/..%5Csecret.txt"), null);
});

test("resolveLocalPath: query and fragment are ignored", () => {
  assert.equal(resolveLocalPath("/generated/ok.png?v=2"), path.join(MEDIA, "ok.png"));
  assert.equal(resolveLocalPath("/generated/ok.png#t=0.1"), path.join(MEDIA, "ok.png"));
});

test("resolveLocalPath: symlink/junction inside MEDIA_DIR pointing outside is rejected", () => {
  // "junction" needs no admin rights on Windows; elsewhere it is a plain dir symlink.
  fs.symlinkSync(TMP, path.join(MEDIA, "link"), "junction");
  assert.equal(resolveLocalPath("/generated/link/secret.txt"), null);
});

test("mediaPathFor: MEDIA_DIR with a trailing separator still resolves", () => {
  const pathsModule = require.resolve("../lib/guest/paths.ts");
  const mediaModule = require.resolve("../lib/guest/media.ts");
  delete require.cache[pathsModule];
  delete require.cache[mediaModule];
  process.env.HELIOS_MEDIA_DIR = MEDIA + path.sep;
  try {
    const { mediaPathFor } = require("../lib/guest/media.ts");
    assert.equal(mediaPathFor("/generated/ok.png"), path.join(MEDIA, "ok.png"));
  } finally {
    process.env.HELIOS_MEDIA_DIR = MEDIA;
    delete require.cache[pathsModule];
    delete require.cache[mediaModule];
  }
});

test("resolveLocalPath: malformed percent-encoding is rejected, not thrown", () => {
  assert.equal(resolveLocalPath("/generated/%E0"), null);
});

test("resolveLocalPath: absolute filesystem path is rejected", () => {
  assert.equal(resolveLocalPath(SECRET), null);
  assert.equal(resolveLocalPath(path.join(MEDIA, "ok.png")), null);
});

test("resolveLocalPath: loopback /generated/ URL (anvil --start) resolves", () => {
  assert.equal(resolveLocalPath("http://localhost:3000/generated/ok.png"), path.join(MEDIA, "ok.png"));
  assert.equal(resolveLocalPath("http://127.0.0.1:3000/generated/ok.png?v=1"), path.join(MEDIA, "ok.png"));
});

test("resolveLocalPath: non-loopback host or traversal in a URL is rejected", () => {
  assert.equal(resolveLocalPath("http://evil.example/generated/ok.png"), null);
  assert.equal(resolveLocalPath("http://localhost.evil.example/generated/ok.png"), null);
  assert.equal(resolveLocalPath("http://localhost:3000/generated/../secret.txt"), null);
  assert.equal(resolveLocalPath("http://localhost:3000/generated/..%5Csecret.txt"), null);
});

test("POST /api/generate-video: non-JSON content-type is refused with 415", async () => {
  const { POST } = require("../app/api/generate-video/route.ts");
  // text/plain is a CORS "simple" request: a cross-site page can send it without preflight.
  const res = await POST(new Request("http://localhost:3000/api/generate-video", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ videoModel: "no-such-model" }),
  }));
  assert.equal(res.status, 415);
});

// /api/upload writes caller-supplied bytes to MEDIA_DIR/<folder>/, so folder must not escape it.
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
function uploadRequest(body, contentType = "application/json") {
  return new Request("http://localhost:3000/api/upload", {
    method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(body),
  });
}

test("POST /api/upload: non-JSON content-type is refused with 415", async () => {
  const { POST } = require("../app/api/upload/route.ts");
  const res = await POST(uploadRequest({ dataUrl: PNG_1PX }, "text/plain"));
  assert.equal(res.status, 415);
});

test("POST /api/upload: folder that escapes MEDIA_DIR is refused and nothing is written", async () => {
  const { POST } = require("../app/api/upload/route.ts");
  for (const folder of ["../escape", "..\\escape", "a/b", "", 42]) {
    const res = await POST(uploadRequest({ dataUrl: PNG_1PX, folder }));
    assert.equal(res.status, 400, `folder ${JSON.stringify(folder)}`);
  }
  assert.equal(fs.existsSync(path.join(TMP, "escape")), false);
});

test("POST /api/upload: default uploads folder still works", async () => {
  const { POST } = require("../app/api/upload/route.ts");
  const res = await POST(uploadRequest({ dataUrl: PNG_1PX, folder: "uploads" }));
  assert.equal(res.status, 200);
  const { cdnUrl } = await res.json();
  assert.match(cdnUrl, /^\/generated\/uploads\/[\w-]+\.png$/);
  assert.ok(fs.existsSync(path.join(MEDIA, "uploads", path.basename(cdnUrl))));
});

// /api/upload-asset takes raw bytes; a cross-site page can POST text/plain, form, multipart
// or header-less bodies without a CORS preflight, so those must be refused.
function assetRequest(headers) {
  return new Request("http://localhost:3000/api/upload-asset", {
    method: "POST", headers, body: new Uint8Array(Buffer.from(PNG_1PX.split(",")[1], "base64")),
  });
}

test("POST /api/upload-asset: CORS-simple or missing content-type is refused with 415", async () => {
  const { POST } = require("../app/api/upload-asset/route.ts");
  for (const type of ["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
    const res = await POST(assetRequest({ "content-type": type }));
    assert.equal(res.status, 415, type);
  }
  const res = await POST(assetRequest({}));
  assert.equal(res.status, 415, "no content-type header");
});

test("POST /api/upload-asset: image upload still works", async () => {
  const { POST } = require("../app/api/upload-asset/route.ts");
  const res = await POST(assetRequest({ "content-type": "image/png" }));
  assert.equal(res.status, 200);
  const { cdnUrl } = await res.json();
  assert.match(cdnUrl, /^\/generated\/uploads\//);
});
