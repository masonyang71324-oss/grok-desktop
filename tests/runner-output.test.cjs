const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const childProcess = require('node:child_process');

test('runner batches output deltas, flushes terminal state and excludes old-run chunks', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'runner output '));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { dev: 'fake' } }));
  const children = [],
    events = [];
  t.mock.method(childProcess, 'spawn', () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    children.push(child);
    return child;
  });
  delete require.cache[require.resolve('../electron/project-runner.cjs')];
  const { createProjectRunner } = require('../electron/project-runner.cjs');
  const runner = createProjectRunner({ emit: (type, event) => events.push({ type, ...event }) });
  await runner.start({ cwd, script: 'dev' });
  const bytes = Buffer.from('中文🙂');
  children[0].stdout.write(bytes.subarray(0, 5));
  children[0].stdout.write(bytes.subarray(5));
  for (let index = 0; index < 30; index++) children[0].stdout.write('x');
  assert.equal(
    events.filter((event) => event.type === 'runner-changed').length,
    1,
    'data must not send full state each chunk',
  );
  await new Promise((resolve) => setTimeout(resolve, 45));
  const deltas = events.filter((event) => event.type === 'runner-output');
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].data, '中文🙂' + 'x'.repeat(30));
  children[0].stderr.write('last');
  children[0].emit('close', 0);
  assert.equal(events.at(-2).type, 'runner-output');
  assert.equal(events.at(-1).state.log, '中文🙂' + 'x'.repeat(30) + 'last');
  assert.equal(events.at(-1).state.sequence, 2);
  const firstRun = events.at(-1).state.runId;
  await runner.start({ cwd, script: 'dev' });
  const eventCount = events.length;
  children[0].stdout.write('late old output');
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(events.length, eventCount);
  children[1].stdout.write('🙂'.repeat(20000));
  const current = runner.state({ cwd });
  assert.notEqual(current.runId, firstRun);
  assert.ok(Buffer.byteLength(current.log) <= 65536);
  assert.ok(!current.log.includes('\uFFFD'));
  assert.equal(current.sequence, 1);
  children[1].emit('close', 0);
});
