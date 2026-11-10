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

const { composeSplitReaction, resolveComposeInput } = require("../lib/composeSplit.ts");
const { makeSplitReactionTemplate } = require("../lib/templates.ts");
const { MEDIA_DIR } = require("../lib/guest/paths.ts");

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

test("composeSplitReaction: cuts to the reaction's actual duration when it is shorter than requested, and audio-less reaction stays in sync", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "compose-split-short-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const reactionPath = path.join(dir, "reaction-short.mp4");
  const demoPath = path.join(dir, "demo-short.mp4");

  // Reaction: only 3s, NO audio track (shorter than the requested 5s window).
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30:duration=3",
    "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    reactionPath,
  ]);
  // Demo: 5s, with audio.
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30:duration=5",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    demoPath,
  ]);

  const outPath = path.join(dir, "out-short.mp4");
  const result = await composeSplitReaction({
    reactionPath,
    demoPath,
    outPath,
    reactionSeconds: 5,
  });

  assert.equal(result.cutAtSec, 3, "cut must not exceed the reaction's real duration");
  assert.ok(Math.abs(result.durationSec - 8) < 0.3, `expected ~8s, got ${result.durationSec}`);

  const probe = await ffprobeJson(outPath);
  const duration = parseFloat(probe.format.duration);
  assert.ok(Math.abs(duration - 8) < 0.3, `expected ~8s of actual output, got ${duration}`);
});

test("composeSplitReaction: overlayText with XML-special characters renders without error", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "compose-split-xml-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const { reactionPath, demoPath } = await makeSyntheticInputs(dir);
  const outPath = path.join(dir, "out-xml.mp4");

  const result = await composeSplitReaction({
    reactionPath,
    demoPath,
    outPath,
    reactionSeconds: 3,
    overlayText: `<script>&"'alert(1)'"&</script>`,
  });

  assert.ok(fs.existsSync(outPath));
  assert.equal(result.cutAtSec, 3);
});

test("resolveComposeInput: only accepts an existing /generated/... file, never an arbitrary path", async (t) => {
  const relDir = "compose-split-test-tmp";
  const dir = path.join(MEDIA_DIR, relDir);
  await fs.promises.mkdir(dir, { recursive: true });
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));

  const filePath = path.join(dir, "ok.mp4");
  await fs.promises.writeFile(filePath, "not really a video, just bytes");

  assert.equal(resolveComposeInput(`/generated/${relDir}/ok.mp4`), filePath);
  assert.equal(resolveComposeInput(`http://localhost:3000/generated/${relDir}/ok.mp4`), filePath, "anvil sends the absolute localhost form");
  assert.equal(resolveComposeInput(filePath), null, "absolute local paths must be rejected");
  assert.equal(resolveComposeInput("/etc/passwd"), null, "non-/generated URLs must be rejected");
  assert.equal(resolveComposeInput(`/generated/${relDir}/missing.mp4`), null, "missing files must be rejected");
  assert.equal(resolveComposeInput(`/generated/${relDir}`), null, "directories must be rejected");
  assert.equal(resolveComposeInput("/generated/../../etc/passwd"), null, "path traversal must be rejected");
  assert.equal(resolveComposeInput(""), null);
  assert.equal(resolveComposeInput(undefined), null);
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
