'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
let app, page, directory;
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
(async () => {
  try {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'grok access e2e ')));
    const data = path.join(directory, 'data'),
      a = path.join(directory, 'a'),
      b = path.join(directory, 'b'),
      outside = path.join(directory, 'selected.txt');
    await Promise.all([data, a, b].map((folder) => fs.mkdir(folder)));
    await fs.writeFile(path.join(b, 'source.txt'), 'project source');
    await fs.writeFile(outside, 'Native selection only');
    await fs.writeFile(
      path.join(data, 'settings.json'),
      JSON.stringify({
        grokPath: process.execPath,
        lastProject: a,
        recentProjects: [a],
        notifications: false,
        language: 'zh-CN',
      }),
    );
    const packaged = process.env.GROK_DESKTOP_TEST_EXE;
    const env = {
      ...process.env,
      GROK_DESKTOP_DATA_DIR: data,
      GROK_DESKTOP_TEST_GROK_SCRIPT: path.join(root, 'scripts/mock-grok.cjs'),
      GROK_DESKTOP_MOCK_STATE: path.join(directory, 'mock.json'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.GROK_DESKTOP_DEV_URL;
    const launch = async () => {
      app = await _electron.launch({
        executablePath: packaged || require('electron'),
        args: packaged ? [] : [root],
        env,
        timeout: 30000,
      });
      page = await app.firstWindow();
      page.setDefaultTimeout(15000);
      await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
    };
    await launch();
    assert.equal((await response('workspace.read', { cwd: b, path: 'source.txt' })).ok, false);
    assert.equal((await response('attachment.preview', { path: outside })).ok, false);
    assert.equal((await response('settings.save', { recentProjects: [b] })).ok, false);
    assert.equal((await response('settings.save', { projectTrust: { [b]: true } })).ok, false);
    assert.equal((await response('terminal.input', { id: 'no-terminal', data: [] })).ok, false);
    await app.evaluate(({ dialog }, folder) => {
      global.accessChoice = 0;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      dialog.showMessageBox = async () => ({ response: global.accessChoice });
    }, b);
    assert.equal(await request('dialog.project'), b);
    assert.equal((await request('project.open', { cwd: b })).trusted, false);
    await page.locator('.breadcrumb button').first().click();
    await page.getByRole('button', { name: '只看文件', exact: true }).waitFor();
    await page
      .getByRole('textbox', { name: '发送给 Grok 的消息', exact: true })
      .fill('Read-only draft');
    assert.equal(
      await page.getByRole('button', { name: '发送消息', exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      (await request('workspace.read', { cwd: b, path: 'source.txt' })).text,
      'project source',
    );
    assert.equal(
      (await response('workspace.save', { cwd: b, path: 'source.txt', text: 'blocked' })).ok,
      false,
    );
    assert.equal((await response('session.new', { cwd: b })).ok, false);
    assert.equal((await response('terminal.open', { cwd: b })).ok, false);
    await app.evaluate(() => {
      global.accessChoice = 1;
    });
    assert.equal((await request('project.trust', { cwd: b })).trusted, true);
    const session = await request('session.new', { cwd: b });
    assert.ok(session.sessionId);
    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, outside);
    const picked = await request('dialog.attach');
    assert.equal(picked[0].path, outside);
    assert.match(
      (await request('attachment.preview', { path: outside })).text,
      /Native selection only/,
    );
    const before = await request('bootstrap');
    assert.equal(before.settings.projectTrust, undefined);
    assert.equal(before.settings.selectedAttachments, undefined);
    await app.close();
    app = null;
    await launch();
    assert.match(
      (await request('attachment.preview', { path: outside })).text,
      /Native selection only/,
    );
    assert.equal((await request('project.access', { cwd: b })).trusted, true);
    await request('sessions.list', { cwd: b });
    await request('session.rename', {
      sessionId: session.sessionId,
      cwd: b,
      title: 'Renamed without opening history',
    });
    const actualMockState = JSON.parse(
      await fs.readFile(path.join(directory, 'mock.json'), 'utf8'),
    );
    assert.equal(
      actualMockState.sessions.find((item) => item.sessionId === session.sessionId).title,
      'Renamed without opening history',
    );
    // Create a real saved draft, then remove only the new permission fields to
    // represent a 1.7.4 profile. The attachment itself must stay usable by reselecting it.
    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, outside);
    await page.getByRole('button', { name: '添加文件或图片', exact: true }).click();
    await page.locator('.attachment-name').filter({ hasText: 'selected.txt' }).waitFor();
    await app.close();
    app = null;
    const legacySettings = JSON.parse(await fs.readFile(path.join(data, 'settings.json'), 'utf8'));
    delete legacySettings.selectedAttachments;
    delete legacySettings.projectTrust;
    await fs.writeFile(path.join(data, 'settings.json'), JSON.stringify(legacySettings));
    await launch();
    assert.equal((await response('attachment.preview', { path: outside })).ok, false);
    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, outside);
    await page.locator('.attachment-name').filter({ hasText: 'selected.txt' }).click();
    await page.getByRole('button', { name: '重新选择原附件并恢复预览', exact: true }).click();
    await page
      .locator('.attachment-preview')
      .filter({ hasText: 'Native selection only' })
      .waitFor();
    assert.match(
      (await request('attachment.preview', { path: outside })).text,
      /Native selection only/,
    );
    console.log('PASS legacy external attachment native reauthorization and preview recovery');
    console.log(
      'PASS project registration, files-only mode, native trust, payload validation and persisted native file grants',
    );
    console.log(`Artifacts: ${directory}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
})();
