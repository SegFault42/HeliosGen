// Omni Flash video edit (character/object swap): reference ordering + model handles.
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/")) request = path.join(ROOT, request.slice(2));
  return originalResolve.call(this, request, ...rest);
};
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
};

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { orderFlowReferences, shouldUseReadThis } = require("../lib/flowAdapter.ts");
const { VIDEO_MODELS, isVetoedVideoModel } = require("../lib/modelConfig.ts");

test("orderFlowReferences: source video first, then frames, then images, no duplicates", () => {
  assert.deepEqual(
    orderFlowReferences(["/v.mp4"], ["/start.png"], ["/sheet.png", "/start.png"]),
    ["/v.mp4", "/start.png", "/sheet.png"],
  );
  assert.deepEqual(orderFlowReferences([], [], ["/a.png"]), ["/a.png"]);
});

test("video edit never turns the prompt into a read-this screenshot", () => {
  const long = "swap ".repeat(80);
  // hasFrames=true is what submitFlowVideo passes while editing a video
  assert.equal(shouldUseReadThis("Omni Flash", long, undefined, true), false);
});

test("flow-omni-flash exposes one reference video and up to 3 look images", () => {
  const m = VIDEO_MODELS.find((x) => x.id === "flow-omni-flash");
  assert.ok(m.handles.includes("referenceVideo"));
  assert.ok(m.handles.includes("resource"));
  assert.equal(m.maxReferenceVideos, 1);
  assert.equal(m.maxResources, 3);
  assert.equal(m.apiInput.useFlow, true);
  assert.equal(isVetoedVideoModel("flow-omni-flash", {}), false);
});

// ── Rights declaration: only an explicit, clip-specific yes reaches Flow ──────
const { needsVideoRights, videoRightsAffirmed, videoRightsKey } = require("../lib/videoRights.ts");
const { buildVideoPayload } = require("../lib/workflow-runtime/generationPayloads.ts");

const videoInputs = (referenceVideoUrls) => ({
  prompt: "swap the man", imageUrls: [], imageNodeLabels: [], resources: [],
  referenceVideoUrls, referenceAudioUrls: [],
});

test("only a Flow model with a reference video needs the declaration", () => {
  assert.equal(needsVideoRights("flow-omni-flash", ["/v.mp4"]), true);
  assert.equal(needsVideoRights("flow-omni-flash", []), false);
  assert.equal(needsVideoRights("seedance-2", ["/v.mp4"]), false);
  assert.equal(needsVideoRights("no-such-model", ["/v.mp4"]), false);
});

test("a declaration holds only for the clip it was made for", () => {
  const made = videoRightsKey(["/v.mp4"]);
  assert.equal(videoRightsAffirmed(made, ["/v.mp4"]), true);
  assert.equal(videoRightsAffirmed(made, ["/other.mp4"]), false);
  assert.equal(videoRightsAffirmed(undefined, ["/v.mp4"]), false);
  assert.equal(videoRightsAffirmed("", []), false);
});

test("the payload carries affirmVideoRights only after the user declared it for that clip", () => {
  const node = (videoRightsAffirmedFor) => ({ videoModel: "flow-omni-flash", videoRightsAffirmedFor });
  assert.equal(buildVideoPayload(node(videoRightsKey(["/v.mp4"])), videoInputs(["/v.mp4"])).affirmVideoRights, true);
  assert.equal("affirmVideoRights" in buildVideoPayload(node(undefined), videoInputs(["/v.mp4"])), false);
  assert.equal("affirmVideoRights" in buildVideoPayload(node(videoRightsKey(["/old.mp4"])), videoInputs(["/v.mp4"])), false);
  // a model that does not go through Flow never sends it, whatever the node holds
  assert.equal("affirmVideoRights" in buildVideoPayload({ videoModel: "seedance-2", videoRightsAffirmedFor: videoRightsKey(["/v.mp4"]) }, videoInputs(["/v.mp4"])), false);
});
