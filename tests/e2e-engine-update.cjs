'use strict';
// Run after npm run build. GROK_DESKTOP_TEST_EXE selects a packaged build.
// Every CLI process runs a disposable copy of Node. The official installer is
// replaced in the main process before the update button can invoke it.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
let app,
  page,
  directory,
  project,
  fakeExecutable,
  versionFile,
  transportLog,
  phase = 'setup';
const pageErrors = [];
const draft = 'Keep this draft while the engine updates.';
const originalPrompt = 'MOCK_STREAM engine update fixture';
const pass = () => process.stdout.write(`PASS ${phase}\n`);

async function until(action, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await action();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(message);
}

async function jsonLines(filename) {
  const text = await fs.readFile(filename, 'utf8');
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function request(command, payload) {
  const result = await page.evaluate(
    ({ command, payload }) => window.desktop.request(command, payload),
    { command, payload },
  );
  assert.equal(result.ok, true, `${command}: ${result.error || 'request failed'}`);
  return result.data;
}

async function installLocalFixture() {
  await app.evaluate(
    ({ app }, fixturePaths) => {
      const modules = process.getBuiltinModule('module');
      const requireFromApp = modules.createRequire(`${app.getAppPath()}/electron/main.cjs`);
      const { CliInstaller } = requireFromApp('./cli-installer.cjs');
      const fs = process.getBuiltinModule('fs');
      const path = process.getBuiltinModule('path');
      const fixture = (globalThis.engineUpdateFixture = {
        calls: [],
        fail: false,
        release: null,
      });
      CliInstaller.prototype.start = function ({ binDir = this.binDir, version } = {}) {
        if (path.resolve(binDir) !== path.dirname(fixturePaths.executable))
          throw new Error('Fixture installer must only target the disposable Node copy');
        if (version !== '1.0.70') throw new Error('Fixture installer requires version 1.0.70');
        const call = { binDir, version, copied: false };
        fixture.calls.push(call);
        this.current = {
          status: 'installing',
          log: 'Local fixture: official installer repairing Grok 1.0.70…\n',
        };
        this._publish({});
        return new Promise((resolve) => {
          fixture.release = async () => {
            fixture.release = null;
            try {
              if (fixture.fail) throw new Error('Fixture official repair failed');
              // This real overwrite fails on Windows if an old owned CLI still
              // runs from the target executable. No system Node file is changed.
              fs.copyFileSync(fixturePaths.node, fixturePaths.executable);
              call.copied = true;
              fs.writeFileSync(fixturePaths.versionFile, version);
              this._publish({ status: 'verifying' });
              this._publish({ status: 'installed', path: fixturePaths.executable, version });
            } catch (error) {
              this._publish({ status: 'error', error: error.message });
            }
            resolve(this.state());
          };
        });
      };
    },
    { node: process.execPath, executable: fakeExecutable, versionFile },
  );
}

async function launch() {
  const profile = path.join(directory, 'profile');
  const userData = path.join(directory, 'userdata');
  const grokHome = path.join(directory, 'grok-home');
  const binDir = path.join(directory, 'bin');
  project = path.join(directory, 'project');
  fakeExecutable = path.join(binDir, 'grok.exe');
  versionFile = path.join(directory, 'version.txt');
  transportLog = path.join(directory, 'transports.jsonl');
  const mockScript = path.join(directory, 'mock-update.cjs');
  await Promise.all(
    [
      profile,
      userData,
      grokHome,
      binDir,
      project,
      path.join(profile, 'AppData', 'Local'),
      path.join(profile, 'AppData', 'Roaming'),
    ].map((folder) => fs.mkdir(folder, { recursive: true })),
  );
  await fs.copyFile(process.execPath, fakeExecutable);
  await fs.writeFile(versionFile, '1.0.52');
  await fs.writeFile(transportLog, '');
  await fs.writeFile(path.join(project, 'fixture.txt'), 'local update fixture\n');
  await fs.writeFile(
    mockScript,
    `const fs = require('node:fs');
const args = process.argv.slice(2).filter((value) => value !== '--no-auto-update');
const version = fs.readFileSync(${JSON.stringify(versionFile)}, 'utf8').trim();
if (args[0] === '--version') {
  process.stdout.write('grok ' + version + ' (local update fixture)\\n');
  process.exit(0);
}
if (args[0] === 'models') {
  process.stdout.write('You are logged in with grok.com.\\n');
  process.exit(0);
}
if (args[0] === 'update' && args.includes('--check')) {
  process.stdout.write(JSON.stringify({currentVersion: version, latestVersion: '1.0.70', updateAvailable: version !== '1.0.70', error: null}) + '\\n');
  process.exit(0);
}
if (args[0] === 'agent') {
  fs.appendFileSync(${JSON.stringify(transportLog)}, JSON.stringify({pid: process.pid, version}) + '\\n');
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    if (String(chunk).includes('"agentInfo"')) {
      const reply = JSON.parse(String(chunk));
      if (reply.result?.agentInfo) {
        reply.result.agentInfo.version = version;
        return write(JSON.stringify(reply) + '\\n', ...rest);
      }
    }
    return write(chunk, ...rest);
  };
}
process.argv = [process.argv[0], process.argv[1], ...args];
require(${JSON.stringify(path.join(root, 'scripts', 'mock-grok.cjs'))});
`,
  );
  await fs.writeFile(
    path.join(userData, 'settings.json'),
    JSON.stringify({
      language: 'zh-CN',
      grokPath: fakeExecutable,
      theme: 'dark',
      lastProject: project,
      recentProjects: [project],
      permissionMode: 'ask',
      notifications: false,
    }),
  );
  const env = {
    ...process.env,
    USERPROFILE: profile,
    APPDATA: path.join(profile, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(profile, 'AppData', 'Local'),
    GROK_HOME: grokHome,
    GROK_DESKTOP_DATA_DIR: userData,
    GROK_DESKTOP_TEST_GROK_SCRIPT: mockScript,
    GROK_DESKTOP_MOCK_STATE: path.join(directory, 'mock-state.json'),
    GROK_DESKTOP_MOCK_LOG: path.join(directory, 'mock-events.jsonl'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.GROK_DESKTOP_DEV_URL;
  delete env.GROK_DEPLOYMENT_KEY;
  const packaged = process.env.GROK_DESKTOP_TEST_EXE;
  app = await electron.launch({
    executablePath: packaged || require('electron'),
    args: packaged ? [] : [root],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('dialog', (dialog) => {
    if (dialog.type() !== 'beforeunload') void dialog.dismiss();
  });
  await installLocalFixture();
  await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
  await page.locator('.new-conversation:not(:disabled)').waitFor();
  await page.evaluate(() => {
    window.engineUpdateEvents = [];
    window.desktop.onEvent((event) => window.engineUpdateEvents.push(event));
  });
}

async function assertPreserved(sessionId) {
  assert.equal(
    await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).inputValue(),
    draft,
  );
  await page.locator('.user-text').filter({ hasText: originalPrompt }).waitFor();
  const state = JSON.parse(await fs.readFile(path.join(directory, 'mock-state.json'), 'utf8'));
  assert.deepEqual(
    state.sessions.map((session) => session.sessionId),
    [sessionId],
  );
  const log = await jsonLines(path.join(directory, 'mock-events.jsonl'));
  assert.equal(
    log.filter((event) => event.type === 'prompt').length,
    1,
    'Update must not replay a prompt',
  );
}

(async () => {
  try {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'grok-engine-update-')));
    await launch();
    phase = 'completed-session-and-unsent-draft';
    const composer = page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true });
    await composer.fill(originalPrompt);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page
      .locator('.message.assistant')
      .filter({ hasText: '模拟流式响应：第一段。已完成。' })
      .waitFor();
    await until(
      async () =>
        !(await request('tasks.list')).some((task) =>
          ['running', 'queued', 'cancelling'].includes(task.status),
        ),
      'Fixture turn did not finish',
    );
    await composer.fill(draft);
    const [session] = await request('sessions.list', { cwd: project });
    assert.ok(session?.sessionId);
    await assertPreserved(session.sessionId);
    pass();

    phase = 'failed-self-update-enters-official-repair';
    const oldTransports = await jsonLines(transportLog);
    const oldPids = [...new Set(oldTransports.map((event) => event.pid))];
    assert.ok(
      oldPids.length >= 2,
      'Catalog and completed-session processes must exist before update',
    );
    assert.ok(oldPids.every(alive));
    await page.getByRole('button', { name: 'Grok Build 引擎详情', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Grok Build 引擎', exact: true });
    await dialog.getByRole('button', { name: '更新 Grok Build', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: '官方安装程序自动修复' }).waitFor();
    await dialog
      .getByText('Local fixture: official installer repairing Grok 1.0.70…', { exact: true })
      .waitFor();
    await until(
      () => oldPids.every((pid) => !alive(pid)),
      'Old catalog/session processes survived into repair',
    );
    const installer = await app.evaluate(() => globalThis.engineUpdateFixture.calls);
    assert.deepEqual(installer, [
      { binDir: path.dirname(fakeExecutable), version: '1.0.70', copied: false },
    ]);
    assert.equal(
      await dialog.getByRole('alert').count(),
      0,
      'Self-update failure is not a final error during repair',
    );
    const concurrentLogin = await page.evaluate(() => window.desktop.request('cli.login'));
    assert.equal(concurrentLogin.ok, false, 'repair must not start a concurrent sign-in process');
    const concurrentPicker = await page.evaluate(() => window.desktop.request('dialog.grok'));
    assert.equal(concurrentPicker.ok, false, 'repair must not open an executable picker/probe');
    await page.screenshot({ path: path.join(directory, 'repairing.png') });
    pass();

    phase = 'close-is-blocked-while-repair-is-pending';
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => !win.getParentWindow())
        .close();
    });
    await page.waitForFunction(() =>
      window.engineUpdateEvents.some(
        (event) => event.type === 'notification' && event.kind === 'engine-update-wait',
      ),
    );
    assert.equal(page.isClosed(), false);
    assert.equal(
      await dialog.getByRole('button', { name: '更新 Grok Build', exact: true }).isDisabled(),
      true,
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    assert.deepEqual(
      await jsonLines(transportLog),
      oldTransports,
      'The renderer must not restart CLI processes while the installer is gated',
    );
    pass();

    phase = 'repair-overwrites-only-disposable-executable-and-reconnects';
    await app.evaluate(async () => globalThis.engineUpdateFixture.release());
    await dialog.getByText('Grok Build 已更新至 1.0.70。', { exact: true }).waitFor();
    await dialog.getByText('1.0.70', { exact: true }).waitFor();
    assert.equal((await request('cli.status')).version, '1.0.70');
    assert.equal(await app.evaluate(() => globalThis.engineUpdateFixture.calls[0].copied), true);
    const statuses = await page.evaluate(() =>
      window.engineUpdateEvents
        .filter((event) => event.type === 'engine-update-state')
        .map((event) => event.state.status),
    );
    let previous = -1;
    for (const status of [
      'stopping',
      'updating',
      'repairing',
      'verifying',
      'reconnecting',
      'completed',
    ]) {
      const index = statuses.indexOf(status, previous + 1);
      assert.ok(index > previous, `Missing or out-of-order engine update state: ${status}`);
      previous = index;
    }
    assert.ok((await jsonLines(transportLog)).some((event) => event.version === '1.0.70'));
    await page.keyboard.press('Escape');
    await assertPreserved(session.sessionId);
    pass();

    phase = 'failed-repair-preserves-surviving-version-and-original-update-error';
    await fs.writeFile(versionFile, '1.0.52');
    await app.evaluate(() => {
      globalThis.engineUpdateFixture.fail = true;
    });
    await page.evaluate(() => {
      window.engineUpdateEvents = [];
    });
    await page.getByRole('button', { name: 'Grok Build 引擎详情', exact: true }).click();
    await dialog.getByRole('button', { name: '更新 Grok Build', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: '官方安装程序自动修复' }).waitFor();
    await app.evaluate(async () => globalThis.engineUpdateFixture.release());
    const alert = dialog.getByRole('alert');
    await alert.filter({ hasText: 'Fixture official repair failed' }).waitFor();
    assert.match(await alert.innerText(), /原始更新错误/);
    assert.match(await alert.innerText(), /1\.0\.52/);
    await dialog.getByText('1.0.52', { exact: true }).waitFor();
    assert.equal((await request('cli.status')).version, '1.0.52');
    assert.equal(
      await dialog.getByText('Grok Build 已更新至 1.0.70。', { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.evaluate(() =>
        window.engineUpdateEvents.some(
          (event) => event.type === 'engine-update-state' && event.state.status === 'completed',
        ),
      ),
      false,
    );
    await page.keyboard.press('Escape');
    await assertPreserved(session.sessionId);
    assert.deepEqual(pageErrors, []);
    pass();
  } catch (error) {
    process.stderr.write(`FAIL ${phase}: ${error.stack || error}\n`);
    process.exitCode = 1;
    if (page && !page.isClosed())
      await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
  } finally {
    if (app) {
      const released = await app
        .evaluate(async () => {
          const fixture = globalThis.engineUpdateFixture;
          if (fixture?.release) {
            fixture.fail = true;
            await fixture.release();
            return true;
          }
          return false;
        })
        .catch(() => false);
      if (released && page && !page.isClosed())
        await page
          .waitForFunction(() => {
            const state = window.engineUpdateEvents
              ?.filter((event) => event.type === 'engine-update-state')
              .at(-1)?.state.status;
            return state === 'completed' || state === 'error';
          })
          .catch(() => {});
      await app
        .evaluate(({ app, dialog }) => {
          dialog.showMessageBox = async () => ({ response: 1 });
          app.quit();
        })
        .catch(() => {});
      await app.close().catch(() => {});
    }
    if (directory) process.stdout.write(`Artifacts: ${directory}\n`);
  }
})();
