const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
const { build } = require('esbuild');

let browser;
let bundle;
before(async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom'; import {Modal,Markdown,Message} from './src/components'; window.rendering={React,createRoot,flushSync,Modal,Markdown,Message};`,
      resolveDir: path.join(__dirname, '..'),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  bundle = result.outputFiles[0].text;
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

async function pageFor(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route('**/*', (route) => route.abort());
  await page.setContent(
    '<div id="root" style="width:500px"></div><style>.markdown pre{overflow:auto}</style>',
  );
  await page.addScriptTag({ content: bundle });
  return page;
}

test('modal leaves composition Escape and Tab to the input method', async (t) => {
  const page = await pageFor(t);
  const result = await page.evaluate(() => {
    const { React, createRoot, flushSync, Modal } = window.rendering;
    let closes = 0;
    const root = createRoot(document.getElementById('root'));
    flushSync(() =>
      root.render(
        React.createElement(
          Modal,
          { title: '中文输入', onClose: () => closes++ },
          React.createElement('input'),
        ),
      ),
    );
    const input = document.querySelector('input');
    const prevented = [];
    for (const event of [
      { key: 'Escape', isComposing: true },
      { key: 'Escape', keyCode: 229 },
      { key: 'Tab', isComposing: true },
      { key: 'Tab', keyCode: 229 },
    ]) {
      input.focus();
      const key = new KeyboardEvent('keydown', { ...event, bubbles: true, cancelable: true });
      input.dispatchEvent(key);
      prevented.push(key.defaultPrevented);
    }
    const duringComposition = { closes, prevented, focusStayed: document.activeElement === input };
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(tab);
    const normalTab = {
      prevented: tab.defaultPrevented,
      wrapped: document.activeElement === document.querySelector('button'),
    };
    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    return { duringComposition, normalTab, closes };
  });
  assert.deepEqual(result.duringComposition, {
    closes: 0,
    prevented: [false, false, false, false],
    focusStayed: true,
  });
  assert.deepEqual(result.normalTab, { prevented: true, wrapped: true });
  assert.equal(result.closes, 1);
});

test('approval modal can ignore backdrop clicks while its close button stays available', async (t) => {
  const page = await pageFor(t);
  const result = await page.evaluate(() => {
    const { React, createRoot, flushSync, Modal } = window.rendering;
    const root = createRoot(document.getElementById('root'));
    let closes = 0;
    const render = (closeOnBackdrop) =>
      flushSync(() =>
        root.render(
          React.createElement(
            Modal,
            { title: '审批', closeOnBackdrop, onClose: () => closes++ },
            '审批内容',
          ),
        ),
      );
    render(false);
    document
      .querySelector('.modal-backdrop')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const blocked = closes;
    document.querySelector('.modal-heading button').click();
    const explicit = closes;
    render(true);
    document
      .querySelector('.modal-backdrop')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return { blocked, explicit, ordinary: closes };
  });
  assert.deepEqual(result, { blocked: 0, explicit: 1, ordinary: 2 });
});

test('code blocks copy their exact source and keep highlighting when later text arrives', async (t) => {
  const page = await pageFor(t);
  const initial = await page.evaluate(() => {
    const { React, createRoot, flushSync, Markdown } = window.rendering;
    const root = createRoot(document.getElementById('root'));
    window.codeSource = 'const name = "<中文>";\nconsole.log(name);\n';
    window.renderCode = (text) =>
      flushSync(() => root.render(React.createElement(Markdown, { text })));
    window.copiedCode = '';
    window.desktop = {
      request: async (command, payload) => {
        if (command !== 'clipboard.write') return { ok: false, error: 'Unexpected command' };
        window.copiedCode = payload.text;
        return { ok: true };
      },
    };
    window.renderCode('```javascript\n' + window.codeSource + '```');
    return !!document.querySelector('button[data-copy-code]');
  });
  assert.equal(initial, true, 'fenced code needs its own copy control');
  await page.waitForFunction(() => !!document.querySelector('code .hljs-keyword'));
  await page.locator('button[data-copy-code]').click();
  await page.waitForFunction(
    () => document.querySelector('button[data-copy-code]').textContent === '已复制',
  );
  const result = await page.evaluate(() => {
    const code = document.querySelector('pre');
    const feedback = document.querySelector('button[data-copy-code]').textContent;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('code .hljs-keyword'));
    selection.removeAllRanges();
    selection.addRange(range);
    window.renderCode('```javascript\n' + window.codeSource + '```\n\n后续说明');
    return {
      copied: window.copiedCode,
      feedback,
      retained: code === document.querySelector('pre'),
      highlighted: !!document.querySelector('code .hljs-keyword'),
      selected: selection.toString(),
      source: document.querySelector('pre code').textContent,
    };
  });
  assert.deepEqual(result, {
    copied: 'const name = "<中文>";\nconsole.log(name);\n',
    feedback: '已复制',
    retained: true,
    highlighted: true,
    selected: 'const',
    source: 'const name = "<中文>";\nconsole.log(name);\n',
  });
});

