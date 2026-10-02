const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser, bundle;
before(async () => {
  bundle = buildSync({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import ProjectTools from './src/ProjectTools';import TaskCenter from './src/TaskCenter';const root=createRoot(document.getElementById('root'));window.showTools=(editorOpen=false)=>root.render(<ProjectTools cwd="C:/project" sessionId="s1" editorOpen={editorOpen} onRestored={()=>window.restored=true} onClose={()=>{}} notify={message=>window.notices.push(message)}/>);window.showTasks=(extra={})=>root.render(<TaskCenter tasks={[{sessionId:'s1',cwd:'C:/project',title:'task',status:'paused',permissions:[],queued:[{id:'q1',text:'queued request',createdAt:''}]}]} onOpen={task=>window.openedTask=task.sessionId} onClose={()=>{}} notify={message=>window.notices.push(message)} {...extra}/>);`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  }).outputFiles[0].text;
  browser = await launchBrowser();
});
after(async () => browser?.close());
async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  page.setDefaultTimeout(5000);
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.calls = [];
    window.notices = [];
    const checkpoint = {
      id: 'c1',
      cwd: 'C:/project',
      sessionId: 's1',
      turnId: 'turn',
      createdAt: '2026-09-08T00:00:00Z',
      status: 'ready',
      files: [
        { path: 'first.ts', status: 'modified', before: 'old', after: 'new' },
        { path: 'second.ts', status: 'created', before: null, after: 'created' },
      ],
      skipped: [],
    };
    window.desktop = {
      onEvent: (callback) => {
        window.emit = callback;
        return () => {};
      },
      request: async (command, payload) => {
        window.calls.push({ command, payload });
        let data;
        if (command === 'runner.inspect')
          data = {
            scripts: [{ name: 'dev', command: 'node app.js' }],
            state: { status: 'stopped', log: '' },
          };
        else if (command === 'checkpoints.list') data = [checkpoint];
        else if (command === 'checkpoints.detail') data = checkpoint;
        else if (command === 'checkpoints.restore')
          data = { restored: payload.paths, backupId: 'undo' };
        else if (command === 'runner.start')
          data = { status: 'running', script: 'dev', log: 'ready', url: 'http://localhost:3000' };
        else if (command === 'runner.stop') data = { status: 'stopped', log: 'stopped' };
        else data = {};
        return { ok: true, data };
      },
    };
  });
  await page.addScriptTag({ content: bundle });
  return page;
}
test('checkpoint restore lists selected files and requires confirmation; open editor blocks it', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.showTools(true));
  await page.locator('.checkpoint-row').click();
  assert.equal(await page.getByRole('button', { name: '恢复所选文件' }).isDisabled(), true);
  await page.evaluate(() => window.showTools(false));
  await page.locator('summary input').nth(1).uncheck();
  await page.getByRole('button', { name: '恢复所选文件' }).click();
  const confirmation = page.getByRole('dialog', { name: '确认恢复这些文件？' });
  assert.equal(await confirmation.locator('li').count(), 1);
  assert.equal(await confirmation.locator('li').textContent(), 'first.ts');
  assert.equal(
    await page.evaluate(() => window.calls.some((call) => call.command === 'checkpoints.restore')),
    false,
  );
  await confirmation.getByRole('button', { name: '确认恢复', exact: true }).click();
  await page.waitForFunction(() => window.restored);
  assert.deepEqual(
    await page.evaluate(
      () => window.calls.find((call) => call.command === 'checkpoints.restore').payload,
    ),
    { id: 'c1', paths: ['first.ts'] },
  );
});
test('deleting checkpoint history is confirmed separately from file restore', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.showTools());
  await page.getByRole('button', { name: '删除记录', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除检查点记录？' });
  await confirmation
    .getByText('只删除这条恢复记录，项目文件保持不变。删除后无法使用此记录恢复文件。')
    .waitFor();
  assert.equal(
    await page.evaluate(() => window.calls.some((call) => call.command === 'checkpoints.remove')),
    false,
  );
  await confirmation.getByRole('button', { name: '删除记录', exact: true }).click();
  assert.deepEqual(
    await page.evaluate(
      () => window.calls.find((call) => call.command === 'checkpoints.remove').payload,
    ),
    { id: 'c1' },
  );
  assert.equal(
    await page.evaluate(() => window.calls.some((call) => call.command === 'checkpoints.restore')),
    false,
  );
});

test('project scripts use explicit start and restart, preview opens separate browser URL', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.showTools());
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await page.getByRole('button', { name: '打开预览' }).click();
  await page.getByRole('button', { name: '重新运行' }).click();
  const calls = await page.evaluate(() =>
    window.calls.filter((call) =>
      ['runner.start', 'runner.stop', 'system.open'].includes(call.command),
    ),
  );
  assert.deepEqual(
    calls.map((call) => call.command),
    ['runner.start', 'system.open', 'runner.stop', 'runner.start'],
  );
  assert.deepEqual(calls[0].payload, { cwd: 'C:/project', script: 'dev' });
  assert.deepEqual(calls[1].payload, { target: 'url', url: 'http://localhost:3000' });
});
test('open project tools refresh checkpoints when a background task finishes', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.showTools());
  await page.locator('.checkpoint-row').waitFor();
  await page.evaluate(() =>
    window.emit({ type: 'checkpoints-changed', cwd: 'C:/project', sessionId: 's1' }),
  );
  await page.waitForFunction(
    () => window.calls.filter((call) => call.command === 'checkpoints.list').length === 2,
  );
});

test('paused queues never resume when opened and removal is explicitly session-scoped', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.showTasks());
  await page.getByText('queued request').waitFor();
  assert.equal(await page.getByRole('dialog', { name: '任务中心' }).count(), 1);
  assert.equal(await page.evaluate(() => window.calls.length), 0);
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '继续队列' }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), [
    { command: 'tasks.remove', payload: { sessionId: 's1', queueId: 'q1' } },
    { command: 'tasks.resume', payload: { sessionId: 's1', queueId: undefined } },
  ]);
});

test('embedded task center preserves open, approval, stop, remove and resume controls without a modal', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() =>
    window.showTasks({
      embedded: true,
      tasks: [
        {
          sessionId: 'paused',
          cwd: 'C:/project',
          title: 'Paused task',
          status: 'paused',
          permissions: [],
          queued: [
            {
              id: 'q1',
              text: 'queued request',
              attachments: [{ name: 'context.txt' }],
              createdAt: '',
            },
          ],
        },
        {
          sessionId: 'waiting',
          cwd: 'C:/other',
          title: 'Approval task',
          status: 'waiting',
          permissions: [{ requestId: 1 }],
          queued: [],
        },
        {
          sessionId: 'background',
          cwd: 'C:/project',
          title: 'Background task',
          status: 'background',
          permissions: [],
          queued: [],
        },
      ],
    }),
  );
  await page.getByRole('button', { name: 'Paused task', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page.getByText('等待审批', { exact: true }).waitFor();
  await page.getByText('context.txt', { exact: true }).waitFor();
  await page
    .getByText('本轮后台操作尚未完成，同项目的新请求会继续等待。可打开会话管理后台操作。')
    .waitFor();
  assert.equal(await page.evaluate(() => window.calls.length), 0);
  await page.getByRole('button', { name: 'Approval task', exact: true }).click();
  assert.equal(await page.evaluate(() => window.openedTask), 'waiting');
  await page.getByRole('button', { name: '停止任务', exact: true }).click();
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '继续队列', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), [
    { command: 'session.cancel', payload: { sessionId: 'waiting', queueId: undefined } },
    { command: 'tasks.remove', payload: { sessionId: 'paused', queueId: 'q1' } },
    { command: 'tasks.resume', payload: { sessionId: 'paused', queueId: undefined } },
  ]);
});

test('embedded task center scrolls inside a narrow panel without horizontal overflow', async (t) => {
  const page = await fixture(t);
  await page.setViewportSize({ width: 900, height: 650 });
  for (const name of ['styles.css', 'workflows.css', 'navigation-panels.css'])
    await page.addStyleTag({ path: path.join(__dirname, '../src', name) });
  await page.addStyleTag({ content: '#root{display:flex;width:260px;height:440px}' });
  await page.evaluate(() =>
    window.showTasks({
      embedded: true,
      tasks: Array.from({ length: 8 }, (_, index) => ({
        sessionId: `task-${index}`,
        cwd: 'C:/project/long/nested/directory',
        title: `Task ${index}`,
        status: 'paused',
        permissions: [],
        queued: [
          { id: `q-${index}`, text: 'LongQueuedMessageWithoutSpaces'.repeat(4), createdAt: '' },
        ],
      })),
    }),
  );
  await page.locator('.task-center-embedded').waitFor();
  const layout = await page.locator('.task-center-embedded').evaluate((element) => {
    const list = element.querySelector('.workflow-list');
    return {
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      overflow: element.scrollWidth > element.clientWidth,
      scrolls: list.scrollHeight > list.clientHeight,
      listOverflow: list.scrollWidth > list.clientWidth,
    };
  });
  assert.deepEqual(layout, {
    width: 260,
    height: 440,
    overflow: false,
    scrolls: true,
    listOverflow: false,
  });
});
