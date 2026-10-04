const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');

let browser, bundle, css;
before(async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom'; import {Markdown} from './src/components'; import {PermissionDialog} from './src/Dialogs'; window.securityRendering={React,createRoot,flushSync,Markdown,PermissionDialog};`,
      resolveDir: path.join(__dirname, '..'),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    outdir: 'test-results/markdown-security-bundle',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  bundle = result.outputFiles.find((file) => file.path.endsWith('.js')).text;
  css =
    (await fs.readFile(path.join(__dirname, '../src/styles.css'), 'utf8')) +
    result.outputFiles.find((file) => file.path.endsWith('.css')).text;
  browser = await launchBrowser();
});
after(async () => browser?.close());

async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  page.setDefaultTimeout(5000);
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    const { React, createRoot, flushSync, Markdown, PermissionDialog } = window.securityRendering;
    const root = createRoot(document.getElementById('root'));
    window.replies = [];
    window.renderMarkdown = (text, dialog = true) =>
      flushSync(() =>
        root.render(
          React.createElement(
            React.Fragment,
            null,
            React.createElement(Markdown, { text }),
            dialog &&
              React.createElement(PermissionDialog, {
                item: {
                  requestId: 'approval',
                  params: {
                    toolCall: { title: 'Run command', rawInput: { command: 'echo harmless' } },
                    options: [
                      { optionId: 'allow', kind: 'allow_once', name: 'Yes, proceed' },
                      { optionId: 'reject', kind: 'reject_once', name: 'No' },
                    ],
                  },
                },
                onReply: async (...args) => {
                  window.replies.push(args);
                },
              }),
          ),
        ),
      );
  });
  return page;
}

for (const [name, source, choice, reply] of [
  [
    'style element',
    'Answer\n\n<style>.permission-choice:not(.primary), .permission-cancel-row, .modal-heading button { display: none !important; }</style>',
    '拒绝本次',
    ['reject', false],
  ],
  [
    'inline overlay',
    'Answer <span style="position:fixed;inset:0;z-index:2147483647;background:white">Fake approval</span>',
    '取消这项操作',
    [undefined, true],
  ],
  [
    'application classes and forms',
    '<div class="modal-backdrop"><form class="modal"><button class="permission-choice primary">Fake allow</button><input autofocus name="approval"></form></div>',
    '拒绝本次',
    ['reject', false],
  ],
]) {
  test(`model HTML ${name} cannot alter the real permission dialog`, async (t) => {
    const page = await fixture(t);
    await page.evaluate((text) => window.renderMarkdown(text), source);
    const dialog = page.getByRole('dialog', { name: 'Grok 需要你的批准' });
    assert.equal(
      await dialog.getByRole('button', { name: '拒绝本次', exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await dialog.getByRole('button', { name: '取消这项操作', exact: true }).isVisible(),
      true,
    );
    assert.equal(
      await page
        .locator(
          '.markdown style, .markdown [style], .markdown .modal-backdrop, .markdown form, .markdown input, .markdown button',
        )
        .count(),
      0,
    );
    assert.ok(
      (await page.locator('.markdown').textContent()).includes(source.slice(source.indexOf('<'))),
    );
    await dialog.getByRole('button', { name: choice, exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.replies), [reply]);
  });
}

test('escaped raw HTML keeps Markdown tables, code copy, math and completed streaming nodes', async (t) => {
  const page = await fixture(t);
  const source =
    '```javascript\nconst html = "<style>body{display:none}</style>";\n```\n\n| Type | Value |\n| --- | --- |\n| formula | $x^2$ |\n\n$$\ny = x + 1\n$$\n\nInline <strong class="primary">HTML</strong>';
  await page.evaluate((text) => {
    window.desktop = {
      request: async (command, payload) => {
        if (command === 'clipboard.write') window.copied = payload.text;
        return { ok: true };
      },
    };
    window.renderMarkdown(text, false);
  }, source);
  await page.waitForFunction(
    () =>
      !!document.querySelector('code .hljs-keyword') &&
      document.querySelectorAll('.katex').length === 2,
  );
  await page.locator('button[data-copy-code]').click();
  const result = await page.evaluate((text) => {
    const pre = document.querySelector('pre');
    const math = document.querySelector('.katex');
    window.renderMarkdown(text + '\n\n<div class="modal-backdrop">Later HTML</div>', false);
    return {
      retainedCode: pre === document.querySelector('pre'),
      retainedMath: math === document.querySelector('.katex'),
      copied: window.copied,
      cells: [...document.querySelectorAll('td')].map((cell) => cell.textContent),
      html: document.querySelector('.markdown').innerHTML,
      unsafe: !!document.querySelector(
        '.markdown style, .markdown .primary, .markdown .modal-backdrop',
      ),
    };
  }, source);
  assert.equal(result.retainedCode, true);
  assert.equal(result.retainedMath, true);
  assert.equal(result.copied, 'const html = "<style>body{display:none}</style>";\n');
  assert.equal(result.cells[0], 'formula');
  assert.match(result.html, /&lt;strong class="primary"&gt;/);
  assert.equal(result.unsafe, false);
});
