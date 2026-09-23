const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

// Exercise the real store/reconciler with isolated data and a stub remote poller.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-jobs-'));
process.env.HELIOS_DATA_DIR = dir;
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, file);
const resumed = [];
require.cache[require.resolve('../lib/kieJobPoller.ts')] = { exports: { resumeKieJob: (id, kind) => { resumed.push([id, kind]); return true; } } };
const { jobStore, serverInstanceId } = require('../lib/jobStore.ts');
const db = require('../lib/guest/db.ts');
const { reconcileJob } = require('../lib/reconcileJob.ts');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('preserves lifecycle metadata and recovers saved completion before interruption', () => {
  jobStore.set('codex-complete', { status: 'pending', phase: 'queued' });
  const queued = jobStore.get('codex-complete');
  assert.equal(queued.startedAt, undefined);
  assert.equal(queued.serverInstanceId, serverInstanceId);
  jobStore.set('codex-complete', { status: 'pending', phase: 'generating', serverInstanceId: 'previous-process' });
  db.insertGeneration({ task_id: 'codex-complete', user_id: null, generation_type: 'image', status: 'done', image_url: '/generated/test.png' });
  const result = reconcileJob('codex-complete');
  assert.equal(result.status, 'done');
  assert.equal(result.createdAt, queued.createdAt);
  assert.ok(result.startedAt && result.finishedAt);
  assert.equal(reconcileJob('codex-complete').finishedAt, result.finishedAt);
});

test('interrupts orphaned local work but resumes remote work without resubmitting', () => {
  jobStore.set('azure-orphan', { status: 'pending', serverInstanceId: 'previous-process' });
  assert.equal(reconcileJob('azure-orphan').phase, 'interrupted');
  assert.equal(reconcileJob('azure-orphan').status, 'error');
  jobStore.set('remote-video', { status: 'pending', type: 'video' });
  assert.equal(reconcileJob('remote-video').status, 'pending');
  assert.deepEqual(resumed, [['remote-video', 'video']]);
});
