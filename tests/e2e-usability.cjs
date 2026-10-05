'use strict';
// Run after npm run build. Uses only owned temporary data, projects and a local ACP fixture.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const evidence = path.join(
  root,
  'test-results',
  process.env.GROK_DESKTOP_TEST_EXE ? 'usability-packaged' : 'usability',
);
let app,
  page,
  directory,
  env,
  language = 'zh-CN',
  phase = 'setup';
const errors = [];
const passes = [];
const screenshots = [];
const label = (zh, en) => (language === 'zh-CN' ? zh : en);
const composer = () => page.locator('textarea').first();
async function response(command, payload = {}) {
  return page.evaluate(({ command, payload }) => window.desktop.request(command, payload), {
    command,
    payload,
  });
}
async function request(command, payload) {
  const result = await response(command, payload);
  assert.equal(result.ok, true, `${command}: ${result.error || ''}`);
  return result.data;
}
async function until(fn, message = phase) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out: ${message}`);
}
async function idle(id) {
  return until(async () =>
    (await request('tasks.list')).find(
      (task) =>
        task.sessionId === id &&
        task.status === 'idle' &&
        !task.finishing &&
        task.lastTurn?.status === 'completed',
    ),
  );
}
async function launch() {
  const executable = process.env.GROK_DESKTOP_TEST_EXE;
  app = await _electron.launch({
    executablePath: executable || require('electron'),
    args: executable ? [] : [root],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .locator('.sidebar-status')
    .filter({ hasText: label('Grok 已连接', 'Grok connected') })
    .waitFor();
  await page.evaluate(() => {
    window.usabilityEvents = [];
    window.desktop.onEvent((event) => window.usabilityEvents.push(event));
  });
}
async function screenshot(name) {
  // Chromium page screenshots clip to logical CSS dimensions at Electron zoom > 100%.
  // Capture the complete native webContents surface, including enlarged controls.
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
  );
  await fs.writeFile(path.join(evidence, `${name}.png`), Buffer.from(png, 'base64'));
  screenshots.push(`${name}.png`);
}
function pass() {
  passes.push(phase);
  console.log(`PASS ${phase}`);
}
async function navigate(session, requestId) {
  // Native notification click construction is covered by desktop-services.test.cjs.
  // Exercise its exact main-to-renderer event and the real session loader here.
  await app.evaluate(
    ({ BrowserWindow }, payload) =>
      BrowserWindow.getAllWindows()[0].webContents.send('desktop:event', {
        type: 'notification-activate',
        ...payload,
      }),
    { session, requestId },
  );
  await page
    .locator(`[data-window-row="${session.sessionId}"] .session-select[aria-current="true"]`)
    .waitFor();
}
async function openSettings() {
  await page.keyboard.press('Control+,');
  await page.getByRole('dialog', { name: label('设置', 'Settings'), exact: true }).waitFor();
}
async function closeSettings() {
  await page
    .getByRole('dialog', { name: label('设置', 'Settings'), exact: true })
    .getByRole('button', { name: label('关闭 · Esc', 'Close · Esc'), exact: true })
    .click();
}
async function usable(locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click({ trial: true });
  const box = await locator.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.ok(
    box &&
      box.width > 16 &&
      box.height > 16 &&
      box.x >= -1 &&
      box.y >= -1 &&
      box.x + box.width <= viewport.width + 1 &&
      box.y + box.height <= viewport.height + 1,
    'control stays inside viewport',
  );
}
async function nativeDrop(files) {
  const client = await page.context().newCDPSession(page);
  const box = await page.locator('.composer').boundingBox();
  assert.ok(box, 'composer drop surface exists');
  const position = { x: box.x + box.width / 2, y: box.y + Math.min(25, box.height / 2) };
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop'])
    await client.send('Input.dispatchDragEvent', { type, ...position, data });
  await client.detach();
}

(async () => {
  try {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'grok usability ')));
    const data = path.join(directory, 'data');
    const home = path.join(directory, 'grok-home');
    const projectA = path.join(directory, 'project A');
    const projectB = path.join(directory, 'project B');
    const droppedProject = path.join(directory, 'dropped project');
    const attachment = path.join(directory, 'ordinary.txt');
    await Promise.all(
      [data, home, projectA, projectB, droppedProject, evidence].map((folder) =>
        fs.mkdir(folder, { recursive: true }),
      ),
    );
    await Promise.all(
      [projectA, projectB, droppedProject].map((folder) =>
        fs.writeFile(path.join(folder, 'fixture.txt'), 'before\n'),
      ),
    );
    await fs.writeFile(attachment, 'ordinary attachment');
    await fs.writeFile(
      path.join(data, 'settings.json'),
      JSON.stringify({
        grokPath: process.execPath,
        language,
        permissionMode: 'ask',
        lastProject: projectA,
        recentProjects: [projectA, projectB],
        notifications: false,
        theme: 'dark',
      }),
    );
    // Extend only the owned fixture so the real ACP transport presents a structured approval.
    const fixtureSource = await fs.readFile(path.join(root, 'scripts/mock-grok.cjs'), 'utf8');
    const permissionInput = "rawInput: { path: 'fixture.txt' },";
    assert.ok(fixtureSource.includes(permissionInput));
    const fixture = path.join(directory, 'mock-usability.cjs');
    await fs.writeFile(
      fixture,
      fixtureSource.replaceAll(
        permissionInput,
        "rawInput: { command: 'Remove-Item -LiteralPath fixture.txt', cwd: session.cwd, path: 'fixture.txt' }, content: [{ type: 'diff', path: 'fixture.txt', oldText: 'before\\n', newText: 'after\\n' }],",
      ),
    );
    env = {
      ...process.env,
      GROK_HOME: home,
      GROK_DESKTOP_DATA_DIR: data,
      GROK_DESKTOP_TEST_GROK_SCRIPT: fixture,
      GROK_DESKTOP_MOCK_STATE: path.join(directory, 'mock.json'),
      GROK_DESKTOP_MOCK_LOG: path.join(directory, 'mock-events.jsonl'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.GROK_DESKTOP_DEV_URL;
    await launch();

    phase = 'session-draft-and-task-history';
    await composer().fill('Local fixture seed');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    const a = await until(async () =>
      (await request('tasks.list')).find((task) => task.cwd === projectA && task.lastTurn),
    );
    await idle(a.sessionId);
    const sessionA = { sessionId: a.sessionId, cwd: projectA, title: a.title };
    await composer().fill('保留未发送的草稿 / preserve this draft');
    await page.locator('.session-item.selected .session-status-chip.draft').waitFor();
    await page.getByRole('button', { name: '任务中心', exact: true }).click();
    const center = page.getByRole('dialog', { name: '任务中心', exact: true });
    await center.getByText('暂无活跃或待处理任务', { exact: true }).waitFor();
    assert.equal(await center.locator('.workflow-card').count(), 0);
    const idleSession = await request('session.new', { cwd: projectA });
    await center.getByRole('button', { name: '显示全部', exact: true }).click();
    await center.getByText('空闲', { exact: true }).waitFor();
    assert.equal(await center.getByText('等待执行', { exact: true }).count(), 0);
    await screenshot('task-history-zh');
    await center.getByRole('button', { name: '关闭 · Esc', exact: true }).click();
    assert.ok(idleSession.sessionId);
    pass();

    phase = 'approval-diff-and-originating-notification';
    const b = await request('session.new', { cwd: projectB });
    await request('session.enqueue', {
      cwd: projectA,
      sessionId: a.sessionId,
      text: 'MOCK_PERMISSION_COLLISION A',
    });
    await until(
      async () =>
        (await request('tasks.list')).find((task) => task.sessionId === a.sessionId)?.permissions
          .length,
    );
    await request('session.enqueue', {
      cwd: projectB,
      sessionId: b.sessionId,
      text: 'MOCK_PERMISSION_COLLISION B',
    });
    const pending = await until(async () => {
      const tasks = await request('tasks.list');
      return tasks.filter((task) => task.permissions.length).length === 2 && tasks;
    });
    const pendingA = pending.find((task) => task.sessionId === a.sessionId);
    const pendingB = pending.find((task) => task.sessionId === b.sessionId);
    assert.equal(pendingA.permissions[0].requestId, pendingB.permissions[0].requestId);
    await page.locator('.session-status-chip.approval').first().waitFor();
    await navigate(
      { sessionId: b.sessionId, cwd: projectB, title: pendingB.title },
      pendingB.permissions[0].requestId,
    );
    const approval = page.getByRole('dialog', { name: 'Grok 需要你的批准', exact: true });
    await approval.locator('.permission-working-directory').filter({ hasText: projectB }).waitFor();
    await approval.locator('.permission-file-diff').filter({ hasText: 'after' }).waitFor();
    await approval.getByText('删除文件或目录', { exact: true }).waitFor();
    await approval.locator('.permission-review-details > summary').click();
    await approval.locator('.permission-raw-details > summary').click();
    assert.match(
      await approval.locator('.permission-raw-details pre').innerText(),
      /Remove-Item -LiteralPath fixture.txt/,
    );
    await approval.locator('.permission-review-details > summary').click();
    await usable(approval.getByRole('button', { name: '允许本次', exact: true }));
    await screenshot('approval-zh');
    await approval.getByRole('button', { name: '拒绝本次', exact: true }).click();
    await idle(b.sessionId);
    assert.equal(
      (await request('tasks.list')).find((task) => task.sessionId === a.sessionId).permissions
        .length,
      1,
    );
    await request('session.permission', {
      sessionId: a.sessionId,
      requestId: pendingA.permissions[0].requestId,
      optionId: 'reject-once',
    });
    await idle(a.sessionId);
    await approval.waitFor({ state: 'hidden' });
    await navigate(sessionA);
    assert.equal(await composer().inputValue(), '保留未发送的草稿 / preserve this draft');
    pass();

    phase = 'real-enoent-localization-and-copy';
    const missing = path.join(directory, 'missing-file.txt');
    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, missing);
    await page.getByRole('button', { name: '添加文件或图片', exact: true }).click();
    const toast = page.locator('.toast');
    await toast.filter({ hasText: '找不到文件或文件夹' }).waitFor();
    await toast.getByText('原始错误详情', { exact: true }).click();
    const raw = await toast.locator('pre').innerText();
    assert.match(raw, /ENOENT/);
    assert.ok(raw.includes(missing));
    // Intercept only the owned Electron process's writeText; the user's clipboard stays untouched.
    await app.evaluate(({ clipboard }) => {
      global.usabilityWriteText = clipboard.writeText;
      clipboard.writeText = (text) => {
        global.usabilityCopied = text;
      };
    });
    await toast.getByRole('button', { name: '复制原始详情', exact: true }).click();
    assert.equal(await app.evaluate(() => global.usabilityCopied), raw);
    await app.evaluate(({ clipboard }) => {
      clipboard.writeText = global.usabilityWriteText;
    });
    await screenshot('missing-file-zh');
    await toast.getByRole('button', { name: '关闭提示', exact: true }).click();
    pass();

    phase = 'small-window-bilingual-125-percent';
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.unmaximize();
      win.setSize(980, 700);
    });
    await openSettings();
    await page.getByRole('combobox', { name: '界面大小', exact: true }).selectOption('125');
    await until(
      async () =>
        (await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
        )) === 1.25,
    );
    for (const current of ['zh-CN', 'en']) {
      if (current !== language) {
        await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption(current);
        language = current;
        await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
      }
      await usable(
        page.getByRole('combobox', { name: label('界面大小', 'Interface size'), exact: true }),
      );
      await usable(
        page.getByRole('button', { name: label('保存设置', 'Save settings'), exact: true }),
      );
      await screenshot(`settings-${current}-125`);
      await closeSettings();
      const sidebarLayout = await page.evaluate(() => {
        const history = document.querySelector('.sidebar .session-list');
        const list = history.getBoundingClientRect();
        const search = document.querySelector('.sidebar .search-input').getBoundingClientRect();
        const footer = document.querySelector('.sidebar-bottom').getBoundingClientRect();
        return {
          historyHeight: history.clientHeight,
          searchBottom: search.bottom,
          listTop: list.top,
          listBottom: list.bottom,
          footerTop: footer.top,
        };
      });
      assert.ok(
        sidebarLayout.historyHeight >= 84,
        `${current} session history keeps two rows of space`,
      );
      assert.ok(
        sidebarLayout.searchBottom <= sidebarLayout.listTop + 1,
        'Search does not overlap history',
      );
      assert.ok(
        sidebarLayout.listBottom <= sidebarLayout.footerTop + 1,
        'History does not overlap sidebar actions',
      );
      // Use a fixed element set because hovering reveals the session menu button.
      for (const button of await page.locator('.sidebar button').elementHandles()) {
        if ((await button.isVisible()) && (await button.isEnabled()))
          await button.click({ trial: true });
      }
      await page.locator('.thread').evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event('scroll'));
      });
      await page.locator('.scroll-bottom').waitFor();
      assert.equal(
        await page.evaluate(() => {
          const textarea = document.querySelector('textarea').getBoundingClientRect();
          const jump = document.querySelector('.scroll-bottom').getBoundingClientRect();
          return (
            jump.x < textarea.right &&
            jump.right > textarea.x &&
            jump.y < textarea.bottom &&
            jump.bottom > textarea.y
          );
        }),
        false,
        'latest-message control must not overlap the composer',
      );
      await usable(composer());
      await usable(
        page.getByRole('button', { name: label('发送消息', 'Send message'), exact: true }),
      );
      await screenshot(`composer-${current}-125`);
      await request('session.enqueue', {
        cwd: projectA,
        sessionId: a.sessionId,
        text: `MOCK_PERMISSION ${current}`,
      });
      const sizeApproval = page.getByRole('dialog', {
        name: label('Grok 需要你的批准', 'Grok needs your approval'),
        exact: true,
      });
      await sizeApproval.locator('.permission-file-diff').waitFor();
      await usable(
        sizeApproval.getByRole('button', { name: label('允许本次', 'Allow once'), exact: true }),
      );
      await usable(
        sizeApproval.getByRole('button', { name: label('拒绝本次', 'Reject once'), exact: true }),
      );
      await screenshot(`approval-${current}-125`);
      await sizeApproval
        .getByRole('button', { name: label('拒绝本次', 'Reject once'), exact: true })
        .click();
      await idle(a.sessionId);
      await sizeApproval.waitFor({ state: 'hidden' });
      if (current === 'zh-CN') await openSettings();
    }
    await app.close();
    app = null;
    await launch();
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
      ),
      1.25,
    );
    assert.equal((await request('bootstrap')).settings.ui.zoomPercent, 125);
    // Send native Electron key events; renderer-only keyboard events do not reliably
    // dispatch application menu accelerators on Windows.
    const menuReset = await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()
        .items.flatMap((item) => item.submenu?.items || [])
        .find((item) => item.accelerator === 'CommandOrControl+0');
      if (!item) return false;
      return true;
    });
    assert.equal(menuReset, true);
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.focus();
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: '0', modifiers: ['control'] });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: '0', modifiers: ['control'] });
    });
    await until(
      async () =>
        (await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
        )) === 1,
    );
    assert.equal((await request('bootstrap')).settings.ui.zoomPercent, 100);
    await openSettings();
    assert.equal(
      await page.getByRole('combobox', { name: 'Interface size', exact: true }).inputValue(),
      '100',
    );
    await screenshot('settings-en-100');
    await closeSettings();
    pass();

    phase = 'native-folder-drop-cancel-read-only-and-files';
    await app.evaluate(({ dialog }) => {
      global.usabilityDialogs = [];
      global.usabilityDecision = 2;
      dialog.showMessageBox = async (_win, options) => {
        global.usabilityDialogs.push(options);
        return { response: global.usabilityDecision };
      };
    });
    await nativeDrop([droppedProject]);
    await until(async () => (await app.evaluate(() => global.usabilityDialogs.length)) === 1);
    assert.equal((await request('bootstrap')).settings.lastProject, projectA);
    assert.equal((await response('project.access', { cwd: droppedProject })).ok, false);
    assert.equal(await page.locator('.attachment-name').count(), 0);
    await app.evaluate(() => {
      global.usabilityDecision = 0;
    });
    await nativeDrop([droppedProject]);
    await page.getByRole('button', { name: 'Files only', exact: true }).waitFor();
    assert.equal((await request('project.access', { cwd: droppedProject })).trusted, false);
    assert.equal((await response('session.new', { cwd: droppedProject })).ok, false);
    assert.equal(await page.locator('.attachment-name').count(), 0);
    const dialogsBefore = await app.evaluate(() => global.usabilityDialogs.length);
    await nativeDrop([droppedProject, attachment]);
    await page.locator('.toast').filter({ hasText: 'Drop one folder separately' }).waitFor();
    assert.equal(await app.evaluate(() => global.usabilityDialogs.length), dialogsBefore);
    assert.equal((await request('project.access', { cwd: droppedProject })).trusted, false);
    assert.equal(await page.locator('.attachment-name').count(), 0);
    await page
      .locator('.toast')
      .getByRole('button', { name: 'Dismiss notification', exact: true })
      .click();
    await nativeDrop([droppedProject]);
    await until(
      async () => (await app.evaluate(() => global.usabilityDialogs.length)) === dialogsBefore + 1,
    );
    assert.equal((await request('project.access', { cwd: droppedProject })).trusted, false);
    await nativeDrop([attachment]);
    await page.locator('.attachment-name').filter({ hasText: 'ordinary.txt' }).waitFor();
    assert.equal(
      (await request('attachment.preview', { path: attachment })).text,
      'ordinary attachment',
    );
    const fabricated = await page.evaluate(() =>
      window.desktop.resolveDrop([new File(['not native'], 'project A')]),
    );
    assert.deepEqual(fabricated, { files: [] });
    await screenshot('drop-read-only-file-en');
    await navigate(sessionA);
    assert.equal(await composer().inputValue(), '保留未发送的草稿 / preserve this draft');
    assert.equal(await page.getByRole('button', { name: 'Files only', exact: true }).count(), 0);
    await usable(page.getByRole('button', { name: 'Send message', exact: true }));
    assert.equal((await request('bootstrap')).settings.lastProject, projectA);
    assert.equal((await request('project.access', { cwd: projectA })).trusted, true);
    assert.equal((await request('project.access', { cwd: droppedProject })).trusted, false);
    assert.equal(await page.locator('.attachment-name').count(), 0);
    await screenshot('notification-restores-project-trust');
    pass();
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(evidence, 'result.json'),
      JSON.stringify(
        {
          status: 'passed',
          fixture: directory,
          passes,
          screenshots,
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(`Artifacts: ${evidence}\nFixture: ${directory}`);
  } catch (error) {
    console.error(`FAIL ${phase}`, error);
    await fs.mkdir(evidence, { recursive: true });
    await screenshot(`failure-${phase}`).catch(() => {});
    const layout = await page
      ?.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        controls: [
          '.app',
          '.workspace',
          'textarea',
          '.composer-toolbar',
          '.composer-tools',
          '.send-button',
          '.scroll-bottom',
        ].map((selector) => {
          const element = document.querySelector(selector);
          if (!element) return { selector, absent: true };
          const box = element.getBoundingClientRect();
          return {
            selector,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            centerHit: document
              .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
              ?.outerHTML.slice(0, 250),
          };
        }),
      }))
      .catch(() => null);
    await fs.writeFile(
      path.join(evidence, 'result.json'),
      JSON.stringify(
        {
          status: 'failed',
          phase,
          error: String(error.stack || error),
          fixture: directory,
          passes,
          pageErrors: errors,
          layout,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
})();
