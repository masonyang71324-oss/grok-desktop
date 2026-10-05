const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser, script, css;
before(async () => {
  const outputs = buildSync({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import SessionList from './src/SessionList';import TaskCenter from './src/TaskCenter';import {setLocale} from './src/i18n';const root=createRoot(document.getElementById('root'));window.setLocale=setLocale;window.showSessions=props=>flushSync(()=>root.render(<SessionList {...props} draftSessionIds={new Set(props.drafts || [])} onSelect={session=>window.actions.push({select:session.sessionId})} onRename={session=>window.actions.push({rename:session.sessionId})} onExport={session=>window.actions.push({export:session.sessionId})} onDelete={session=>window.actions.push({delete:session.sessionId})}/>));window.showTasks=tasks=>flushSync(()=>root.render(<TaskCenter tasks={tasks} embedded onOpen={task=>window.actions.push({open:task.sessionId})} onInspectChanges={task=>window.actions.push({inspect:task.sessionId})} onClose={()=>{}} notify={text=>window.actions.push({notice:text})}/>));`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    outfile: 'task-status-ui-test.js',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  }).outputFiles;
  script = outputs.find((output) => output.path.endsWith('.js')).text;
  css =
    ['styles.css', 'workflows.css', 'navigation-panels.css']
      .map((name) => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'))
      .join('\n') + (outputs.find((output) => output.path.endsWith('.css'))?.text || '');
  browser = await launchBrowser();
});
after(async () => browser?.close());
async function fixture(t) {
  const page = await browser.newPage({ viewport: { width: 900, height: 650 } });
  t.after(() => page.close());
  page.setDefaultTimeout(5000);
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: css + '\n#root{display:flex;width:260px;height:500px}' });
  await page.evaluate(() => {
    window.actions = [];
    window.desktop = {
      request: async (command, payload) => {
        window.actions.push({ command, payload });
        return { ok: true, data: {} };
      },
    };
  });
  await page.addScriptTag({ content: script });
  return page;
}
const task = (sessionId, extra = {}) => ({
  sessionId,
  cwd: 'C:/project',
  title: sessionId,
  status: 'idle',
  permissions: [],
  queued: [],
  ...extra,
});

test('session statuses belong to their session and queue plus draft survives selection until cleared', async (t) => {
  const page = await fixture(t);
  const tasks = [
    task('approval', {
      status: 'running',
      permissions: [{ requestId: 1 }],
      queued: [{ id: 'q1' }, { id: 'q2' }],
    }),
    task('running', { status: 'running' }),
    task('idle'),
  ];
  const props = { sessions: tasks, tasks, activeSessionId: 'idle', drafts: ['approval'] };
  await page.evaluate((props) => window.showSessions(props), props);
  const approval = page.locator('[data-window-row="approval"]');
  await approval.getByText('等待审批', { exact: true }).waitFor();
  assert.equal(await approval.getByText('排队 2', { exact: true }).count(), 1);
  assert.equal(await approval.getByText('草稿', { exact: true }).count(), 1);
  assert.equal(
    await page.locator('[data-window-row="running"]').getByText('进行中', { exact: true }).count(),
    1,
  );
  assert.equal(await page.locator('[data-window-row="idle"] .session-status-chip').count(), 0);
  await approval.locator('.session-select').click();
  assert.deepEqual(await page.evaluate(() => window.actions), [{ select: 'approval' }]);
  await page.evaluate(
    (props) => window.showSessions({ ...props, activeSessionId: 'approval' }),
    props,
  );
  assert.equal(await approval.getByText('草稿', { exact: true }).count(), 1);
  await page.evaluate(
    (props) => window.showSessions({ ...props, drafts: [], tasks: [props.tasks[1]] }),
    props,
  );
  assert.equal(await approval.locator('.session-status-chip').count(), 0);
  assert.equal(
    await page.locator('[data-window-row="running"]').getByText('进行中', { exact: true }).count(),
    1,
  );
});

test('task center filters quiet history, puts approvals first, and keeps session-scoped actions', async (t) => {
  const page = await fixture(t);
  await page.evaluate(
    (tasks) => window.showTasks(tasks),
    [
      task('idle'),
      task('running', { status: 'running' }),
      task('completed', { lastTurn: { turnId: 'past', status: 'completed' } }),
      task('stopped', { status: 'paused', lastTurn: { turnId: 'past', status: 'cancelled' } }),
      task('paused', {
        status: 'paused',
        queued: [{ id: 'q1', text: 'queued message', createdAt: '', interrupted: true }],
      }),
      task('approval', { status: 'waiting', permissions: [{ requestId: 1 }] }),
    ],
  );
  await page.getByRole('button', { name: 'approval', exact: true }).waitFor();
  assert.deepEqual(await page.locator('.workflow-card > .text-button').allTextContents(), [
    'approval',
    'paused',
    'running',
  ]);
  assert.equal(await page.getByRole('heading', { name: /^需要处理/ }).count(), 1);
  await page.getByRole('button', { name: 'approval', exact: true }).click();
  const running = page
    .locator('.workflow-card')
    .filter({ has: page.getByRole('button', { name: 'running', exact: true }) });
  await running.getByRole('button', { name: '停止任务', exact: true }).click();
  await page.getByRole('button', { name: '先查看已做的更改', exact: true }).click();
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '继续队列', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.actions), [
    { open: 'approval' },
    { command: 'session.cancel', payload: { sessionId: 'running', queueId: undefined } },
    { inspect: 'paused' },
    { command: 'tasks.remove', payload: { sessionId: 'paused', queueId: 'q1' } },
    { command: 'tasks.resume', payload: { sessionId: 'paused', queueId: undefined } },
  ]);
  await page.getByRole('button', { name: '显示全部', exact: true }).click();
  assert.equal(await page.getByText('空闲', { exact: true }).count(), 1);
  assert.equal(await page.getByText('已完成', { exact: true }).count(), 1);
  assert.equal(await page.getByText('已停止', { exact: true }).count(), 1);
  assert.equal(await page.getByText('待开始', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '活跃与待处理', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'idle', exact: true }).count(), 0);
});

test('status chips keep virtual session navigation, search, menus and compact row heights', async (t) => {
  const page = await fixture(t);
  await page.evaluate(
    (tasks) =>
      window.showSessions({ sessions: tasks, tasks, drafts: ['s0'], activeSessionId: 's0' }),
    Array.from({ length: 300 }, (_, i) => task(`s${i}`, { status: 'running' })),
  );
  const first = page.locator('[data-window-row="s0"]');
  await first.getByText('草稿', { exact: true }).waitFor();
  assert.ok((await page.locator('[data-window-row]').count()) < 70);
  const dimensions = await first.locator('.session-item').evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    overflow: element.scrollWidth > element.clientWidth,
  }));
  assert.ok(dimensions.height <= 42, `Session row grew to ${dimensions.height}px`);
  assert.equal(dimensions.overflow, false);
  await first.locator('.session-select').focus();
  await page.keyboard.press('End');
  await page.waitForFunction(
    () => document.activeElement?.closest('[data-window-row]')?.dataset.windowRow === 's299',
  );
  await page.getByRole('textbox', { name: '搜索会话', exact: true }).fill('s299');
  await page.locator('[data-window-row="s299"] .session-select').hover();
  await page.getByRole('button', { name: 's299 · 更多操作', exact: true }).click();
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.actions), [{ rename: 's299' }]);
});

test('English chips and task filters retain counts and actions in the smallest sidebar', async (t) => {
  const page = await fixture(t);
  await page.addStyleTag({ content: '#root{width:198px}' });
  const tasks = [
    task('approval', {
      status: 'waiting',
      permissions: [{ requestId: 1 }],
      queued: [{ id: 'q1' }, { id: 'q2' }],
    }),
  ];
  await page.evaluate((tasks) => {
    window.setLocale('en');
    window.showSessions({ sessions: tasks, tasks, drafts: ['approval'] });
  }, tasks);
  await page.getByText('Queued 2', { exact: true }).waitFor();
  await page.getByText('Draft', { exact: true }).waitFor();
  await page.locator('.session-select').hover();
  const layout = await page.locator('.session-item').evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    overflow: element.scrollWidth > element.clientWidth,
    clippedMetadata: [
      ...element.querySelectorAll('.session-status-chip.queued, .session-status-chip.draft'),
    ].some((chip) => chip.scrollWidth > chip.clientWidth),
  }));
  assert.equal(layout.overflow, false);
  assert.equal(layout.clippedMetadata, false);
  assert.ok(layout.height <= 42);
  await page.evaluate((tasks) => window.showTasks(tasks), tasks);
  await page.getByRole('button', { name: 'Show all', exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: 'Active and actionable', exact: true }).isVisible(),
    true,
  );
  assert.equal(
    await page
      .locator('.task-center-embedded')
      .evaluate((element) => element.scrollWidth > element.clientWidth),
    false,
  );
});
