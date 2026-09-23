// GET /api/flow/status must never leak account secrets (OAuth/session token,
// transferred cookies, CDP debug endpoint, local browser paths) to any LAN
// client that can reach the dev server.
const ts = require("typescript");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");

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

// Stub lib/flowAdapter's exports before app/api/flow/status/route.ts is
// required: TS compiles `import { listFlowAccounts } from "@/lib/flowAdapter"`
// to property access on the required module object, so patching the
// already-loaded module's exports here is picked up by the route.
const flowAdapterPath = require.resolve("../lib/flowAdapter.ts");
require(flowAdapterPath);
const flowAdapterModule = require.cache[flowAdapterPath].exports;

const SECRET_ACCOUNT = {
  id: "acc1",
  label: "Main account",
  email: "user@example.com",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastOpenedAt: "2026-09-20T00:00:00.000Z",
  lastValidatedAt: "2026-09-20T00:00:00.000Z",
  lastValidationError: "leaked stack trace with /C:/Users/secret/path",
  connectionStatus: "connected",
  browserMode: "extension",
  headlessAfterLogin: true,
  cdpUrl: "http://127.0.0.1:9222/devtools/browser/abc-123",
  browserExecutablePath: "C:\\Users\\secret\\chrome.exe",
  token: "ya29.SECRET_OAUTH_TOKEN",
  cookies: [{ name: "SID", value: "SECRET_COOKIE_VALUE", domain: ".google.com" }],
};

function stubFlowAdapter() {
  flowAdapterModule.listFlowAccounts = async () => ({
    version: 1,
    defaultAccountId: "acc1",
    accounts: [SECRET_ACCOUNT],
  });
  flowAdapterModule.getFlowCredits = async () => ({ credits: 100 });
}

test("GET /api/flow/status: response never contains account secrets", async () => {
  stubFlowAdapter();
  const routePath = require.resolve("../app/api/flow/status/route.ts");
  delete require.cache[routePath];
  const { GET } = require(routePath);

  const res = await GET();
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.accounts.length, 1);
  const account = body.accounts[0];

  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes("SECRET_OAUTH_TOKEN"), "OAuth token leaked");
  assert.ok(!serialized.includes("SECRET_COOKIE_VALUE"), "cookie leaked");
  assert.ok(!serialized.includes("9222"), "CDP debug endpoint leaked");
  assert.ok(!serialized.includes("chrome.exe"), "local browser path leaked");
  assert.ok(!serialized.includes("secret\\path"), "validation error with local path leaked");

  assert.equal(account.token, undefined);
  assert.equal(account.cookies, undefined);
  assert.equal(account.cdpUrl, undefined);
  assert.equal(account.browserExecutablePath, undefined);
  assert.equal(account.lastValidationError, undefined);

  // UI-facing fields the status check needs must survive the allowlist.
  assert.equal(account.id, "acc1");
  assert.equal(account.label, "Main account");
  assert.equal(account.email, "user@example.com");
  assert.equal(account.connectionStatus, "connected");
});
