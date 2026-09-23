/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS loader compiles the real TypeScript module without a test dependency. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, file);
const { enqueueCodexImage, runCodexImageCommand } = require('../lib/codexImageQueue.ts');

test('FIFO holds one slot across the entire asynchronous pipeline', async () => {
  const events = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = enqueueCodexImage(async () => { events.push('first'); await gate; events.push('saved'); });
  const second = enqueueCodexImage(async () => { events.push('second'); });
  await Promise.resolve();
  assert.deepEqual(events, ['first']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first', 'saved', 'second']);
});

test('execution timeout kills and awaits close before starting the next job', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  const signals = [];
  child.kill = signal => signals.push(signal);
  t.mock.method(require('node:child_process'), 'spawn', () => child);
  const first = enqueueCodexImage(() => runCodexImageCommand(['generate']));
  const rejected = assert.rejects(first, /timed out after 10 minutes/);
  let nextStarted = false;
  const next = enqueueCodexImage(async () => { nextStarted = true; });
  await Promise.resolve();
  t.mock.timers.tick(600_000);
  assert.deepEqual(signals, ['SIGTERM']);
  t.mock.timers.tick(2_000);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(nextStarted, false);
  child.emit('close', null);
  await rejected;
  await next;
  assert.equal(nextStarted, true);
});
