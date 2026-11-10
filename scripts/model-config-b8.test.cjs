const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { VIDEO_MODELS } = require("../lib/modelConfig.ts");
const byId = (id) => VIDEO_MODELS.find((m) => m.id === id);
const flow = VIDEO_MODELS.filter((m) => m.apiInput.useFlow);

test("HeyGen: only 16:9/9:16 and 10000 char prompt", () => {
  const m = byId("heygen-video-agent");
  assert.deepEqual([...m.ratios].sort(), ["16:9", "9:16"]);
  assert.equal(m.apiInput.promptMaxLength, 10000);
});

test("Flow interpolation requires start and end frames", () => {
  assert.deepEqual(byId("flow-veo-interpolation").requiredHandles, ["startFrame", "endFrame"]);
});

test("Flow video: no sound toggle, default 720p, 1080p still offered", () => {
  assert.ok(flow.length >= 3);
  for (const m of flow) {
    assert.equal(m.sound, false, m.id);
    assert.equal(m.defaultResolution, "720p", m.id);
    assert.ok(m.resolutions.includes("1080p"), m.id);
  }
});
