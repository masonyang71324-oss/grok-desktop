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
        import {Message} from './src/components'; import Inspector from './src/Inspector'; import {setLocale} from './src/i18n';
        window.ui={React,createRoot,flushSync,Message,Inspector,setLocale};`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    format: 'iife',
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

test('switching language refreshes memo messages and code controls without altering code or selection', async (t) => {
  const page = await fixture(t);
  const result = await page.evaluate(() => {
    const { React, createRoot, flushSync, Message, setLocale } = window.ui;
    const root = createRoot(document.getElementById('root'));
    flushSync(() => {
      setLocale('zh-CN');
      root.render(
        React.createElement(Message, {
          row: {
            id: 'reply',
            kind: 'assistant',
            text: '```\n原始代码 stays unchanged\n```',
            streaming: true,
          },
          onRetry() {},
          notify() {},
        }),
      );
    });
    const code = document.querySelector('pre code');
    const range = document.createRange();
    range.setStart(code.firstChild, 0);
    range.setEnd(code.firstChild, 4);
    window.getSelection().addRange(range);
    flushSync(() => setLocale('en'));
    const english = {
      copy: document.querySelector('[data-copy-code]').textContent,
      language: document.querySelector('.code-toolbar span').textContent,
      live: document.querySelector('.live-label').textContent,
      sameCode: code === document.querySelector('pre code'),
      content: code.textContent,
      selection: window.getSelection().toString(),
    };
    flushSync(() => setLocale('zh-CN'));
    return { english, chineseCopy: document.querySelector('[data-copy-code]').textContent };
  });
  assert.deepEqual(result, {
    english: {
      copy: 'Copy code',
      language: 'Plain text',
      live: 'Responding',
      sameCode: true,
      content: '原始代码 stays unchanged\n',
      selection: '原始代码',
    },
    chineseCopy: '复制代码',
  });
});

test('Inspector changes language while an unsaved editor is open and localizes discard choices', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const { React, createRoot, flushSync, Inspector } = window.ui;
    window.desktop = {
      request: async (command) => ({
        ok: true,
        data:
          command === 'workspace.list'
            ? [{ path: '笔记.txt', name: '笔记.txt', isDirectory: false }]
            : command === 'workspace.read'
              ? { path: '笔记.txt', text: 'original', mtimeMs: 1, truncated: false }
              : null,
      }),
    };
    const root = createRoot(document.getElementById('root'));
    flushSync(() =>
      root.render(
        React.createElement(Inspector, {
          cwd: 'C:/project',
          plan: [],
          revision: 0,
          onClose() {},
          notify() {},
        }),
      ),
    );
  });
  await page.locator('.file-row').click();
  await page.getByRole('textbox', { name: '文件内容' }).fill('未保存内容 stays unchanged');
  await page.evaluate(() => window.ui.flushSync(() => window.ui.setLocale('en')));
  assert.equal(
    await page.getByRole('textbox', { name: 'File content' }).inputValue(),
    '未保存内容 stays unchanged',
  );
  await page.getByRole('button', { name: 'Close · Esc', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  assert.equal(
    await page.getByRole('textbox', { name: 'File content' }).inputValue(),
    '未保存内容 stays unchanged',
  );
  await page.getByRole('button', { name: 'Close · Esc', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'File content' }).count(), 0);
  assert.equal(await page.locator('.file-row').textContent(), '笔记.txt');
});

test('English tool labels leave raw tool titles, file paths and diff content untouched', async (t) => {
  const page = await fixture(t);
  const result = await page.evaluate(() => {
    const { React, createRoot, flushSync, Message, setLocale } = window.ui;
    const root = createRoot(document.getElementById('root'));
    flushSync(() => {
      setLocale('en');
      root.render(
        React.createElement(Message, {
          row: {
            id: 'tool',
            kind: 'tool',
            title: 'Grok 原始工具标题',
            status: 'completed',
            input: '原始输入',
            toolContent: [
              { type: 'diff', path: '中文文件.txt', oldText: '旧内容', newText: '新内容' },
            ],
          },
          onRetry() {},
          notify() {},
        }),
      );
    });
    return {
      title: document.querySelector('.tool-row summary > span:first-of-type').textContent,
      status: document.querySelector('.tool-status').textContent,
      labels: [...document.querySelectorAll('.eyebrow')].map((node) => node.textContent),
      path: document.querySelector('.tool-file-link').textContent,
      old: document.querySelector('.tool-diff-old pre').textContent,
      next: document.querySelector('.tool-diff-new pre').textContent,
    };
  });
  assert.deepEqual(result, {
    title: 'Grok 原始工具标题',
    status: 'Completed',
    labels: ['Input', 'Result', 'Before', 'After'],
    path: '中文文件.txt',
    old: '旧内容',
    next: '新内容',
  });
});

test('an already-open new-file diff updates generated labels without translating file content', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const { React, createRoot, flushSync, Inspector } = window.ui;
    window.desktop = {
      request: async (command) => ({
        ok: true,
        data:
          command === 'workspace.changes'
            ? {
                isGit: true,
                branch: '分离 HEAD',
                changes: [{ path: '中文.txt', status: '?', staged: false }],
              }
            : command === 'workspace.diff'
              ? { text: '新文件 中文.txt\n+新文件 原始内容\n+… 内容已截断\n… 内容已截断' }
              : [],
      }),
    };
    const root = createRoot(document.getElementById('root'));
    flushSync(() =>
      root.render(
        React.createElement(Inspector, {
          cwd: 'C:/project',
          plan: [],
          revision: 0,
          tab: 'changes',
          onClose() {},
          notify() {},
        }),
      ),
    );
  });
  await page.locator('.change-row').click();
  await page.getByRole('dialog').waitFor();
  await page.evaluate(() => window.ui.flushSync(() => window.ui.setLocale('en')));
  assert.deepEqual(await page.locator('.diff-line-content').allTextContents(), [
    'New file 中文.txt',
    '+新文件 原始内容',
    '+… 内容已截断',
    '… Content truncated',
  ]);
  assert.match(await page.locator('.tree-heading').textContent(), /Detached HEAD/);
  assert.deepEqual(await page.locator('.diff-add .diff-line-number').allTextContents(), [
    '',
    '1',
    '',
    '2',
  ]);
});
