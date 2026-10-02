const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { heygenVideoAssetUrl } = require('../lib/heygenVideoResult.ts');

test('HeyGen session page is not a completed video asset', () => {
  const session = { status: 'completed', video_page_url: 'https://app.heygen.com/videos/abc' };
  assert.equal(heygenVideoAssetUrl(session), undefined);
});

test('HeyGen video asset wins over its page and thumbnail', () => {
  const video = { video_page_url: 'https://app.heygen.com/videos/abc', thumbnail_url: 'https://files2.heygen.ai/a.jpeg', video_url: 'https://files2.heygen.ai/a.mp4?Signature=x' };
  assert.equal(heygenVideoAssetUrl(video), video.video_url);
  assert.equal(heygenVideoAssetUrl({ items: [video] }), video.video_url);
});
