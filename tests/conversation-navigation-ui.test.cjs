const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser, bundle;
before(async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom'; import ConversationNavigation from './src/ConversationNavigation'; window.ui={React,createRoot,flushSync,ConversationNavigation};`,
      resolveDir: path.join(__dirname, '..'),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  bundle = result.outputFiles[0].text;
  browser = await launchBrowser();
});
after(async () => browser?.close());

test('search buttons wrap, IME Enter stays local, outline shares targets and switching session clears search', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    const { React, createRoot, flushSync, ConversationNavigation } = window.ui;
    const root = createRoot(document.getElementById('root'));
    window.targets = [];
    window.renderNavigation = (sessionId) =>
      flushSync(() =>
        root.render(
          React.createElement(ConversationNavigation, {
            sessionId,
            rows: [
              { id: 'u', kind: 'user', text: '测试目录' },
              { id: 't', kind: 'thought', text: '测试思考' },
            ],
            turnError: '测试错误',
            onNavigate: (target) => window.targets.push(target),
          }),
        ),
      );
    window.renderNavigation('one');
  });
  await page.getByRole('searchbox', { name: '搜索会话' }).fill('测试');
  await page.getByRole('button', { name: '下一处', exact: true }).click();
  await page.getByRole('button', { name: '上一处', exact: true }).click();
  await page.getByRole('searchbox').evaluate((input) =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  assert.deepEqual(await page.evaluate(() => window.targets), [
    { kind: 'row', rowId: 'u' },
    { kind: 'error' },
  ]);
  await page.getByRole('searchbox').press('Enter');
  assert.deepEqual(await page.evaluate(() => window.targets.at(-1)), { kind: 'row', rowId: 'u' });
  await page.getByRole('tab', { name: '问题目录' }).click();
  await page.getByRole('button', { name: '1.测试目录' }).click();
  assert.deepEqual(await page.evaluate(() => window.targets.at(-1)), { kind: 'row', rowId: 'u' });
  await page.evaluate(() => window.renderNavigation('two'));
  await page.getByRole('tab', { name: '搜索', exact: true }).click();
  assert.equal(await page.getByRole('searchbox').inputValue(), '');
  assert.equal(await page.getByRole('button', { name: '下一处', exact: true }).count(), 0);
});
