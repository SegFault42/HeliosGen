// B2: heygenMcp timeouts, 401 retry, token persistence, sanitizeError, content types.
const ts = require("typescript");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, filename);
};
const root = path.join(__dirname, "..");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(root, request.slice(2));
  return origResolve.call(this, request, ...rest);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mcp = require("../lib/heygenMcp.ts");

const FAKE = "fake-access-secret";
function tmpTokenFile(token) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hg-b2-"));
  const file = path.join(dir, "heygen.json");
  fs.writeFileSync(file, JSON.stringify(token));
  process.env.HEYGEN_MCP_TOKEN_FILE = file;
  process.env.HEYGEN_MCP_CLIENT_FILE = path.join(dir, "none.json");
  return { dir, file };
}
const rpcReply = (id, result) => Response.json({ jsonrpc: "2.0", id, result });

test("sanitizeError redacts without literal $1", () => {
  assert.equal(mcp.sanitizeError("token=abc"), "token=[redacted]");
  assert.equal(mcp.sanitizeError("x Bearer abc.def y"), "x Bearer [redacted] y");
});

test("defaultContentType covers heic/avif/gif/webm/m4a", () => {
  assert.equal(mcp.defaultContentType("a.HEIC"), "image/heic");
  assert.equal(mcp.defaultContentType("a.avif"), "image/avif");
  assert.equal(mcp.defaultContentType("a.gif"), "image/gif");
  assert.equal(mcp.defaultContentType("a.webm"), "video/webm");
  assert.equal(mcp.defaultContentType("a.m4a"), "audio/mp4");
  assert.equal(mcp.defaultContentType("a.xyz"), "application/octet-stream");
});

test("never-resolving fetch rejects after timeout", async () => {
  const original = global.fetch;
  process.env.HEYGEN_FETCH_TIMEOUT_MS = "50";
  tmpTokenFile({ access_token: FAKE });
  global.fetch = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  });
  try {
    await assert.rejects(mcp.heygenMcpCall("get_current_user"));
  } finally { global.fetch = original; delete process.env.HEYGEN_FETCH_TIMEOUT_MS; }
});

test("401 triggers one refresh and retry; refreshed token persisted atomically", async () => {
  const original = global.fetch;
  mcp._resetHeyGenTokenMemory();
  const { dir, file } = tmpTokenFile({ access_token: FAKE, refresh_token: "r1" });
  const seen = [];
  global.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes("oauth/token")) return Response.json({ access_token: "new-tok", refresh_token: "r2", expires_in: 3600 });
    const auth = init.headers.Authorization;
    seen.push(auth);
    if (auth === `Bearer ${FAKE}`) return new Response("nope", { status: 401 });
    const body = JSON.parse(init.body);
    if (body.method === "notifications/initialized") return new Response("", { status: 202 });
    return rpcReply(body.id, { content: [{ type: "text", text: JSON.stringify({ ok: 1 }) }] });
  };
  try {
    assert.deepEqual(await mcp.heygenMcpCall("get_current_user"), { ok: 1 });
    assert.equal(seen[0], `Bearer ${FAKE}`);
    assert.ok(seen.slice(1).every((a) => a === "Bearer new-tok"));
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.access_token, "new-tok");
    assert.equal(saved.refresh_token, "r2");
    assert.deepEqual(fs.readdirSync(dir), ["heygen.json"]);
  } finally { global.fetch = original; }
});

test("persist failure keeps refreshed token in memory", async () => {
  const original = global.fetch;
  const origErr = console.error;
  console.error = () => {};
  mcp._resetHeyGenTokenMemory();
  const { file } = tmpTokenFile({ access_token: FAKE, refresh_token: "r1" });
  const real = fs.readFileSync;
  let refreshes = 0;
  global.fetch = async (url, init) => {
    if (String(url).includes("oauth/token")) { refreshes++; return Response.json({ access_token: "mem-tok", refresh_token: "r2", expires_in: 3600 }); }
    const body = JSON.parse(init.body);
    if (init.headers.Authorization === `Bearer ${FAKE}`) return new Response("", { status: 401 });
    if (body.method === "notifications/initialized") return new Response("", { status: 202 });
    return rpcReply(body.id, { content: [{ type: "text", text: "\"fine\"" }] });
  };
  const fsp = require("node:fs/promises");
  const origRename = fsp.rename;
  fsp.rename = async () => { throw new Error("EPERM"); };
  try {
    assert.equal(await mcp.heygenMcpCall("get_current_user"), "fine");
    assert.equal(refreshes, 1);
    assert.equal(JSON.parse(real(file, "utf8")).access_token, FAKE); // disk untouched
    assert.equal(await mcp.heygenMcpCall("get_current_user"), "fine"); // memory token used, no new 401/refresh
    assert.equal(refreshes, 1);
  } finally { fsp.rename = origRename; global.fetch = original; console.error = origErr; mcp._resetHeyGenTokenMemory(); }
});

test("a Cloudflare 502 is retried for reads, never for a create (no double render)", async () => {
  const original = global.fetch;
  mcp._resetHeyGenTokenMemory();
  tmpTokenFile({ access_token: "ok-tok" });
  let blips = 0, creates = 0;
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "notifications/initialized") return new Response("", { status: 202 });
    if (body.method === "tools/call" && body.params.name.startsWith("create_")) { creates++; return new Response("bad gateway", { status: 502 }); }
    if (body.method === "tools/call" && blips++ === 0) return new Response("bad gateway", { status: 502 });
    return rpcReply(body.id, { content: [{ type: "text", text: "\"fine\"" }] });
  };
  try {
    assert.equal(await mcp.heygenMcpCall("get_video_agent_session", { sessionId: "s" }), "fine");
    await assert.rejects(mcp.heygenMcpCall("create_video_agent", { prompt: "x" }), /502/);
    assert.equal(creates, 1);
  } finally { global.fetch = original; mcp._resetHeyGenTokenMemory(); }
});
