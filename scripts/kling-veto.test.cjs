// Compile local TypeScript modules for behavioral tests without a Next server.
const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isVetoedVideoModel, DEFAULT_VIDEO_MODEL, VIDEO_MODELS } = require("../lib/modelConfig.ts");

const KLING_IDS = ["kling-3.0", "kling-3.0-turbo", "kling-2.6-motion-control", "kling-3.0-motion-control"];

test("all Kling video models are vetoed by default", () => {
  for (const id of KLING_IDS) {
    assert.equal(isVetoedVideoModel(id, {}), true, `${id} should be vetoed`);
  }
});

test("ALLOW_VETOED_KLING=true opts back in", () => {
  for (const id of KLING_IDS) {
    assert.equal(isVetoedVideoModel(id, { ALLOW_VETOED_KLING: "true" }), false, `${id} should be allowed`);
  }
});

test("allowed video models are never vetoed", () => {
  assert.equal(isVetoedVideoModel("flow-omni-flash", {}), false);
  assert.equal(isVetoedVideoModel("heygen-video-agent", {}), false);
});

test("DEFAULT_VIDEO_MODEL is a real, non-vetoed VIDEO_MODELS entry", () => {
  const found = VIDEO_MODELS.find((m) => m.id === DEFAULT_VIDEO_MODEL);
  assert.ok(found, `${DEFAULT_VIDEO_MODEL} must exist in VIDEO_MODELS`);
  assert.equal(isVetoedVideoModel(DEFAULT_VIDEO_MODEL, {}), false);
});
