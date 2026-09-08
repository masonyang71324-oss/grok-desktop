'use strict';
// Run after npm run build. GROK_DESKTOP_TEST_EXE selects an unpacked/installed build.
// All ACP work and npm scripts use isolated local fixtures, without a Grok account.
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
const pass = () => process.stdout.write(`PASS ${phase}\n`);

async function response(command, payload = {}) {
  return page.evaluate(({ command, payload }) => window.desktop.request(command, payload), {
    command,
    payload,
  });
}
async function request(command, payload) {
  const result = await response(command, payload);
  assert.equal(result.ok, true, `${command}: ${result.error || 'request failed'}`);
  return result.data;
}
async function until(action, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await action();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(message);
}
async function idle(...sessionIds) {
  return until(async () => {
    const tasks = await request('tasks.list');
    return (
      sessionIds.every((id) =>
        tasks.some(
          (task) => task.sessionId === id && task.status === 'idle' && !task.queued.length,
        ),
      ) && tasks
    );
  }, 'Tasks did not finish');
}
async function logs() {
  return (await fs.readFile(path.join(directory, 'mock-events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

(async () => {
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok workflows '));
    const userData = path.join(directory, 'userdata');
    const projectA = path.join(directory, 'project A');
    const projectB = path.join(directory, 'project B');
    await Promise.all([userData, projectA, projectB].map((folder) => fs.mkdir(folder)));
    const fixture = path.join(projectA, 'fixture.txt');
    await fs.writeFile(fixture, 'pre-existing dirty text\r\n');
    await fs.writeFile(
      path.join(projectA, 'package.json'),
      JSON.stringify({ scripts: { dev: 'node server.cjs' } }),
    );
    await fs.writeFile(
      path.join(projectA, 'server.cjs'),
      "console.log('http://127.0.0.1:4567/'); setInterval(()=>{},1000);\n",
    );
    await fs.writeFile(
      path.join(userData, 'settings.json'),
      JSON.stringify({
        language: 'zh-CN',
        grokPath: process.execPath,
        permissionMode: 'ask',
        lastProject: projectA,
        recentProjects: [projectA, projectB],
        notifications: false,
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
    await page.evaluate(() => {
      window.workflowEvents = [];
      window.desktop.onEvent((event) => window.workflowEvents.push(event));
    });

    phase = 'two-projects-same-permission-id-routes-ui-approval';
    const a = await request('session.new', { cwd: projectA });
    const b = await request('session.new', { cwd: projectB });
    assert.notEqual(a.sessionId, b.sessionId);
    await request('session.enqueue', {
      cwd: projectA,
      sessionId: a.sessionId,
      text: 'MOCK_PERMISSION_COLLISION A',
    });
    await until(
      async () =>
        (await request('tasks.list')).find((task) => task.sessionId === a.sessionId)?.permissions
          .length,
      'First approval missing',
    );
    await request('session.enqueue', {
      cwd: projectB,
      sessionId: b.sessionId,
      text: 'MOCK_PERMISSION_COLLISION B',
    });
    const pending = await until(async () => {
      const tasks = await request('tasks.list');
      return tasks.filter((task) => task.permissions.length).length === 2 && tasks;
    }, 'Both projects must reach approval concurrently');
    const approvalA = pending.find((task) => task.sessionId === a.sessionId).permissions[0];
    const approvalB = pending.find((task) => task.sessionId === b.sessionId).permissions[0];
    assert.equal(approvalA.requestId, approvalB.requestId);
    const approval = page.getByRole('dialog', { name: 'Grok 需要你的批准', exact: true });
    await approval.getByRole('button', { name: '允许本次', exact: true }).click();
    await idle(a.sessionId);
    const stillWaiting = (await request('tasks.list')).find(
      (task) => task.sessionId === b.sessionId,
    );
    assert.equal(
      stillWaiting.permissions.length,
      1,
      'Approving A must not resolve B with the same request id',
    );
    await request('session.permission', {
      sessionId: b.sessionId,
      requestId: approvalB.requestId,
      optionId: 'reject-once',
    });
    await idle(b.sessionId);
    await approval.waitFor({ state: 'hidden' });
    const permissionLogs = (await logs()).filter((event) => event.type === 'permission-response');
    assert.deepEqual(
      permissionLogs.map((event) => event.status),
      ['allow-once', 'reject-once'],
    );
    pass();

    phase = 'same-directory-queue-fifo-and-task-center';
    const c = await request('session.new', { cwd: projectA });
    await request('session.enqueue', {
      cwd: projectA,
      sessionId: a.sessionId,
      text: 'MOCK_SLOW QUEUE_FIRST',
    });
    await until(
      async () =>
        (await logs()).some(
          (event) => event.type === 'prompt' && event.status.includes('QUEUE_FIRST'),
        ),
      'First queued turn did not start',
    );
    await request('session.enqueue', {
      cwd: projectA,
      sessionId: a.sessionId,
      text: 'QUEUE_SECOND',
    });
    await request('session.enqueue', {
      cwd: projectA,
      sessionId: a.sessionId,
      text: 'QUEUE_THIRD',
    });
    await request('session.enqueue', {
      cwd: projectA,
      sessionId: c.sessionId,
      text: 'OTHER_SESSION_SAME_DIRECTORY',
    });
    const queued = await request('tasks.list');
    assert.deepEqual(
      queued.find((task) => task.sessionId === a.sessionId).queued.map((item) => item.text),
      ['QUEUE_SECOND', 'QUEUE_THIRD'],
    );
    assert.equal(queued.find((task) => task.sessionId === c.sessionId).status, 'waiting');
    assert.equal(
      (await logs()).some(
        (event) => event.type === 'prompt' && event.status === 'OTHER_SESSION_SAME_DIRECTORY',
      ),
      false,
    );
    await page.getByRole('button', { name: '任务中心', exact: true }).click();
    const center = page.getByRole('dialog', { name: '任务中心', exact: true });
    await center.getByText(projectB, { exact: true }).waitFor();
    await center.getByText('QUEUE_SECOND', { exact: true }).waitFor();
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({
      path: path.join(root, 'test-results', 'e2e-workflows-task-center.png'),
    });
    await page.keyboard.press('Escape');
    await idle(a.sessionId, c.sessionId);
    assert.deepEqual(
      (await logs())
        .filter(
          (event) => event.type === 'prompt' && /QUEUE_(FIRST|SECOND|THIRD)/.test(event.status),
        )
        .map((event) => event.status),
      ['MOCK_SLOW QUEUE_FIRST', 'QUEUE_SECOND', 'QUEUE_THIRD'],
    );
    pass();

    phase = 'checkpoint-main-hooks-ui-restore-undo-and-conflict';
    await request('session.enqueue', { cwd: projectA, sessionId: a.sessionId, text: 'MOCK_EDIT' });
    await idle(a.sessionId);
    assert.equal(await fs.readFile(fixture, 'utf8'), 'mock edited\n');
    const checkpoint = (
      await request('checkpoints.list', { cwd: projectA, sessionId: a.sessionId })
    ).find((entry) => entry.files.some((file) => file.path === 'fixture.txt'));
    assert.ok(checkpoint, 'Main turn hooks must create a ready checkpoint');
    const detail = await request('checkpoints.detail', { id: checkpoint.id });
    assert.equal(detail.files[0].before, 'pre-existing dirty text\r\n');
    await page.getByRole('button', { name: '项目工具', exact: true }).click();
    const projectTools = page.getByRole('dialog', { name: '项目工具', exact: true });
    await projectTools
      .locator('.checkpoint-row')
      .filter({ hasText: /1\s*个文件/ })
      .click();
    await projectTools.getByRole('button', { name: '恢复所选文件', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: '确认恢复这些文件？', exact: true });
    await confirmation.getByRole('button', { name: '确认恢复', exact: true }).click();
    await until(
      async () => (await fs.readFile(fixture, 'utf8')) === 'pre-existing dirty text\r\n',
      'UI restore did not preserve the dirty baseline',
    );
    const backup = (
      await request('checkpoints.list', { cwd: projectA, sessionId: a.sessionId })
    ).find((entry) => entry.turnId === `restore:${checkpoint.turnId}`);
    assert.ok(backup);
    await request('checkpoints.restore', { id: backup.id, paths: ['fixture.txt'] });
    assert.equal(await fs.readFile(fixture, 'utf8'), 'mock edited\n');
    await fs.writeFile(fixture, 'later user edit\r\n');
    assert.equal(
      (await response('checkpoints.restore', { id: checkpoint.id, paths: ['fixture.txt'] })).ok,
      false,
    );
    assert.equal(await fs.readFile(fixture, 'utf8'), 'later user edit\r\n');
    pass();

    phase = 'project-tools-run-stop-events-and-preview';
    await projectTools.getByRole('button', { name: '运行', exact: true }).click();
    await projectTools.getByRole('button', { name: '打开预览', exact: true }).waitFor();
    const running = await request('runner.state', { cwd: projectA });
    assert.equal(running.status, 'running');
    assert.equal(running.url, 'http://127.0.0.1:4567/');
    await page.screenshot({
      path: path.join(root, 'test-results', 'e2e-workflows-project-tools.png'),
    });
    await projectTools.getByRole('button', { name: '停止', exact: true }).click();
    await until(
      async () => (await request('runner.state', { cwd: projectA })).status === 'stopped',
      'Runner did not stop',
    );
    await projectTools
      .getByRole('button', { name: '打开预览', exact: true })
      .waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
    pass();

    phase = 'clipboard-image-preview-and-native-acp-image';
    await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      globalThis.workflowClipboard = await clipboard.read();
      const image = nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), {
        width: 1,
        height: 1,
      });
      await clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) }),
      ]);
    });
    const attachment = await request('clipboard.image');
    assert.equal(attachment.kind, 'image');
    const preview = await request('attachment.preview', { path: attachment.path });
    assert.match(preview.dataUrl, /^data:image\/png;base64,/);
    await request('session.enqueue', {
      cwd: projectA,
      sessionId: a.sessionId,
      text: 'IMAGE_WORKFLOW',
      attachments: [attachment],
    });
    await idle(a.sessionId);
    const imageLog = (await logs()).find((event) => event.type === 'image-prompt');
    assert.ok(imageLog, 'ACP must receive native image content');
    assert.equal(imageLog.status, '1');
    assert.deepEqual(imageLog.mimeTypes, ['image/png']);
    assert.deepEqual(pageErrors, []);
    pass();
  } catch (error) {
    process.stderr.write(`FAIL ${phase}: ${error.stack || error}\n`);
    process.exitCode = 1;
    if (page && directory)
      await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
  } finally {
    if (app) {
      await app
        .evaluate(async ({ app, clipboard, dialog }) => {
          if (globalThis.workflowClipboard) await clipboard.write(globalThis.workflowClipboard);
          dialog.showMessageBox = async () => ({ response: 1 });
          app.quit();
        })
        .catch(() => {});
      await app.close().catch(() => {});
    }
    if (directory) process.stdout.write(`Artifacts: ${directory}\n`);
  }
})();
