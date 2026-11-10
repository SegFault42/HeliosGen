const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { decideWave } = require("../lib/pipelineWait.ts");

test("upstream image node failed before ever going pending: stop, not hang", () => {
  assert.equal(decideWave([{ status: "error", pendingGenerate: false }], false, true), "stop");
});
test("freshly triggered wave (pendingGenerate set) keeps waiting even with stale error", () => {
  assert.equal(decideWave([{ status: "error", pendingGenerate: true }], false, true), "wait");
});
test("idle nodes before activation wait", () => {
  assert.equal(decideWave([{ status: "idle" }], false, true), "wait");
});
test("running wave waits", () => {
  assert.equal(decideWave([{ status: "running" }, { status: "done" }], true, true), "wait");
});
test("wave that failed after running stops before downstream wave", () => {
  assert.equal(decideWave([{ status: "error" }, { status: "done" }], true, true), "stop");
});
test("clean wave advances; failed last wave just finishes", () => {
  assert.equal(decideWave([{ status: "done" }], true, true), "advance");
  assert.equal(decideWave([{ status: "error" }], true, false), "advance");
});
test("deleted node does not block", () => {
  assert.equal(decideWave([undefined], true, false), "advance");
});
