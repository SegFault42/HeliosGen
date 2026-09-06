const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, file);
const { shouldClearJob } = require('../lib/pendingJobCleanup.ts');

test('clears only failed/interrupted placeholders in the visible tab and folder subtree', () => {
  const scope = { tab: 'images', folderIds: ['parent', 'child'] };
  const jobs = [
    { id: 'failed', tab: 'images', folderId: 'parent', error: 'provider failed' },
    { id: 'interrupted', tab: 'images', folderId: 'child', phase: 'interrupted' },
    { id: 'other-tab', tab: 'videos', folderId: 'parent', error: 'failed' },
    { id: 'other-folder', tab: 'images', folderId: 'outside', error: 'failed' },
  ];
  assert.deepEqual(jobs.filter(job => !shouldClearJob(job, scope)).map(job => job.id), ['other-tab', 'other-folder']);
  assert.equal(jobs.length, 4); // The predicate never mutates persisted records.
});

test('never treats age, queued/running work or the cancellation grace period as stuck', () => {
  const scope = { tab: 'images', folderIds: null };
  for (const job of [{ phase: 'queued' }, { phase: 'generating' }, { createdAt: '2000-01-01' }, { prePending: true, error: 'stale' }]) {
    assert.equal(shouldClearJob(job, scope), false);
  }
});
