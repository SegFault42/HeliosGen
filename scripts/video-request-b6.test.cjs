const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const v = require("../lib/videoRequest.ts");
const { VIDEO_MODELS } = require("../lib/modelConfig.ts");

test("asUrlList / asUrl / asResources / asKlingElements are null-safe", () => {
  assert.deepEqual(v.asUrlList(null), []);
  assert.deepEqual(v.asUrlList("x"), []);
  assert.deepEqual(v.asUrlList(["a", null, 3, ""]), ["a"]);
  assert.equal(v.asUrl(null), undefined);
  assert.equal(v.asUrl(""), undefined);
  assert.equal(v.asUrl("u"), "u");
  assert.deepEqual(v.asResources(null), []);
  assert.deepEqual(v.asResources([null, { url: "u" }]), [{ url: "u", label: "" }]);
  assert.deepEqual(v.asKlingElements([{ name: "n", imageUrls: null }, { name: "k", imageUrls: ["a"] }]),
    [{ name: "k", description: "", imageUrls: ["a"] }]);
});

test("flowUpscale honors the picked resolution", () => {
  assert.equal(v.flowUpscale("720p", { defaultResolution: "1080p" }), "none");
  assert.equal(v.flowUpscale(undefined, { defaultResolution: "1080p" }), "1080p");
  assert.equal(v.flowUpscale("1080p", { defaultResolution: "720p" }), "1080p");
  assert.equal(v.flowUpscale(undefined, {}), "none");
});

test("interpolation model requires both frames", () => {
  const cfg = VIDEO_MODELS.find((m) => m.id === "flow-veo-interpolation");
  assert.ok(cfg.apiInput.isInterpolation);
  assert.match(v.interpolationError(cfg, undefined, undefined), /start frame and an end frame/);
  assert.ok(v.interpolationError(cfg, "a", undefined));
  assert.ok(v.interpolationError(cfg, undefined, "b"));
  assert.equal(v.interpolationError(cfg, "a", "b"), null);
  const other = VIDEO_MODELS.find((m) => !m.apiInput.isInterpolation);
  assert.equal(v.interpolationError(other, undefined, undefined), null);
});
