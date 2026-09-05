'use strict';
// Run after building with `node tests/e2e-lifecycle.cjs`.
// GROK_DESKTOP_TEST_EXE selects an installed or unpacked desktop executable.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
let app, page, directory, project, fixturePath;
let phase = 'setup';
const pageErrors = [];
const pass = (name) => process.stdout.write(`PASS ${name}\n`);

async function request(command, payload) {
  const result = await page.evaluate(
    ({ command, payload }) => window.desktop.request(command, payload),
    { command, payload },
  );
  assert.equal(result.ok, true, `${command} must remain available`);
  return result.data;
}

async function launch() {
  const packaged = process.env.GROK_DESKTOP_TEST_EXE;
  const env = {
    ...process.env,
    GROK_DESKTOP_DATA_DIR: path.join(directory, 'userdata'),
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
  page.on('pageerror', (error) => pageErrors.push(error.name));
  // Electron handles beforeunload through its native will-prevent-unload dialog.
  // Stop Playwright from trying to dismiss the already-handled Chromium dialog.
  page.on('dialog', (dialog) => {
    if (dialog.type() !== 'beforeunload') void dialog.dismiss();
  });
  await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
  await page.evaluate(() => {
    window.lifecycleEvents = [];
    window.desktop.onEvent((event) => window.lifecycleEvents.push(event));
  });
  await app.evaluate(({ dialog }) => {
    globalThis.lifecycleDialogs = [];
    globalThis.lifecycleReplies = { sync: 0, async: 0 };
    const record = (kind, args) => {
      const options = args.at(-1);
      const entry = {
        kind,
        title: options.title,
        message: options.message,
        buttons: options.buttons,
        defaultId: options.defaultId,
        cancelId: options.cancelId,
      };
      globalThis.lifecycleDialogs.push(entry);
      globalThis.lifecycleDialogObserved?.();
    };
    dialog.showMessageBoxSync = (...args) => {
      record('sync', args);
      return globalThis.lifecycleReplies.sync;
    };
    dialog.showMessageBox = async (...args) => {
      record('async', args);
      return { response: globalThis.lifecycleReplies.async };
    };
  });
}

async function openEditor(text) {
  await page.locator('.file-row[title="fixture.txt"]').click();
  const editor = page.getByRole('textbox', { name: '文件内容', exact: true });
  if (text !== undefined) await editor.fill(text);
  return editor;
}

async function cancelExit(kind, active = false) {
  // Resolve after the expected native dialog has been answered. Scheduling the
  // close separately lets Playwright finish dispatch even if a regression exits.
  const dialogs = await app.evaluate(
    ({ app, BrowserWindow }, { kind, active }) =>
      new Promise((resolve, reject) => {
        globalThis.lifecycleDialogs = [];
        globalThis.lifecycleReplies = { sync: 0, async: active ? 1 : 0 };
        const expectedCount = active ? 2 : 1;
        const timer = setTimeout(() => reject(new Error('Exit confirmation was not shown')), 5000);
        globalThis.lifecycleDialogObserved = () => {
          if (globalThis.lifecycleDialogs.length < expectedCount) return;
          clearTimeout(timer);
          setImmediate(() => resolve(globalThis.lifecycleDialogs));
        };
        setTimeout(() => {
          if (kind === 'quit') app.quit();
          else BrowserWindow.getAllWindows()[0].close();
        }, 50);
      }),
    { kind, active },
  );
  assert.deepEqual(
    dialogs.map((item) => item.kind),
    active ? ['async', 'sync'] : ['sync'],
  );
  const discard = dialogs.at(-1);
  assert.equal(discard.defaultId, 0, 'continuing to edit must be the default');
  assert.equal(discard.cancelId, 0, 'dismissing the native dialog must preserve edits');
  assert.equal(discard.buttons.length, 2);
  assert.match(discard.buttons[0], /继续编辑/);
  assert.match(discard.buttons[1], /放弃/);
  return dialogs;
}

async function closeAndWait(discard) {
  const current = app;
  const closed = current.waitForEvent('close', { timeout: 10000 });
  await current.evaluate(({ BrowserWindow }, discard) => {
    globalThis.lifecycleReplies = { sync: discard ? 1 : 0, async: 0 };
    globalThis.lifecycleDialogObserved = undefined;
    setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 50);
  }, discard);
  await closed;
  app = null;
}