test('tool output shows separate old and new content and opens reported file locations', async (t) => {
  const page = await pageFor(t);
  const result = await page.evaluate(() => {
    const { React, createRoot, flushSync, Message } = window.rendering;
    const root = createRoot(document.getElementById('root'));
    const opened = [];
    flushSync(() =>
      root.render(
        React.createElement(Message, {
          row: {
            id: 'tool',
            kind: 'tool',
            turnId: 'turn',
            text: 'plain fallback',
            streaming: false,
            status: 'completed',
            toolContent: [
              { type: 'text', text: '修改完成' },
              {
                type: 'diff',
                path: '/project/config.json',
                oldText: 'old\nsecond\n',
                newText: 'new\nsecond\n',
              },
            ],
            locations: [{ path: '/project/config.json', line: 2 }],
          },
          onRetry() {},
          notify() {},
          onOpenFile: (path, line) => opened.push({ path, line }),
        }),
      ),
    );
    document.querySelector('.tool-locations button')?.click();
    return {
      old: document.querySelector('.tool-diff-old pre')?.textContent,
      next: document.querySelector('.tool-diff-new pre')?.textContent,
      text: document.querySelector('.tool-detail')?.textContent,
      opened,
    };
  });
  assert.equal(result.old, 'old\nsecond\n');
  assert.equal(result.next, 'new\nsecond\n');
  assert.match(result.text, /修改完成/);
  assert.doesNotMatch(result.text, /plain fallback/);
  assert.deepEqual(result.opened, [{ path: '/project/config.json', line: 2 }]);
});

test('streaming later text preserves completed code scroll and selection through completion', async (t) => {
  const page = await pageFor(t);
  const result = await page.evaluate(() => {
    const { React, createRoot, flushSync, Message } = window.rendering;
    const root = createRoot(document.getElementById('root'));
    const source = '```js\nconst value = ' + JSON.stringify('example '.repeat(100)) + ';\n```';
    const render = (text, streaming) =>
      flushSync(() =>
        root.render(
          React.createElement(Message, {
            row: { id: 'reply', kind: 'assistant', text, turnId: 'turn', streaming },
            onRetry() {},
            notify() {},
          }),
        ),
      );
    render(source, true);
    const code = document.querySelector('pre');
    code.scrollLeft = 100;
    const range = document.createRange();
    range.setStart(code.querySelector('code').firstChild, 0);
    range.setEnd(code.querySelector('code').firstChild, 5);
    window.getSelection().addRange(range);
    render(source + '\n\n后续说明正在生成', true);
    render(source + '\n\n后续说明正在生成。', false);
    return {
      sameCode: code === document.querySelector('pre'),
      scrollLeft: document.querySelector('pre').scrollLeft,
      selected: window.getSelection().toString(),
      live: !!document.querySelector('.live-label'),
    };
  });
  assert.deepEqual(result, { sameCode: true, scrollLeft: 100, selected: 'const', live: false });
});

test('Markdown updates references, lists and tables without stale content and keeps safe link handling', async (t) => {
  const page = await pageFor(t);
  const result = await page.evaluate(async () => {
    const { React, createRoot, flushSync, Markdown } = window.rendering;
    const root = createRoot(document.getElementById('root'));
    const render = (text) => flushSync(() => root.render(React.createElement(Markdown, { text })));
    const calls = [];
    window.desktop = {
      request: async (command, payload) => {
        calls.push({ command, payload });
        return { ok: true };
      },
    };
    const start = '[指南][guide]\n\n- 第一项\n';
    render(start);
    const unresolved = document.querySelector('.markdown p').textContent;
    render(
      start +
        '- 第二项\n\n| 列 | 值 |\n|---|---|\n| A | B |\n\n> 引用\n\n[guide]: https://example.com/docs\n\n[不安全](javascript:alert(1))\n<img src="x" onerror="alert(1)"><script>alert(1)</script>',
    );
    const resolved = {
      href: document.querySelector('.markdown a').getAttribute('href'),
      items: [...document.querySelectorAll('li')].map((node) => node.textContent),
      cells: [...document.querySelectorAll('td')].map((node) => node.textContent),
      quote: document.querySelector('blockquote').textContent.trim(),
      unsafe: !!document.querySelector(
        '.markdown [onerror],.markdown script,.markdown a[href^="javascript:"]',
      ),
    };
    document.querySelector('.markdown a').click();
    await Promise.resolve();
    render('最后一段。');
    const finalHtml = document.querySelector('.markdown').innerHTML;
    render('');
    return {
      unresolved,
      resolved,
      calls,
      finalHtml,
      empty: document.querySelector('.markdown').innerHTML,
    };
  });
  assert.equal(result.unresolved, '[指南][guide]');
  assert.deepEqual(result.resolved, {
    href: 'https://example.com/docs',
    items: ['第一项', '第二项'],
    cells: ['A', 'B'],
    quote: '引用',
    unsafe: false,
  });
  assert.deepEqual(result.calls, [
    { command: 'system.open', payload: { target: 'url', url: 'https://example.com/docs' } },
  ]);
  assert.equal(result.finalHtml, '<p>最后一段。</p>\n');
  assert.equal(result.empty, '');
});
