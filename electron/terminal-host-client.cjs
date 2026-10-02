const { fork, spawn } = require('node:child_process');
const path = require('node:path');
// Every process controlled here is the exact helper created for one terminal.
function spawnHostedPty(shell, args, options) {
  const host = fork(path.join(__dirname, 'terminal-host.cjs'), [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
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
    if (host.connected)
      host.send(message, (error) => {
        if (error && !closed) diagnostic = error.message;
      });
  };
  host.on('message', (message) => {
    if (message.type === 'data') for (const fn of dataListeners) fn(message.data);
    else if (message.type === 'exit') terminalExit = message.exitCode;
    else if (message.type === 'error') diagnostic = message.message;
  });
  function exited(code) {
    if (closed) return;
    closed = true;
    if (diagnostic && !stopping) for (const fn of dataListeners) fn(`\r\n${diagnostic}\r\n`);
    for (const fn of exitListeners) fn({ exitCode: terminalExit ?? code ?? 1 });
  }
  host.on('error', (error) => {
    diagnostic = error.message;
    exited(1);
  });
  host.on('exit', exited);
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
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(host.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('error', () => {
          stopping = false;
        });
      } else host.kill('SIGTERM');
    },
  };
}
module.exports = { spawnHostedPty };
