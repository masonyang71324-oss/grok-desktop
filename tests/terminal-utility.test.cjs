const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');

function adapter() {
  const launches = [],
    sent = [],
    killed = [];
  const host = new EventEmitter();
  host.postMessage = (message) => sent.push(message);
  host.kill = () => true;
  const utilityProcess = {
    fork: (...args) => {
      launches.push(args);
      return host;
    },
  };
  const spawnFn = (...args) => {
    killed.push(args);
    return new EventEmitter();
  };
  const filename = require.resolve('../electron/terminal-host-client.cjs');
  const localRequire = createRequire(filename);
  const context = {
    module: { exports: {} },
    __dirname: path.dirname(filename),
    process,
    require: (name) =>
      name === 'node:child_process'
        ? {
            fork: () => {
              throw new Error('legacy Node fork must not be used');
            },
            spawn: spawnFn,
          }
        : localRequire(name),
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  const pty = context.module.exports.spawnHostedPty(
    'safe-shell',
    [],
    { cwd: '/fixture' },
    { utilityProcess, spawnFn },
  );
  return { pty, host, launches, sent, killed };
}

test('PTY utility adapter relays data and resize and acknowledges graceful host exit once', () => {
  const { pty, host, launches, sent } = adapter();
  assert.equal(launches.length, 1);
  assert.match(launches[0][0], /terminal-host\.cjs$/);
  assert.equal(launches[0][2].env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(launches[0][2].serviceName, 'Grok terminal');
  const output = [],
    exits = [];
  pty.onData((data) => output.push(data));
  pty.onExit((event) => exits.push(event.exitCode));
  host.emit('message', { type: 'data', data: 'terminal output' });
  pty.write('input');
  pty.resize(100, 30);
  assert.equal(sent[0].type, 'start');
  assert.equal(sent[1].type, 'input');
  assert.equal(sent[1].data, 'input');
  assert.equal(sent[2].type, 'resize');
  assert.equal(sent[2].cols, 100);
  host.emit('message', { type: 'exit', exitCode: 7 });
  assert.equal(sent.at(-1).type, 'exit-ack');
  host.emit('exit', 0);
  host.emit('exit', 0);
  assert.deepEqual(output, ['terminal output']);
  assert.deepEqual(exits, [7]);
});

test(
  'closing before utility spawn waits for its owned PID before killing the tree',
  { skip: process.platform !== 'win32' },
  () => {
    const { pty, host, killed } = adapter();
    pty.kill();
    assert.equal(killed.length, 0);
    host.pid = 876543;
    host.emit('spawn');
    assert.equal(killed.length, 1);
    assert.match(killed[0][0], /^[A-Z]:\\.*\\System32\\taskkill\.exe$/i);
    assert.deepEqual(Array.from(killed[0][1]), ['/PID', '876543', '/T', '/F']);
    pty.kill();
    assert.equal(killed.length, 1);
  },
);

test('native host uses parentPort message envelopes and waits for exit acknowledgement', () => {
  const port = new EventEmitter(),
    messages = [],
    exits = [];
  port.postMessage = (message) => messages.push(message);
  const proc = new EventEmitter();
  proc.parentPort = port;
  proc.exit = (code) => exits.push(code);
  let onData, onExit;
  const inputs = [],
    sizes = [];
  const terminal = {
    onData(fn) {
      onData = fn;
    },
    onExit(fn) {
      onExit = fn;
    },
    write(value) {
      inputs.push(value);
    },
    resize(...args) {
      sizes.push(args);
    },
  };
  const filename = require.resolve('../electron/terminal-host.cjs');
  vm.runInNewContext(
    fs.readFileSync(filename, 'utf8'),
    {
      process: proc,
      require: (name) => {
        assert.equal(name, 'node-pty');
        return { spawn: () => terminal };
      },
    },
    { filename },
  );
  port.emit('message', { data: { type: 'start', shell: 'safe-shell', args: [], options: {} } });
  assert.equal(typeof onData, 'function');
  onData('native');
  port.emit('message', { data: { type: 'input', data: 'echo' } });
  port.emit('message', { data: { type: 'resize', cols: 90, rows: 25 } });
  onExit({ exitCode: 3 });
  assert.equal(messages[0].data, 'native');
  assert.equal(messages[1].exitCode, 3);
  assert.deepEqual(inputs, ['echo']);
  assert.deepEqual(sizes, [[90, 25]]);
  assert.deepEqual(exits, []);
  port.emit('message', { data: { type: 'exit-ack' } });
  assert.deepEqual(exits, [0]);
});
