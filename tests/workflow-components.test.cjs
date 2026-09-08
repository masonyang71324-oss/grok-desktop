const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser, bundle;
before(async () => {
  bundle = buildSync({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import ProjectTools from './src/ProjectTools';import TaskCenter from './src/TaskCenter';const root=createRoot(document.getElementById('root'));window.showTools=(editorOpen=false)=>root.render(<ProjectTools cwd="C:/project" sessionId="s1" editorOpen={editorOpen} onRestored={()=>window.restored=true} onClose={()=>{}} notify={message=>window.notices.push(message)}/>);window.showTasks=()=>root.render(<TaskCenter tasks={[{sessionId:'s1',cwd:'C:/project',title:'task',status:'paused',permissions:[],queued:[{id:'q1',text:'queued request',createdAt:''}]}]} onOpen={()=>{}} onClose={()=>{}} notify={message=>window.notices.push(message)}/>);`,
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
  assert.equal(await page.evaluate(() => window.calls.length), 0);
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '继续队列' }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), [
    { command: 'tasks.remove', payload: { sessionId: 's1', queueId: 'q1' } },
    { command: 'tasks.resume', payload: { sessionId: 's1', queueId: undefined } },
  ]);
});
