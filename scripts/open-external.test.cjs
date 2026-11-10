// /api/open-external must never hand the URL to a shell: on Windows `cmd /c start "" <url>`
// ran `http://x/&calc` as two commands (libuv only quotes args containing spaces or quotes).
const ts = require("typescript");
const fs = require("node:fs");
const childProcess = require("node:child_process");

require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, filename);
};

const { test } = require("node:test");
const assert = require("node:assert/strict");

const spawned = [];
childProcess.spawn = (cmd, args, opts) => {
  spawned.push({ cmd, args, opts });
  return { unref() {} };
};
const { POST } = require("../app/api/open-external/route.ts");

function open(url) {
  return POST(new Request("http://localhost:3000/api/open-external", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
  }));
}

test("open-external: no shell ever sees the URL", async () => {
  spawned.length = 0;
  const res = await open("http://x/&calc");
  assert.equal(res.status, 200);
  assert.equal(spawned.length, 1);
  const { cmd, args, opts } = spawned[0];
  assert.ok(!/^(cmd|cmd\.exe|powershell|pwsh|sh|bash)$/i.test(cmd), `spawned a shell: ${cmd}`);
  assert.ok(!opts?.shell, "shell option must be off");
  assert.equal(args.at(-1), "http://x/&calc");
});

test("open-external: non-http(s) URLs are refused without spawning", async () => {
  spawned.length = 0;
  for (const url of ["file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "not a url"]) {
    const res = await open(url);
    assert.equal(res.status, 400, url);
  }
  assert.equal(spawned.length, 0);
});
