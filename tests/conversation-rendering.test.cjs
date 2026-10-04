const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser, bundle;
before(async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom'; import {Markdown, Message} from './src/components'; window.ui={React,createRoot,flushSync,Markdown,Message};`,
      resolveDir: path.join(__dirname, '..'),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  bundle =
    result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ||
    result.outputFiles[0].text;
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

test('Markdown content cannot execute canaries and only explicit safe link and code controls request host actions', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.calls = [];
    window.desktop = {
      request: async (command, payload) => {
        window.calls.push({ command, payload });
        return { ok: true };
      },
    };
    const { React, createRoot, flushSync, Markdown } = window.ui;
    flushSync(() =>
      createRoot(document.getElementById('root')).render(
        React.createElement(Markdown, {
          text: '<script>window.markdownCanary="executed"</script>\n\n<a href="javascript:window.markdownCanary=1">Blocked canary</a>\n\n[External canary](https://markdown-canary.invalid/link)\n\n```text\nCANARY_CODE_EXACT\n```',
        }),
      ),
    );
  });
  assert.equal(
    await page
      .locator('.markdown script,.markdown [onclick],.markdown a[href^="javascript:"]')
      .count(),
    0,
  );
  assert.ok(
    (await page.locator('.markdown').textContent()).includes(
      '<a href="javascript:window.markdownCanary=1">Blocked canary</a>',
    ),
  );
  assert.deepEqual(await page.evaluate(() => window.calls), []);
  assert.equal(await page.evaluate(() => window.markdownCanary), undefined);
  await page.getByRole('link', { name: 'External canary' }).click();
  await page.getByRole('button', { name: '复制代码', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), [
    {
      command: 'system.open',
      payload: { target: 'url', url: 'https://markdown-canary.invalid/link' },
    },
    { command: 'clipboard.write', payload: { text: 'CANARY_CODE_EXACT\n' } },
  ]);
  assert.equal(page.url(), 'about:blank');
});

test('math renders complete inline/block expressions while code, currency, invalid and incomplete source stay readable', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const { React, createRoot, flushSync, Markdown } = window.ui;
    flushSync(() =>
      createRoot(document.getElementById('root')).render(
        React.createElement(Markdown, {
          text: 'Inline $x^2 + y^2$\n\n$$\n\\frac{a}{b}\n$$\n\n`$code$`\n\n```txt\n$in_fence$\n```\n\nPrice $5 and $10. Incomplete $x +\n\nInvalid $\\unknown{x}$',
        }),
      ),
    );
  });
  await page.waitForFunction(() => document.querySelectorAll('.katex').length === 2, null, {
    timeout: 5000,
  });
  assert.equal(await page.locator('.katex-display').count(), 1);
  assert.equal(await page.locator('code').first().textContent(), '$code$');
  assert.equal(await page.locator('pre code').textContent(), '$in_fence$\n');
  const text = await page.locator('.markdown').textContent();
  assert.match(text, /Price \$5 and \$10/);
  assert.match(text, /Incomplete \$x \+/);
  assert.match(text, /Invalid \$\\unknown\{x\}\$/);
});

test('formatted copy sends clean rich HTML and matching text while original copy remains exact', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.calls = [];
    window.source =
      '# 标题\n\n- **重点**\n\n| 列 | 值 |\n|---|---|\n| A | B |\n\n```txt\n<exact>\n```';
    window.desktop = {
      request: async (command, payload) => {
        window.calls.push({ command, payload });
        return { ok: true };
      },
    };
    const { React, createRoot, flushSync, Message } = window.ui;
    flushSync(() =>
      createRoot(document.getElementById('root')).render(
        React.createElement(Message, {
          row: { id: 'reply', kind: 'assistant', text: window.source, streaming: false },
          notify() {},
          onRetry() {},
        }),
      ),
    );
  });
  await page.getByRole('button', { name: '复制原文', exact: true }).click();
  await page.getByRole('button', { name: '复制格式化内容', exact: true }).click();
  const result = await page.evaluate(() => {
    const payload = window.calls.at(-1).payload;
    const parsed = document.createElement('div');
    parsed.innerHTML = payload.html;
    return {
      source: window.calls[0].payload.text,
      expected: window.source,
      text: payload.text,
      headings: parsed.querySelectorAll('h1').length,
      tables: parsed.querySelectorAll('table').length,
      lists: parsed.querySelectorAll('ul').length,
      code: parsed.querySelector('pre code').textContent,
      controls: parsed.querySelectorAll('button,.code-toolbar').length,
      row: document.querySelector('article').dataset.rowId,
    };
  });
  assert.equal(result.source, result.expected);
  assert.equal(result.headings, 1);
  assert.equal(result.tables, 1);
  assert.equal(result.lists, 1);
  assert.equal(result.controls, 0);
  assert.equal(result.code, '<exact>\n');
  assert.match(result.text, /标题/);
  assert.match(result.text, /A\tB/);
  assert.equal(result.row, 'reply');
});

test('changing a formula updates it while completed formula and table selection survive appended text', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const { React, createRoot, flushSync, Markdown } = window.ui;
    const root = createRoot(document.getElementById('root'));
    window.renderMath = (text) =>
      flushSync(() => root.render(React.createElement(Markdown, { text })));
    window.mathPrefix = '$x^2$\n\n| A | B |\n|---|---|\n| selected | value |\n\n';
    window.renderMath(window.mathPrefix);
  });
  await page.waitForFunction(() => !!document.querySelector('.katex'));
  const result = await page.evaluate(() => {
    const math = document.querySelector('.katex');
    const cell = document.querySelector('td');
    const range = document.createRange();
    range.selectNodeContents(cell);
    window.getSelection().addRange(range);
    window.renderMath(window.mathPrefix + '新尾部');
    return {
      same: math === document.querySelector('.katex'),
      selected: window.getSelection().toString(),
      cellSame: cell === document.querySelector('td'),
    };
  });
  assert.deepEqual(result, { same: true, selected: 'selected', cellSame: true });
  await page.evaluate(() => window.renderMath('$y^3$'));
  await page.waitForFunction(() => document.querySelector('[data-math-source="y^3"] .katex'));
  assert.equal(await page.locator('[data-math-source="x^2"]').count(), 0);
});

test('raw HTML stays readable as text around Markdown blocks and streamed appends', async (t) => {
  const page = await fixture(t);
  const result = await page.evaluate(() => {
    const { React, createRoot, flushSync, Markdown } = window.ui;
    const root = createRoot(document.getElementById('root'));
    const prefix = '<details><summary>Details</summary>\n\n**nested**\n\n</details>\n\n';
    const render = (text) => flushSync(() => root.render(React.createElement(Markdown, { text })));
    render(prefix);
    const strong = document.querySelector('.markdown strong');
    render(prefix + 'Outside');
    return {
      nested: strong?.textContent,
      activeDetails: !!document.querySelector('.markdown details'),
      retained: strong === document.querySelector('.markdown strong'),
      outside: document.querySelector('.markdown > p:last-child')?.textContent,
      source: document
        .querySelector('.markdown')
        .textContent.includes('<details><summary>Details</summary>'),
    };
  });
  assert.deepEqual(result, {
    nested: 'nested',
    activeDetails: false,
    retained: true,
    outside: 'Outside',
    source: true,
  });
});
