// B9/F2: a regenerated generateNode must send the imageUrl it shows, not a stale r2Url.
const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolveInputs } = require("../lib/executor.ts");

const run = (srcType, data) => resolveInputs("v", [
  { id: "s", type: srcType, position: { x: 0, y: 0 }, data },
  { id: "v", type: "videoGeneratorNode", position: { x: 0, y: 0 }, data: {} },
], [{ id: "e", source: "s", target: "v", targetHandle: "startFrame" }]);

test("regenerated image node sends the displayed imageUrl, not stale r2Url", () => {
  const r = run("generateNode", { imageUrl: "https://new/img.png", r2Url: "https://old/img.png" });
  assert.equal(r.startFrameUrl, "https://new/img.png");
});

test("uploaded image node still prefers durable r2Url", () => {
  const r = run("imageInputNode", { inputImage: "data:image/png;base64,AAA", r2Url: "https://cdn/up.png" });
  assert.equal(r.startFrameUrl, "https://cdn/up.png");
});
