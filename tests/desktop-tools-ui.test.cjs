const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser, bundle;
before(async () => {
  browser = await launchBrowser();
  bundle = buildSync({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import WebPreview from './src/WebPreview';const root=createRoot(document.getElementById('root'));window.mount=n=>root.render(<WebPreview key={n} owner={{cwd:'C:/test',draftKey:'draft'+n}} onClose={()=>window.previewClosedCalls.push(n)}/>);window.mount(1);`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    outfile: 'preview.js',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles.find((file) => file.path.endsWith('.js')).text;
});
after(() => browser?.close());
test('preview form coalesces Enter and an old open cannot close a replacement dialog', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.previewClosedCalls = [];
    window.calls = 0;
    window.desktop = {
      request: async (command) => {
        if (command === 'runner.state') return { ok: true, data: {} };
        if (command === 'preview.open') {
          window.calls++;
          return new Promise(
            (resolve) => (window.finish = () => resolve({ ok: true, data: { id: 'one' } })),
          );
        }
        throw Error(command);
      },
    };
  });
  await page.addScriptTag({ content: bundle });
  const input = page.getByRole('textbox', { name: '网页地址' });
  await input.fill('http://localhost:3000');
  await input.press('Enter');
  await input.press('Enter');
  assert.equal(await page.evaluate(() => window.calls), 1);
  await page.evaluate(() => window.mount(2));
  await page.getByRole('textbox', { name: '网页地址' }).waitFor();
  await page.evaluate(() => window.finish());
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  assert.deepEqual(await page.evaluate(() => window.previewClosedCalls), []);
});
test('toolbar capture remains disabled until its own capture settles despite other actions', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const html = (await fs.readFile(path.join(__dirname, '../electron/preview.html'), 'utf8'))
    .replace(/<script[^>]*src="preview-ui.js"[^>]*><\/script>/, '')
    .replace(/<meta\b[^>]*>/g, '');
  await page.setContent(html);
  await page.evaluate(() => {
    const state = {
      url: 'https://example.org',
      labels: {
        address: 'Address',
        capture: 'Capture',
        external: 'External',
        open: 'Open',
        reload: 'Reload',
        saved: 'Saved',
      },
    };
    window.preview = {
      onState() {},
      request: async ({ action }) =>
        action === 'capture'
          ? new Promise((resolve) => (window.finishCapture = () => resolve({ ok: true, data: {} })))
          : { ok: true, data: state },
    };
  });
  await page.addScriptTag({ path: path.join(__dirname, '../electron/preview-ui.js') });
  await page.getByRole('button', { name: 'Capture', exact: true }).click();
  const capture = page.locator('[data-action=capture]');
  assert.equal(await capture.isDisabled(), true);
  await page.locator('[data-action=reload]').click();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  assert.equal(await capture.isDisabled(), true);
  await page.evaluate(() => window.finishCapture());
  await page.waitForFunction(() => !document.querySelector('[data-action=capture]').disabled);
});
