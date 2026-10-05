'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const evidence = path.join(
  root,
  'test-results',
  process.env.GROK_DESKTOP_TEST_EXE ? 'architecture-settings-packaged' : 'architecture-settings',
);
let app, page, directory;
const errors = [];
async function request(command, payload = {}) {
  const result = await page.evaluate(
    ({ command, payload }) => window.desktop.request(command, payload),
    { command, payload },
  );
  assert.equal(result.ok, true, `${command}: ${result.error || ''}`);
  return result.data;
}
(async () => {
  try {
    directory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'grok architecture settings ')),
    );
    const data = path.join(directory, 'data'),
      project = path.join(directory, 'project');
    await Promise.all(
      [data, project, evidence].map((folder) => fs.mkdir(folder, { recursive: true })),
    );
    await fs.writeFile(
      path.join(data, 'settings.json'),
      JSON.stringify({
        grokPath: process.execPath,
        lastProject: project,
        recentProjects: [project],
        language: 'zh-CN',
        notifications: false,
        promptTemplates: [{ id: 'private', name: 'SECRET_TEMPLATE', text: 'SECRET_TEMPLATE_TEXT' }],
      }),
    );
    const env = {
      ...process.env,
      GROK_DESKTOP_DATA_DIR: data,
      GROK_HOME: path.join(directory, 'grok-home'),
      GROK_DESKTOP_TEST_GROK_SCRIPT: path.join(root, 'scripts/mock-grok.cjs'),
      GROK_DESKTOP_MOCK_STATE: path.join(directory, 'mock.json'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.GROK_DESKTOP_DEV_URL;
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
    await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
    await page.keyboard.press('Control+,');
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    const channel = settings.getByRole('combobox', { name: '更新通道' });
    assert.equal(await channel.inputValue(), 'stable');
    await channel.selectOption('beta');
    await page.waitForFunction(() => !document.querySelector('.update-settings select').disabled);
    assert.equal((await request('update.status')).channel, 'beta');
    const snapshot = JSON.parse(await fs.readFile(path.join(data, 'settings.json'), 'utf8'));
    assert.equal(snapshot.updateChannel, 'beta');
    await channel.selectOption('stable');
    await page.waitForFunction(() => !document.querySelector('.update-settings select').disabled);
    await settings.getByRole('combobox', { name: '新会话默认权限' }).selectOption('read');
    await settings.getByRole('checkbox', { name: '意外断线后尝试一次自动重连' }).uncheck();
    await settings.getByRole('button', { name: '保存设置', exact: true }).click();
    await settings.waitFor({ state: 'hidden' });
    const persisted = JSON.parse(await fs.readFile(path.join(data, 'settings.json'), 'utf8'));
    assert.equal(persisted.permissionMode, 'read');
    assert.equal(persisted.autoReconnect, false);
    assert.equal(persisted.updateChannel, 'stable');
    await page.keyboard.press('Control+,');
    await settings.getByRole('button', { name: '诊断预览与导出', exact: true }).click();
    const diagnostics = page.getByRole('dialog', { name: '诊断预览与导出', exact: true });
    const pre = diagnostics.locator('.diagnostics-json');
    await pre.waitFor();
    const preview = await pre.textContent();
    assert.doesNotMatch(preview, /SECRET_TEMPLATE|SECRET_TEMPLATE_TEXT/);
    assert.ok(!preview.includes(directory), 'diagnostics omit absolute paths');
    const destination = path.join(directory, 'diagnostics.zip');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, destination);
    await diagnostics.getByRole('button', { name: '导出预览为 ZIP', exact: true }).click();
    await diagnostics.getByText('诊断包已保存。', { exact: true }).waitFor();
    const zip = await JSZip.loadAsync(await fs.readFile(destination));
    assert.deepEqual(
      JSON.parse(await zip.file('diagnostics.json').async('string')),
      JSON.parse(preview),
    );
    await page.screenshot({ path: path.join(evidence, 'diagnostics-zh.png') });
    await diagnostics.getByRole('button', { name: '关闭 · Esc', exact: true }).click();
    await settings.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Preview and export diagnostics', exact: true }).click();
    await page
      .getByRole('heading', { name: 'Complete export contents (JSON)', exact: true })
      .waitFor();
    await page.screenshot({ path: path.join(evidence, 'diagnostics-en.png') });
    await page
      .getByRole('dialog', { name: 'Preview and export diagnostics', exact: true })
      .getByRole('button', { name: 'Close · Esc', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: 'Settings', exact: true })
      .getByRole('button', { name: 'Close · Esc', exact: true })
      .click();
    await request('settings.save', { ui: { zoomPercent: 150 } });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
    await page.locator('.permission-trigger').click();
    const menu = page.getByRole('menu', { name: 'Permissions', exact: true });
    await menu.waitFor();
    const box = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(
      box.y >= 0 &&
        box.y + box.height <= viewport.height + 1 &&
        box.x >= 0 &&
        box.x + box.width <= viewport.width + 1,
      `all permission choices remain within a short enlarged window: ${JSON.stringify({ box, viewport })}`,
    );
    for (const item of await menu.getByRole('menuitemradio').all()) {
      await item.scrollIntoViewIfNeeded();
      await item.click({ trial: true });
    }
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'),
    );
    await fs.writeFile(
      path.join(evidence, 'read-permission-150-en.png'),
      Buffer.from(png, 'base64'),
    );
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(evidence, 'result.json'),
      JSON.stringify(
        {
          status: 'passed',
          channelPersisted: true,
          readModePersisted: true,
          reconnectOptOut: true,
          zipMatchesPreview: true,
          locales: ['zh-CN', 'en'],
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS channels, read/reconnect preferences, private diagnostic preview/export and bilingual UI',
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    await fs.mkdir(evidence, { recursive: true });
    await page?.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  } finally {
    await app?.close();
  }
})();
