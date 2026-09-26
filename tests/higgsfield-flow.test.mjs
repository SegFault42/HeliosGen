import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mockState = { submits: [], polls: new Map() };
const mock = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "POST" && url.pathname === "/bytedance/seedance-2.0/text-to-video") {
    assert.equal(req.headers.authorization, "Key test-id:test-secret");
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    mockState.submits.push(input);
    if (input.prompt === "rate limit") {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "Rate limit" }));
      return;
    }
    const requestId = `request-${mockState.submits.length}`;
    mockState.polls.set(requestId, 0);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ request_id: requestId, status: "queued", status_url: `/requests/${requestId}/status` }));
    return;
  }
  const status = url.pathname.match(/^\/requests\/(request-\d+)\/status$/);
  if (req.method === "GET" && status) {
    const count = (mockState.polls.get(status[1]) ?? 0) + 1;
    mockState.polls.set(status[1], count);
    const input = mockState.submits[Number(status[1].split("-")[1]) - 1];
    const state = count === 1 ? "queued" : count === 2 ? "in_progress" : input.prompt === "fail" ? "failed" : "completed";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ request_id: status[1], status: state, ...(state === "completed" ? { video: { url: `http://127.0.0.1:${mock.address().port}/video.mp4` } } : {}) }));
    return;
  }
  if (url.pathname === "/video.mp4") {
    res.writeHead(200, { "Content-Type": "video/mp4" });
    res.end(Buffer.from("mock video"));
    return;
  }
  res.writeHead(404);
  res.end();
});

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(url) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await pause(250);
  }
  throw new Error("HeliosGen did not start");
}

async function waitForJob(base, taskId) {
  for (let i = 0; i < 60; i++) {
    const result = await fetch(`${base}/api/job-status?taskId=${taskId}`).then((r) => r.json());
    if (result.status !== "pending") return result;
    await pause(300);
  }
  throw new Error("Job did not settle");
}

test("Higgsfield credentials, payload, polling, errors and Kie selection", async () => {
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const dataDir = await mkdtemp(join(tmpdir(), "heliosgen-hf-test-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port)], {
    cwd: process.cwd(), env: { ...process.env, HELIOS_DATA_DIR: dataDir, HF_API_BASE_URL: `http://127.0.0.1:${mock.address().port}`, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: "ignore",
  });
  try {
    await waitFor(`${base}/api/settings/higgsfield-key`);
    const status = () => fetch(`${base}/api/settings/higgsfield-key`).then((r) => r.json());
    assert.deepEqual(await status(), { hasToken: false });
    const save = await fetch(`${base}/api/settings/higgsfield-key`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyId: "test-id", keySecret: "test-secret" }),
    });
    assert.equal(save.status, 200);
    assert.deepEqual(await status(), { hasToken: true });

    const generate = (prompt, provider = "higgsfield") => fetch(`${base}/api/generate-video`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoModel: "seedance-2", provider, prompt, duration: 5, resolution: "720p", aspectRatio: "16:9", sound: true }),
    });
    const started = await generate("success");
    assert.equal(started.status, 200);
    const { taskId } = await started.json();
    assert.match(taskId, /^higgsfield-/);
    const done = await waitForJob(base, taskId);
    assert.equal(done.status, "done");
    assert.match(done.videoUrl, /^(\/generated\/videos\/|http:\/\/127\.0\.0\.1:)/);
    assert.deepEqual(mockState.submits[0], { prompt: "success", duration: 5, resolution: "720p", aspect_ratio: "16:9", generate_audio: true });
    assert.ok(mockState.polls.get("request-1") >= 3);

    const failed = await generate("fail");
    assert.equal((await waitForJob(base, (await failed.json()).taskId)).status, "error");
    const rate = await generate("rate limit");
    assert.match((await waitForJob(base, (await rate.json()).taskId)).error, /rate limit/i);
    assert.equal(mockState.submits.filter((item) => item.prompt === "rate limit").length, 1);

    const kie = await generate("success", "kie");
    assert.equal(kie.status, 401); // No Kie key in this isolated test data directory.
    assert.match((await kie.json()).error, /Kie.ai/);

    await fetch(`${base}/api/settings/higgsfield-key`, { method: "DELETE" });
    assert.deepEqual(await status(), { hasToken: false });
    assert.equal((await generate("success")).status, 400);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await new Promise((resolve) => mock.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
