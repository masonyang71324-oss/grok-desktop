const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser, bundle;
before(async () => {
  bundle = buildSync({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import ProjectTools from './src/ProjectTools';import TaskOutcome from './src/TaskOutcome';const root=createRoot(document.getElementById('root'));window.showTools=()=>root.render(<ProjectTools cwd="C:/project" sessionId="s1" editorOpen={false} onRestored={()=>{}} onClose={()=>{}} notify={message=>window.notices.push(message)}/>);window.showOutcome=(result,checkpoint)=>root.render(<TaskOutcome result={result} checkpoint={checkpoint} rows={[]} onReview={()=>{}} onRestore={()=>{}} onOpenFile={()=>{}}/>);`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    outfile: 'checkpoint-review.js',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  }).outputFiles.find((file) => file.path.endsWith('.js')).text;
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
    window.records = [
      {
        id: 'c1',
        cwd: 'C:/project',
        sessionId: 's1',
        createdAt: '2026-10-04T00:00:00Z',
        status: 'ready',
        fileCount: 0,
        bytes: 1024,
        kind: 'turn',
      },
      {
        id: 'undo',
        cwd: 'D:/other',
        sessionId: 's2',
        createdAt: '2026-10-03T00:00:00Z',
        status: 'ready',
        fileCount: 2,
        bytes: 2048,
        kind: 'restore',
      },
      {
        id: 'active',
        cwd: 'D:/working',
        sessionId: 's3',
        createdAt: '2026-10-04T00:00:00Z',
        status: 'recording',
        fileCount: 0,
        bytes: 512,
        kind: 'turn',
      },
      {
        id: 'bad',
        cwd: '',
        sessionId: '',
        createdAt: '2026-10-04T00:00:00Z',
        status: 'unreadable',
        fileCount: null,
        bytes: 10,
        kind: 'unreadable',
      },
    ];
    window.desktop = {
      onEvent: () => () => {},
      request: async (command, payload) => {
        window.calls.push({ command, payload });
        let data = {};
        if (command === 'runner.inspect')
          data = { scripts: [], state: { status: 'stopped', log: '' } };
        if (command === 'checkpoints.list') data = [];
        if (command === 'checkpoints.storage')
          data = {
            records: window.records,
            bytes: window.records.reduce((sum, record) => sum + record.bytes, 0),
            limitBytes: 536870912,
          };
        if (command === 'checkpoints.removeMany') {
          window.records = window.records.filter((record) => !payload.ids.includes(record.id));
          data = { removed: payload.ids };
        }
        return { ok: true, data };
      },
    };
  });
  await page.addScriptTag({ content: bundle });
  return page;
}

test('storage management lists every project and requires explicit selection and confirmation before deletion', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.showTools());
  await page.getByRole('button', { name: '检查点存储管理', exact: true }).click();
  await page.getByText('D:/other', { exact: true }).waitFor();
  assert.equal(await page.getByText('恢复撤销记录').count(), 1);
  assert.equal(await page.getByText('记录不可读').count(), 1);
  assert.equal(await page.getByRole('checkbox').count(), 4);
  assert.equal(await page.getByRole('checkbox').nth(2).isDisabled(), true);
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('checkbox').nth(3).check();
  await page.getByRole('button', { name: '删除所选记录', exact: true }).click();
  assert.equal(
    await page.evaluate(() =>
      window.calls.some((call) => call.command === 'checkpoints.removeMany'),
    ),
    false,
  );
  const confirm = page.getByRole('dialog', { name: '删除所选检查点记录？' });
  await confirm.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('checkbox').nth(1).waitFor();
  assert.deepEqual(
    await page.evaluate(() =>
      window.calls
        .filter((call) => call.command === 'checkpoints.removeMany')
        .map((call) => call.payload),
    ),
    [{ ids: ['undo', 'bad'] }],
  );
  assert.equal(await page.getByRole('checkbox').count(), 2);
});

test('skipped and partial checkpoints visibly disclose missing restore coverage even with zero recorded changes', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() =>
    window.showOutcome({ turnId: 't', status: 'completed', checkpointSkipped: true }),
  );
  await page.getByText('本轮未创建检查点，无法恢复本轮文件。', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: '恢复本轮文件', exact: true }).isDisabled(),
    true,
  );
  await page.evaluate(() =>
    window.showOutcome(
      { turnId: 't', status: 'completed', checkpointId: 'partial' },
      {
        id: 'partial',
        turnId: 't',
        status: 'ready',
        files: [],
        skipped: [{ path: '.', reason: 'limit' }],
      },
    ),
  );
  await page.getByText('检查点不完整，无法完整恢复本轮文件。', { exact: true }).waitFor();
  assert.equal(
    await page
      .getByText('未记录到可恢复变更，不代表本轮没有文件变化。', { exact: true })
      .isVisible(),
    true,
  );
});
