const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser, bundle;
before(async () => {
  bundle = buildSync({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import ProjectTools from './src/ProjectTools';createRoot(document.getElementById('root')).render(<ProjectTools cwd="C:/project" editorOpen={false} onRestored={()=>{}} onClose={()=>{}} notify={message=>window.notices.push(message)} protectedAttachmentPaths={['C:/data/attachments/draft.png']}/>);`,
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
async function fixture(t, { holdCheckpoints = false, holdRunner = false } = {}) {
  const page = await browser.newPage();
  t.after(() => page.close());
  page.setDefaultTimeout(3000);
  await page.setContent('<div id="root"></div>');
  await page.evaluate(
    ({ holdCheckpoints, holdRunner }) => {
      window.calls = [];
      window.notices = [];
      window.files = [
        {
          name: 'old.png',
          path: 'C:/data/attachments/old.png',
          createdAt: '2026-10-04T00:00:00Z',
          bytes: 1024,
          protected: false,
        },
        {
          name: 'draft.png',
          path: 'C:/data/attachments/draft.png',
          createdAt: '2026-10-04T00:00:00Z',
          bytes: 1024,
          protected: true,
        },
      ];
      window.desktop = {
        onEvent: (callback) => {
          window.emit = callback;
          return () => {};
        },
        request: async (command, payload) => {
          window.calls.push({ command, payload });
          let data = {};
          if (command === 'runner.inspect')
            data = {
              scripts: [],
              state: { status: 'running', log: 'start\n', runId: 'r1', sequence: 0 },
            };
          if (command === 'runner.inspect' && holdRunner)
            return new Promise((resolve) => {
              window.finishRunner = () => resolve({ ok: true, data });
            });
          if (command === 'runner.state')
            data = { status: 'running', log: 'start\nLIVE OUTPUT\n', runId: 'r1', sequence: 1 };
          if (command === 'checkpoints.list')
            data = [
              {
                id: 'empty',
                status: 'ready',
                files: [],
                createdAt: '2026-10-04T00:00:00Z',
                summary: 'No restorable text files',
                skipped: [],
              },
            ];
          if (command === 'checkpoints.list' && holdCheckpoints)
            return new Promise((resolve) => {
              window.finishCheckpoints = () => resolve({ ok: true, data });
            });
          if (command === 'attachments.storage')
            data = { directory: 'C:/data/attachments', bytes: 2048, files: window.files };
          if (command === 'attachments.removeMany') {
            window.files = window.files.filter((file) => !payload.names.includes(file.name));
            data = { removed: payload.names };
          }
          return { ok: true, data };
        },
      };
    },
    { holdCheckpoints, holdRunner },
  );
  await page.addScriptTag({ content: bundle });
  return page;
}
test('attachment management confirms old-history impact and protects draft references', async (t) => {
  const page = await fixture(t);
  await page.getByRole('button', { name: '附件存储管理', exact: true }).click();
  await page.getByText('old.png', { exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox').nth(1).isDisabled(), true);
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('button', { name: '删除所选附件', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除这些应用附件？' });
  await dialog
    .getByText('删除后，旧会话中引用这些图片的显示可能失效。用户原文件不会被删除。')
    .waitFor();
  assert.equal(
    await page.evaluate(() =>
      window.calls.some((call) => call.command === 'attachments.removeMany'),
    ),
    false,
  );
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.waitForFunction(() =>
    window.calls.some((call) => call.command === 'attachments.removeMany'),
  );
  assert.deepEqual(
    await page.evaluate(
      () => window.calls.find((call) => call.command === 'attachments.removeMany').payload,
    ),
    { names: ['old.png'], protectedPaths: ['C:/data/attachments/draft.png'] },
  );
});

for (const holdRunner of [false, true]) {
  test(`runner output survives slow checkpoint loading while runner snapshot ${holdRunner ? 'is pending' : 'is ready'}`, async (t) => {
    const page = await fixture(t, { holdCheckpoints: true, holdRunner });
    await page.waitForFunction(() => !!window.finishCheckpoints && !!window.emit);
    if (!holdRunner)
      await page.waitForFunction(
        () => document.querySelector('.workflow-log').textContent === 'start\n',
      );
    await page.evaluate(() =>
      window.emit({
        type: 'runner-output',
        cwd: 'C:/project',
        runId: 'r1',
        sequence: 1,
        data: 'LIVE OUTPUT\n',
      }),
    );
    await page.waitForFunction(
      () => document.querySelector('.workflow-log').textContent === 'start\nLIVE OUTPUT\n',
    );
    await page.evaluate(() => {
      window.finishRunner?.();
      window.finishCheckpoints();
    });
    await page.getByText('已隐藏 1 条无可恢复文件的记录。').waitFor();
    assert.equal(await page.locator('.workflow-log').textContent(), 'start\nLIVE OUTPUT\n');
  });
}
test('empty checkpoints remain discoverable and runner deltas ignore duplicate and old runs', async (t) => {
  const page = await fixture(t);
  await page.getByText('已隐藏 1 条无可恢复文件的记录。').waitFor();
  assert.equal(await page.locator('.checkpoint-row').count(), 0);
  await page.getByRole('button', { name: '显示全部检查点', exact: true }).click();
  await page.getByText('No restorable text files', { exact: true }).waitFor();
  await page.evaluate(() => {
    window.emit({
      type: 'runner-output',
      cwd: 'C:/project',
      runId: 'r1',
      sequence: 1,
      data: '中文🙂\n',
    });
    window.emit({
      type: 'runner-output',
      cwd: 'C:/project',
      runId: 'r1',
      sequence: 1,
      data: 'duplicate',
    });
  });
  await page.waitForFunction(
    () => document.querySelector('.workflow-log').textContent === 'start\n中文🙂\n',
  );
  await page.evaluate(() => {
    window.emit({
      type: 'runner-changed',
      cwd: 'C:/project',
      state: { status: 'running', log: 'new\n', runId: 'r2', sequence: 0 },
    });
    window.emit({
      type: 'runner-output',
      cwd: 'C:/project',
      runId: 'r1',
      sequence: 2,
      data: 'late',
    });
    window.emit({ type: 'runner-output', cwd: 'C:/project', runId: 'r2', sequence: 1, data: 'ok' });
  });
  await page.waitForFunction(
    () => document.querySelector('.workflow-log').textContent === 'new\nok',
  );
});
