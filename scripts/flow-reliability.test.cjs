// Compile local TypeScript modules for behavioral tests without a Next server.
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
const { flowProjectUrl } = require("../lib/flowAdapter.ts");

test("flowProjectUrl: missing env fails with an actionable message", () => {
  const saved = process.env.FLOW_PROJECT_URL;
  delete process.env.FLOW_PROJECT_URL;
  try {
    assert.throws(() => flowProjectUrl(), /FLOW_PROJECT_URL/);
  } finally {
    if (saved !== undefined) process.env.FLOW_PROJECT_URL = saved;
  }
});

test("flowProjectUrl: rejects anything that is not a Flow project URL", () => {
  const saved = process.env.FLOW_PROJECT_URL;
  process.env.FLOW_PROJECT_URL = "https://flow.google.com/?pli=1";
  try {
    assert.throws(() => flowProjectUrl(), /FLOW_PROJECT_URL/);
  } finally {
    if (saved === undefined) delete process.env.FLOW_PROJECT_URL; else process.env.FLOW_PROJECT_URL = saved;
  }
});

test("flowProjectUrl: returns a valid project URL", () => {
  const saved = process.env.FLOW_PROJECT_URL;
  process.env.FLOW_PROJECT_URL = " https://flow.google.com/project/70448001-5571-434c-9afe-e78ec83cd5c3 ";
  try {
    assert.equal(flowProjectUrl(), "https://flow.google.com/project/70448001-5571-434c-9afe-e78ec83cd5c3");
  } finally {
    if (saved === undefined) delete process.env.FLOW_PROJECT_URL; else process.env.FLOW_PROJECT_URL = saved;
  }
});
