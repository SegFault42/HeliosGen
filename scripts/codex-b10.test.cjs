// Compile local TypeScript modules for behavioral tests without a Next server.
const ts = require("typescript");
const fs = require("node:fs");
require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename);
};
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isAuthError, isUsageLimitError } = require("../lib/codexAccounts.ts");
const { cleanCodexError, codexQualityArgs, resolveCodexExecutable, runWithAccounts, spawnCodex } = require("../lib/codexRun.ts");

const AUTH = "codex-imagegen exited with code 1: /tmp/x Error: Your session has ended. Please log in again.";
const LIMIT = { exitCode: 1, stderr: "Error: HTTP 429 usage limit reached" };
const EXPIRED = { exitCode: 1, stderr: AUTH };

test("isAuthError / isUsageLimitError", () => {
  assert.equal(isAuthError("Your session has ended. Please log in again."), true);
  assert.equal(isAuthError("HTTP 401: nope"), true);
  assert.equal(isAuthError("HTTP 429 usage limit"), false);
  assert.equal(isUsageLimitError("HTTP 429 usage limit"), true);
});

test("cleanCodexError adds the Settings hint for expired sessions only", () => {
  assert.match(cleanCodexError(AUTH), /Settings > Codex/);
  assert.equal(cleanCodexError("x Error: Responses stream ended; last status was failed."), "Responses stream ended");
});

test("rotation: expired account 1 falls through to account 2", async () => {
  const seen = [];
  const ok = await runWithAccounts(["a", "b"], async (f) => (seen.push(f), f === "a" ? EXPIRED : { exitCode: 0, stderr: "" }));
  assert.equal(ok, "b");
  assert.deepEqual(seen, ["a", "b"]);
});

test("rotation: usage limit marks cooldown and continues", async () => {
  const marked = [];
  const ok = await runWithAccounts(["a", "b"], async (f) => (f === "a" ? LIMIT : { exitCode: 0, stderr: "" }), (f) => marked.push(f));
  assert.equal(ok, "b");
  assert.deepEqual(marked, ["a"]);
});

test("rotation: all expired -> clear re-login error; other errors throw at once", async () => {
  await assert.rejects(runWithAccounts(["a", "b"], async () => EXPIRED), (e) => /Settings > Codex/.test(cleanCodexError(e.message)) && /All 2/.test(e.message));
  let calls = 0;
  await assert.rejects(runWithAccounts(["a", "b"], async () => (calls++, { exitCode: 2, stderr: "Error: bad prompt" })), /bad prompt/);
  assert.equal(calls, 1);
  await assert.rejects(runWithAccounts([], async () => EXPIRED), /No Codex auth/);
});

test("quality flag mapping", () => {
  assert.deepEqual(codexQualityArgs("1k"), []);
  assert.deepEqual(codexQualityArgs("2k"), ["--quality", "medium"]);
  assert.deepEqual(codexQualityArgs("4k"), ["--quality", "high"]);
});

test("executable resolution: prefers .exe, shell only for shims", () => {
  const has = (set) => (p) => set.some((s) => p.endsWith(s));
  assert.deepEqual(resolveCodexExecutable("linux", "/x", () => true), { cmd: "codex-imagegen", shell: false });
  const exe = resolveCodexExecutable("win32", ["C:/a","C:/b"].join(require("node:path").delimiter), has(["codex-imagegen.exe", "codex-imagegen.cmd"]));
  assert.equal(exe.shell, false); assert.match(exe.cmd, /\.exe$/);
  const cmd = resolveCodexExecutable("win32", "C:/a", has(["codex-imagegen.cmd"]));
  assert.equal(cmd.shell, true);
});

test("shell mode refuses metacharacters", () => {
  assert.throws(() => spawnCodex(["--out", "a&calc"], { cmd: "C:/x/codex-imagegen.cmd", shell: true }), /unsafe/);
});

test("classification uses the final Error: part, not Warning: retry lines", async () => {
  const stderr = "Warning: retry after unauthorized\nError: content policy violation";
  assert.equal(isAuthError(stderr), false);
  let calls = 0;
  await assert.rejects(runWithAccounts(["a", "b"], async () => (calls++, { exitCode: 1, stderr })), /content policy/);
  assert.equal(calls, 1);
  const seen = [];
  const ok = await runWithAccounts(["a", "b"], async (f) => (seen.push(f), f === "a" ? { exitCode: 1, stderr: "Warning: x\nError: Your session has ended" } : { exitCode: 0, stderr: "" }));
  assert.equal(ok, "b");
  assert.deepEqual(seen, ["a", "b"]);
});
