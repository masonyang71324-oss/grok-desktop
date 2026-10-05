const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');

let browser, bundle;
before(async () => {
  bundle = buildSync({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
        import InterfaceSize from './src/InterfaceSize'; import SystemErrorDetails from './src/SystemErrorDetails';
        import {setLocale} from './src/i18n';
        window.ui={React,createRoot,flushSync,InterfaceSize,SystemErrorDetails,setLocale};`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
  }).outputFiles[0].text;
  browser = await launchBrowser();
});
after(async () => browser?.close());

async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  return page;
}

test('interface size forwards a numeric choice and reflects external keyboard zoom in both languages', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const { React, createRoot, flushSync, InterfaceSize } = window.ui;
    window.changes = [];
    const root = createRoot(document.getElementById('root'));
    window.renderSize = (value, disabled = false) =>
      flushSync(() =>
        root.render(
          React.createElement(InterfaceSize, {
            value,
            disabled,
            onChange: (value) => window.changes.push(value),
          }),
        ),
      );
    window.renderSize(100);
  });
  const selector = page.getByRole('combobox', { name: '界面大小', exact: true });
  await selector.selectOption('125');
  assert.deepEqual(await page.evaluate(() => window.changes), [125]);
  await page.evaluate(() => window.renderSize(133));
  assert.equal(await selector.inputValue(), '133');
  await page.evaluate(() => window.ui.flushSync(() => window.ui.setLocale('en')));
  const english = page.getByRole('combobox', { name: 'Interface size', exact: true });
  assert.equal(await english.inputValue(), '133');
  assert.match(await english.textContent(), /133%/);
  await page.evaluate(() => window.renderSize(150, true));
  assert.equal(await english.isDisabled(), true);
  assert.equal(await english.inputValue(), '150');
});

test('error details preserve and copy original diagnostics while expanding and changing language', async (t) => {
  const page = await fixture(t);
  const raw = "EPERM: operation not permitted, rename 'C:\\项目\\原始.txt'\noriginal detail";
  await page.evaluate((raw) => {
    const { React, createRoot, flushSync, SystemErrorDetails } = window.ui;
    window.copied = [];
    window.expanded = [];
    flushSync(() =>
      createRoot(document.getElementById('root')).render(
        React.createElement(SystemErrorDetails, {
          error: raw,
          onCopy: async (text) => window.copied.push(text),
          onExpandedChange: (open) => window.expanded.push(open),
        }),
      ),
    );
  }, raw);
  await page.getByText('原始错误详情', { exact: true }).click();
  assert.equal(await page.locator('pre').textContent(), raw);
  await page.getByRole('button', { name: '复制原始详情', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.copied), [raw]);
  await page.evaluate(() => window.ui.flushSync(() => window.ui.setLocale('en')));
  assert.equal(await page.locator('pre').textContent(), raw);
  assert.equal(await page.getByText('Original error details', { exact: true }).count(), 1);
  assert.match(await page.locator('.system-error-explanation').textContent(), /permission/i);
  assert.deepEqual(await page.evaluate(() => window.expanded), [true]);
});

test('unknown errors remain inspectable and clipboard failures offer a manual copy path', async (t) => {
  const page = await fixture(t);
  const raw = 'Unrecognized failure: untouched diagnostic data';
  await page.evaluate((raw) => {
    const { React, createRoot, flushSync, SystemErrorDetails, setLocale } = window.ui;
    flushSync(() => {
      setLocale('en');
      createRoot(document.getElementById('root')).render(
        React.createElement(SystemErrorDetails, {
          error: raw,
          showExplanation: false,
          onCopy: async () => {
            throw new Error('clipboard unavailable');
          },
        }),
      );
    });
  }, raw);
  await page.getByText('Original error details', { exact: true }).click();
  assert.equal(await page.locator('pre').textContent(), raw);
  await page.getByRole('button', { name: 'Copy original details', exact: true }).click();
  assert.match(await page.getByRole('status').textContent(), /select.*copy/i);
  assert.equal(await page.locator('.system-error-explanation').count(), 0);
});
