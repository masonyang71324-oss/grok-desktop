'use strict';
// Run after `npm run build`. GROK_DESKTOP_TEST_EXE also supports a packaged build.
// Exercise the registered renderer-gone handler and a real page reload. A forced
// Chromium crash aborts the Playwright driver, so OS crash detection is outside
// this test; recovery, IPC, child transport and history restoration remain real.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
let app,
  page,
  directory,
  phase = 'setup';
const pageErrors = [];

async function events() {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].recoveryEvents);
}

async function send(text) {
  await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).fill(text);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}

(async () => {
  try {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'grok-recovery-e2e-')));
    const userData = path.join(directory, 'userdata'),
      project = path.join(directory, 'project');
    await fs.mkdir(userData);
    await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'fixture.txt'), 'fixture\n');
    await fs.writeFile(
      path.join(userData, 'settings.json'),
      JSON.stringify({
        grokPath: process.execPath,
        lastProject: project,
        recentProjects: [project],
        permissionMode: 'ask',
      }),
    );
    const packaged = process.env.GROK_DESKTOP_TEST_EXE;
    const env = {
      ...process.env,
      GROK_DESKTOP_DATA_DIR: userData,
      GROK_DESKTOP_TEST_GROK_SCRIPT: path.join(root, 'scripts/mock-grok.cjs'),
      GROK_DESKTOP_MOCK_STATE: path.join(directory, 'mock-state.json'),
      GROK_DESKTOP_MOCK_LOG: path.join(directory, 'mock-events.jsonl'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.GROK_DESKTOP_DEV_URL;
    app = await electron.launch({
      executablePath: packaged || require('electron'),
      args: packaged ? [] : [root],
      env,
      timeout: 30000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
    // Observe the actual main-to-preload events across renderer reload without
    // replacing delivery, permissions, or the ACP client with test doubles.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.recoveryEvents = [];
      const original = win.webContents.send.bind(win.webContents);
      win.webContents.send = (channel, payload, ...args) => {
        if (channel === 'desktop:event') {
          for (const event of payload.type === 'event-batch' ? payload.events : [payload])
            win.recoveryEvents.push({
              type: event.type,
              state: event.state,
              sessionId: event.sessionId,
              turnId: event.turnId,
              requestId: event.requestId,
              stopReason: event.result?.stopReason,
            });
        }
        return original(channel, payload, ...args);
      };
    });

    phase = 'pending-permission';
    await send('MOCK_PERMISSION');
    const approval = page.getByRole('dialog', { name: 'Grok 需要你的批准', exact: true });
    await approval.waitFor();
    const originalEvents = await events();
    const originalTurn = originalEvents.find((event) => event.type === 'turn-start');
    const originalPermission = originalEvents.find((event) => event.type === 'permission');
    assert.ok(originalTurn);
    assert.ok(originalPermission);
    assert.equal(originalPermission.sessionId, originalTurn.sessionId);

    phase = 'reload-preserves-live-turn';
    const loaded = page.waitForEvent('domcontentloaded');
    await app.evaluate(({ BrowserWindow, dialog }) => {
      const original = dialog.showMessageBox;
      dialog.showMessageBox = async () => {
        dialog.showMessageBox = original;
        return { response: 0 };
      };
      BrowserWindow.getAllWindows()[0].webContents.emit(
        'render-process-gone',
        {},
        { reason: 'crashed' },
      );
    });
    await loaded;
    const recoveredEvents = await events();
    assert.equal(
      recoveredEvents.some(
        (event) => event.type === 'turn-error' && event.turnId === originalTurn.turnId,
      ),
      false,
      'Renderer reload must preserve the live foreground turn',
    );
    assert.equal(
      recoveredEvents.some(
        (event) =>
          event.type === 'permission-resolved' && event.requestId === originalPermission.requestId,
      ),
      false,
      'Renderer reload must preserve the exact outstanding permission request',
    );
    await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
    await page.locator('.user-text').filter({ hasText: 'MOCK_PERMISSION' }).waitFor();
    await approval.waitFor();
    const tasks = await page.evaluate(
      async () => (await window.desktop.request('tasks.list')).data,
    );
    const live = tasks.find((task) => task.sessionId === originalTurn.sessionId);
    assert.equal(live.turnId, originalTurn.turnId);
    assert.equal(live.permissions[0].requestId, originalPermission.requestId);
    assert.equal(
      recoveredEvents.filter((event) => event.type === 'turn-start').length,
      1,
      'Recovery must never replay a prompt',
    );
    await approval.getByRole('button', { name: '允许本次', exact: true }).click();
    await page.locator('.message.assistant').filter({ hasText: '模拟操作已获准。' }).waitFor();
    await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();

    phase = 'send-after-recovery';
    await send('MOCK_STREAM');
    await page
      .locator('.message.assistant')
      .filter({ hasText: '模拟流式响应：第一段。已完成。' })
      .waitFor();
    await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
    const streamEvents = await events();
    const streamTurn = streamEvents.filter((event) => event.type === 'turn-start').at(-1);
    assert.equal(streamTurn.sessionId, originalTurn.sessionId);
    assert.notEqual(streamTurn.turnId, originalTurn.turnId);
    assert.ok(
      streamEvents.some(
        (event) =>
          event.type === 'turn-end' &&
          event.turnId === streamTurn.turnId &&
          event.stopReason === 'end_turn',
      ),
    );

    phase = 'permission-after-recovery';
    await send('MOCK_PERMISSION');
    await approval.waitFor();
    const freshPermission = (await events()).filter((event) => event.type === 'permission').at(-1);
    assert.notEqual(freshPermission.requestId, originalPermission.requestId);
    await approval.getByRole('button', { name: '允许本次', exact: true }).click();
    await page
      .locator('.message.assistant')
      .filter({ hasText: '模拟操作已获准。' })
      .last()
      .waitFor();
    await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
    assert.equal(await approval.count(), 0);
    assert.ok(
      (await events()).some(
        (event) =>
          event.type === 'permission-resolved' && event.requestId === freshPermission.requestId,
      ),
    );
    const requests = (await fs.readFile(path.join(directory, 'mock-events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      requests.filter((event) => event.type === 'permission-response').map((event) => event.status),
      ['allow-once', 'allow-once'],
      'The preserved and new permission requests receive their explicit approvals exactly once',
    );
    assert.deepEqual(pageErrors, []);
    process.stdout.write('PASS renderer-recovery-preserves-permission-and-resumes-session\n');
  } catch (error) {
    process.stderr.write(`FAIL ${phase}: ${error.message || error}\n`);
    process.exitCode = 1;
  } finally {
    if (app) {
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
