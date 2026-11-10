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
const { framePrompt, stripKieImageTags } = require("../lib/flowAdapter.ts");

test("framePrompt: end-only names the last frame", () => {
  assert.equal(framePrompt("go", false, true), "Use the attached image as the last frame. go");
});

test("framePrompt: other cases unchanged", () => {
  assert.equal(framePrompt("go", false, false), "go");
  assert.equal(framePrompt("go", true, false), "Use the first attached image as the first frame. go");
  assert.match(framePrompt("go", true, true), /second attached image as the last frame/);
});

test("stripKieImageTags: <<<image N>>> becomes image N", () => {
  assert.equal(stripKieImageTags("<<<image 1>>> on <<<image 2>>>"), "image 1 on image 2");
  assert.equal(stripKieImageTags("plain"), "plain");
});