(async () => {
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-desktop-lifecycle-'));
    project = path.join(directory, 'project');
    const userData = path.join(directory, 'userdata');
    fixturePath = path.join(project, 'fixture.txt');
    await fs.mkdir(project);
    await fs.mkdir(userData);
    await fs.writeFile(fixturePath, 'original on disk\n');
    await fs.writeFile(
      path.join(userData, 'settings.json'),
      JSON.stringify({
        language: 'zh-CN',
        grokPath: process.execPath,
        theme: 'dark',
        permissionMode: 'ask',
        lastProject: project,
        recentProjects: [project],
        notifications: false,
      }),
    );
    await launch();

    phase = 'idle-dirty-close-cancel';
    const editor = await openEditor('important unsaved edit');
    await page.getByText('有未保存的修改', { exact: true }).waitFor();
    await cancelExit('close');
    assert.equal(await editor.inputValue(), 'important unsaved edit');
    assert.equal(await fs.readFile(fixturePath, 'utf8'), 'original on disk\n');
    pass(phase);

    phase = 'dirty-app-quit-cancel-keeps-ipc';
    await cancelExit('quit');
    await editor.fill('still editable after cancelling app.quit');
    assert.equal(await editor.inputValue(), 'still editable after cancelling app.quit');
    await request('sessions.list', { cwd: project });
    await page.getByRole('button', { name: '保存文件', exact: true }).click();
    await page.getByText('所有修改已保存', { exact: true }).waitFor();
    const baseline = 'still editable after cancelling app.quit';
    assert.equal(await fs.readFile(fixturePath, 'utf8'), baseline);
    await page.getByRole('button', { name: '关闭 · Esc', exact: true }).click();
    pass(phase);

    phase = 'active-task-exit-cancel-keeps-task';
    await page
      .getByRole('textbox', { name: '发送给 Grok 的消息', exact: true })
      .fill('MOCK_CANCEL');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.getByText('正在等待停止。', { exact: true }).waitFor();
    const runningEditor = await openEditor('unsaved edit while task is active');
    await cancelExit('close', true);
    assert.equal(await runningEditor.inputValue(), 'unsaved edit while task is active');
    assert.equal(await fs.readFile(fixturePath, 'utf8'), baseline);
    assert.equal(
      await page.evaluate(() =>
        window.lifecycleEvents.some((event) => event.type === 'turn-error'),
      ),
      false,
    );
    const [{ sessionId }] = await request('sessions.list', { cwd: project });
    await request('session.cancel', { sessionId });
    await page.waitForFunction(() =>
      window.lifecycleEvents.some(
        (event) => event.type === 'turn-end' && event.result?.stopReason === 'cancelled',
      ),
    );
    const log = (await fs.readFile(path.join(directory, 'mock-events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(
      log.some((item) => item.type === 'request' && item.method === 'session/cancel'),
      true,
    );
    pass(phase);

    phase = 'explicit-discard-closes-without-writing';
    await closeAndWait(true);
    assert.equal(await fs.readFile(fixturePath, 'utf8'), baseline);
    pass(phase);

    phase = 'saved-editor-closes-without-confirmation';
    await launch();
    await openEditor('saved before normal exit');
    await page.getByRole('button', { name: '保存文件', exact: true }).click();
    await page.getByText('所有修改已保存', { exact: true }).waitFor();
    assert.equal(await fs.readFile(fixturePath, 'utf8'), 'saved before normal exit');
    // Replies remain cancel: any unexpected confirmation keeps the app open and fails.
    await closeAndWait(false);
    assert.equal(await fs.readFile(fixturePath, 'utf8'), 'saved before normal exit');
    assert.deepEqual(pageErrors, []);
    pass(phase);
  } catch (error) {
    process.stderr.write(`FAIL ${phase}: ${error.stack || error}\n`);
    process.exitCode = 1;
  } finally {
    if (app) {
      const closed = app.waitForEvent('close', { timeout: 10000 }).catch(() => {});
      await app
        .evaluate(({ app }) => {
          setTimeout(() => app.exit(), 50);
        })
        .catch(() => {});
      await closed;
      await app.close().catch(() => {});
    }
    if (directory) process.stdout.write(`Artifacts: ${directory}\n`);
  }
})();
