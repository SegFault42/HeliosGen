// Compile local TypeScript modules for behavioral tests without a Next server.
const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

const { composeSplitReaction } = require("../lib/composeSplit.ts");
const { makeSplitReactionTemplate } = require("../lib/templates.ts");

async function ffprobeJson(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", file,
  ]);
  return JSON.parse(stdout);
}

async function makeSyntheticInputs(dir) {
  const reactionPath = path.join(dir, "reaction.mp4");
  const demoPath = path.join(dir, "demo.mp4");

  // Reaction: 6s, 720x1280, has audio (sine).
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    reactionPath,
  ]);

  // Demo: 5s, 1920x1080, NO audio track.
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30:duration=5",
    "-an",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    demoPath,
  ]);

  return { reactionPath, demoPath };
}

test("composeSplitReaction: hard cut at 4s, normalizes to 1080x1920, always has audio", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "compose-split-test-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const { reactionPath, demoPath } = await makeSyntheticInputs(dir);
  const outPath = path.join(dir, "out.mp4");

  const result = await composeSplitReaction({
    reactionPath,
    demoPath,
    outPath,
    reactionSeconds: 4,
    overlayText: "Olha isso: resultado real",
  });

  assert.equal(result.cutAtSec, 4);
  assert.ok(fs.existsSync(outPath));

  const probe = await ffprobeJson(outPath);
  const vStream = probe.streams.find((s) => s.codec_type === "video");
  const aStreams = probe.streams.filter((s) => s.codec_type === "audio");

  assert.equal(vStream.width, 1080);
  assert.equal(vStream.height, 1920);
  assert.equal(aStreams.length, 1);

  const duration = parseFloat(probe.format.duration);
  assert.ok(Math.abs(duration - 9) < 0.3, `expected ~9s, got ${duration}`);
  assert.ok(Math.abs(result.durationSec - 9) < 0.3, `expected ~9s, got ${result.durationSec}`);
});

test("composeSplitReaction: reactionSeconds clamps to the 3..5 range", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "compose-split-clamp-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const { reactionPath, demoPath } = await makeSyntheticInputs(dir);
  const outPath = path.join(dir, "out-clamp.mp4");

  const result = await composeSplitReaction({
    reactionPath,
    demoPath,
    outPath,
    reactionSeconds: 10,
  });

  assert.equal(result.cutAtSec, 5);
});

test("makeSplitReactionTemplate: edges reference existing nodes, no kling model", () => {
  const { nodes, edges } = makeSplitReactionTemplate();
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    assert.ok(ids.has(e.source), `edge source ${e.source} missing from nodes`);
    assert.ok(ids.has(e.target), `edge target ${e.target} missing from nodes`);
  }
  for (const n of nodes) {
    const model = (n.data && (n.data.model || n.data.videoModel)) || "";
    assert.ok(!/kling/i.test(String(model)), `node ${n.id} uses a kling model: ${model}`);
  }
});
