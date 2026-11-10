// B4: job events emitter must be shared across separately-bundled module copies.
const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require.resolve("../lib/jobEvents.ts");

test("two separately-loaded copies of jobEvents share one emitter", () => {
  const a = require(path);
  delete require.cache[path];
  const b = require(path);
  assert.notEqual(a, b, "must be distinct module instances");
  assert.equal(a.jobEvents, b.jobEvents);
  let got;
  b.jobEvents.once("job:x", (p) => { got = p; });
  a.jobEvents.emit("job:x", { status: "done" });
  assert.deepEqual(got, { status: "done" });
});

test("stream budget covers Flow (20 min) and HeyGen (~22 min)", () => {
  const { JOB_STREAM_BUDGET_MS } = require(path);
  const { FLOW_VIDEO_DEADLINE_MS } = require("../lib/flowPollPolicy.ts");
  assert.ok(JOB_STREAM_BUDGET_MS >= 25 * 60_000);
  assert.ok(JOB_STREAM_BUDGET_MS > FLOW_VIDEO_DEADLINE_MS);
});
