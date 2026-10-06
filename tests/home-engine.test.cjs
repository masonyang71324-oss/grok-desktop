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
        (call) => call.command === 'settings.save' && call.payload.ui?.inspectorWidth,
      ),
    ),
    false,
  );
  await page.mouse.up();
  await page.waitForFunction(() =>
    window.calls.some(
      (call) => call.command === 'settings.save' && call.payload.ui?.inspectorWidth,
    ),
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
          else if (command === 'tasks.list') data = [];
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
  assert.match(await page.locator('.home-update-status').textContent(), /Grok Desktop.*1\.4\.2/);
  assert.match(await page.locator('.home-engine-status').textContent(), /Grok Build.*1\.0\.46/);
  await page.getByRole('button', { name: 'Grok Build 引擎详情', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Grok Build 引擎', exact: true });
  await dialog.getByRole('button', { name: '登录 Grok Build', exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() => window.calls.find((call) => call.command === 'system.open').payload),
    { target: 'grok-login', cwd: '' },
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
  const workspaceBounds = await page.locator('.workspace').boundingBox();
  assert.ok(
    engineBounds.x >= workspaceBounds.x &&
      engineBounds.x + engineBounds.width <= workspaceBounds.x + workspaceBounds.width,
    'Engine access must remain inside the workspace when both panels are open',
  );
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

test('a prompt authentication failure updates readiness and its recovery starts native login without losing the draft', async (t) => {
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
    await page.evaluate(() => window.calls.find((call) => call.command === 'system.open').payload),
    { target: 'grok-login', cwd: 'C:/project' },
  );
  assert.equal(
    await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).inputValue(),
    'Keep request after login',
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
