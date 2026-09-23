// Request guard (wired in proxy.ts): refuses browser-borne cross-site writes (CSRF) and
// foreign Host headers (DNS rebinding); non-browser clients (anvil, curl) pass.
const ts = require("typescript");
const fs = require("node:fs");

process.env.HELIOS_ALLOWED_HOSTS = "my-pc.local, Other-Box";

require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, filename);
};

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { guardRequest } = require("../lib/requestGuard.ts");

function status(method, headers) {
  const res = guardRequest(new NextRequest("http://localhost:3000/api/generate", { method, headers }));
  return res ? res.status : "pass";
}

test("cross-site browser writes are refused", () => {
  assert.equal(status("POST", { host: "localhost:3000", "sec-fetch-site": "cross-site" }), 403);
  assert.equal(status("DELETE", { host: "localhost:3000", "sec-fetch-site": "cross-site" }), 403);
});

test("without Sec-Fetch-Site, a foreign or null Origin is refused", () => {
  assert.equal(status("POST", { host: "localhost:3000", origin: "https://evil.example" }), 403);
  assert.equal(status("POST", { host: "localhost:3000", origin: "null" }), 403);
});

test("same-origin app requests and non-browser clients pass", () => {
  assert.equal(status("POST", { host: "localhost:3000", "sec-fetch-site": "same-origin", origin: "http://localhost:3000" }), "pass");
  assert.equal(status("POST", { host: "localhost:3000", origin: "http://localhost:3000" }), "pass");
  assert.equal(status("POST", { host: "localhost:3000" }), "pass");
  assert.equal(status("POST", { host: "127.0.0.1:3000", "sec-fetch-site": "none" }), "pass");
});

test("cross-site GET passes (reads are not writes)", () => {
  assert.equal(status("GET", { host: "localhost:3000", "sec-fetch-site": "cross-site" }), "pass");
});

test("DNS rebinding: a foreign Host is refused, even for GET", () => {
  assert.equal(status("GET", { host: "attacker.example:3000" }), 403);
  assert.equal(status("POST", { host: "localhost.attacker.example", "sec-fetch-site": "same-origin" }), 403);
});

test("loopback, IP-literal (LAN) and allowlisted Hosts pass", () => {
  for (const host of ["localhost:3000", "app.localhost:3000", "127.0.0.1:3000", "[::1]:3000", "192.168.1.10:3000", "my-pc.local:3000", "other-box"]) {
    assert.equal(status("GET", { host }), "pass", host);
  }
});
