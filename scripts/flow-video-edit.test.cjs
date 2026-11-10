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

// ── Omni Flash 1.2 next to 1.1 ───────────────────────────────────────────────
const { isOmniFlash } = require("../lib/flowAdapter.ts");

// Copy of the engine's model matching (google-flow-mcp, capabilities.ts): the retirement
// badge is dropped from a name, then exact normalized name first, else the single picker
// option holding every requested word.
const flowId = (s) => s.toLowerCase().replace(/leaving +[a-z]{3,9}[.]? +[0-9]{1,2}/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function matchFlowModel(labels, requested) {
  const options = labels.map((label) => ({ label, id: flowId(label) }));
  const id = flowId(requested);
  const exact = options.find((o) => o.id === id);
  if (exact) return exact.label;
  const words = id.split("-").filter(Boolean);
  const candidates = options.filter((o) => { const have = new Set(o.id.split("-")); return words.every((w) => have.has(w)); });
  return candidates.length === 1 ? candidates[0].label : null;
}

// Flow's model pickers as read from a live account on 2026-11-10.
const FLOW_VIDEO = ["Omni 1.2 Flash", "Omni 1.1 Flash Leaving Dec 5", "Veo 3.1 - Lite", "Veo 3.1 - Fast Leaving Dec 5", "Veo 3.1 - Quality Leaving Dec 5"];
const FLOW_IMAGE = ["Nano Banana Pro", "Nano Banana 2 Lite", "Nano Banana 2.1"];

test("Omni Flash runs 1.2, and names the version while Flow still lists 1.1", () => {
  const omni = VIDEO_MODELS.find((x) => x.id === "flow-omni-flash");
  assert.equal(matchFlowModel(FLOW_VIDEO, omni.apiInput.flowModel), "Omni 1.2 Flash");
  assert.equal(matchFlowModel(FLOW_VIDEO, "Omni Flash"), null, "a bare name is ambiguous until 1.1 is gone");
});

test("no Flow model ANVIL offers is one Flow is retiring", () => {
  const retiring = FLOW_VIDEO.filter((label) => label.includes("Leaving"));
  assert.equal(retiring.length, 3);
  for (const m of VIDEO_MODELS.filter((x) => x.apiInput.useFlow)) {
    assert.ok(!retiring.includes(matchFlowModel(FLOW_VIDEO, m.apiInput.flowModel)), m.id);
  }
});

test("every Flow model ANVIL offers exists in Flow's picker", () => {
  const { IMAGE_MODELS } = require("../lib/modelConfig.ts");
  for (const [models, picker] of [[VIDEO_MODELS, FLOW_VIDEO], [IMAGE_MODELS, FLOW_IMAGE]]) {
    for (const m of models.filter((x) => x.apiInput.useFlow)) {
      assert.notEqual(matchFlowModel(picker, m.apiInput.flowModel), null, m.id + " asks for " + m.apiInput.flowModel);
    }
  }
});

test("the read-this heuristic covers every Omni Flash name and nothing else", () => {
  for (const name of ["Omni Flash", "Omni 1.1 Flash", "Omni 1.2 Flash"]) assert.equal(isOmniFlash(name), true, name);
  for (const name of ["Veo 3.1 - Fast", "Nano Banana 2", "Gemini Omni Video"]) assert.equal(isOmniFlash(name), false, name);
  const long = "swap ".repeat(80);
  assert.equal(shouldUseReadThis("Omni 1.2 Flash", long), true);
  assert.equal(shouldUseReadThis("Veo 3.1 - Fast", long), false);
});
