const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');

let browser, bundle;
before(async () => {
  const outputs = buildSync({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import {ManagementDialog} from './src/Dialogs';
        createRoot(document.getElementById('root')).render(<ManagementDialog cwd="C:/mock-project" sessionId="session-a" onClose={()=>{}} notify={message=>window.notices.push(message)}/>);`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    outfile: 'management.js',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles;
  bundle = outputs.find((file) => file.path.endsWith('.js')).text;
  browser = await launchBrowser();
});
after(async () => browser?.close());

test('cancelled worktree destination keeps the form and never announces creation or retries', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  page.setDefaultTimeout(5000);
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.notices = [];
    window.createCalls = [];
    window.desktop = {
      request: async (command, payload) => {
        if (command !== 'system.run') throw new Error(`Unexpected command: ${command}`);
        if (payload.action !== 'worktree-create')
          return { ok: true, data: { text: 'No worktrees', data: [] } };
        window.createCalls.push(payload);
        return {
          ok: true,
          data:
            window.createCalls.length === 1
              ? { text: '已取消创建。', data: { cancelled: true } }
              : { text: '工作树已创建。', data: { path: 'C:/mock-destination/feature-a' } },
        };
      },
    };
  });
  await page.addScriptTag({ content: bundle });
  await page
    .locator('.management-nav')
    .getByRole('button', { name: '工作树', exact: true })
    .click();
  await page.locator('.management-actions button').filter({ hasText: '创建工作树' }).click();
  const name = page.getByLabel('工作树名称', { exact: true });
  await name.fill('feature-a');
  await page.getByRole('button', { name: '确认创建工作树', exact: true }).click();
  await page.waitForFunction(() => window.notices.length > 0);
  assert.deepEqual(await page.evaluate(() => window.notices), ['已取消创建。']);
  assert.equal(await name.inputValue(), 'feature-a');
  assert.equal(await page.evaluate(() => window.createCalls.length), 1);

  await page.getByRole('button', { name: '确认创建工作树', exact: true }).click();
  await page.waitForFunction(() => window.notices.length === 2);
  assert.deepEqual(await page.evaluate(() => window.notices), ['已取消创建。', '创建工作树已完成']);
  assert.equal(await name.count(), 0);
  assert.equal(await page.evaluate(() => window.createCalls.length), 2);
});
