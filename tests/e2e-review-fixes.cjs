'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
let app,
  page,
  directory,
  phase = 'setup';
const errors = [];
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
async function until(fn) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 75));
  }
  throw new Error(`Timed out: ${phase}`);
}
(async () => {
  try {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'grok review fixes ')));
    const data = path.join(directory, 'data'),
      project = path.join(directory, 'project');
    await fs.mkdir(data);
    await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'note.txt'), 'fixture');
    await fs.writeFile(
      path.join(project, 'inert.cmd'),
      '@echo off\r\nrem Never executed by this test\r\n',
    );
    await fs.writeFile(
      path.join(data, 'settings.json'),
      JSON.stringify({
        grokPath: process.execPath,
        language: 'zh-CN',
        lastProject: project,
        recentProjects: [project],
        notifications: false,
      }),
    );
    const broken = '{broken queue';
    await fs.writeFile(path.join(data, 'queued-tasks.json'), broken);
    const packaged = process.env.GROK_DESKTOP_TEST_EXE;
    const env = {
      ...process.env,
      GROK_DESKTOP_DATA_DIR: data,
      GROK_DESKTOP_TEST_GROK_SCRIPT: path.join(root, 'scripts/mock-grok.cjs'),
      GROK_DESKTOP_MOCK_STATE: path.join(directory, 'mock.json'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.GROK_DESKTOP_DEV_URL;
    if (packaged) env.GROK_DESKTOP_DEV_URL = 'http://127.0.0.1:1/not-a-production-ui';
    app = await _electron.launch({
      executablePath: packaged || require('electron'),
      args: packaged ? [] : [root],
      env,
      timeout: 30000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
    assert.ok(page.url().startsWith('file:'));

    phase = 'startup-recovery-and-draft-flush';
    await page.getByText('本机数据恢复提醒', { exact: true }).waitFor();
    const boot = await request('bootstrap');
    assert.equal(boot.recoveryWarnings.length, 1);
    assert.equal(await fs.readFile(boot.recoveryWarnings[0].backupPath, 'utf8'), broken);
    await app.evaluate(({ session }) => {
      global.reviewFlushed = 0;
      const original = session.defaultSession.flushStorageData.bind(session.defaultSession);
      session.defaultSession.flushStorageData = () => {
        global.reviewFlushed = Date.now();
        return original();
      };
    });
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        original.call(this, key, value);
        if (key === 'grok-desktop-drafts' && value.includes('保留本次未发送草稿'))
          window.reviewDraftWritten = Date.now();
      };
    });
    await page
      .getByRole('textbox', { name: '发送给 Grok 的消息', exact: true })
      .fill('保留本次未发送草稿');
    await until(async () => {
      const written = await page.evaluate(() => window.reviewDraftWritten);
      return written && (await app.evaluate(() => global.reviewFlushed)) >= written;
    });
    assert.match(
      await page.evaluate(() => localStorage.getItem('grok-desktop-drafts')),
      /保留本次未发送草稿/,
    );
    console.log(`PASS ${phase}`);

    phase = 'executable-open-confirmation-on-both-file-routes';
    await app.evaluate(({ dialog, shell }) => {
      global.reviewDialogs = [];
      global.reviewOpened = [];
      global.reviewDecision = 0;
      dialog.showMessageBox = async (_win, options) => {
        global.reviewDialogs.push(options);
        return { response: global.reviewDecision };
      };
      shell.openPath = async (filename) => {
        global.reviewOpened.push(filename);
        return '';
      };
    });
    const script = path.join(project, 'inert.cmd');
    for (const payload of [
      { target: 'file', path: script },
      { target: 'workspace-file', cwd: project, path: 'inert.cmd' },
    ]) {
      assert.equal((await request('system.open', payload)).cancelled, true);
    }
    assert.equal(await app.evaluate(() => global.reviewOpened.length), 0);
    assert.equal(await app.evaluate(() => global.reviewDialogs.length), 2);
    await app.evaluate(() => {
      global.reviewDecision = 1;
    });
    await request('system.open', { target: 'workspace-file', cwd: project, path: 'inert.cmd' });
    assert.deepEqual(await app.evaluate(() => global.reviewOpened), [script]);
    console.log(`PASS ${phase}`);

    phase = 'checkpoint-capacity-choice-and-cross-project-storage';
    const checkpointDir = path.join(data, 'checkpoints'),
      id = randomUUID(),
      existingSession = 'older-session';
    await fs.mkdir(checkpointDir, { recursive: true });
    const capacityFile = path.join(checkpointDir, `${id}.json`);
    await fs.writeFile(
      capacityFile,
      JSON.stringify({
        id,
        cwd: path.join(directory, 'old-project'),
        sessionId: existingSession,
        turnId: 'old-turn',
        createdAt: new Date().toISOString(),
        status: 'ready',
        files: [],
        skipped: [],
      }),
    );
    // Real store/hooks, with only this owned fixture's reported byte size inflated.
    // Physical capacity and scan coverage have dedicated checkpoint regressions.
    await app.evaluate(async (_, filename) => {
      const fs = process.getBuiltinModule('node:fs/promises');
      global.reviewStat = fs.stat;
      fs.stat = async function (file, ...args) {
        const stat = await global.reviewStat.call(this, file, ...args);
        if (String(file) === filename)
          Object.defineProperty(stat, 'size', { value: 512 * 1024 * 1024 });
        return stat;
      };
      global.reviewDecision = 0;
    }, capacityFile);
    const snapshot = await request('session.new', { cwd: project });
    const cancelled = await response('session.send', {
      cwd: project,
      sessionId: snapshot.sessionId,
      text: 'Cancelled before prompt',
    });
    assert.equal(cancelled.ok, false);
    assert.match(cancelled.error, /取消/);
    await page.getByRole('dialog', { name: '项目工具', exact: true }).waitFor();
    await page.getByText('所有项目的检查点存储', { exact: true }).waitFor();
    const storage = await request('checkpoints.storage');
    assert.ok(storage.bytes >= storage.limitBytes);
    assert.ok(storage.records.some((r) => r.id === id && r.sessionId === existingSession));
    await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
    await page.screenshot({
      path: path.join(
        root,
        'test-results',
        packaged ? 'review-storage-packaged.png' : 'review-storage-source.png',
      ),
    });
    await page
      .getByRole('dialog', { name: '项目工具', exact: true })
      .getByRole('button', { name: '关闭 · Esc', exact: true })
      .click();
    await app.evaluate(() => {
      global.reviewDecision = 1;
    });
    await request('session.send', {
      cwd: project,
      sessionId: snapshot.sessionId,
      text: 'Local mock reply without checkpoint',
    });
    await until(async () =>
      (await request('tasks.list')).some(
        (task) =>
          task.sessionId === snapshot.sessionId &&
          task.lastTurn?.status === 'completed' &&
          task.lastTurn.checkpointSkipped,
      ),
    );
    await app.evaluate(() => {
      process.getBuiltinModule('node:fs/promises').stat = global.reviewStat;
    });
    assert.deepEqual((await request('checkpoints.removeMany', { ids: [id] })).removed, [id]);
    assert.equal(
      (await request('checkpoints.storage')).records.some((r) => r.id === id),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(`PASS ${phase}`);
    console.log(`Artifacts: ${directory}`);
  } catch (error) {
    console.error(`FAIL ${phase}`, error);
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
})();
