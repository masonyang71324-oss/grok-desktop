const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright');

test(
  'native utility terminal exits, restarts and terminates its owned descendant tree',
  { skip: process.platform !== 'win32', timeout: 70000 },
  async (t) => {
    const root = path.resolve(__dirname, '..');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok utility terminal '));
    const userData = path.join(directory, 'userdata');
    await fs.mkdir(userData);
    await fs.writeFile(
      path.join(userData, 'settings.json'),
      JSON.stringify({
        grokPath: process.execPath,
        lastProject: directory,
        recentProjects: [directory],
      }),
    );
    const env = {
      ...process.env,
      GROK_DESKTOP_DATA_DIR: userData,
      GROK_HOME: path.join(directory, 'grok-home'),
      GROK_DESKTOP_TEST_GROK_SCRIPT: path.join(root, 'scripts/mock-grok.cjs'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.GROK_DESKTOP_DEV_URL;
    let app;
    try {
      app = await electron.launch({
        executablePath: process.env.GROK_DESKTOP_TEST_EXE || require('electron'),
        args: process.env.GROK_DESKTOP_TEST_EXE
          ? []
          : [path.join(__dirname, 'fixtures/terminal-utility-app.cjs')],
        env,
        timeout: 30000,
      });
      const result = await app.evaluate(
        async ({ app, utilityProcess }, { directory, root, packaged, node }) => {
          const path = process.getBuiltinModule('node:path');
          const require = process
            .getBuiltinModule('node:module')
            .createRequire(path.join(app.getAppPath(), 'package.json'));
          const moduleRoot = packaged ? app.getAppPath() : root;
          const { spawnHostedPty } = require(
            path.join(moduleRoot, 'electron/terminal-host-client.cjs'),
          );
          const { createTerminalManager } = require(path.join(moduleRoot, 'electron/terminal.cjs'));
          const events = [];
          const started = Date.now();
          const trace = [];
          const record = (event) => {
            trace.push({ elapsedMs: Date.now() - started, ...event });
            if (trace.length > 30) trace.shift();
          };
          const observedUtility = {
            fork(...args) {
              const host = utilityProcess.fork(...args);
              host.once('spawn', () => record({ type: 'utility-spawn', pid: host.pid }));
              host.on('message', (message) => {
                if (message.type === 'exit' || message.type === 'error')
                  record({ type: 'utility-message', message });
              });
              host.once('exit', (code) => record({ type: 'utility-exit', code }));
              return host;
            },
          };
          const manager = createTerminalManager({
            spawnPty: (...args) => spawnHostedPty(...args, { utilityProcess: observedUtility }),
            emit: (event) => events.push(event),
          });
          globalThis.terminalProbeManager = manager;
          let activeId;
          const capture = () => {
            const state = activeId ? manager.state({ id: activeId }) : null;
            return {
              elapsedMs: Date.now() - started,
              state: state && {
                status: state.status,
                exitCode: state.exitCode,
                sequence: state.sequence,
                markerReceived: state.log.includes('UTILITY_PROBE_READY'),
                cursorPositionQueries: (state.log.match(/\x1b\[\??6n/g) || []).length,
                logTail: state.log.slice(-3000),
              },
              trace: [...trace],
            };
          };
          const wait = async (predicate, label, timeout = 30000) => {
            const until = Date.now() + timeout;
            while (Date.now() < until) {
              if (predicate()) return;
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            throw new Error(`${label}: ${JSON.stringify(capture())}`);
          };
          const prompt = (id) =>
            /(?:^|[\r\n])PS [^\r\n]*> ?$/.test(
              manager
                .state({ id })
                .log.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g, ''),
            );
          const first = manager.open({ cwd: directory });
          activeId = first.id;
          await wait(() => prompt(first.id), 'first PowerShell prompt');
          record({
            type: 'first-prompt',
            cursorPositionQueries: capture().state.cursorPositionQueries,
          });
          manager.resize({ id: first.id, cols: 100, rows: 30 });
          record({ type: 'resize-sent', cols: 100, rows: 30 });
          const utility = app.getAppMetrics().find((item) => item.name === 'Grok terminal');
          manager.write({
            id: first.id,
            data: "Write-Output ('UTILITY_' + 'PROBE_READY'); exit\r",
          });
          record({ type: 'natural-exit-command-sent' });
          await wait(
            () => manager.state({ id: first.id }).status === 'exited',
            'natural utility exit',
            5000,
          );
          const firstState = manager.state({ id: first.id });
          const naturalExit = capture();
          const next = manager.open({ cwd: directory, restart: true });
          activeId = next.id;
          await wait(() => prompt(next.id), 'restarted PowerShell prompt');
          manager.write({
            id: next.id,
            data: `$owned = Start-Process -FilePath '${node.replaceAll("'", "''")}' -ArgumentList '-e','setInterval(()=>{},1000)' -WindowStyle Hidden -PassThru; Write-Output ('DESCENDANT_PID=' + $owned.Id)\r`,
          });
          await wait(
            () => /DESCENDANT_PID=(\d+)/.test(manager.state({ id: next.id }).log),
            'owned descendant PID',
          );
          const descendantPid = Number(
            manager.state({ id: next.id }).log.match(/DESCENDANT_PID=(\d+)/)[1],
          );
          globalThis.terminalProbeDescendant = descendantPid;
          process.kill(descendantPid, 0);
          await manager.close({ id: next.id });
          await wait(
            () => {
              try {
                process.kill(descendantPid, 0);
                return false;
              } catch {
                return true;
              }
            },
            'descendant tree shutdown',
            5000,
          );
          await manager.dispose();
          return {
            packaged,
            moduleRoot,
            utilityType: utility?.type,
            firstStatus: firstState.status,
            firstLog: firstState.log,
            exitEvents: events.filter((event) => event.type === 'terminal-exit').length,
            busy: manager.busy,
            descendantPid,
            descendantStopped: true,
            naturalExit,
          };
        },
        { directory, root, packaged: !!process.env.GROK_DESKTOP_TEST_EXE, node: process.execPath },
      );
      assert.equal(result.utilityType, 'Utility');
      assert.equal(result.firstStatus, 'exited');
      assert.match(result.firstLog, /UTILITY_PROBE_READY/);
      assert.equal(result.exitEvents, 2);
      assert.equal(result.busy, false);
      assert.equal(result.descendantStopped, true);
      delete result.firstLog;
      t.diagnostic(JSON.stringify(result));
    } finally {
      if (app) {
        await app
          .evaluate(async () => {
            await globalThis.terminalProbeManager?.dispose();
          })
          .catch(() => {});
        await app.close().catch(() => {});
      }
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);
