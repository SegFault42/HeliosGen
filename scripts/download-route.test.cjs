// SSRF hardening for app/api/download/route.ts (GET proxy that fetches an
// arbitrary caller-supplied URL and returns it as an attachment).
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");

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

let originalFetch;
let fetchCalls;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    return {
      ok: true,
      status: 200,
      headers: { get: () => "image/png" },
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    };
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function downloadRequest(url) {
  const { NextRequest } = require("next/server");
  return new NextRequest(
    `http://localhost:3000/api/download?url=${encodeURIComponent(url)}&filename=a.png`,
  );
}

test("GET /api/download: raw loopback URL is forbidden, fetch not called", async () => {
  const { GET } = require("../app/api/download/route.ts");
  const res = await GET(downloadRequest("http://127.0.0.1:8000/x"));
  assert.equal(res.status, 403);
  assert.equal(fetchCalls.length, 0);
});

test("GET /api/download: /generated/ pathname on a foreign host is forbidden, fetch not called", async () => {
  const { GET } = require("../app/api/download/route.ts");
  const res = await GET(downloadRequest("http://10.0.0.5/generated/x"));
  assert.equal(res.status, 403);
  assert.equal(fetchCalls.length, 0);
});

test("GET /api/download: userinfo bypass of ALLOWED_ORIGINS is forbidden, fetch not called", async () => {
  const { GET } = require("../app/api/download/route.ts");
  const res = await GET(downloadRequest("https://cdn.kie.ai@10.0.0.5/x"));
  assert.equal(res.status, 403);
  assert.equal(fetchCalls.length, 0);
});

test("GET /api/download: non-https allowed-origin host is forbidden, fetch not called", async () => {
  const { GET } = require("../app/api/download/route.ts");
  const res = await GET(downloadRequest("http://cdn.kie.ai/x"));
  assert.equal(res.status, 403);
  assert.equal(fetchCalls.length, 0);
});

test("GET /api/download: relative /generated/ path is allowed", async () => {
  const { GET } = require("../app/api/download/route.ts");
  const res = await GET(downloadRequest("/generated/a.png"));
  assert.equal(res.status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0], "http://localhost:3000/generated/a.png");
});

test("GET /api/download: exact ALLOWED_ORIGINS https URL is allowed", async () => {
  const { GET } = require("../app/api/download/route.ts");
  const res = await GET(downloadRequest("https://cdn.kie.ai/a.png"));
  assert.equal(res.status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0], "https://cdn.kie.ai/a.png");
});
