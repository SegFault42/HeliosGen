// lib/azureEndpoint.ts validates the user-supplied Azure base URL before the
// server attaches the stored Azure key to it (key theft / SSRF otherwise).
const ts = require("typescript");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const ROOT = path.join(__dirname, "..");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "azure-endpoint-"));
process.env.HELIOS_MEDIA_DIR = path.join(TMP, "media");
process.env.HELIOS_DATA_DIR = path.join(TMP, "data");
fs.mkdirSync(process.env.HELIOS_MEDIA_DIR);

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
const { validateAzureEndpoint } = require("../lib/azureEndpoint.ts");

test("validateAzureEndpoint: accepts real Azure hosts", () => {
  assert.equal(validateAzureEndpoint("https://my-resource.openai.azure.com"), "https://my-resource.openai.azure.com");
  assert.equal(validateAzureEndpoint("https://my-resource.openai.azure.com/"), "https://my-resource.openai.azure.com");
  assert.equal(validateAzureEndpoint("https://my-resource.openai.azure.com/openai"), "https://my-resource.openai.azure.com");
  assert.equal(validateAzureEndpoint("https://foo.cognitiveservices.azure.com"), "https://foo.cognitiveservices.azure.com");
  assert.equal(validateAzureEndpoint("https://foo.services.ai.azure.com"), "https://foo.services.ai.azure.com");
});

test("validateAzureEndpoint: rejects http", () => {
  assert.equal(validateAzureEndpoint("http://my-resource.openai.azure.com"), null);
});

test("validateAzureEndpoint: rejects evil hosts", () => {
  assert.equal(validateAzureEndpoint("https://evil.example"), null);
  assert.equal(validateAzureEndpoint("https://evil.com/.openai.azure.com"), null);
  assert.equal(validateAzureEndpoint("https://x.openai.azure.com.evil.com"), null);
});

test("validateAzureEndpoint: rejects userinfo", () => {
  assert.equal(validateAzureEndpoint("https://user:pass@my-resource.openai.azure.com"), null);
});

test("validateAzureEndpoint: rejects private IPs", () => {
  assert.equal(validateAzureEndpoint("https://127.0.0.1"), null);
  assert.equal(validateAzureEndpoint("https://192.168.1.1"), null);
  assert.equal(validateAzureEndpoint("https://10.0.0.1"), null);
});

test("validateAzureEndpoint: rejects empty/missing", () => {
  assert.equal(validateAzureEndpoint(""), null);
  assert.equal(validateAzureEndpoint(undefined), null);
  assert.equal(validateAzureEndpoint(null), null);
});

test("POST /api/assistant: evil azureEndpoint is refused with 400 and no fetch is made", async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async (...args) => {
    fetchCalled = true;
    throw new Error("fetch should not have been called: " + JSON.stringify(args));
  };
  try {
    const { POST } = require("../app/api/assistant/route.ts");
    const res = await POST(new Request("http://localhost:3000/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "azure-auto", prompt: "x", azureEndpoint: "https://evil.example" }),
    }));
    assert.equal(res.status, 400);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("curlMultipartPost: text fields use --form-string, not -F", () => {
  const routeSrc = fs.readFileSync(path.join(ROOT, "app/api/generate/route.ts"), "utf8");
  const start = routeSrc.indexOf("async function curlMultipartPost");
  const end = routeSrc.indexOf("// Resolve every image URL", start);
  assert.ok(start !== -1 && end !== -1, "curlMultipartPost function not found");
  const fnSrc = routeSrc.slice(start, end);
  assert.match(fnSrc, /--form-string/, "expected --form-string to be used for text fields");
  // the textFields loop must use --form-string, not -F (which lets @/< read local files)
  const textFieldsLoop = fnSrc.match(/for \(const \[k, v\] of Object\.entries\(textFields\)\) \{[\s\S]*?\}/);
  assert.ok(textFieldsLoop, "textFields loop not found");
  assert.match(textFieldsLoop[0], /--form-string/);
  assert.doesNotMatch(textFieldsLoop[0], /args\.push\("-F"/);
});
