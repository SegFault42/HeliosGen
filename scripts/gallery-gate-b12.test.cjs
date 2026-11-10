const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { canGenerate, needsKieKey, pollMaxIterations } = require("../lib/galleryGate.ts");
const { IMAGE_MODELS, VIDEO_MODELS } = require("../lib/modelConfig.ts");

const flowVideo = VIDEO_MODELS.find((m) => m.apiInput.useFlow).id;
const flowImage = IMAGE_MODELS.find((m) => m.apiInput.useFlow).id;
const kieVideo = VIDEO_MODELS.find((m) => !m.apiInput.useFlow && !m.apiInput.useHeyGenMcp).id;

test("codex bypasses the Kie key, kie does not", () => {
  assert.equal(canGenerate({ modelId: "gpt-image-2", kieKeySet: false, selected: "codex" }), true);
  assert.equal(canGenerate({ modelId: "gpt-image-2", kieKeySet: false, selected: "kie" }), false);
});
test("azure only bypasses when configured", () => {
  assert.equal(needsKieKey("gpt-image-2", "azure", true), false);
  assert.equal(needsKieKey("gpt-image-2", "azure", false), true);
});
test("flow and heygen never need Kie", () => {
  for (const id of [flowVideo, flowImage, "heygen-video-agent"]) assert.equal(canGenerate({ modelId: id, kieKeySet: false }), true);
  assert.equal(needsKieKey(flowVideo), false);
  assert.equal(needsKieKey("heygen-video-agent"), false);
  assert.equal(needsKieKey(kieVideo), true);
});
test("kieKeySet true/null never blocks", () => {
  assert.equal(canGenerate({ modelId: kieVideo, kieKeySet: true }), true);
  assert.equal(canGenerate({ modelId: kieVideo, kieKeySet: null }), true);
});
test("poll deadline: 25 min for Flow/HeyGen, 7.5 min otherwise", () => {
  assert.equal(pollMaxIterations(flowVideo) * 3 >= 25 * 60, true);
  assert.equal(pollMaxIterations("heygen-video-agent") * 3 >= 25 * 60, true);
  assert.equal(pollMaxIterations(kieVideo), 150);
});
