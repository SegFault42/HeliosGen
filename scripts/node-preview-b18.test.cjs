const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { nodeImageUrl, resolveImageUrl } = require('../lib/executor.ts');
const g = require('../lib/videoNodeGuards.ts');

test('generateNode: regenerated imageUrl beats stale r2Url', () => {
  const n = { type: 'generateNode', data: { r2Url: 'old', imageUrl: 'new' } };
  assert.equal(nodeImageUrl(n), 'new');
  assert.equal(resolveImageUrl({ ...n, id: 'a' }, null), 'new');
});
test('other nodes keep r2Url > inputImage > imageUrl', () => {
  assert.equal(nodeImageUrl({ type: 'imageInputNode', data: { r2Url: 'r', inputImage: 'i', imageUrl: 'x' } }), 'r');
  assert.equal(nodeImageUrl({ type: 'imageInputNode', data: { inputImage: 'i', imageUrl: 'x' } }), 'i');
});
test('frame handle without its designated frame resolves undefined (guard blocks)', () => {
  const n = { id: 'v', type: 'videoInputNode', data: { eagerEndFrameUrl: 'e', r2Url: 'r' } };
  assert.equal(resolveImageUrl(n, 'startFrameOut'), undefined);
  assert.equal(resolveImageUrl(n, 'endFrameOut'), 'e');
});
test('stale submit marker', () => {
  assert.equal(g.isStaleSubmit(undefined, 1000), true);
  assert.equal(g.isStaleSubmit(1000, 1000 + 60_000), false);
  assert.equal(g.isStaleSubmit(1000, 1000 + g.SUBMIT_STALE_MS + 1), true);
});
