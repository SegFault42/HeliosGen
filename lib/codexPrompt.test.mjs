import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { enhanceWithCodex } from "./codexPrompt.ts";

afterEach(() => { mock.restoreAll(); syncBuiltinESMExports(); });

test("missing Codex allows fallback", async () => {
  mock.method(childProcess, "execFile", (_bin, _args, _opts, callback) => {
    queueMicrotask(() => callback(Object.assign(new Error(), { code: "ENOENT" }), "", ""));
    return {};
  });
  syncBuiltinESMExports();
  assert.equal(await enhanceWithCodex("idea", new AbortController().signal), null);
});

test("configured Codex failure rejects rather than falling back", async () => {
  mock.method(childProcess, "execFile", (_bin, args, _opts, callback) => {
    queueMicrotask(() => args[0] === "login"
      ? callback(null, "", "Logged in using ChatGPT")
      : callback(Object.assign(new Error("private diagnostic"), { code: 1 }), "", "rate limit"));
    return {};
  });
  syncBuiltinESMExports();
  await assert.rejects(enhanceWithCodex("idea", new AbortController().signal),
    error => error.message.includes("Kie was not called") && !error.message.includes("private diagnostic"));
});
