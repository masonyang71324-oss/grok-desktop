'use strict';
// Run after npm run build. GROK_DESKTOP_TEST_EXE selects an unpacked/installed build.
// ACP, provider configuration, attachments and projects are disposable local fixtures.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const root = path.resolve(__dirname, '..');
const mode = process.env.GROK_DESKTOP_TEST_EXE ? 'packaged' : 'source';
const screenshots = path.join(root, 'test-results', 'upgrades', mode);
let app,
  page,
  directory,
  project,
  server,
  phase = 'setup';
const errors = [];
const passed = [];
const pass = () => {
  passed.push(phase);
  process.stdout.write(`PASS ${phase}\n`);
};
async function request(command, payload = {}) {
  const response = await page.evaluate(
    ({ command, payload }) => window.desktop.request(command, payload),
    { command, payload },
  );
  assert.equal(response.ok, true, `${command}: ${response.error || 'request failed'}`);
  return response.data;
}
async function until(action, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await action();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw new Error(message);
}
async function launch(language = 'zh-CN') {
  const executablePath = process.env.GROK_DESKTOP_TEST_EXE || require('electron');
  const env = {
    ...process.env,
    GROK_HOME: path.join(directory, 'grok-home'),
    GROK_DESKTOP_DATA_DIR: path.join(directory, 'userdata'),
    GROK_DESKTOP_TEST_GROK_SCRIPT: path.join(root, 'scripts', 'mock-grok.cjs'),
    GROK_DESKTOP_MOCK_STATE: path.join(directory, 'mock-state.json'),
    GROK_DESKTOP_MOCK_LOG: path.join(directory, 'mock-events.jsonl'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.GROK_DESKTOP_DEV_URL;
  app = await electron.launch({
    executablePath,
    args: process.env.GROK_DESKTOP_TEST_EXE ? [] : [root],
    env,
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page
    .locator('.sidebar-status')
    .filter({
      hasText: language === 'en' ? 'Grok connected' : 'Grok 已连接',
    })
    .waitFor();
  await page.evaluate(() => {
    window.upgradeEvents = [];
    window.desktop.onEvent((event) => window.upgradeEvents.push(event));
  });
}
async function closeApp() {
  if (!app) return;
  await app
    .evaluate(async ({ app, clipboard, dialog }) => {
      if (globalThis.upgradeClipboard) {
        await clipboard.write(globalThis.upgradeClipboard);
        delete globalThis.upgradeClipboard;
      }
      dialog.showMessageBox = async () => ({ response: 1 });
      app.quit();
    })
    .catch(() => {});
  await app.close().catch(() => {});
  app = null;
}
async function engineAction(name) {
  await page.locator('.home-engine-status').click();
  await page.getByRole('dialog', { name: 'Grok Build 引擎', exact: true }).waitFor();
  await page.getByRole('button', { name, exact: true }).click();
}
async function chooseDialogFile(file) {
  await app.evaluate(({ dialog }, selected) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [selected] };
    };
  }, file);
}
async function bounds(width, height) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find((item) => !item.getParentWindow());
      if (win.isMaximized()) win.unmaximize();
      win.setSize(size.width, size.height);
    },
    { width, height },
  );
  await page.waitForFunction(() => document.querySelector('.workspace')?.clientWidth > 0);
}
async function screenshot(name) {
  await page.screenshot({ path: path.join(screenshots, `${name}.png`) });
}

