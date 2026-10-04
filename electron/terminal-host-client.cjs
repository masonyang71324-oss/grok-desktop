const { spawn } = require('node:child_process');
const path = require('node:path');
const { windowsSystemExecutable } = require('./system-launch.cjs');
// Every process controlled here is the exact helper created for one terminal.
function spawnHostedPty(
  shell,
  args,
  options,
  { utilityProcess = require('electron').utilityProcess, spawnFn = spawn } = {},
) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const host = utilityProcess.fork(path.join(__dirname, 'terminal-host.cjs'), [], {
    env,
    execArgv: [],
    serviceName: 'Grok terminal',
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const dataListeners = new Set(),
    exitListeners = new Set();
  let terminalExit,
    closed = false,
    stopping = false,
    diagnostic = '';
  host.stderr?.setEncoding('utf8');
  host.stderr?.on('data', (data) => {
    diagnostic = (diagnostic + data).slice(-2000);
  });
  const send = (message) => {
    if (closed) return;
    try {
      host.postMessage(message);
    } catch (error) {
      diagnostic = error.message;
    }
  };
  host.on('message', (message) => {
    if (message.type === 'data') for (const fn of dataListeners) fn(message.data);
    else if (message.type === 'exit' || message.type === 'error') {
      if (message.type === 'exit') terminalExit = message.exitCode;
      else diagnostic = message.message;
      send({ type: 'exit-ack' });
    }
  });
  function exited(code) {
    if (closed) return;
    closed = true;
    if (diagnostic && !stopping) for (const fn of dataListeners) fn(`\r\n${diagnostic}\r\n`);
    for (const fn of exitListeners) fn({ exitCode: terminalExit ?? code ?? 1 });
  }
  host.on('error', (type, location) => {
    diagnostic = location ? `${type}: ${location}` : type;
  });
  host.on('exit', exited);
  function stopHost() {
    if (closed || !host.pid) return;
    if (process.platform === 'win32') {
      const killer = spawnFn(
        windowsSystemExecutable('taskkill.exe'),
        ['/PID', String(host.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore', shell: false },
      );
      killer.once('error', () => {
        stopping = false;
      });
      killer.once('close', (code) => {
        if (code !== 0 && !closed) stopping = false;
      });
    } else host.kill();
  }
  host.once('spawn', () => {
    if (stopping) stopHost();
  });
  send({ type: 'start', shell, args, options });
  return {
    onData(fn) {
      dataListeners.add(fn);
      return { dispose: () => dataListeners.delete(fn) };
    },
    onExit(fn) {
      exitListeners.add(fn);
      return { dispose: () => exitListeners.delete(fn) };
    },
    write(data) {
      send({ type: 'input', data });
    },
    resize(cols, rows) {
      send({ type: 'resize', cols, rows });
    },
    kill() {
      if (closed || stopping) return;
      stopping = true;
      stopHost();
    },
  };
}
module.exports = { spawnHostedPty };
