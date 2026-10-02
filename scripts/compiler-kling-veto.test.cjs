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
const { compilePlan } = require("../lib/workflow-runtime/compiler.ts");
const { WorkflowRuntimeError } = require("../lib/workflow-runtime/contracts.ts");

test("compilePlan: kling videoModel fails at compile time instead of submitting", () => {
  const graph = {
    id: "test-kling", name: "Kling veto",
    nodes: [
      { id: "v", type: "videoGeneratorNode", data: { videoModel: "kling-3.0", duration: 5 } },
    ],
    edges: [],
  };
  assert.throws(
    () => compilePlan(graph, { spaceId: "test-kling", outputNodeIds: ["v"], providers: {}, overrides: {} }),
    (e) => {
      assert.ok(e instanceof WorkflowRuntimeError);
      assert.ok(e.errors.some((err) => err.code === "invalid_model" && /kling-3\.0/.test(err.message)));
      return true;
    },
  );
});
