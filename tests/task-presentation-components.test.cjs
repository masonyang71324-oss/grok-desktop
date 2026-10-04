const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser, script, css;
before(async () => {
  const outputs = buildSync({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import TaskActivity from './src/TaskActivity';import TaskOutcome from './src/TaskOutcome';const root=createRoot(document.getElementById('root'));window.showActivity=props=>root.render(<TaskActivity {...props}/>);window.showOutcome=props=>root.render(<TaskOutcome {...props} onReview={()=>window.actions.push('review')} onRestore={()=>window.actions.push('restore')} onOpenFile={path=>window.actions.push({open:path})}/>);`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    outfile: 'task-ui-test.js',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  }).outputFiles;
  script = outputs.find((output) => output.path.endsWith('.js')).text;
  css = outputs.find((output) => output.path.endsWith('.css'))?.text || '';
  browser = await launchBrowser();
});
after(async () => browser?.close());
async function fixture(t) {
  const page = await browser.newPage({ viewport: { width: 390, height: 720 } });
  t.after(() => page.close());
  page.setDefaultTimeout(5000);
  await page.setContent(
    `<style>:root{--border:#d5dedb;--surface:#fff;--surface-hover:#eee;--accent:#167b60;--text:#202b31;--muted:#62717b;--danger:#b54741}*{box-sizing:border-box}body{margin:0;font:14px sans-serif}button{font:inherit}#root{padding:12px}${css}</style><div id="root"></div>`,
  );
  await page.evaluate(() => {
    window.actions = [];
  });
  await page.addScriptTag({ content: script });
  return page;
}
const checkpoint = {
  id: 'c1',
  cwd: 'C:/项目',
  sessionId: 's1',
  turnId: 'turn',
  status: 'ready',
  createdAt: '',
  files: [
    { path: 'folder/output.ts', status: 'created', before: null, after: 'new' },
    { path: 'folder/deleted.ts', status: 'deleted', before: 'old', after: null },
  ],
  skipped: [{ path: 'result.docx', reason: 'binary' }],
};
const result = { turnId: 'turn', status: 'completed', checkpointId: 'c1' };

test('activity clock advances from the actual start and hides unknown elapsed time', async (t) => {
  const page = await fixture(t);
  await page.clock.install({ time: new Date('2026-10-02T00:00:10Z') });
  await page.evaluate(() =>
    window.showActivity({
      rows: [],
      turnId: 'turn',
      startedAt: '2026-10-02T00:00:00Z',
      waitingApproval: true,
    }),
  );
  await page.getByText('等待审批', { exact: true }).waitFor();
  assert.equal(await page.locator('.task-activity-timer').textContent(), '已运行 0:10');
  await page.clock.fastForward(1000);
  assert.equal(await page.locator('.task-activity-timer').textContent(), '已运行 0:11');
  await page.evaluate(() => window.showActivity({ rows: [], turnId: 'other', cancelling: true }));
  await page.getByText('正在停止', { exact: true }).waitFor();
  assert.equal(await page.locator('.task-activity-timer').count(), 0);
});

test('outcome file actions preserve original paths and restoration is only a callback', async (t) => {
  const page = await fixture(t);
  await page.evaluate(
    ({ result, checkpoint }) => window.showOutcome({ result, checkpoint, rows: [] }),
    { result, checkpoint },
  );
  await page.getByRole('heading', { name: '任务已完成' }).waitFor();
  await page.getByText('变更与验证明细', { exact: true }).click();
  await page.getByRole('button', { name: 'folder/output.ts', exact: true }).click();
  assert.equal(
    await page.getByRole('button', { name: 'folder/deleted.ts', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: '查看变更', exact: true }).click();
  await page.getByRole('button', { name: '恢复本轮文件', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.actions), [
    { open: 'folder/output.ts' },
    'review',
    'restore',
  ]);
  assert.equal(await page.getByText('另有 1 项未纳入检查点。', { exact: true }).count(), 1);
  assert.equal(await page.getByText('C:/项目', { exact: true }).count(), 1);
});

test('missing or recording checkpoints keep review and restore disabled without fake file totals', async (t) => {
  const page = await fixture(t);
  await page.evaluate(
    ({ result, checkpoint }) =>
      window.showOutcome({
        result,
        rows: [],
        checkpoint: { ...checkpoint, status: 'recording', files: [] },
      }),
    { result, checkpoint },
  );
  await page.getByText('文件变更未确认', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: '查看变更', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole('button', { name: '恢复本轮文件', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.getByText('检查点内记录 0 个文件变更', { exact: true }).count(), 0);
});

test('incomplete results and unknown validation cannot render as success', async (t) => {
  const page = await fixture(t);
  await page.evaluate(
    ({ result, checkpoint }) =>
      window.showOutcome({
        result: { ...result, status: 'failed', error: 'connection lost' },
        checkpoint,
        rows: [
          {
            id: 'test',
            kind: 'tool',
            toolKind: 'execute',
            turnId: 'turn',
            status: 'completed',
            streaming: false,
            text: 'tests passed',
            input: '{"command":"npm test"}',
          },
        ],
      }),
    { result, checkpoint },
  );
  await page.getByRole('heading', { name: '任务未完成' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '任务已完成' }).count(), 0);
  assert.equal(await page.getByText('未确认结果', { exact: true }).count(), 1);
  assert.equal(await page.getByText('1 未确认', { exact: true }).isVisible(), true);
  assert.equal(await page.getByText('已通过', { exact: true }).count(), 0);
  assert.equal(await page.getByText('connection lost', { exact: true }).count(), 1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(overflow, false);
});

test('completed outcome starts compact with trusted counters and visible actions', async (t) => {
  const page = await fixture(t);
  await page.evaluate(
    ({ result, checkpoint }) =>
      window.showOutcome({
        result,
        checkpoint: {
          ...checkpoint,
          skipped: [],
          files: Array.from({ length: 6 }, (_, index) => ({
            path: `long/folder/generated-output-${index}.tsx`,
            status: 'created',
          })),
        },
        rows: Array.from({ length: 4 }, (_, index) => ({
          id: `check-${index}`,
          kind: 'tool',
          toolKind: 'execute',
          turnId: 'turn',
          status: 'completed',
          streaming: false,
          text: '',
          input: '{"command":"npm test"}',
          rawOutput: index < 3 ? { exitCode: 0 } : undefined,
        })),
      }),
    { result, checkpoint },
  );
  await page.getByRole('heading', { name: '任务已完成' }).waitFor();
  assert.equal(await page.locator('.task-outcome details').getAttribute('open'), null);
  assert.equal(await page.getByRole('button', { name: '查看变更', exact: true }).isVisible(), true);
  assert.equal(
    await page.getByRole('button', { name: '恢复本轮文件', exact: true }).isVisible(),
    true,
  );
  assert.equal(await page.getByText('3 通过', { exact: true }).isVisible(), true);
  assert.equal(await page.getByText('1 未确认', { exact: true }).isVisible(), true);
  const height = await page
    .locator('.task-outcome')
    .evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(height <= 150, `Collapsed outcome height was ${height}px`);
  assert.equal(
    await page
      .getByRole('button', { name: 'long/folder/generated-output-0.tsx', exact: true })
      .isVisible(),
    false,
  );
});
