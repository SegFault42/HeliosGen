import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { checkCodexLogin, checkImageCli } from "./codexStatus.mjs";

afterEach(() => { mock.restoreAll(); syncBuiltinESMExports(); });

test("bounded local checks recognize installed CLI and ChatGPT on stderr", async () => {
  const commands = [];
  mock.method(childProcess, "execFile", (bin, args, options, callback) => {
    commands.push([bin, ...args]);
    assert.equal(options.timeout, 5000);
    queueMicrotask(() => callback(null, "", bin === "codex" ? "Logged in using ChatGPT" : "codex-imagegen 0.1.0"));
  });
  syncBuiltinESMExports();
  assert.deepEqual(await Promise.all([checkImageCli(), checkCodexLogin()]), ["installed", "chatgpt"]);
  assert.deepEqual(commands, [["codex-imagegen", "--version"], ["codex", "login", "status"]]);
});

test("API-key login cannot be treated as ChatGPT even if credentials exist", async () => {
  mock.method(childProcess, "execFile", (_bin, _args, _options, callback) => {
    queueMicrotask(() => callback(null, "Logged in using an API key", ""));
  });
  syncBuiltinESMExports();
  assert.equal(await checkCodexLogin(), "api_key");
});
