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
const { flowProjectUrl } = require("../lib/flowAdapter.ts");

test("flowProjectUrl: missing env fails with an actionable message", () => {
  const saved = process.env.FLOW_PROJECT_URL;
  delete process.env.FLOW_PROJECT_URL;
  try {
    assert.throws(() => flowProjectUrl(), /FLOW_PROJECT_URL/);
  } finally {
    if (saved !== undefined) process.env.FLOW_PROJECT_URL = saved;
  }
});

test("flowProjectUrl: rejects anything that is not a Flow project URL", () => {
  const saved = process.env.FLOW_PROJECT_URL;
  process.env.FLOW_PROJECT_URL = "https://flow.google.com/?pli=1";
  try {
    assert.throws(() => flowProjectUrl(), /FLOW_PROJECT_URL/);
  } finally {
    if (saved === undefined) delete process.env.FLOW_PROJECT_URL; else process.env.FLOW_PROJECT_URL = saved;
  }
});

test("flowProjectUrl: returns a valid project URL", () => {
  const saved = process.env.FLOW_PROJECT_URL;
  process.env.FLOW_PROJECT_URL = " https://flow.google.com/project/70448001-5571-434c-9afe-e78ec83cd5c3 ";
  try {
    assert.equal(flowProjectUrl(), "https://flow.google.com/project/70448001-5571-434c-9afe-e78ec83cd5c3");
  } finally {
    if (saved === undefined) delete process.env.FLOW_PROJECT_URL; else process.env.FLOW_PROJECT_URL = saved;
  }
});

const { flowDeadlineMs, isFatalFlowError, flowErrorMessage } = require("../lib/flowPollPolicy.ts");

test("poll deadline is wall clock: 5 min image, 20 min video", () => {
  assert.equal(flowDeadlineMs(false), 5 * 60_000);
  assert.equal(flowDeadlineMs(true), 20 * 60_000);
});

test("fatal Flow errors stop polling, transient ones do not", () => {
  for (const code of ["generated_asset_not_found", "job_asset_identity_missing", "ui_changed", "login_required", "download_failed", "download_type_mismatch", "generation_failed"]) {
    const error = Object.assign(new Error("x"), { code });
    assert.equal(isFatalFlowError(error), true, code);
  }
  assert.equal(isFatalFlowError(Object.assign(new Error("x"), { code: "browser_error" })), false);
  assert.equal(isFatalFlowError(new Error("socket hang up")), false);
  assert.equal(isFatalFlowError(null), false);
});

test("error message carries the diagnostic screenshot path when present", () => {
  assert.equal(flowErrorMessage("boom", "C:/diag/job-1.png"), "boom (screenshot: C:/diag/job-1.png)");
  assert.equal(flowErrorMessage("boom"), "boom");
});

test("getFlowEngine is one per process even when the module is bundled twice", async () => {
  // Next gives every route its own copy of lib/flowAdapter.ts; simulate that.
  const file = require.resolve("../lib/flowAdapter.ts");
  const first = require(file);
  delete require.cache[file];
  const second = require(file);
  assert.notEqual(first.getFlowEngine, second.getFlowEngine);
  const a = first.getFlowEngine();
  const b = second.getFlowEngine();
  assert.equal(a, b);
  await Promise.allSettled([a, b]);
});

test("frame prompt tells Flow which attached image is first and last", () => {
  const { framePrompt } = require("../lib/flowAdapter.ts");
  assert.equal(framePrompt("waves", false, false), "waves");
  assert.equal(framePrompt("waves", true, false), "Use the first attached image as the first frame. waves");
  assert.equal(
    framePrompt("waves", true, true),
    "Use the first attached image as the first frame and the second attached image as the last frame. waves",
  );
});

test("an unreadable start frame fails the submit instead of being dropped", async () => {
  const { submitFlowVideo } = require("../lib/flowAdapter.ts");
  await assert.rejects(
    submitFlowVideo({ prompt: "waves", startFrame: "blob:http://localhost:3000/5d1c" }),
    /Start frame could not be read/,
  );
});
