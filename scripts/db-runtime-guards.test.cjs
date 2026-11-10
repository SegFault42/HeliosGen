// Guards around: (1) spaces.ts/db.ts transactions leaving the shared SQLite
// connection stuck mid-transaction, (2) an empty full workflow save wiping
// everything, (3) paid-provider steps running without approval.
const ts = require("typescript");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");

// Point DATA_DIR/MEDIA_DIR at a temp dir before lib/guest/paths.ts is loaded.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "db-runtime-guards-"));
process.env.HELIOS_DATA_DIR = path.join(TMP, "data");
process.env.HELIOS_MEDIA_DIR = path.join(TMP, "media");
fs.mkdirSync(process.env.HELIOS_MEDIA_DIR, { recursive: true });

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) {
    request = path.join(ROOT, request.slice(2));
  }
  return originalResolve.call(this, request, ...rest);
};

require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, filename);
};

const { test } = require("node:test");
const assert = require("node:assert/strict");

// ── 1 & 2: PUT /api/workflows transaction/validation guards ────────────────

function putRequest(body) {
  return new Request("http://localhost:3000/api/workflows", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("PUT /api/workflows: a failing save (bad space) is refused with 400 and does not stick the connection", async () => {
  const { PUT, GET } = require("../app/api/workflows/route.ts");

  const bad = await PUT(putRequest({ spaces: [null] }));
  assert.equal(bad.status, 400);

  const good = { id: "s1", name: "Real space", nodes: [], edges: [], nodeCounters: {}, createdAt: Date.now() };
  const ok = await PUT(putRequest({ spaces: [good] }));
  assert.equal(ok.status, 200);

  const { spaces } = await (await GET()).json();
  assert.deepEqual(spaces.map((s) => s.id), ["s1"]);
});

test("PUT /api/workflows: empty spaces[] without partial is refused (would delete everything)", async () => {
  const { PUT, GET } = require("../app/api/workflows/route.ts");

  const res = await PUT(putRequest({ spaces: [] }));
  assert.equal(res.status, 400);

  // The space from the previous test (shared temp DB) must still be there.
  const { spaces } = await (await GET()).json();
  assert.deepEqual(spaces.map((s) => s.id), ["s1"]);
});

test("PUT /api/workflows: empty spaces[] with partial:true is accepted as a no-op", async () => {
  const { PUT } = require("../app/api/workflows/route.ts");
  const res = await PUT(putRequest({ spaces: [], partial: true }));
  assert.equal(res.status, 200);
});

// ── 3: runner approval gate applies to every paid provider ─────────────────

const { DatabaseSync } = require("node:sqlite");
const { createRuntimeStore } = require("../lib/workflow-runtime/store.ts");
const { createRunner } = require("../lib/workflow-runtime/runner.ts");

function makePlan(provider) {
  const nodeId = "v";
  const nodes = [{ id: nodeId, type: "videoGeneratorNode", data: { videoModel: "seedance-2", duration: 5 } }];
  const snapshot = { id: "test", name: "test", nodes, edges: [], nodeCounters: {}, createdAt: Date.now(), providers: {}, outputNodeIds: [nodeId] };
  const step = { nodeId, kind: "video", model: "seedance-2", provider, dependsOn: [], payloadPreview: {} };
  const plan = { planId: "plan-" + provider, fingerprint: "fp-" + provider, spaceId: "test", spaceName: "test", steps: [step], warnings: [], expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  return { plan, snapshot };
}

const noopTransport = {
  async balance() { return 100; },
  async submit() { throw new Error("should not submit without approval"); },
  async poll() { return { state: "pending", outputs: [] }; },
};

for (const provider of ["kie", "heygen", "flow", "grok"]) {
  test(`runner: paid provider '${provider}' is blocked without allowPaid approval`, async () => {
    const db = new DatabaseSync(":memory:");
    const store = createRuntimeStore(db);
    const { plan, snapshot } = makePlan(provider);
    store.putPlan(plan, snapshot);
    const run = store.createRun(plan.planId, "req-" + provider, { fingerprint: plan.fingerprint, maxImages: 0, maxVideos: 1, maxVideoSeconds: 5, allowPaid: false, allowPremium: false, acknowledgement: "test" }, new Date());
    const runner = createRunner(store, noopTransport, "test-boot");
    await runner.tick();
    const finished = store.getRun(run.runId);
    assert.equal(finished.steps[0].state, "reconciliation_required");
    assert.equal(finished.steps[0].error, "paid_provider_not_approved");
    db.close();
  });
}

test("runner: heygen-video-agent spends premium credits, so it still needs allowPaid", async () => {
  const db = new DatabaseSync(":memory:");
  const store = createRuntimeStore(db);
  const { plan, snapshot } = makePlan("heygen");
  plan.planId += "-heygen-video-agent";
  plan.steps[0].model = "heygen-video-agent";
  snapshot.nodes[0] = { id: "v", type: "videoGeneratorNode", data: { videoModel: "heygen-video-agent", duration: 5 } };
  store.putPlan(plan, snapshot);
  const run = store.createRun(plan.planId, "req-heygen-agent", { fingerprint: plan.fingerprint, maxImages: 0, maxVideos: 1, maxVideoSeconds: 5, allowPaid: false, allowPremium: false, acknowledgement: "test" }, new Date());
  await createRunner(store, noopTransport, "test-boot").tick();
  assert.equal(store.getRun(run.runId).steps[0].error, "paid_provider_not_approved");
  db.close();
});

for (const [provider, model, kind] of [["flow", "flow-omni-flash", "video"], ["flow", "flow-nano-banana-2", "image"], ["grok", "grok-imagine", "image"]]) {
  test(`runner: approved free ${provider}/${model} runs with allowPaid=false`, async () => {
    const db = new DatabaseSync(":memory:");
    const store = createRuntimeStore(db);
    const { plan, snapshot } = makePlan(provider);
    plan.planId += "-" + model;
    plan.steps[0].model = model;
    plan.steps[0].kind = kind;
    snapshot.nodes[0] = { id: "v", type: kind === "image" ? "generateNode" : "videoGeneratorNode", data: kind === "image" ? { model } : { videoModel: model, duration: 5 } };
    store.putPlan(plan, snapshot);
    const submitted = [];
    const transport = { ...noopTransport, async submit(step) { submitted.push(step); return { taskId: "free-task" }; } };
    const run = store.createRun(plan.planId, "req-free-" + model, { fingerprint: plan.fingerprint, maxImages: 1, maxVideos: 1, maxVideoSeconds: 5, allowPaid: false, allowPremium: false, acknowledgement: "Approved concrete plan" }, new Date());
    await createRunner(store, transport, "test-boot").tick();
    assert.equal(submitted.length, 1);
    assert.equal(store.getRun(run.runId).steps[0].state, "pending");
    db.close();
  });
}

test("runner: 'codex' provider runs without allowPaid approval (not billed through us)", async () => {
  const db = new DatabaseSync(":memory:");
  const store = createRuntimeStore(db);
  const { plan, snapshot } = makePlan("codex");
  store.putPlan(plan, snapshot);
  const submitted = [];
  const transport = { async balance() { return 100; }, async submit(step, payload) { submitted.push({ step, payload }); return { taskId: "t1" }; }, async poll() { return { state: "pending", outputs: [] }; } };
  const run = store.createRun(plan.planId, "req-codex", { fingerprint: plan.fingerprint, maxImages: 0, maxVideos: 1, maxVideoSeconds: 5, allowPaid: false, allowPremium: false, acknowledgement: "test" }, new Date());
  const runner = createRunner(store, transport, "test-boot");
  await runner.tick();
  assert.equal(submitted.length, 1);
  const finished = store.getRun(run.runId);
  assert.equal(finished.steps[0].state, "pending");
  db.close();
});
