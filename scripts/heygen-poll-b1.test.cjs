// Compile local TypeScript modules for behavioral tests without a Next server.
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(ROOT, request.slice(2));
  return originalResolve.call(this, request, ...rest);
};
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};

const { test } = require("node:test");
const assert = require("node:assert/strict");
const p = require("../lib/heygenPollPolicy.ts");

test("deadline is 30 min", () => assert.equal(p.HEYGEN_DEADLINE_MS, 30 * 60_000));

test("phase mapping: waiting_for_input and reviewing are pending", () => {
  for (const s of ["", "thinking", "generating", "waiting_for_input", "reviewing"]) assert.equal(p.heygenPhase(s), "pending", s);
  for (const s of ["completed", "success", "done"]) assert.equal(p.heygenPhase(s), "completed", s);
  for (const s of ["failed", "error", "cancelled", "stopped"]) assert.equal(p.heygenPhase(s), "failed", s);
});

test("fatal: 401/403/400/422 status, refresh 4xx, auth messages", () => {
  for (const status of [400, 401, 403, 422]) assert.equal(p.isFatalHeyGenError(Object.assign(new Error("x"), { status })), true, String(status));
  assert.equal(p.isFatalHeyGenError(new Error("HeyGen MCP token refresh failed (400)")), true);
});

test("transient: 5xx, 429, network, timeout", () => {
  for (const status of [404, 429, 500, 502, 503]) assert.equal(p.isFatalHeyGenError(Object.assign(new Error("x"), { status })), false, String(status));
  assert.equal(p.isFatalHeyGenError(new Error("fetch failed")), false);
  for (const m of ["Video not found", "invalid response", "validation hiccup"]) assert.equal(p.isFatalHeyGenError(new Error(m)), false, m);
  assert.equal(p.isFatalHeyGenError(new Error("Forbidden")), true);
  assert.equal(p.isFatalHeyGenError(new Error("The operation was aborted due to timeout")), false);
  assert.equal(p.isFatalHeyGenError(new Error("HeyGen MCP token refresh failed (503)")), false);
});

test("failure reason: failure_message, error.message, error string; none", () => {
  assert.equal(p.heygenFailureReason({ status: "failed", error: { message: "Avatar look is not available" } }), "Avatar look is not available");
  assert.equal(p.heygenFailureReason({}, { failure_message: "Prompt rejected" }), "Prompt rejected");
  assert.equal(p.heygenFailureReason({ error: "boom" }), "boom");
  assert.equal(p.heygenFailureReason({ status: "failed" }, null), undefined);
});
