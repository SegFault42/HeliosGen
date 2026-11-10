const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isOrphanedJob, isInProcessJob, ORPHAN_AFTER_MS } = require("../lib/jobOrphans.ts");

const now = 10_000_000;
const old = now - ORPHAN_AFTER_MS - 1;

test("old pending in-process jobs are orphans", () => {
  for (const id of ["codex-1-a", "azure-1-a", "grok-img-1-a"]) assert.equal(isOrphanedJob(id, old, now), true);
});
test("recent in-process jobs are not orphans", () => {
  assert.equal(isOrphanedJob("codex-1-a", now - 60_000, now), false);
  assert.equal(isOrphanedJob("azure-1-a", now - ORPHAN_AFTER_MS, now), false);
});
test("resumable pollers are never orphans", () => {
  for (const id of ["heygen-agent:x", "flow-video:x", "flow-image:x", "abc123kie"]) {
    assert.equal(isInProcessJob(id), false);
    assert.equal(isOrphanedJob(id, old, now), false);
  }
});
test("missing ts is not settled", () => assert.equal(isOrphanedJob("codex-1", undefined, now), false));
test("timeout covers generate maxDuration (1000s)", () => assert.ok(ORPHAN_AFTER_MS > 1_000_000));
