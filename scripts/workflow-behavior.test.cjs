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
const { compilePlan } = require("../lib/workflow-runtime/compiler.ts");
const { createRuntimeStore } = require("../lib/workflow-runtime/store.ts");
const { createRunner } = require("../lib/workflow-runtime/runner.ts");
const { createProductionTransport } = require("../lib/workflow-runtime/productionTransport.ts");

test("transport accepts actual numeric Kie balance and recognizes lost tasks", async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => Response.json({code:200,msg:"success",data:394.5});
    const transport = createProductionTransport();
    assert.equal(await transport.balance(),394.5);
    global.fetch = async () => Response.json({status:"not_found"});
    assert.equal((await transport.poll("missing")).state,"not_found");
  } finally { global.fetch = original; }
});

test("transport reports the MIME type of a completed PNG image", async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => Response.json({ status: "done", imageUrl: "/generated/generated/a.png" });
    const result = await createProductionTransport().poll("image-task");
    assert.equal(result.outputs[0].mimeType, "image/png");
  } finally { global.fetch = original; }
});

test("transport: a status read that times out or drops is transient, not a failure", async () => {
  const original = global.fetch;
  try {
    global.fetch = async (_url, init) => {
      assert.ok(init?.signal, "status read must carry a timeout signal");
      throw new DOMException("timed out", "TimeoutError");
    };
    assert.equal((await createProductionTransport().poll("slow-task")).state, "pending");
  } finally { global.fetch = original; }
});

test("Omni Flash plan uses the observed fixed 10-second duration", () => {
  const flow = {
    id: "flow-duration", name: "Flow duration",
    nodes: [
      { id: "prompt", type: "promptNode", data: { prompt: "Paper boat" } },
      { id: "video", type: "videoGeneratorNode", data: { videoModel: "flow-omni-flash", duration: 5 } },
    ],
    edges: [{ id: "e", source: "prompt", target: "video", targetHandle: "prompt" }],
  };
  const { plan } = compilePlan(flow, { spaceId: flow.id, outputNodeIds: ["video"], providers: {}, overrides: {} });
  assert.equal(plan.steps[0].payloadPreview.duration, 10);
});

const graph = {
  id: "test", name: "Test only",
  nodes: [
    { id: "p", type: "promptNode", data: {prompt: "old prompt"} },
    { id: "i", type: "generateNode", data: {model: "nano-banana-pro", imageUrl:"https://stale/image.png"} },
    { id: "v", type: "videoGeneratorNode", data: {videoModel:"seedance-2", duration:5} },
  ],
  edges: [
    {id:"a",source:"p",target:"i",targetHandle:"prompt"},
    {id:"b",source:"i",target:"v",targetHandle:"startFrame"},
  ],
};
test("review and snapshot both contain the edited prompt", () => {
  const {plan,snapshot} = compilePlan(graph, {spaceId:"test",outputNodeIds:["v"],providers:{i:"kie"},overrides:{p:{prompt:"new prompt"}}});
  assert.equal(plan.steps[0].payloadPreview.prompt, "new prompt");
  assert.equal(snapshot.nodes.find(n=>n.id==="p").data.prompt,"new prompt");
  assert.equal(graph.nodes[0].data.prompt,"old prompt");
});

test("image output feeds video and successful run is persisted; concurrent ticks do not duplicate submission", async () => {
  const db = new DatabaseSync(":memory:");
  const store = createRuntimeStore(db);
  const {plan,snapshot} = compilePlan(graph, {spaceId:"test",outputNodeIds:["v"],providers:{i:"kie"},overrides:{}});
  store.putPlan(plan,snapshot);
  const run = store.createRun(plan.planId,"request", {fingerprint:plan.fingerprint,maxImages:1,maxVideos:1,maxVideoSeconds:5,allowPaid:true,allowPremium:false,acknowledgement:"test"},new Date());
  const submitted = [];
  const transport = {
    async balance(){return 100;},
    async submit(step,payload){submitted.push({step,payload}); return {taskId:step.nodeId};},
    async poll(id){return {state:"done",outputs:[{id,nodeId:"",kind:id==="i"?"image":"video",url:"https://fresh/"+id,mimeType:id==="i"?"image/png":"video/mp4"}]};}
  };
  const runner = createRunner(store,transport,"test-boot");
  await Promise.all([runner.tick(),runner.tick()]);
  assert.equal(submitted.length,1);
  await runner.tick();
  assert.equal(submitted.length,2);
  assert.equal(submitted[1].payload.startFrameUrl,"https://fresh/i");
  await runner.tick();
  const finished = store.getRun(run.runId);
  assert.equal(finished.state,"succeeded");
  assert.deepEqual(finished.outputs.map(o=>o.nodeId),["i","v"]);
  await runner.tick();
  assert.equal(submitted.length,2);
  db.close();
});