(async () => {
  try {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'grok upgrades ')));
    project = path.join(directory, 'project');
    const userData = path.join(directory, 'userdata');
    const grokHome = path.join(directory, 'grok-home');
    await Promise.all(
      [project, userData, grokHome, screenshots].map((folder) =>
        fs.mkdir(folder, { recursive: true }),
      ),
    );
    await fs.writeFile(
      path.join(project, 'fixture.txt'),
      'theme = "light"\nnotifications = false\n',
    );
    execFileSync('git', ['init', '--quiet', project]);
    execFileSync('git', ['-C', project, '-c', 'core.autocrlf=false', 'add', 'fixture.txt']);
    execFileSync('git', [
      '-C',
      project,
      '-c',
      'user.name=E2E Fixture',
      '-c',
      'user.email=e2e@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ]);
    await fs.writeFile(path.join(project, 'fixture.txt'), 'theme = "dark"\nnotifications = true\n');
    await fs.writeFile(path.join(project, 'second.txt'), 'second\n');
    await fs.mkdir(path.join(project, 'node_modules'));
    await fs.writeFile(path.join(project, 'node_modules', 'fixture-hidden.txt'), 'excluded\n');
    await fs.copyFile(
      path.join(root, 'tests', 'fixtures', 'word', 'sample.docx'),
      path.join(project, 'sample.docx'),
    );
    const presentation = new JSZip();
    presentation.file(
      'ppt/presentation.xml',
      '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="r1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>',
    );
    presentation.file(
      'ppt/_rels/presentation.xml.rels',
      '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    );
    presentation.file(
      'ppt/slides/slide1.xml',
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="6400800" cy="1828800"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="2400" b="1"/><a:t>Positioned slide fixture</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
    );
    await fs.writeFile(
      path.join(project, 'sample.pptx'),
      await presentation.generateAsync({ type: 'nodebuffer' }),
    );
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Read-only fixture', 'Amount'],
      ['Alpha', 12.5],
    ]);
    sheet.A2.s = { font: { bold: true } };
    XLSX.utils.book_append_sheet(workbook, sheet, 'Overview');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Second sheet']]), 'Details');
    XLSX.writeFile(workbook, path.join(project, 'sample.xlsx'));
    const officeBefore = new Map(
      await Promise.all(
        ['sample.docx', 'sample.xlsx', 'sample.pptx'].map(async (name) => [
          name,
          await fs.readFile(path.join(project, name)),
        ]),
      ),
    );
    const configFile = path.join(grokHome, 'config.toml');
    await fs.writeFile(
      configFile,
      '# E2E unrelated comment\nunknown_root = "keep-root"\n\n[model.fixture]\n' +
        'model = "fixture-model"\nbase_url = "http://127.0.0.1:9/v1"\n' +
        'name = "Fixture provider"\nenv_key = "UPGRADE_E2E_UNSET_KEY"\n' +
        'api_backend = "chat_completions"\nunknown_model = "keep-model" # keep-inline\n',
    );
    await fs.writeFile(
      path.join(userData, 'settings.json'),
      JSON.stringify({
        language: 'zh-CN',
        grokPath: process.execPath,
        lastProject: project,
        recentProjects: [project],
        permissionMode: 'ask',
        notifications: false,
      }),
    );
    phase = 'isolated-launch-and-startup-wizard';
    await launch();
    await bounds(1280, 850);
    await engineAction('首次使用引导');
    const wizard = page.getByRole('dialog', { name: '欢迎使用 Grok Desktop', exact: true });
    await wizard.locator('.runtime-ready').filter({ hasText: '已检测到 Grok 1.0.46' }).waitFor();
    assert.equal(
      await wizard.getByRole('button', { name: '安装官方稳定版', exact: true }).count(),
      0,
    );
    await chooseDialogFile(process.execPath);
    await wizard.getByRole('button', { name: '选择 Grok 程序', exact: true }).click();
    await until(
      async () => (await request('bootstrap')).settings.grokPath === process.execPath,
      'Wizard did not save chosen CLI',
    );
    await wizard.getByRole('button', { name: '重新检查登录', exact: true }).click();
    await wizard.getByText('已验证登录状态。', { exact: true }).waitFor();
    await chooseDialogFile(project);
    await wizard.getByRole('button', { name: '选择项目目录', exact: true }).click();
    await wizard.getByRole('button', { name: '开始使用', exact: true }).click();
    await wizard.waitFor({ state: 'hidden' });
    assert.equal((await request('cli.install.state')).status, 'idle');
    pass();

    phase = 'provider-form-preserves-unrelated-toml';
    await engineAction('模型来源');
    const provider = page.getByRole('dialog', { name: '自定义模型', exact: true });
    await provider.getByRole('button', { name: '编辑 Fixture provider', exact: true }).click();
    await provider.getByLabel('显示名称', { exact: true }).fill('Edited fixture');
    await provider.getByRole('button', { name: '保存模型', exact: true }).click();
    await provider.getByRole('button', { name: '停用 Edited fixture', exact: true }).click();
    await provider.getByRole('button', { name: '启用 Edited fixture', exact: true }).click();
    await provider.getByRole('button', { name: '停用 Edited fixture', exact: true }).waitFor();
    const providerText = await fs.readFile(configFile, 'utf8');
    for (const text of [
      '# E2E unrelated comment',
      'unknown_root = "keep-root"',
      'unknown_model = "keep-model" # keep-inline',
      'name = "Edited fixture"',
    ])
      assert.ok(providerText.includes(text), `Provider save lost ${text}`);
    const providers = await request('providers.list');
    assert.equal(providers.models[0].enabled, true);
    assert.equal(providers.models[0].hasKey, false);
    await screenshot('providers-zh');
    await page.keyboard.press('Escape');
    pass();

    phase = 'conversation-search-outline-and-diff';
    const prompt = 'MOCK_RENDER 搜索目录 fixture';
    await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).fill(prompt);
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.waitForFunction(() =>
      window.upgradeEvents.some((event) => event.type === 'turn-end'),
    );
    const originalSession = (await request('sessions.list', { cwd: project }))[0];
    const sessionId = originalSession.sessionId;
    await page.locator('.message.assistant .code-block code').waitFor();
    await page.getByRole('button', { name: '搜索与提问目录', exact: true }).click();
    const navigation = page.locator('.conversation-navigation');
    await navigation
      .getByRole('searchbox', { name: '搜索会话', exact: true })
      .fill('notifications');
    await navigation.getByRole('button', { name: '下一处', exact: true }).click();
    await page.locator('.tool-row[open].conversation-jump').waitFor();
    await page.locator('.tool-row .tool-diff').waitFor();
    await navigation.getByRole('tab', { name: '问题目录', exact: true }).click();
    await navigation.getByRole('button', { name: new RegExp(prompt) }).click();
    await page.locator('.message.user.conversation-jump').waitFor();
    await page.locator('header').getByRole('button', { name: '查看变更', exact: true }).click();
    await page.locator('.inspector .change-row').filter({ hasText: 'fixture.txt' }).click();
    const diff = page.getByRole('dialog', { name: '文件变更', exact: true });
    await diff.getByRole('button', { name: '并排', exact: true }).click();
    assert.ok((await diff.locator('.diff-split-row').count()) > 0);
    assert.ok((await diff.locator('mark').count()) > 0);
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: '会话', exact: true }).click();
    await screenshot('conversation-zh');
    pass();

    phase = 'native-formatted-and-original-clipboard-copy';
    await app.evaluate(async ({ clipboard, ClipboardItem }) => {
      const previous = await clipboard.read();
      globalThis.upgradeClipboard = await Promise.all(
        previous
          .filter((item) => item.types.length)
          .map(
            async (item) =>
              new ClipboardItem(
                Object.fromEntries(
                  await Promise.all(
                    item.types.map(async (type) => [type, await item.getType(type)]),
                  ),
                ),
              ),
          ),
      );
    });
    const assistant = page.locator('.message.assistant').last();
    await assistant.getByRole('button', { name: '复制格式化内容', exact: true }).click();
    const formatted = await until(async () => {
      const value = await app.evaluate(async ({ clipboard }) => {
        const items = await clipboard.read();
        const textItem = items.find((item) => item.types.includes('text/plain'));
        const htmlItem = items.find((item) => item.types.includes('text/html'));
        return {
          text: textItem ? await (await textItem.getType('text/plain')).text() : '',
          html: htmlItem ? await (await htmlItem.getType('text/html')).text() : '',
        };
      });
      return value.html.includes('<pre') && value;
    }, 'Formatted copy did not write HTML');
    assert.match(formatted.html, /<code/);
    assert.match(formatted.text, /const greeting = "你好，Grok";/);
    assert.doesNotMatch(formatted.html, /<button|data-copy|复制代码/);
    await assistant.getByRole('button', { name: '复制原文', exact: true }).click();
    const original =
      '这是一条固定的界面测试回复，展示代码和文件修改。\n\n```javascript\nconst greeting = "你好，Grok";\nconsole.log(greeting);\n```';
    await until(
      async () => (await app.evaluate(({ clipboard }) => clipboard.readText())) === original,
      'Original copy must preserve exact Markdown',
    );
    await app.evaluate(async ({ clipboard }) => {
      await clipboard.write(globalThis.upgradeClipboard);
      delete globalThis.upgradeClipboard;
    });
    pass();

    phase = 'project-file-picker-multiple-attachments';
    await page.getByRole('button', { name: '引用项目文件', exact: true }).click();
    const picker = page.getByRole('dialog', { name: '引用项目文件', exact: true });
    await picker.getByRole('textbox', { name: '搜索文件名或项目路径', exact: true }).fill('.txt');
    await picker.getByRole('checkbox', { name: 'fixture.txt', exact: true }).check();
    await picker.getByRole('checkbox', { name: 'second.txt', exact: true }).check();
    assert.equal(await picker.getByText('fixture-hidden.txt', { exact: true }).count(), 0);
    await picker.getByRole('button', { name: '添加 2 个文件', exact: true }).click();
    await page.locator('.attachment-name').filter({ hasText: 'fixture.txt' }).waitFor();
    await page.locator('.attachment-name').filter({ hasText: 'second.txt' }).waitFor();
    for (const name of ['fixture.txt', 'second.txt'])
      await page.getByRole('button', { name: `移除 ${name}`, exact: true }).click();
    pass();

    phase = 'office-docx-sheet-and-slides-read-only-preview';
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    await page.locator('.inspector').getByRole('button', { name: '文件', exact: true }).click();
    for (const name of ['sample.xlsx', 'sample.pptx', 'sample.docx']) {
      await page.locator('.inspector .file-row').filter({ hasText: name }).click();
      await page.locator('.office-preview').getByText('只读排版预览', { exact: true }).waitFor();
      if (name.endsWith('xlsx')) {
        await page
          .locator('.office-preview')
          .getByRole('tab', { name: 'Overview', exact: true })
          .waitFor();
        assert.equal(
          await page.locator('.office-sheet [data-address="A1"]').innerText(),
          'Read-only fixture',
        );
        await page
          .locator('.office-preview')
          .getByRole('tab', { name: 'Details', exact: true })
          .click();
        await page.locator('.office-sheet').getByText('Second sheet', { exact: true }).waitFor();
      } else if (name.endsWith('pptx')) {
        await page
          .locator('.office-slide')
          .getByText('Positioned slide fixture', { exact: true })
          .waitFor();
      } else {
        await page.frameLocator('.office-docx-frame').locator('section.docx').first().waitFor();
      }
      assert.equal(
        await page
          .locator(
            '.office-preview input, .office-preview textarea, .office-preview [contenteditable="true"]',
          )
          .count(),
        0,
      );
      assert.deepEqual(await fs.readFile(path.join(project, name)), officeBefore.get(name));
      await screenshot(`office-${path.extname(name).slice(1)}-zh`);
      await page.keyboard.press('Escape');
    }
    await page.getByRole('tab', { name: '会话', exact: true }).click();
    pass();

    phase = 'native-terminal-input-hidden-retention-stop-restart';
    await page.getByRole('button', { name: '交互终端', exact: true }).click();
    const terminalDialog = page.getByRole('dialog', { name: '交互终端', exact: true });
    await terminalDialog.locator('.xterm-helper-textarea').waitFor();
    let terminal = await until(async () => {
      const state = await request('terminal.state', { cwd: project });
      return state?.status === 'running' && state.log.includes('PS ') && state;
    }, 'Native PowerShell did not start');
    const terminalId = terminal.id;
    // Write via xterm's actual keyboard/input path and check terminal output, not echoed input.
    await terminalDialog
      .locator('.xterm-helper-textarea')
      .pressSequentially("Write-Output ('UPGRADE_' + 'PTY_OK'); (Get-Location).Path", { delay: 2 });
    await terminalDialog.locator('.xterm-helper-textarea').press('Enter');
    terminal = await until(async () => {
      const state = await request('terminal.state', { id: terminalId });
      return state.log.includes('UPGRADE_PTY_OK') && state.log.includes(project) && state;
    }, 'xterm input did not reach native PTY');
    await screenshot('terminal-zh');
    await page.keyboard.press('Escape');
    assert.equal((await request('terminal.state', { id: terminalId })).status, 'running');
    await page.getByRole('button', { name: '交互终端', exact: true }).click();
    assert.equal((await request('terminal.state', { cwd: project })).id, terminalId);
    await terminalDialog.getByRole('button', { name: '停止终端', exact: true }).click();
    await until(
      async () => (await request('terminal.state', { id: terminalId })).status === 'exited',
      'Stopping terminal did not end native process',
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '交互终端', exact: true }).click();
    const retained = await request('terminal.state', { cwd: project });
    assert.equal(retained.id, terminalId);
    assert.match(retained.log, /UPGRADE_PTY_OK/);
    await terminalDialog.getByRole('button', { name: '重新启动', exact: true }).click();
    terminal = await until(async () => {
      const state = await request('terminal.state', { cwd: project });
      return state?.id !== terminalId && state?.status === 'running' && state;
    }, 'Explicit restart did not create a new terminal');
    await terminalDialog.getByRole('button', { name: '停止终端', exact: true }).click();
    await page.keyboard.press('Escape');
    pass();

    phase = 'isolated-web-module-render-and-capture-original-draft';
    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', req.url === '/module.js' ? 'text/javascript' : 'text/html');
      res.end(
        req.url === '/module.js'
          ? "document.querySelector('#rendered').textContent='MODULE_RENDER_OK'; document.title='Local module preview';"
          : '<!doctype html><html><head><title>Local preview</title></head><body><h1 id="rendered">Loading</h1><script type="module" src="/module.js"></script></body></html>',
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page
      .getByRole('textbox', { name: '发送给 Grok 的消息', exact: true })
      .fill('Original preview draft');
    await page.getByRole('button', { name: '网页预览', exact: true }).click();
    const webDialog = page.getByRole('dialog', { name: '网页预览', exact: true });
    await webDialog.getByLabel('网页地址', { exact: true }).fill(url);
    const childPromise = app.waitForEvent('window');
    await webDialog.getByRole('button', { name: '打开预览窗口', exact: true }).click();
    const child = await childPromise;
    child.setDefaultTimeout(10000);
    await until(
      async () =>
        app.evaluate(async ({ webContents }, prefix) => {
          const remote = webContents
            .getAllWebContents()
            .find((wc) => wc.getURL().startsWith(prefix));
          if (!remote || remote.isLoading()) return false;
          return remote.executeJavaScript(
            "document.querySelector('#rendered')?.textContent === 'MODULE_RENDER_OK'",
          );
        }, url),
      'Isolated preview did not render module JavaScript',
    );
    const isolation = await app.evaluate(async ({ webContents }, prefix) => {
      const remote = webContents.getAllWebContents().find((wc) => wc.getURL().startsWith(prefix));
      return remote.executeJavaScript(
        '({ desktop: typeof window.desktop, require: typeof require, process: typeof process })',
      );
    }, url);
    assert.deepEqual(isolation, {
      desktop: 'undefined',
      require: 'undefined',
      process: 'undefined',
    });
    await page
      .getByRole('button', { name: /新建会话/ })
      .first()
      .click();
    await page.locator('.message.user').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('.new-conversation').disabled);
    await page
      .getByRole('textbox', { name: '发送给 Grok 的消息', exact: true })
      .fill('Different session draft');
    await child.locator('[data-action="capture"]').click();
    await child.getByRole('status').filter({ hasText: '截图已加入原会话草稿' }).waitFor();
    assert.equal(await page.locator('.attachment-name').count(), 0);
    assert.equal(
      await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).inputValue(),
      'Different session draft',
    );
    await page.locator('.session-select').filter({ hasText: originalSession.title }).click();
    await page.locator('.attachment-name').filter({ hasText: 'preview-' }).waitFor();
    assert.equal(
      await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).inputValue(),
      'Original preview draft',
    );
    const capture = await page.evaluate(() =>
      window.upgradeEvents.find((event) => event.type === 'preview-captured'),
    );
    assert.equal(capture.owner.sessionId, sessionId);
    assert.equal(capture.owner.cwd, project);
    assert.ok((await fs.stat(capture.attachment.path)).size > 0);
    const mockEvents = (await fs.readFile(path.join(directory, 'mock-events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(
      mockEvents.filter((event) => event.type === 'prompt').length,
      1,
      'Capture must never auto-send',
    );
    await request('preview.close', {
      id: (await child.evaluate(() => window.preview.request({ action: 'state' }))).data.id,
    });
    await screenshot('preview-draft-zh');
    pass();

    phase = 'keyboard-pointer-resize-persistence-and-small-window';
    const sidebar = page.getByRole('separator', { name: '调整侧栏宽度', exact: true });
    await sidebar.press('Home');
    await sidebar.press('ArrowRight');
    const composer = page.getByRole('separator', { name: '调整输入区高度', exact: true });
    await composer.press('Home');
    await composer.press('ArrowUp');
    const box = await sidebar.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2);
    await page.mouse.up();
    const saved = await until(async () => {
      const ui = (await request('bootstrap')).settings.ui;
      return ui.sidebarWidth === 230 && ui.composerHeight === 100 && ui;
    }, 'Resize sizes were not saved');
    await closeApp();
    await launch();
    assert.equal((await request('bootstrap')).settings.ui.sidebarWidth, saved.sidebarWidth);
    assert.equal(
      await page
        .getByRole('separator', { name: '调整侧栏宽度', exact: true })
        .getAttribute('aria-valuenow'),
      '230',
    );
    assert.equal(
      await page
        .getByRole('separator', { name: '调整输入区高度', exact: true })
        .getAttribute('aria-valuenow'),
      '100',
    );
    await bounds(900, 640);
    await screenshot('small-window-zh');
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      composer: document.querySelector('.composer').getBoundingClientRect().right,
    }));
    assert.ok(
      layout.scroll <= layout.width + 1 && layout.composer <= layout.width + 1,
      'Small window must keep composer inside viewport',
    );
    await bounds(1280, 850);
    pass();

    phase = 'bilingual-labels-and-dictation-button-presence';
    const voiceScript = await app.evaluate(({ app }) =>
      app.isPackaged
        ? `${process.resourcesPath}/voice-typing.ps1`
        : `${app.getAppPath()}/electron/voice-typing.ps1`,
    );
    assert.ok(
      (await fs.stat(voiceScript)).size > 0,
      'Voice helper must exist outside ASAR for PowerShell',
    );
    await page.getByRole('button', { name: 'Windows 语音输入', exact: true }).waitFor();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
    await page.getByRole('button', { name: 'Close · Esc', exact: true }).click();
    for (const name of [
      'Windows voice typing',
      'Interactive terminal',
      'Web preview',
      'Reference project files',
      'Search and question outline',
    ])
      await page.getByRole('button', { name, exact: true }).waitFor();
    await page.getByRole('separator', { name: 'Resize sidebar', exact: true }).waitFor();
    await page.getByRole('separator', { name: 'Resize composer', exact: true }).waitFor();
    await screenshot('desktop-en');
    await bounds(900, 640);
    await screenshot('small-window-en');
    assert.deepEqual(errors, []);
    pass();
    process.stdout.write(`Completed ${passed.length} upgrade integration checks (${mode}).\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${phase}: ${error.stack || error}\n`);
    process.exitCode = 1;
    if (page) await screenshot('failure').catch(() => {});
  } finally {
    // app.quit performs production teardown for every owned PTY and preview child.
    // Clipboard is restored before quit even if a clipboard assertion failed.
    await closeApp();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (directory) process.stdout.write(`Artifacts: ${directory}\nScreenshots: ${screenshots}\n`);
  }
})();
