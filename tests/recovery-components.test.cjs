const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser, bundle;
before(async () => {
  bundle = buildSync({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import TaskCenter from './src/TaskCenter';const root=createRoot(document.getElementById('root'));window.showTasks=()=>root.render(<TaskCenter embedded tasks={[{sessionId:'s1',cwd:'C:/project',title:'interrupted task',status:'interrupted',permissions:[],queued:[{id:'q1',text:'partially completed request',createdAt:'',interrupted:true}]}]} onInspectChanges={task=>window.inspected=task.cwd} onOpen={()=>{}} onClose={()=>{}} notify={()=>{}}/>);`,
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

test('interrupted requests explain full replay and allow inspecting changes before manual resume', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  page.setDefaultTimeout(3000);
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.calls = [];
    window.desktop = {
      request: async (command, payload) => {
        window.calls.push({ command, payload });
        return { ok: true, data: {} };
      },
    };
  });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.showTasks());
  await page.getByText('上次中断：继续队列会重新发送整条请求，可能重复已执行的操作。').waitFor();
  assert.deepEqual(await page.evaluate(() => window.calls), []);
  await page.getByRole('button', { name: '先查看已做的更改' }).click();
  assert.equal(await page.evaluate(() => window.inspected), 'C:/project');
  assert.deepEqual(await page.evaluate(() => window.calls), []);
  await page.getByRole('button', { name: '继续队列' }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), [
    { command: 'tasks.resume', payload: { sessionId: 's1', queueId: undefined } },
  ]);
});
