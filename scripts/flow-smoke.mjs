// Live end-to-end check of the Flow providers through the running Anvil API.
// Usage: node scripts/flow-smoke.mjs [--rounds N] [--only <flow name substring>]   (needs `pnpm dev` on :3000)
// Do not touch the Flow tab while this runs.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://localhost:3000";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roundsIndex = process.argv.indexOf("--rounds");
const rounds = roundsIndex > 0 ? Number(process.argv[roundsIndex + 1]) || 1 : 1;
const START_FRAME = "/generated/flow/flow-090e8b7b.jpeg";
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex > 0 ? process.argv[onlyIndex + 1] : "";

async function post(route, body) {
  const res = await fetch(`${BASE}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.taskId) throw new Error(`${route} ${res.status}: ${json.error ?? JSON.stringify(json)}`);
  return json.taskId;
}

async function waitJob(taskId, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const job = await (await fetch(`${BASE}/api/job-status?taskId=${encodeURIComponent(taskId)}`)).json();
    if (job.status === "done") return job;
    if (job.status === "error") throw new Error(job.error);
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`smoke timeout for ${taskId}`);
}

function probe(mediaUrl) {
  if (!mediaUrl) throw new Error("job finished without a media URL");
  const file = path.join(ROOT, "public", mediaUrl.replace(/^\//, ""));
  if (!existsSync(file)) throw new Error(`file missing: ${file}`);
  const out = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" }));
  const stream = out.streams?.find((s) => s.codec_type === "video");
  return { file: path.basename(file), codec: stream?.codec_name, size: `${stream?.width}x${stream?.height}`, duration: Number(stream?.duration ?? out.format?.duration) };
}

function expectImage(mediaUrl) {
  const p = probe(mediaUrl);
  if (!["png", "mjpeg", "webp"].includes(p.codec)) throw new Error(`not an image: codec=${p.codec} ${p.file}`);
  return p;
}

// Catches "downloaded the wrong tile": a generated image must not be our own uploaded start frame.
function psnrAgainstStartFrame(mediaUrl) {
  const file = (u) => path.join(ROOT, "public", u.replace(/^\//, ""));
  const res = spawnSync("ffmpeg", ["-hide_banner", "-i", file(mediaUrl), "-i", file(START_FRAME), "-lavfi",
    "[0]scale=64:36,format=gray[a];[1]scale=64:36,format=gray[b];[a][b]psnr", "-f", "null", "-"], { encoding: "utf8" });
  const m = /average:(inf|[\d.]+)/.exec(res.stderr ?? "");
  return m ? (m[1] === "inf" ? Infinity : Number(m[1])) : 0;
}

function expectVideo(mediaUrl, ratio) {
  const p = probe(mediaUrl);
  if (p.codec !== "h264" || !(p.duration > 0)) throw new Error(`not a real video: codec=${p.codec} duration=${p.duration} ${p.file}`);
  const [w, h] = p.size.split("x").map(Number);
  if (ratio === "9:16" && !(h > w)) throw new Error(`asked 9:16, got ${p.size}: ${p.file}`);
  if (ratio === "16:9" && !(w > h)) throw new Error(`asked 16:9, got ${p.size}: ${p.file}`);
  return p;
}

async function runRound(round) {
  const results = [];
  const record = async (name, fn) => {
    if (only && !name.includes(only)) return null;
    const started = Date.now();
    try {
      const detail = await fn();
      results.push({ round, flow: name, ok: true, secs: Math.round((Date.now() - started) / 1000), detail });
      return detail;
    } catch (error) {
      results.push({ round, flow: name, ok: false, secs: Math.round((Date.now() - started) / 1000), detail: String(error?.message ?? error) });
      return null;
    } finally {
      const last = results.at(-1);
      console.log(`${last.ok ? "PASS" : "FAIL"}  ${last.flow.padEnd(26)} ${String(last.secs).padStart(5)}s  ${JSON.stringify(last.detail)}`);
    }
  };

  const image = await record("image nano-banana-2", async () => {
    const taskId = await post("/api/generate", { model: "flow-nano-banana-2", prompt: "a red fox sitting in fresh snow, soft morning light, photorealistic", aspectRatio: "16:9" });
    const job = await waitJob(taskId, 6 * 60_000);
    const p = expectImage(job.imageUrl);
    const psnr = psnrAgainstStartFrame(job.imageUrl);
    if (psnr > 28) throw new Error(`image is the uploaded start frame (PSNR ${psnr}), wrong tile downloaded: ${p.file}`);
    return { url: job.imageUrl, psnrVsStartFrame: Math.round(psnr), ...p };
  });

  await record("text->video omni", async () => {
    const taskId = await post("/api/generate-video", { videoModel: "flow-omni-flash", prompt: "waves rolling onto a quiet beach at sunset, slow camera push in", aspectRatio: "9:16" });
    const job = await waitJob(taskId, 25 * 60_000);
    return expectVideo(job.videoUrl, "9:16");
  });

  await record("start frame->video omni", async () => {
    const taskId = await post("/api/generate-video", { videoModel: "flow-omni-flash", prompt: "the animal slowly turns its head, snow gently falling", aspectRatio: "16:9", startFrameUrl: START_FRAME });
    const job = await waitJob(taskId, 25 * 60_000);
    return expectVideo(job.videoUrl, "16:9");
  });

  await record("frame A->B veo", async () => {
    const endFrame = image?.url ?? START_FRAME;
    const taskId = await post("/api/generate-video", { videoModel: "flow-veo-interpolation", prompt: "smooth cinematic transition between the two snowy scenes", aspectRatio: "16:9", startFrameUrl: START_FRAME, endFrameUrl: endFrame });
    const job = await waitJob(taskId, 25 * 60_000);
    return expectVideo(job.videoUrl, "16:9");
  });

  return results;
}

const all = [];
for (let round = 1; round <= rounds; round += 1) {
  console.log(`\n=== round ${round}/${rounds} ===`);
  all.push(...await runRound(round));
}
const failed = all.filter((r) => !r.ok);
console.log(`\n${all.length - failed.length}/${all.length} passed`);
process.exitCode = failed.length ? 1 : 0; // exit() with open fetch sockets trips a libuv assert on Windows
