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
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {Message} from './src/components';import ConversationTimeline from './src/ConversationTimeline';window.ui={React,createRoot,flushSync,Message,ConversationTimeline};`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    outdir: 'test-results/window-bundle',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  bundle = result.outputFiles.find((x) => x.path.endsWith('.js')).text;
  css =
    (await fs.readFile(path.join(__dirname, '../src/styles.css'), 'utf8')) +
    result.outputFiles.find((x) => x.path.endsWith('.css')).text;
  browser = await launchBrowser();
});
after(async () => browser?.close());
async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  page.setDefaultTimeout(5000);
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    const { React, createRoot, flushSync, ConversationTimeline } = window.ui;
    window.rows = Array.from({ length: 1000 }, (_, i) => ({
      id: `r${i}`,
      kind: i % 3 === 0 ? 'user' : i % 3 === 1 ? 'assistant' : 'tool',
      text:
        i === 499
          ? '```text\nCOPY EXACT\n```'
          : 'message ' + i + '\n\n' + 'Long paragraph '.repeat((i % 8) + 1),
      turnId: `t${Math.floor(i / 3)}`,
      streaming: false,
      ...(i % 3 === 2
        ? {
            toolCallId: `tool${i}`,
            title: 'Tool ' + i,
            status: 'completed',
            input: 'secret detail ' + i,
            toolContent: [{ type: 'text', text: 'output ' + i }],
          }
        : {}),
    }));
    window.timeline = React.createRef();
    window.scrollRef = React.createRef();
    window.copies = [];
    window.desktop = {
      request: async (command, payload) => {
        if (command === 'clipboard.write') window.copies.push(payload.text);
        return { ok: true };
      },
    };
    const root = createRoot(document.getElementById('root'));
    const noop = () => {};
    window.render = () =>
      flushSync(() =>
        root.render(
          React.createElement(
            'div',
            { ref: window.scrollRef, style: { height: 500, width: 700, overflow: 'auto' } },
            React.createElement(
              'div',
              { className: 'conversation' },
              React.createElement(ConversationTimeline, {
                ref: window.timeline,
                rows: window.rows,
                scrollRef: window.scrollRef,
                activeTurnId: 'active',
                onRetry: noop,
                notify: noop,
              }),
            ),
          ),
        ),
      );
    window.render();
  });
  return page;
}
test('long timelines mount a bounded window and navigate to unloaded rows with original and code copy', async (t) => {
  const page = await fixture(t);
  assert.ok((await page.locator('[data-row-id]').count()) < 60);
  assert.equal(await page.locator('[data-row-id="r499"]').count(), 0);
  await page.evaluate(() => window.timeline.current.scrollToRow('r499'));
  await page.locator('[data-row-id="r499"] button[data-copy-code]').click();
  await page
    .locator('[data-row-id="r499"]')
    .getByRole('button', { name: '复制原文', exact: true })
    .click();
  assert.deepEqual(await page.evaluate(() => window.copies), [
    'COPY EXACT\n',
    '```text\nCOPY EXACT\n```',
  ]);
  assert.ok((await page.locator('[data-row-id]').count()) < 60);
});
test('closed tool details are absent until opened, and navigation opens an unloaded tool', async (t) => {
  const page = await fixture(t);
  assert.equal(await page.locator('.tool-detail').count(), 0);
  await page.evaluate(() => window.timeline.current.scrollToRow('r500'));
  await page.locator('[data-row-id="r500"] .tool-detail').waitFor();
  assert.match(
    await page.locator('[data-row-id="r500"] .tool-detail').textContent(),
    /secret detail 500/,
  );
});
test('appending active output retains the historical viewport and completed code nodes', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.timeline.current.scrollToRow('r499'));
  const result = await page.evaluate(async () => {
    const pre = document.querySelector('[data-row-id="r499"] pre');
    const before = pre.getBoundingClientRect().top;
    window.rows = [
      ...window.rows,
      { id: 'active', kind: 'assistant', text: 'live', turnId: 'active', streaming: true },
    ];
    window.render();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      same: pre === document.querySelector('[data-row-id="r499"] pre'),
      delta: pre.getBoundingClientRect().top - before,
      active: !!document.querySelector('[data-row-id="active"]'),
    };
  });
  assert.equal(result.same, true);
  assert.ok(Math.abs(result.delta) < 3, `viewport moved ${result.delta}`);
  assert.equal(result.active, true);
});

test('streaming thoughts close on completion and can then be opened by navigation', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.rows = [
      ...window.rows,
      { id: 'thinking', kind: 'thought', text: 'working', turnId: 'active', streaming: true },
    ];
    window.render();
  });
  assert.equal(await page.locator('[data-row-id="thinking"]').getAttribute('open'), '');
  await page.evaluate(() => {
    window.rows = window.rows.map((row) =>
      row.id === 'thinking' ? { ...row, streaming: false } : row,
    );
    window.render();
  });
  await page.waitForFunction(() => !document.querySelector('[data-row-id="thinking"]').open);
  await page.evaluate(() => window.timeline.current.scrollToRow('thinking'));
  assert.equal(
    await page.locator('[data-row-id="thinking"] .thought-body').textContent(),
    'working\n',
  );
});

test('manual scrolling mounts the destination while preserving a native historical text selection', async (t) => {
  const page = await fixture(t);
  const before = await page.evaluate(() => {
    const text = document.querySelector('[data-row-id="r1"] .markdown');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  await page.evaluate(() => {
    window.scrollRef.current.scrollTop = window.scrollRef.current.scrollHeight;
  });
  await page.waitForFunction(() => !!document.querySelector('[data-row-id="r999"]'));
  assert.equal(await page.evaluate(() => getSelection().toString()), before);
  assert.equal(await page.locator('[data-row-id="r1"]').count(), 1);
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.waitForFunction(() => !document.querySelector('[data-row-id="r1"]'));
});

test('Ctrl+A in conversation mounts the whole conversation, while input Ctrl+A remains native', async (t) => {
  const page = await fixture(t);
  await page.locator('[data-row-id="r1"] .markdown').click();
  await page.keyboard.press('Control+A');
  await page.waitForFunction(() => document.querySelectorAll('[data-row-id]').length === 1000);
  const selected = await page.evaluate(() => getSelection().toString());
  assert.match(selected, /message 0/);
  assert.match(selected, /message 999/);
  await page.evaluate(() => {
    const input = document.createElement('textarea');
    input.value = 'input only';
    document.body.append(input);
    input.focus();
  });
  await page.keyboard.press('Control+A');
  assert.deepEqual(
    await page.locator('textarea').evaluate((input) => [input.selectionStart, input.selectionEnd]),
    [0, 10],
  );
});
