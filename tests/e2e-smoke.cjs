'use strict';
// Run with `npm run test:e2e` after building. GROK_DESKTOP_TEST_EXE selects
// an installed or unpacked desktop executable instead of source Electron.
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
const pass = (type) => process.stdout.write(`PASS ${type}\n`);
async function request(command, payload) {
  const result = await page.evaluate(
    async ({ command, payload }) => window.desktop.request(command, payload),
    { command, payload },
  );
  assert.equal(result.ok, true, `${command} must succeed`);
  return result.data;
}
async function launch(language = 'zh-CN') {
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
  await page
    .locator('.sidebar-status')
    .filter({ hasText: language === 'en' ? 'Grok connected' : 'Grok 已连接' })
    .waitFor();
  await page.evaluate(() => {
    window.smokeEvents = [];
    window.desktop.onEvent((event) =>
      window.smokeEvents.push({
        type: event.type,
        sessionId: event.sessionId,
        update: event.update?.sessionUpdate,
        stopReason: event.result?.stopReason,
      }),
    );
  });
}
async function send(text) {
  await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).fill(text);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}
async function waitEnd(reason = 'end_turn') {
  await page.waitForFunction(
    (expected) =>
      window.smokeEvents.some(
        (event) => event.type === 'turn-end' && event.stopReason === expected,
      ),
    reason,
  );
}
async function resetEvents() {
  await page.evaluate(() => {
    window.smokeEvents = [];
  });
}
async function mockLog() {
  return (await fs.readFile(path.join(directory, 'mock-events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

(async () => {
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-desktop-e2e-'));
    const userData = path.join(directory, 'userdata'),
      project = path.join(directory, 'project');
    await fs.mkdir(userData);
    await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'fixture.txt'), 'fixture\n');
    await fs.writeFile(
      path.join(userData, 'settings.json'),
      JSON.stringify({
        grokPath: process.execPath,
        theme: 'dark',
        permissionMode: 'ask',
        lastProject: project,
        recentProjects: [project],
      }),
    );
    phase = 'initialize';
    await launch();
    const version = await app.evaluate(({ app }) => app.getVersion());
    assert.equal(
      JSON.parse(await fs.readFile(path.join(directory, 'mock-state.json'), 'utf8')).clientVersion,
      version,
    );
    pass('initialize-version');

    phase = 'executable-picker';
    await app.evaluate(({ dialog }, executable) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => {
        dialog.showOpenDialog = original;
        return { canceled: false, filePaths: [executable] };
      };
    }, process.execPath);
    assert.equal(await request('dialog.grok'), process.execPath);
    pass('executable-picker');

    phase = 'file-drop';
    const fixturePath = path.join(project, 'fixture.txt');
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'smoke-disk-file';
      input.hidden = true;
      document.body.append(input);
    });
    // A path-backed browser File is required: an in-memory File has no native path.
    await page.locator('#smoke-disk-file').setInputFiles(fixturePath);
    const droppedPaths = await page.evaluate(() => {
      const input = document.querySelector('#smoke-disk-file');
      const transfer = new DataTransfer();
      for (const file of input.files) transfer.items.add(file);
      const paths = window.desktop.pathsForFiles(Array.from(transfer.files));
      document
        .querySelector('.composer')
        .dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      input.remove();
      return paths;
    });
    assert.deepEqual(droppedPaths, [{ name: 'fixture.txt', path: fixturePath }]);
    const attachment = page.locator('.attachment-list > span').filter({ hasText: 'fixture.txt' });
    await attachment.waitFor();
    assert.equal(await attachment.getAttribute('title'), fixturePath);
    await attachment.getByRole('button', { name: '移除 fixture.txt', exact: true }).click();
    await attachment.waitFor({ state: 'detached' });
    pass('native-file-drop-and-remove');

    phase = 'workspace-watch';
    await page.locator('.inspector .file-row').filter({ hasText: 'fixture.txt' }).waitFor();
    const externalFile = path.join(project, 'external-change.txt');
    await resetEvents();
    await fs.writeFile(externalFile, 'Created outside the renderer.\n');
    await page.waitForFunction(() =>
      window.smokeEvents.some((event) => event.type === 'workspace-changed'),
    );
    const externalEntry = page.locator('.workspace-entry').filter({
      has: page.locator('.file-row').filter({ hasText: 'external-change.txt' }),
    });
    await externalEntry.waitFor();
    assert.equal(
      await page.evaluate(() => window.smokeEvents.some((event) => event.type === 'turn-end')),
      false,
    );
    pass('external-workspace-refresh');

    phase = 'external-open';
    await app.evaluate(({ shell }) => {
      globalThis.smokeOriginalShell = {
        openPath: shell.openPath,
        showItemInFolder: shell.showItemInFolder,
      };
      globalThis.smokeShellOpened = new Promise((resolve) => {
        shell.openPath = async (target) => {
          resolve(target);
          return '';
        };
      });
      globalThis.smokeShellRevealed = new Promise((resolve) => {
        shell.showItemInFolder = (target) => {
          resolve(target);
        };
      });
    });
    await externalEntry.hover();
    await externalEntry
      .getByRole('button', { name: '用默认程序打开 external-change.txt', exact: true })
      .click();
    assert.equal(await app.evaluate(() => globalThis.smokeShellOpened), externalFile);
    await externalEntry
      .getByRole('button', { name: '在资源管理器显示 external-change.txt', exact: true })
      .click();
    assert.equal(await app.evaluate(() => globalThis.smokeShellRevealed), externalFile);
    await app.evaluate(({ shell }) => {
      Object.assign(shell, globalThis.smokeOriginalShell);
      delete globalThis.smokeOriginalShell;
      delete globalThis.smokeShellOpened;
      delete globalThis.smokeShellRevealed;
    });
    pass('external-file-open-and-reveal');

    phase = 'stream';
    await send('MOCK_STREAM');
    await page.locator('.message.assistant .live-label').waitFor();
    await waitEnd();
    assert.ok(
      (await page.evaluate(
        () => window.smokeEvents.filter((event) => event.update === 'agent_message_chunk').length,
      )) >= 3,
    );
    assert.match(
      await page.locator('.message.assistant').last().innerText(),
      /模拟流式响应：第一段。已完成。/,
    );
    const firstSession = (await request('sessions.list', { cwd: project }))[0].sessionId;
    pass('streaming');

    phase = 'permission';
    await resetEvents();
    await send('MOCK_PERMISSION');
    const approval = page.getByRole('dialog', { name: 'Grok 需要你的批准', exact: true });
    await approval.waitFor();
    const repliesBefore = (await mockLog()).filter(
      (event) => event.type === 'permission-response',
    ).length;
    await page.locator('.modal-backdrop').click({ position: { x: 3, y: 3 } });
    await request('sessions.list', { cwd: project }); // Ordered ACP round trip before asserting that no reply was sent.
    await approval.waitFor();
    assert.equal(
      (await mockLog()).filter((event) => event.type === 'permission-response').length,
      repliesBefore,
    );
    await approval.getByRole('button', { name: '允许本次', exact: true }).click();
    await waitEnd();
    assert.equal(
      (await mockLog()).filter((event) => event.type === 'permission-response').at(-1).status,
      'allow-once',
    );
    pass('permission-mask-and-reply');

    phase = 'cancel';
    await resetEvents();
    await send('MOCK_CANCEL');
    await page.getByText('正在等待停止。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '停止生成', exact: true }).click();
    await waitEnd('cancelled');
    pass('cancel');

    phase = 'history-load';
    await page
      .getByRole('button', { name: /新建会话/ })
      .first()
      .click();
    await page.waitForFunction(() => !document.querySelector('.new-conversation').disabled);
    await page.locator('.session-select').filter({ hasText: '模拟会话 1' }).click();
    await page.locator('.message.assistant').first().waitFor();
    assert.equal(
      (await request('session.permissions', { sessionId: firstSession, permissionMode: 'ask' }))
        .sessionId,
      firstSession,
    );
    assert.match(await page.locator('.message.assistant').first().innerText(), /模拟流式响应/);
    pass('history-load');

    phase = 'settings-persistence';
    const savedSettings = await request('settings.save', {
      notifications: false,
      ui: { sidebar: true, inspector: false, inspectorTab: 'changes' },
    });
    assert.equal(savedSettings.notifications, false);
    assert.deepEqual(savedSettings.ui, {
      sidebar: true,
      inspector: false,
      inspectorTab: 'changes',
    });
    const normalBounds = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win.isMaximized()) win.unmaximize();
      win.setBounds({ x: 60, y: 60, width: 1160, height: 780 });
      return win.getNormalBounds();
    });

    phase = 'draft-close-flush';
    const draft = 'E2E draft saved immediately before closing';
    await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).fill(draft);
    await app.close();
    app = null;
    await launch();
    await page.waitForFunction(
      (value) =>
        document.querySelector('textarea[aria-label="发送给 Grok 的消息"]').value === value,
      draft,
    );
    pass('draft-close-flush');
    const restoredSettings = (await request('bootstrap')).settings;
    assert.equal(restoredSettings.notifications, false);
    assert.deepEqual(restoredSettings.ui, {
      sidebar: true,
      inspector: false,
      inspectorTab: 'changes',
    });
    for (const key of ['x', 'y', 'width', 'height'])
      assert.equal(restoredSettings.window[key], normalBounds[key]);
    assert.equal(restoredSettings.window.maximized, false);
    await page.locator('.app.inspector-hidden').waitFor();
    pass('settings-window-and-ui');

    phase = 'rendering-screenshots';
    await page
      .getByRole('button', { name: /新建会话/ })
      .first()
      .click();
    await page.waitForFunction(() => !document.querySelector('.new-conversation').disabled);
    await resetEvents();
    await send('展示代码和文件修改。MOCK_RENDER');
    await waitEnd();
    await page.locator('.code-block code .hljs-keyword').first().waitFor();
    await page.locator('.tool-row summary').click();
    assert.equal(
      await page.locator('.tool-diff-new pre').textContent(),
      'theme = "dark"\nnotifications = true',
    );
    const screenshots = path.join(root, 'test-results');
    await fs.mkdir(screenshots, { recursive: true });
    await page.screenshot({ path: path.join(screenshots, 'e2e-desktop.png') });
    await page.locator('.tool-diff').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(screenshots, 'e2e-diff.png') });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.screenshot({ path: path.join(screenshots, 'e2e-settings.png') });
    pass('rendering-screenshots');

    phase = 'language-switch';
    const codeBefore = await page.locator('.code-block code').first().elementHandle();
    const codeText = await codeBefore.textContent();
    const messageBefore = await page.locator('.message.user .user-text').last().innerText();
    await page.getByRole('button', { name: '浅色', exact: true }).click();
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
    assert.equal(await page.locator('.theme-options .selected').innerText(), 'Light');
    assert.equal((await request('bootstrap')).settings.theme, 'dark');
    assert.equal((await request('bootstrap')).settings.language, 'en');
    assert.equal(
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].label),
      'Edit',
    );
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(
      await codeBefore.evaluate((node) => node === document.querySelector('.code-block code')),
      true,
    );
    assert.equal(await codeBefore.textContent(), codeText);
    assert.equal(await page.locator('.message.user .user-text').last().innerText(), messageBefore);
    await page.screenshot({ path: path.join(screenshots, 'e2e-settings-en.png') });
    await page.getByRole('button', { name: 'Close · Esc', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Copy code', exact: true }).first().waitFor();
    await page.locator('.permission-trigger').click();
    await page.getByRole('menuitemradio', { name: /Ask when needed/ }).waitFor();
    await page.getByRole('menuitemradio', { name: /Ask when needed/ }).click();
    await page.screenshot({ path: path.join(screenshots, 'e2e-desktop-en.png') });
    pass('language-live-switch-preserves-content-and-unsaved-settings');

    phase = 'english-approval';
    await resetEvents();
    await page
      .getByRole('textbox', { name: 'Message to Grok', exact: true })
      .fill('MOCK_PERMISSION');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const englishApproval = page.getByRole('dialog', {
      name: 'Grok needs your approval',
      exact: true,
    });
    await englishApproval.waitFor();
    await page.screenshot({ path: path.join(screenshots, 'e2e-permission-en.png') });
    await englishApproval.getByRole('button', { name: 'Allow once', exact: true }).click();
    await waitEnd();
    assert.equal(
      (await mockLog()).filter((event) => event.type === 'permission-response').at(-1).status,
      'allow-once',
    );
    pass('english-approval-keeps-protocol-option');

    phase = 'translated-task-status';
    await resetEvents();
    await page.getByRole('textbox', { name: 'Message to Grok', exact: true }).fill('MOCK_CANCEL');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText('正在等待停止。', { exact: true }).last().waitFor();
    await page.getByRole('button', { name: 'Stop generating', exact: true }).click();
    await waitEnd('cancelled');
    await page.getByText('Task stopped. Edit your request to continue.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN');
    await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
    await page.getByText('任务已停止。你可以编辑请求后继续。', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close · Esc', exact: true }).click();
    await page.getByText('Task stopped. Edit your request to continue.', { exact: true }).waitFor();
    pass('completed-task-status-follows-language');

    phase = 'language-restart';
    const multilingualDraft = '继续这个任务 / Continue this task: const 文本 = "你好";';
    await page
      .getByRole('textbox', { name: 'Message to Grok', exact: true })
      .fill(multilingualDraft);
    await app.close();
    app = null;
    await launch('en');
    // Catalog connectivity precedes loading the independent session transport.
    await page.waitForFunction(
      (value) => document.querySelector('textarea[aria-label="Message to Grok"]')?.value === value,
      multilingualDraft,
    );
    assert.equal(
      await page.getByRole('textbox', { name: 'Message to Grok', exact: true }).inputValue(),
      multilingualDraft,
    );
    assert.equal((await request('bootstrap')).settings.language, 'en');
    assert.equal(
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].label),
      'Edit',
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN');
    await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
    await page.getByRole('button', { name: '关闭 · Esc', exact: true }).click();
    assert.equal(
      await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).inputValue(),
      multilingualDraft,
    );
    assert.equal((await request('bootstrap')).settings.language, 'zh-CN');
    assert.equal(
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].label),
      '编辑',
    );
    pass('language-restart-and-switch-back-with-draft');
    assert.deepEqual(pageErrors, []);
    pass('renderer-errors-none');
  } catch (error) {
    process.stderr.write(`FAIL ${phase} ${error.stack || error}\n`);
    process.exitCode = 1;
  } finally {
    if (app) {
      await app.evaluate(({ app }) => app.exit()).catch(() => {});
      await app.close().catch(() => {});
    }
    if (directory) process.stdout.write(`Artifacts: ${directory}\n`);
  }
})();
