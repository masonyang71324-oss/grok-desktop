const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTerminalManager } = require('../electron/terminal.cjs');

function fixture() {
  const children = [],
    events = [];
  const manager = createTerminalManager({
    emit: (event) => events.push(event),
    spawnPty: (shell, args, options) => {
      const child = {
        shell,
        args,
        options,
        writes: [],
        resizes: [],
        onData(fn) {
          this.data = fn;
          return { dispose() {} };
        },
        onExit(fn) {
          this.exit = fn;
          return { dispose() {} };
        },
        write(text) {
          this.writes.push(text);
        },
        resize(cols, rows) {
          this.resizes.push([cols, rows]);
        },
        kill() {
          this.exit({ exitCode: 0 });
        },
      };
      children.push(child);
      return child;
    },
  });
  return { manager, children, events };
}

test('terminal is bound to project, reopens with retained output and routes input to its id', async () => {
  const { manager, children } = fixture();
  const a = manager.open({ cwd: 'C:/project a' }),
    b = manager.open({ cwd: 'C:/project b' });
  children[0].data('中文 output\r\n');
  assert.equal(manager.open({ cwd: 'C:/project a' }).id, a.id);
  assert.equal(manager.state({ id: a.id }).log, '中文 output\r\n');
  assert.equal(children.length, 2);
  manager.write({ id: b.id, data: 'echo hello\r' });
  assert.deepEqual(children[0].writes, []);
  assert.deepEqual(children[1].writes, ['echo hello\r']);
  assert.equal(children[1].options.cwd, 'C:/project b');
  manager.resize({ id: a.id, cols: 110, rows: 30 });
  assert.deepEqual(children[0].resizes, [[110, 30]]);
  assert.throws(() => manager.write({ id: 'missing', data: 'x' }));
  await manager.dispose();
  assert.equal(manager.busy, false);
});

test('exit flushes pending output once and closed terminals reject further input', async () => {
  const { manager, children, events } = fixture();
  const a = manager.open({ cwd: 'C:/a' });
  children[0].data('last output');
  children[0].exit({ exitCode: 7 });
  assert.deepEqual(
    events.map((e) => e.type),
    ['terminal-data', 'terminal-exit'],
  );
  assert.equal(events[0].data, 'last output');
  assert.equal(events[1].state.exitCode, 7);
  assert.equal(manager.state({ id: a.id }).status, 'exited');
  assert.throws(() => manager.write({ id: a.id, data: 'x' }));
  const retained = manager.open({ cwd: 'C:/a' });
  assert.equal(retained.id, a.id);
  assert.equal(retained.log, 'last output');
  assert.equal(retained.status, 'exited');
  const next = manager.open({ cwd: 'C:/a', restart: true });
  assert.notEqual(next.id, a.id);
  assert.equal(next.log, '');
  await manager.dispose();
});

test('a snapshot flushes pending bytes so a later batch never repeats snapshot output', async () => {
  const { manager, children, events } = fixture();
  const first = manager.open({ cwd: 'C:/a' });
  children[0].data('A');
  const snapshot = manager.open({ cwd: 'C:/a' });
  children[0].data('B');
  children[0].exit({ exitCode: 0 });
  const accepted = events
    .filter((e) => e.type === 'terminal-data' && e.sequence > snapshot.sequence)
    .map((e) => e.data)
    .join('');
  assert.equal(snapshot.log + accepted, 'AB');
  assert.equal(first.id, snapshot.id);
  await manager.dispose();
});

test('terminal bounds retained output and invalid input/resize cannot reach the process', async () => {
  const { manager, children } = fixture();
  const a = manager.open({ cwd: 'C:/a' });
  children[0].data('x'.repeat(250000));
  assert.ok(manager.state({ id: a.id }).log.length <= 200000);
  assert.throws(() => manager.resize({ id: a.id, cols: 0, rows: 20 }));
  assert.throws(() => manager.write({ id: a.id, data: { command: 'x' } }));
  assert.equal(children[0].writes.length, 0);
  await manager.dispose();
});
