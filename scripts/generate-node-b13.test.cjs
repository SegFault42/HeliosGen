const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { imageNeedsKie, parseGenerateError, DEFAULT_IMAGE_RATIO } = require("../lib/generateNodeRules.ts");
const { buildImagePayload } = require("../lib/workflow-runtime/generationPayloads.ts");

test("Flow and Codex image models do not need a Kie key; Kie models do", () => {
  assert.equal(imageNeedsKie("flow-nano-banana-2", "kie"), false);
  assert.equal(imageNeedsKie("nano-banana-2", "codex"), false);
  assert.equal(imageNeedsKie("nano-banana-2", "kie"), true);
});

test("screenshot path is split from the Flow error text", () => {
  assert.deepEqual(parseGenerateError("Flow failed (screenshot: C:\tmp\a.png)"), { text: "Flow failed", screenshot: "C:\tmp\a.png" });
  assert.deepEqual(parseGenerateError("plain"), { text: "plain" });
});

test("node default ratio equals the runtime payload default", () => {
  const p = buildImagePayload({ model: "nano-banana-2" }, { prompt: "x", imageUrls: [], imageNodeLabels: [] }, "kie");
  assert.equal(p.aspectRatio, DEFAULT_IMAGE_RATIO);
});
