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
const { DatabaseSync } = require("node:sqlite");
const { buildVideoPayload, buildImagePayload } = require("../lib/workflow-runtime/generationPayloads.ts");
const { compilePlan } = require("../lib/workflow-runtime/compiler.ts");
const { createRuntimeStore } = require("../lib/workflow-runtime/store.ts");
const { createProductionTransport } = require("../lib/workflow-runtime/productionTransport.ts");

const inputs = (over = {}) => ({
  prompt: "Follow @rafa.lima", imageUrls: [], imageNodeLabels: [], referenceVideoUrls: [], referenceAudioUrls: [],
  resources: [{ url: "https://x/a.png", label: "a" }, { url: "https://x/b.png", label: "b" }], ...over,
});

for (const videoModel of ["heygen-video-agent", "flow-omni-flash"]) {
  test(`${videoModel}: prompt verbatim, every resource kept`, () => {
    const p = buildVideoPayload({ videoModel }, inputs());
    assert.equal(p.prompt, "Follow @rafa.lima");
    assert.deepEqual(p.referenceImageUrls, ["https://x/a.png", "https://x/b.png"]);
  });
}

test("HeyGen ignores a stale duration", () => {
  assert.equal(buildVideoPayload({ videoModel: "heygen-video-agent", duration: 15 }, inputs()).duration, 0);
});

test("HeyGen node duration 15 passes a 10s approval cap", () => {
  const flow = { id: "h", name: "h", nodes: [
    { id: "p", type: "promptNode", data: { prompt: "hi" } },
    { id: "v", type: "videoGeneratorNode", data: { videoModel: "heygen-video-agent", duration: 15 } }],
    edges: [{ id: "e", source: "p", target: "v", targetHandle: "prompt" }] };
  const { plan } = compilePlan(flow, { spaceId: "h", outputNodeIds: ["v"], providers: {}, overrides: {} });
  const store = createRuntimeStore(new DatabaseSync(":memory:"));
  store.putPlan(plan, { nodes: flow.nodes, edges: flow.edges });
  const run = store.createRun(plan.planId, "r1", { fingerprint: plan.fingerprint, maxImages: 0, maxVideos: 1, maxVideoSeconds: 10, allowPaid: true, acknowledgement: "ok" }, new Date());
  assert.equal(run.steps[0].provider, "heygen");
});

test("image aspect default matches the node (9:16, else first model ratio)", () => {
  assert.equal(buildImagePayload({ model: "nano-banana-2" }, inputs(), "kie").aspectRatio, "9:16");
});

test("default base URL honors PORT", async () => {
  const oldPort = process.env.PORT, oldFetch = global.fetch; let url;
  try {
    process.env.PORT = "41730";
    global.fetch = async (u) => { url = String(u); return Response.json({ data: 1 }); };
    await createProductionTransport().balance();
    assert.match(url, /^http:\/\/127\.0\.0\.1:41730\//);
  } finally { if (oldPort === undefined) delete process.env.PORT; else process.env.PORT = oldPort; global.fetch = oldFetch; }
});
