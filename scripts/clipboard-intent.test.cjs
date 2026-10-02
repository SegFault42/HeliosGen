const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { NODES_MIME, shouldHandleCopy, resolvePasteIntent } = require("../lib/clipboardIntent.ts");

test("copy is native while typing or with a text selection", () => {
  assert.equal(shouldHandleCopy({ typing: true, hasTextSelection: false, hasSelectedNodes: true }), false);
  assert.equal(shouldHandleCopy({ typing: false, hasTextSelection: true, hasSelectedNodes: true }), false);
  assert.equal(shouldHandleCopy({ typing: false, hasTextSelection: false, hasSelectedNodes: false }), false);
  assert.equal(shouldHandleCopy({ typing: false, hasTextSelection: false, hasSelectedNodes: true }), true);
});

test("paste: nodes need the custom type and stored nodes", () => {
  assert.equal(resolvePasteIntent({ types: [NODES_MIME], text: "", hasNodes: true }), "nodes");
  assert.equal(resolvePasteIntent({ types: [NODES_MIME], text: "", hasNodes: false }), "none");
  assert.equal(resolvePasteIntent({ types: ["text/plain"], text: "hello", hasNodes: true }), "text");
  assert.equal(resolvePasteIntent({ types: [], text: "  ", hasNodes: true }), "none");
});

test("regression: the old sentinel string pastes as plain text", () => {
  assert.equal(resolvePasteIntent({ types: ["text/plain"], text: "__rf_nodes_1789973644127__", hasNodes: true }), "text");
});

test("copy never writes text/plain", () => {
  const src = fs.readFileSync(require.resolve("../components/WorkflowCanvas.tsx"), "utf8");
  assert.ok(!/setData\(\s*["']text\/plain/.test(src));
  assert.ok(!/__rf_nodes_/.test(src));
  assert.ok(!/clipboard\.writeText/.test(src));
});
