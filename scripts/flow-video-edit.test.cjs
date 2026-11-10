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
