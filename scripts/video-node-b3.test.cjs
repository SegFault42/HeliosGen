const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const g = require('../lib/videoNodeGuards.ts');
const { VIDEO_MODELS } = require('../lib/modelConfig.ts');

test('deadline covers Flow (20 min) and HeyGen (~22 min)', () => {
  assert.ok(g.VIDEO_JOB_DEADLINE_MS >= 25 * 60 * 1000);
});
test('Kie key only needed for Kie models', () => {
  assert.equal(g.needsKieKey('Google Flow'), false);
  assert.equal(g.needsKieKey('HeyGen'), false);
  assert.equal(g.needsKieKey('Kling'), true);
  assert.equal(g.showsCreditsRefunded('Google Flow'), false);
  assert.equal(g.showsCreditsRefunded('Kling'), true);
});
test('provider names used by guards exist in modelConfig', () => {
  const p = new Set(VIDEO_MODELS.map((m) => m.provider));
  assert.ok(p.has('Google Flow') && p.has('HeyGen'));
});
test('blob/data frame urls are detected', () => {
  assert.equal(g.findLocalFrameUrl(['https://a/b.png', 'blob:http://x/1']), 'blob:http://x/1');
  assert.equal(g.findLocalFrameUrl(['https://a/b.png', undefined]), undefined);
});
