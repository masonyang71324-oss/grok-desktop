const { app, utilityProcess } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { spawnHostedPty } = require('../../electron/terminal-host-client.cjs');
const { createTerminalManager } = require('../../electron/terminal.cjs');
const { createProjectRunner } = require('../../electron/project-runner.cjs');

const directory = process.env.GROK_CRASH_PROBE_DIR;
app.setPath('userData', path.join(directory, 'user-data'));
const wait = async (predicate, label) => {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`);
};
app
  .whenReady()
  .then(async () => {
    let utilityPid;
    const terminals = createTerminalManager({
      spawnPty: (...args) =>
        spawnHostedPty(...args, {
          utilityProcess: {
            fork(...params) {
              const host = utilityProcess.fork(...params);
              host.once('spawn', () => {
                utilityPid = host.pid;
                if (process.env.GROK_CRASH_PROBE_PHASE === 'startup') {
                  void fs.writeFile(
                    path.join(directory, 'ready.json'),
                    JSON.stringify({ mainPid: process.pid, utilityPid }),
                  );
                }
              });
              return host;
            },
          },
        }),
    });
    const runner = createProjectRunner();
    globalThis.crashProbe = { terminals, runner };
    if (process.env.GROK_CRASH_PROBE_PHASE === 'startup') {
      terminals.open({ cwd: directory });
      return;
    }
    // Same independent spawn boundary as an explicitly opened external terminal,
    // but hidden and inert so this fixture never opens a user-facing console.
    const external = spawn(
      process.env.GROK_CRASH_PROBE_NODE,
      ['-e', 'setInterval(() => {}, 1000)'],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    globalThis.crashProbe.external = external;
    const terminal = terminals.open({ cwd: directory });
    await wait(
      () => /PS [^\r\n]*>/.test(terminals.state({ id: terminal.id }).log),
      'PowerShell prompt',
    );
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    terminals.write({
      id: terminal.id,
      data: `& ${quote(process.env.GROK_CRASH_PROBE_NODE)} ${quote(path.join(__dirname, 'crash-lifecycle-child.cjs'))} terminal ${quote(directory)}\r`,
    });
    await runner.start({ cwd: directory, script: 'dev' });
    await wait(async () => {
      try {
        await fs.access(path.join(directory, 'terminal-leaf.json'));
        await fs.access(path.join(directory, 'runner-leaf.json'));
        return !!utilityPid;
      } catch {
        return false;
      }
    }, 'owned terminal and runner descendants');
    await fs.writeFile(
      path.join(directory, 'ready.json'),
      JSON.stringify({ mainPid: process.pid, utilityPid, externalPid: external.pid }),
    );
  })
  .catch(async (error) => {
    await fs.writeFile(path.join(directory, 'error.txt'), error.stack);
    await globalThis.crashProbe?.terminals.dispose();
    await globalThis.crashProbe?.runner.dispose();
    globalThis.crashProbe?.external?.kill();
    app.exit(1);
  });
