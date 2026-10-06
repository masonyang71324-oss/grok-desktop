const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser, bundle, componentCss;
before(async () => {
  const outputs = buildSync({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './src/App'; createRoot(document.getElementById('root')).render(<App/>);`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    outfile: 'app.js',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  }).outputFiles;
  bundle = outputs.find((file) => !file.path.endsWith('.css')).text;
  componentCss = outputs.find((file) => file.path.endsWith('.css'))?.text || '';
  browser = await launchBrowser();
});
after(async () => browser?.close());

test('returning to the previous navigation while its first save is pending persists the latest selection', async (t) => {
  const page = await fixture(t, { authStatus: 'authenticated' });
  await page.evaluate(() => {
    const request = window.desktop.request;
    window.calls = [];
    window.desktop.request = async (command, payload) => {
      const response = await request(command, payload);
      if (command === 'settings.save' && payload.ui?.navigationTab === 'files')
        return new Promise((resolve) => {
          window.finishNavigationSave = () => resolve(response);
        });
      return response;
    };
  });
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.waitForFunction(() => !!window.finishNavigationSave);
  await page.getByRole('tab', { name: '会话', exact: true }).click();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(
    await page.evaluate(() =>
      window.calls.some(
        (call) => call.command === 'settings.save' && call.payload.ui?.navigationTab === 'sessions',
      ),
    ),
    true,
  );
  await page.evaluate(() => window.finishNavigationSave());
  assert.equal(await page.evaluate(() => window.settings.ui.navigationTab), 'sessions');
});

test('navigation persists without a debounce and dragging saves its final size on release', async (t) => {
  const page = await fixture(t, { authStatus: 'authenticated' });
  await page.evaluate(() => {
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = (fn, delay, ...args) => (delay >= 200 ? 0 : schedule(fn, delay, ...args));
    window.calls = [];
  });
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(
    await page.evaluate(() =>
      window.calls.some(
        (call) => call.command === 'settings.save' && call.payload.ui?.navigationTab === 'files',
      ),
    ),
    true,
  );
  const handle = page.getByRole('separator', { name: '调整侧栏宽度' }),
    bounds = await handle.boundingBox();
  await page.evaluate(() => {
    window.calls = [];
  });
  await page.mouse.move(bounds.x + 3, bounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 40, bounds.y + 40);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  assert.equal(
    await page.evaluate(() =>
      window.calls.some(
        (call) => call.command === 'settings.save' && call.payload.ui?.sidebarWidth,
      ),
    ),
    false,
  );
  await page.mouse.up();
  await page.waitForFunction(() =>
    window.calls.some((call) => call.command === 'settings.save' && call.payload.ui?.sidebarWidth),
  );
});

test('unified navigation preserves the composer and exposes files, tasks and footer controls at small desktop sizes', async (t) => {
  const page = await fixture(t, { authStatus: 'authenticated' });
  await page.setViewportSize({ width: 980, height: 680 });
  const draft = page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true });
  await draft.fill('切换面板后保留的草稿');
  const navigation = page.getByRole('tablist', { name: '工作区导航' });
  await navigation.getByRole('tab', { name: '文件', exact: true }).click();
  await page.locator('.inspector').getByText('先选择一个项目', { exact: true }).waitFor();
  await navigation.getByRole('tab', { name: '任务', exact: true }).click();
  await page
    .locator('.task-center-embedded')
    .getByText('暂无活跃或待处理任务', { exact: true })
    .waitFor();
  await navigation.getByRole('tab', { name: '会话', exact: true }).click();
  assert.equal(await draft.inputValue(), '切换面板后保留的草稿');
  const footer = await page.locator('.desktop-status-bar').boundingBox();
  const send = await page.getByRole('button', { name: '发送消息', exact: true }).boundingBox();
  assert.ok(footer && footer.y + footer.height <= 680);
  assert.ok(send && send.y + send.height <= footer.y);
  assert.equal(await page.locator('.desktop-status-bar .home-engine-status').isVisible(), true);
  assert.equal(await page.locator('.desktop-status-bar .home-update-status').isVisible(), true);
  assert.equal(await page.locator('.desktop-status-bar .usage-status').isVisible(), true);
  await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  assert.equal(await navigation.isVisible(), false);
  assert.equal(await draft.inputValue(), '切换面板后保留的草稿');
  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  assert.equal(await navigation.isVisible(), true);
  await navigation.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  await page.getByRole('button', { name: '展开项目上下文', exact: true }).click();
  assert.equal(
    await navigation.getByRole('tab', { name: '文件', exact: true }).getAttribute('aria-selected'),
    'true',
  );
  assert.equal(await page.locator('.inspector').isVisible(), true);
});

test('the appearance shortcut persists its selection without replacing drafts or attachments and stays available without the sidebar', async (t) => {
  const page = await fixture(t, { authStatus: 'authenticated' });
  await page.evaluate(() => {
    const request = window.desktop.request;
    window.desktop.request = (command, payload) =>
      command === 'dialog.attach'
        ? Promise.resolve({
            ok: true,
            data: [
              { name: 'keep.txt', path: 'C:/keep.txt', kind: 'text', text: 'Keep this attachment' },
            ],
          })
        : request(command, payload);
  });
  const draft = page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true });
  await draft.fill('切换主题也保留这段任务');
  await page.getByRole('button', { name: '添加文件或图片', exact: true }).click();
  await page.locator('.attachment-name').filter({ hasText: 'keep.txt' }).waitFor();
  const appearance = page.getByRole('combobox', { name: '外观主题', exact: true });
  await appearance.selectOption('light');
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'light' && window.settings.theme === 'light',
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.calls
        .filter((call) => call.command === 'settings.save' && call.payload.theme)
        .map((call) => call.payload),
    ),
    [{ theme: 'light' }],
  );
  assert.equal(await draft.inputValue(), '切换主题也保留这段任务');
  assert.equal(await page.locator('.attachment-name').count(), 1);
  assert.equal(await page.locator('.attachment-name').textContent(), 'keep.txt');
  await appearance.selectOption('light');
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter((call) => call.command === 'settings.save' && call.payload.theme)
          .length,
    ),
    1,
  );
  await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  assert.equal(await appearance.isVisible(), true);
  await appearance.selectOption('dark');
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'dark' && window.settings.theme === 'dark',
  );
  assert.equal(await draft.inputValue(), '切换主题也保留这段任务');
  assert.equal(await page.locator('.attachment-name').textContent(), 'keep.txt');
  assert.equal(
    await page.evaluate(() => window.calls.filter((call) => call.command === 'bootstrap').length),
    1,
  );
});

test('system appearance follows media changes while a fixed theme remains fixed', async (t) => {
  const page = await fixture(t, { language: 'en', authStatus: 'authenticated' });
  const appearance = page.getByRole('combobox', { name: 'Appearance theme', exact: true });
  await page.emulateMedia({ colorScheme: 'light' });
  await appearance.selectOption('system');
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'light' && window.settings.theme === 'system',
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await appearance.inputValue(), 'system');
  await appearance.selectOption('light');
  await page.waitForFunction(
    () => document.documentElement.dataset.theme === 'light' && window.settings.theme === 'light',
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await appearance.inputValue(), 'light');
  assert.equal(await page.evaluate(() => window.settings.theme), 'light');
});

test('a pending appearance save is disabled and a failed save keeps the previous theme', async (t) => {
  const page = await fixture(t, { authStatus: 'authenticated' });
  await page.evaluate(() => {
    const request = window.desktop.request;
    window.desktop.request = (command, payload) =>
      command === 'settings.save' && payload.theme
        ? new Promise((resolve) => {
            window.rejectThemeSave = () => resolve({ ok: false, error: 'Theme save failed' });
          })
        : request(command, payload);
  });
  const appearance = page.getByRole('combobox', { name: '外观主题', exact: true });
  await appearance.focus();
  await appearance.selectOption('light');
  await page.waitForFunction(
    () =>
      typeof window.rejectThemeSave === 'function' &&
      document.querySelector('select[aria-label="外观主题"]').disabled,
  );
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.evaluate(() => window.settings.theme), 'dark');
  const failureNotice = page.locator('.toast').filter({ hasText: 'Theme save failed' }).waitFor();
  await page.evaluate(() => window.rejectThemeSave());
  await failureNotice;
  await page.waitForFunction(
    () => !document.querySelector('select[aria-label="外观主题"]').disabled,
  );
  assert.equal(await appearance.inputValue(), 'dark');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await appearance.evaluate((node) => node === document.activeElement), true);
  await appearance.selectOption('light');
  await page.waitForFunction(
    () => document.querySelector('select[aria-label="外观主题"]').disabled,
  );
  const draft = page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true });
  await draft.fill('保存期间继续输入');
  await page.evaluate(() => window.rejectThemeSave());
  await page.waitForFunction(
    () => !document.querySelector('select[aria-label="外观主题"]').disabled,
  );
  assert.equal(await draft.evaluate((node) => node === document.activeElement), true);
  assert.equal(await draft.inputValue(), '保存期间继续输入');
  assert.equal(await appearance.inputValue(), 'dark');
});

test('wide project context stays independent of sessions, tasks, and sidebar visibility', async (t) => {
  const page = await fixture(t, { authStatus: 'authenticated' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '打开项目文件夹', exact: true }).click();
  const navigation = page.getByRole('tablist', { name: '工作区导航' });
  const context = page.locator('.project-context-pane');
  const draft = page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true });
  await draft.fill('两侧面板都不能影响这段草稿');
  await page.locator('header').getByRole('button', { name: '查看变更', exact: true }).click();
  await context.getByText('工作区干净', { exact: true }).waitFor();
  assert.equal(
    await navigation.getByRole('tab', { name: '会话', exact: true }).getAttribute('aria-selected'),
    'true',
  );
  assert.equal(
    await page.getByRole('button', { name: 'My existing session', exact: true }).isVisible(),
    true,
  );
  assert.equal(await page.locator('.inspector').count(), 1);
  const bounds = await context.boundingBox();
  const workspace = await page.locator('.workspace').boundingBox();
  assert.ok(bounds.x >= workspace.x + workspace.width - 1 && bounds.x + bounds.width <= 1441);
  await navigation.getByRole('tab', { name: '任务', exact: true }).click();
  await page
    .locator('.task-center-embedded')
    .getByText('暂无活跃或待处理任务', { exact: true })
    .waitFor();
  await page.locator('header').getByRole('button', { name: '计划', exact: true }).click();
  assert.equal(
    await context.getByRole('button', { name: '计划', exact: true }).getAttribute('class'),
    'active',
  );
  assert.equal(
    await navigation.getByRole('tab', { name: '任务', exact: true }).getAttribute('aria-selected'),
    'true',
  );
  await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  assert.equal(await navigation.isVisible(), false);
  assert.equal(await context.isVisible(), true);
  assert.equal(
    await page.getByRole('button', { name: '收起项目上下文', exact: true }).isVisible(),
    true,
  );
  assert.equal(await draft.inputValue(), '两侧面板都不能影响这段草稿');
  await page.getByRole('button', { name: '收起项目上下文', exact: true }).click();
  await context.waitFor({ state: 'hidden' });
  assert.equal(await navigation.isVisible(), false);
  await page.getByRole('button', { name: '展开侧边栏', exact: true }).click();
  assert.equal(
    await navigation.getByRole('tab', { name: '任务', exact: true }).getAttribute('aria-selected'),
    'true',
  );
});

test('right context resizing saves its own width only on release and leaves sidebar width unchanged', async (t) => {
  const page = await fixture(t, { authStatus: 'authenticated' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '展开项目上下文', exact: true }).click();
  const handle = page.getByRole('separator', { name: '调整项目上下文宽度', exact: true });
  const bounds = await handle.boundingBox();
  const before = Number(await handle.getAttribute('aria-valuenow'));
  const sidebarWidth = await page.evaluate(() => window.settings.ui.sidebarWidth);
  await page.evaluate(() => {
    window.calls = [];
  });
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 36, bounds.y + 40);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  assert.equal(
    await page.evaluate(() =>
      window.calls.some(
        (call) => call.command === 'settings.save' && call.payload.ui?.inspectorWidth,
      ),
    ),
    false,
  );
  const resized = Number(await handle.getAttribute('aria-valuenow'));
  assert.ok(resized > before, 'dragging the left edge left increases the right context width');
  await page.mouse.up();
  await page.waitForFunction((expected) => window.settings.ui.inspectorWidth === expected, resized);
  assert.equal(await page.evaluate(() => window.settings.ui.sidebarWidth), sidebarWidth);
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter(
          (call) => call.command === 'settings.save' && call.payload.ui?.inspectorWidth,
        ).length,
    ),
    1,
  );
});

test('right context previews a diff inline and preserves full review and add-context actions', async (t) => {
  const page = await fixture(t, { authStatus: 'authenticated' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    window.workspaceChanges = [{ path: 'notes.txt', status: 'M', staged: false }];
  });
  await page.getByRole('button', { name: '打开项目文件夹', exact: true }).click();
  await page.locator('header').getByRole('button', { name: '查看变更', exact: true }).click();
  const context = page.locator('.project-context-pane');
  await context.locator('.change-row').filter({ hasText: 'notes.txt' }).click();
  const preview = page.locator('.context-diff-preview');
  await preview.waitFor();
  assert.match(await preview.textContent(), /old text/);
  assert.match(await preview.textContent(), /new text/);
  assert.equal(await page.getByRole('dialog', { name: '文件变更', exact: true }).count(), 0);
  for (const width of [980, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(
      (wide) => Boolean(document.querySelector('.project-context-pane .inspector')) === wide,
      width >= 1100,
    );
    assert.equal(await preview.count(), 1);
    assert.equal(await preview.isVisible(), true);
    assert.match(await preview.textContent(), /new text/);
    assert.equal(await page.getByRole('dialog', { name: '文件变更', exact: true }).count(), 0);
  }
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.command === 'workspace.diff').length,
    ),
    1,
  );
  await preview.getByRole('button', { name: '查看完整差异', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '文件变更', exact: true });
  await dialog.getByRole('button', { name: '并排', exact: true }).click();
  assert.ok((await dialog.locator('.diff-split-row').count()) > 0);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await preview.isVisible(), true);
  await preview.getByRole('button', { name: '添加差异到上下文', exact: true }).click();
  await page.locator('.attachment-name').filter({ hasText: 'notes.txt (diff)' }).waitFor();
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.command === 'workspace.diff').length,
    ),
    1,
  );
});

test('a single file editor preserves unsaved edits when context moves between wide and narrow layouts', async (t) => {
  const page = await fixture(t, { authStatus: 'authenticated' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    window.workspaceEntries = [{ name: 'notes.txt', path: 'notes.txt', isDirectory: false }];
  });
  await page.getByRole('button', { name: '打开项目文件夹', exact: true }).click();
  await page.getByRole('button', { name: '展开项目上下文', exact: true }).click();
  await page.locator('.inspector .file-row').filter({ hasText: 'notes.txt' }).click();
  const dialog = page.getByRole('dialog', { name: 'notes.txt', exact: true });
  const editor = dialog.getByRole('textbox', { name: '文件内容', exact: true });
  const draft = '尚未保存的编辑\nKeep my exact draft 123';
  await editor.fill(draft);
  const readCount = await page.evaluate(
    () => window.calls.filter((call) => call.command === 'workspace.read').length,
  );
  for (const width of [980, 1440]) {
    await page.setViewportSize({ width, height: 820 });
    await page.waitForFunction(
      (wide) => Boolean(document.querySelector('.project-context-pane .inspector')) === wide,
      width >= 1100,
    );
    assert.equal(await page.locator('.inspector').count(), 1);
    assert.equal(await dialog.count(), 1);
    assert.equal(await editor.inputValue(), draft);
    await dialog.getByText('有未保存的修改', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.settings.ui.navigationTab), 'sessions');
  }
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.command === 'workspace.read').length,
    ),
    readCount,
  );
  assert.equal(
    await page.evaluate(() => window.calls.some((call) => call.command === 'workspace.save')),
    false,
  );
});

test('expanded task results stay in the thread scroll while the send control remains visible with a long draft', async (t) => {
  const page = await fixture(t, { authStatus: 'authenticated' });
  await page.setViewportSize({ width: 980, height: 680 });
  await page.getByRole('button', { name: '打开项目文件夹', exact: true }).click();
  await page.evaluate(() => {
    const lastTurn = {
      turnId: 'done',
      status: 'completed',
      startedAt: '2026-10-02T01:00:00Z',
      finishedAt: '2026-10-02T01:00:02Z',
      checkpointId: 'cp',
      facts: {
        toolCount: 1,
        completedToolCount: 1,
        failedToolCount: 0,
        unfinishedToolCount: 0,
        verification: { count: 1, passed: 1, failed: 0, unknown: 0 },
      },
    };
    window.checkpoint = {
      id: 'cp',
      turnId: 'done',
      cwd: 'C:/project',
      sessionId: 'existing',
      status: 'ready',
      files: Array.from({ length: 6 }, (_, i) => ({
        path: `file-${i}.ts`,
        status: 'created',
        before: null,
        after: 'new',
      })),
      skipped: [],
    };
    window.snapshot.runtime = { ...window.snapshot.runtime, lastTurn };
    window.snapshot.updates = [
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Task' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Done' } },
    ];
  });
  await page.getByRole('button', { name: 'My existing session', exact: true }).click();
  await page.getByText('变更与验证明细', { exact: true }).click();
  await page
    .getByRole('textbox', { name: '发送给 Grok 的消息', exact: true })
    .fill(Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'));
  const box = await page.getByRole('button', { name: '发送消息', exact: true }).boundingBox();
  assert.ok(box && box.y + box.height <= 680);
  assert.equal(
    await page.evaluate(() => !!document.querySelector('.thread .task-result-container')),
    true,
  );
  await page.evaluate(() =>
    window.emit({
      type: 'tasks-changed',
      tasks: [
        {
          sessionId: 'existing',
          cwd: 'C:/project',
          title: 'existing',
          status: 'running',
          finishing: true,
          startedAt: '2026-10-02T01:00:00Z',
          lastTurn: window.snapshot.runtime.lastTurn,
          permissions: [],
          queued: [],
        },
      ],
    }),
  );
  await page
    .getByRole('region', { name: '任务活动', exact: true })
    .getByText('正在整理结果', { exact: true })
    .waitFor();
  assert.equal(await page.locator('.task-outcome').count(), 0);
});

async function fixture(t, { language = 'zh-CN', authStatus = 'required', savedModel = '' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1120, height: 820 } });
  t.after(() => page.close());
  page.setDefaultTimeout(5000);
  await page.route('http://localhost/', (route) =>
    route.fulfill({ body: '<div id="root"></div>', contentType: 'text/html' }),
  );
  await page.goto('http://localhost/');
  await page.addStyleTag({
    content: fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8'),
  });
  await page.addStyleTag({ content: componentCss });
  await page.evaluate(
    ({ language, authStatus, savedModel }) => {
      window.calls = [];
      window.settings = {
        language,
        grokPath: 'C:/grok.exe',
        theme: 'dark',
        modelId: savedModel,
        effort: '',
        permissionMode: 'ask',
        recentProjects: ['C:/project'],
        lastProject: '',
        ui: { sidebar: true, inspector: false, inspectorTab: 'files' },
      };
      window.models = {
        currentModelId: 'grok-4.7',
        availableModels: [
          {
            modelId: 'grok-4.7',
            name: 'Grok 4.7',
            _meta: {
              contextWindows: [256000, 500000],
              totalContextTokens: 256000,
              reasoningEfforts: [
                { id: 'low', label: 'Low' },
                { id: 'medium', label: 'Medium', default: true },
                { id: 'high', label: 'High' },
              ],
            },
          },
          { modelId: 'grok-fast', name: 'Grok Fast' },
        ],
      };
      window.snapshot = {
        sessionId: 'existing',
        cwd: 'C:/project',
        permissionMode: 'ask',
        models: window.models,
        commands: [],
        updates: [],
        contextWindow: 256000,
        runtime: { status: 'idle', connection: 'ready', permissions: [], queued: [] },
      };
      window.engineStatus = {
        path: 'C:/grok.exe',
        version: '1.0.46',
        authStatus,
        models: window.models,
      };
      window.bootstrap = () => ({
        settings: window.settings,
        version: '1.4.2',
        update: { mode: 'installer', status: 'idle', currentVersion: '1.4.2' },
        cli: { path: 'C:/grok.exe', version: '1.0.46', connected: true, authStatus: 'unknown' },
        models: window.models,
        commands: [],
      });
      window.desktop = {
        pathsForFiles: () => [],
        onEvent(callback) {
          window.emit = callback;
          return () => {};
        },
        async request(command, payload) {
          window.calls.push({ command, payload });
          let data;
          if (command === 'bootstrap' || command === 'cli.refresh') {
            data = window.bootstrap();
            if (command === 'cli.refresh' && window.catalogModels) {
              data.models = window.catalogModels;
              queueMicrotask(() => {
                window.emit({ type: 'connection', state: 'disconnected' });
                window.emit({ type: 'models', models: window.catalogModels });
                window.emit({ type: 'connection', state: 'ready' });
              });
            }
          } else if (command === 'cli.status')
            data = {
              ...window.engineStatus,
              ...(payload?.checkUpdate ? { latestVersion: '1.0.47', updateAvailable: true } : {}),
            };
          else if (command === 'cli.login') {
            window.engineStatus.authStatus = 'authenticated';
            data = { cancelled: false, status: window.engineStatus };
          } else if (command === 'tasks.list') data = [];
          else if (command === 'checkpoints.detail') data = window.checkpoint;
          else if (command === 'dialog.project') data = 'C:/project';
          else if (command === 'project.open')
            data = {
              cwd: 'C:/project',
              sessions: [
                { sessionId: 'existing', cwd: 'C:/project', title: 'My existing session' },
              ],
            };
          else if (command === 'sessions.list')
            data = [{ sessionId: 'existing', cwd: 'C:/project', title: 'My existing session' }];
          else if (command === 'workspace.list') data = window.workspaceEntries || [];
          else if (command === 'workspace.changes')
            data = { isGit: true, branch: 'main', changes: window.workspaceChanges || [] };
          else if (command === 'workspace.diff')
            data = {
              text: '--- a/notes.txt\n+++ b/notes.txt\n@@ -1 +1 @@\n-old text\n+new text\n',
            };
          else if (command === 'workspace.read')
            data = {
              path: payload.path,
              text: 'Original file\n',
              truncated: false,
              mtimeMs: 1,
              eol: 'lf',
            };
          else if (command === 'session.load' || command === 'session.new') data = window.snapshot;
          else if (command === 'session.send' && window.sendError)
            return { ok: false, error: window.sendError };
          else if (command === 'session.configure') {
            if (payload.contextWindow !== undefined)
              window.snapshot.contextWindow = payload.contextWindow;
            if (payload.modelId) window.models.currentModelId = payload.modelId;
            data = { models: window.models, contextWindow: window.snapshot.contextWindow };
          } else if (command === 'settings.save')
            data = window.settings = {
              ...window.settings,
              ...payload,
              ui: { ...window.settings.ui, ...payload.ui },
            };
          else if (command === 'system.run') {
            if (window.simulateUpdate) {
              window.engineStatus.version = '1.0.47';
              window.emit({ type: 'connection', sessionId: 'existing', state: 'disconnected' });
              window.emit({ type: 'notification', kind: 'settings-reloaded', payload: {} });
              // The idle restoration can finish before the management IPC response.
              await new Promise((resolve) => setTimeout(resolve, 30));
            }
            data = { exitCode: 0, text: 'Updated' };
          } else if (command === 'system.open') data = true;
          else return { ok: false, error: `Unexpected command ${command}` };
          return { ok: true, data };
        },
      };
    },
    { language, authStatus, savedModel },
  );
  await page.addScriptTag({ content: bundle });
  await page
    .locator('.sidebar-status')
    .filter({ hasText: language === 'en' ? 'Grok connected' : 'Grok 已连接' })
    .waitFor();
  return page;
}

test('home distinguishes engine authentication from a connected transport and exposes login/check actions', async (t) => {
  const page = await fixture(t);
  await page.locator('.home-engine-status').getByText('需要登录', { exact: true }).waitFor();
  assert.match(
    await page.locator('.home-update-status').textContent(),
    /Grok Build Desktop.*1\.4\.2/,
  );
  assert.match(await page.locator('.home-engine-status').textContent(), /Grok Build.*1\.0\.46/);
  await page.getByRole('button', { name: 'Grok Build 引擎详情', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Grok Build 引擎', exact: true });
  await dialog.getByRole('button', { name: '登录 Grok Build', exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() => window.calls.filter((call) => call.command === 'cli.login').length),
    1,
  );
  await dialog.getByRole('button', { name: '检查引擎更新', exact: true }).click();
  await dialog.getByText('可更新至 1.0.47', { exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.calls.find((call) => call.command === 'cli.status' && call.payload?.checkUpdate)
          .payload,
    ),
    { checkUpdate: true },
  );
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
  assert.equal(
    await page
      .getByRole('button', { name: 'Grok Build 引擎详情', exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
});

test('catalog refresh preserves the selected session and running background task while install waits for global idle', async (t) => {
  const page = await fixture(t, { authStatus: 'authenticated' });
  await page.getByRole('button', { name: '打开项目文件夹', exact: true }).click();
  await page.getByRole('button', { name: 'My existing session', exact: true }).click();
  await page
    .getByRole('textbox', { name: '发送给 Grok 的消息', exact: true })
    .fill('Keep this draft');
  await page.evaluate(() =>
    window.emit({
      type: 'tasks-changed',
      tasks: [
        {
          sessionId: 'background',
          cwd: 'C:/other',
          title: 'Background',
          status: 'running',
          turnId: 'bg-turn',
          connection: 'ready',
          permissions: [],
          queued: [],
        },
      ],
    }),
  );
  await page.evaluate(() => {
    window.catalogModels = {
      currentModelId: 'grok-4.8',
      availableModels: [{ modelId: 'grok-4.8', name: 'Grok 4.8' }],
    };
  });
  await page.getByRole('button', { name: 'Grok Build 引擎详情', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Grok Build 引擎', exact: true });
  assert.equal(
    await dialog.getByRole('button', { name: '更新 Grok Build', exact: true }).isDisabled(),
    true,
  );
  await dialog.getByRole('button', { name: '刷新引擎与模型', exact: true }).click();
  await page.waitForFunction(() => window.calls.some((call) => call.command === 'cli.refresh'));
  await page.keyboard.press('Escape');
  assert.equal(
    await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).inputValue(),
    'Keep this draft',
  );
  assert.equal(
    await page.getByRole('combobox', { name: '选择模型', exact: true }).inputValue(),
    'grok-4.7',
  );
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.command === 'session.load').length,
    ),
    1,
  );
  assert.equal(
    await page.evaluate(() => window.calls.some((call) => call.command === 'session.new')),
    false,
  );
  assert.equal(
    await page.locator('.breadcrumb').getByText('My existing session', { exact: true }).count(),
    1,
  );
});

test('advertised effort defaults and context selection use authoritative configure and model-change state', async (t) => {
  const page = await fixture(t);
  await page.getByRole('button', { name: '打开项目文件夹', exact: true }).click();
  await page.getByRole('button', { name: 'My existing session', exact: true }).click();
  const context = page.getByRole('combobox', { name: '上下文窗口', exact: true });
  await page.getByRole('button', { name: '推理深度', exact: true }).click();
  assert.equal(
    await page
      .getByRole('slider', { name: '推理深度', exact: true })
      .getAttribute('aria-valuetext'),
    '标准',
  );
  await page.keyboard.press('Escape');
  assert.equal(await context.inputValue(), '256000');
  await context.selectOption('500000');
  await page.waitForFunction(() =>
    window.calls.some((call) => call.command === 'session.configure'),
  );
  assert.deepEqual(
    await page.evaluate(
      () => window.calls.find((call) => call.command === 'session.configure').payload,
    ),
    { sessionId: 'existing', contextWindow: 500000 },
  );
  assert.equal(await context.inputValue(), '500000');
  await page.evaluate(() =>
    window.emit({
      type: 'notification',
      kind: 'model_changed',
      sessionId: 'existing',
      payload: { context_window_selection: 256000 },
    }),
  );
  await page.waitForFunction(
    () => document.querySelector('select[aria-label="上下文窗口"]').value === '256000',
  );
  await page.getByRole('combobox', { name: '选择模型', exact: true }).selectOption('grok-fast');
  await context.waitFor({ state: 'hidden' });
});

test('home engine actions and context labels are available in English', async (t) => {
  const page = await fixture(t, { language: 'en', authStatus: 'authenticated' });
  await page.locator('.home-engine-status').getByText('Signed in', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Grok Build engine details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Grok Build engine', exact: true });
  await dialog.getByText('Executable', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Refresh engine and models', exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Check engine update', exact: true }).waitFor();
  await fs.promises.mkdir(path.join(__dirname, '../test-results'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, '../test-results/home-engine-en.png') });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show project context', exact: true }).click();
  const engineBounds = await page
    .getByRole('button', { name: 'Grok Build engine details', exact: true })
    .boundingBox();
  const footerBounds = await page.locator('.desktop-status-bar').boundingBox();
  assert.ok(
    engineBounds.x >= footerBounds.x &&
      engineBounds.x + engineBounds.width <= footerBounds.x + footerBounds.width &&
      engineBounds.y >= footerBounds.y &&
      engineBounds.y + engineBounds.height <= footerBounds.y + footerBounds.height &&
      footerBounds.x + footerBounds.width <= 1121 &&
      footerBounds.y + footerBounds.height <= 821,
    'Engine access must remain inside the full-width status bar and viewport with both panels open',
  );
  await page
    .getByRole('button', { name: 'Grok Build engine details', exact: true })
    .click({ trial: true });
  await page.screenshot({ path: path.join(__dirname, '../test-results/home-engine-panels.png') });
});

test('obsolete saved model defaults display the advertised catalog default without changing saved preferences', async (t) => {
  const page = await fixture(t, { savedModel: 'grok-code-fast-1' });
  assert.equal(
    await page.getByRole('combobox', { name: '选择模型', exact: true }).inputValue(),
    'grok-4.7',
  );
  await page.getByRole('button', { name: '推理深度', exact: true }).click();
  assert.equal(
    await page
      .getByRole('slider', { name: '推理深度', exact: true })
      .getAttribute('aria-valuetext'),
    '标准',
  );
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.settings.modelId), 'grok-code-fast-1');
});

test('a prompt authentication failure updates readiness and recovery signs in without resending the draft', async (t) => {
  const page = await fixture(t, { authStatus: 'authenticated' });
  await page.locator('.home-engine-status').getByText('已登录', { exact: true }).waitFor();
  await page.evaluate(() => {
    window.snapshot.updates = [
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Earlier reply' } },
    ];
  });
  await page.getByRole('button', { name: '打开项目文件夹', exact: true }).click();
  await page.getByRole('button', { name: 'My existing session', exact: true }).click();
  await page.evaluate(() => {
    window.sendError = '401 Unauthorized';
  });
  await page
    .getByRole('textbox', { name: '发送给 Grok 的消息', exact: true })
    .fill('Keep request after login');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.home-engine-status').getByText('需要登录', { exact: true }).waitFor();
  await page.getByRole('button', { name: '打开 Grok 登录', exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() => window.calls.filter((call) => call.command === 'cli.login').length),
    1,
  );
  assert.equal(
    await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).inputValue(),
    'Keep request after login',
  );
  await page.locator('.home-engine-status').getByText('已登录', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.command === 'session.send').length,
    ),
    1,
  );
});

test('idle engine update refreshes the version and coalesces restart restoration without changing the draft or context', async (t) => {
  const page = await fixture(t, { authStatus: 'authenticated' });
  await page.getByRole('button', { name: '打开项目文件夹', exact: true }).click();
  await page.getByRole('button', { name: 'My existing session', exact: true }).click();
  await page
    .getByRole('textbox', { name: '发送给 Grok 的消息', exact: true })
    .fill('Continue after updating');
  await page.evaluate(() => {
    window.simulateUpdate = true;
  });
  await page.getByRole('button', { name: 'Grok Build 引擎详情', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Grok Build 引擎', exact: true });
  await dialog.getByRole('button', { name: '更新 Grok Build', exact: true }).click();
  await dialog.getByText('1.0.47', { exact: true }).waitFor();
  assert.deepEqual(
    await page.evaluate(() => window.calls.find((call) => call.command === 'system.run').payload),
    { action: 'update-install', cwd: 'C:/project', values: {} },
  );
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((call) => call.command === 'session.load').length,
    ),
    2,
  );
  await page.keyboard.press('Escape');
  assert.equal(
    await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).inputValue(),
    'Continue after updating',
  );
  assert.equal(
    await page.getByRole('combobox', { name: '上下文窗口', exact: true }).inputValue(),
    '256000',
  );
});

test('a paused task with no queued messages or permissions permits engine update', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() =>
    window.emit({
      type: 'tasks-changed',
      tasks: [
        {
          sessionId: 'paused',
          cwd: 'C:/project',
          title: 'Paused task',
          status: 'paused',
          connection: 'ready',
          queued: [],
          permissions: [],
        },
      ],
    }),
  );
  await page.getByRole('button', { name: 'Grok Build 引擎详情', exact: true }).click();
  const update = page
    .getByRole('dialog', { name: 'Grok Build 引擎', exact: true })
    .getByRole('button', { name: '更新 Grok Build', exact: true });
  assert.equal(await update.isEnabled(), true);
});
