// Compile local TypeScript modules for behavioral tests without a Next server.
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");

// Resolve the "@/*" tsconfig path alias to the project root, same mapping as tsconfig.json.
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
const sharp = require("sharp");
const { shouldUseReadThis, renderPromptImage } = require("../lib/flowAdapter.ts");

const LONG_PROMPT = "A ".repeat(150); // > 200 chars

test("shouldUseReadThis: explicit override wins", () => {
  assert.equal(shouldUseReadThis("Omni Flash", "short", true), true);
  assert.equal(shouldUseReadThis("Omni Flash", LONG_PROMPT, false), false);
});

test("shouldUseReadThis: Omni Flash + long prompt -> true", () => {
  assert.equal(shouldUseReadThis("Omni Flash", LONG_PROMPT), true);
});

test("shouldUseReadThis: Omni Flash + short prompt -> false", () => {
  assert.equal(shouldUseReadThis("Omni Flash", "short prompt"), false);
});

test("shouldUseReadThis: frames attached -> false (the prompt image would compete with the start/end frames)", () => {
  assert.equal(shouldUseReadThis("Omni Flash", LONG_PROMPT, undefined, true), false);
});

test("shouldUseReadThis: non-Omni-Flash model + long prompt -> false", () => {
  assert.equal(shouldUseReadThis("Veo 3.1 - Fast", LONG_PROMPT), false);
});

test("renderPromptImage: writes a real PNG, 1080 wide, escapes markup, dedupes by hash", async () => {
  const outDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "read-this-test-"));
  const prompt = ("UGC ad script with & special <tags> to escape. ").repeat(14); // ~600 chars

  const outPath1 = await renderPromptImage(prompt, outDir);
  assert.ok(fs.existsSync(outPath1));

  const meta = await sharp(outPath1).metadata();
  assert.equal(meta.width, 1080);
  assert.ok(meta.height > 100, `expected height > 100, got ${meta.height}`);

  const outPath2 = await renderPromptImage(prompt, outDir);
  assert.equal(outPath1, outPath2, "same prompt should hash to the same path");
});
