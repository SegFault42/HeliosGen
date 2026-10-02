// Flow image -> Codex edit -> HeyGen video through the real compiler and runner, with a
// fake transport: proves each step's output reaches the next step's payload, no credits.
const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { compilePlan } = require("../lib/workflow-runtime/compiler.ts");
const { createRuntimeStore } = require("../lib/workflow-runtime/store.ts");
const { createRunner } = require("../lib/workflow-runtime/runner.ts");

const space = {
  id: "pipeline", name: "pipeline", createdAt: Date.now(), nodeCounters: {},
  nodes: [
    { id: "p", type: "promptNode", data: { prompt: "a red fox sitting in fresh snow" } },
    { id: "flow", type: "generateNode", data: { model: "flow-nano-banana-2", aspectRatio: "16:9" } },
    { id: "edit", type: "generateNode", data: { model: "gpt-image-2", prompt: "turn it into a watercolor" } },
    { id: "video", type: "videoGeneratorNode", data: { videoModel: "heygen-video-agent", prompt: "A presenter introduces this painting.", aspectRatio: "9:16" } },
  ],
  edges: [
    { id: "e1", source: "p", target: "flow", targetHandle: "prompt" },
    { id: "e2", source: "flow", target: "edit", targetHandle: "image" },
    { id: "e3", source: "edit", target: "video", targetHandle: "resource" },
  ],
};

test("Flow -> Codex -> HeyGen: providers, order, and each output feeding the next step", async () => {
  const { plan, snapshot } = compilePlan(space, { spaceId: "pipeline", outputNodeIds: ["video"], providers: { edit: "codex" }, overrides: {} });
  const byNode = Object.fromEntries(plan.steps.map((s) => [s.nodeId, s]));
  assert.deepEqual([byNode.flow.provider, byNode.edit.provider, byNode.video.provider], ["flow", "codex", "heygen"]);
  assert.deepEqual(byNode.edit.dependsOn, ["flow"]);
  assert.deepEqual(byNode.video.dependsOn, ["edit"]);

  const store = createRuntimeStore(new DatabaseSync(":memory:"));
  store.putPlan(plan, snapshot);
  const outputs = { flow: "/generated/flow/fox.jpg", edit: "/generated/generated/watercolor.png", video: "/generated/videos/presenter.mp4" };
  const submitted = {};
  const transport = {
    async balance() { return 100; },
    async submit(step, payload) { submitted[step.nodeId] = payload; return { taskId: step.nodeId }; },
    async poll(taskId) {
      const url = outputs[taskId];
      return { state: "done", outputs: [{ id: taskId, nodeId: "", kind: taskId === "video" ? "video" : "image", url, mimeType: taskId === "video" ? "video/mp4" : "image/png" }] };
    },
  };
  const run = store.createRun(plan.planId, "req-pipeline", { fingerprint: plan.fingerprint, maxImages: 2, maxVideos: 1, maxVideoSeconds: 60, allowPaid: true, allowPremium: true, acknowledgement: "test" }, new Date());
  const runner = createRunner(store, transport, "boot");
  for (let i = 0; i < 6; i += 1) await runner.tick();

  assert.equal(store.getRun(run.runId).state, "succeeded");
  assert.match(String(submitted.flow.prompt), /red fox/);
  assert.deepEqual(submitted.edit.imageUrls, [outputs.flow], "Codex edits the Flow output");
  assert.equal(submitted.edit.codexProvider, true);
  assert.ok(JSON.stringify(submitted.video).includes(outputs.edit), "HeyGen receives the Codex output");
  assert.equal(submitted.video.videoModel, "heygen-video-agent");
});
