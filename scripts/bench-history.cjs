const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { build } = require('esbuild');
const { launchBrowser } = require('./browser-launch.cjs');
const { appendHistoryUpdate } = require('../electron/history-updates.cjs');

const root = path.join(__dirname, '..');
const baselineRef = process.argv[2] || '46295bf';
const sourceAt = (filename) =>
  execFileSync('git', ['show', `${baselineRef}:${filename}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
  });
function fixture(turns) {
  const updates = [];
  for (let turn = 0; turn < turns; turn++) {
    const tag = { _desktopTurnId: `turn-${turn}` };
    updates.push({
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text: `Review synthetic project, turn ${turn}` },
      ...tag,
    });
    for (let chunk = 0; chunk < 20; chunk++)
      updates.push({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'checking context ' },
        ...tag,
      });
    updates.push({
      sessionUpdate: 'tool_call',
      toolCallId: 'reused',
      title: 'Read synthetic file',
      rawInput: { path: 'src/example.ts' },
      status: 'pending',
      ...tag,
    });
    updates.push({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'reused',
      rawOutput: { text: 'fixture output\n'.repeat(20) },
      status: 'completed',
      ...tag,
    });
    for (let chunk = 0; chunk < 200; chunk++)
      updates.push({
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: 'Synthetic answer keeps all words. ' + (chunk % 16 === 15 ? '\n\n' : ''),
        },
        ...tag,
      });
  }
  return updates;
}
const plain = (rows) => rows.map(({ id, ...row }) => row);
const textOf = (updates) =>
  updates
    .filter((update) => typeof update.content?.text === 'string')
    .map((update) => update.content.text)
    .join('');
function objects(value) {
  if (!value || typeof value !== 'object') return 0;
  return 1 + Object.values(value).reduce((count, item) => count + objects(item), 0);
}
function measure(fn) {
  const times = [];
  for (let repeat = 0; repeat < 4; repeat++) {
    global.gc?.();
    const start = performance.now();
    fn();
    if (repeat) times.push(performance.now() - start);
  }
  return Number(times.sort((a, b) => a - b)[1].toFixed(2));
}
async function bundle(baseline) {
  const result = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {Message} from './src/components';${baseline ? '' : "import ConversationTimeline from './src/ConversationTimeline';"}window.bench={React,createRoot,flushSync,Message${baseline ? '' : ',ConversationTimeline'}};`,
      loader: 'tsx',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    outdir: 'test-results/history-bench',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: baseline
      ? [
          {
            name: 'baseline-message',
            setup(build) {
              build.onLoad({ filter: /[\\/]src[\\/]components\.tsx$/ }, () => ({
                contents: sourceAt('src/components.tsx'),
                loader: 'tsx',
                resolveDir: path.join(root, 'src'),
              }));
            },
          },
        ]
      : [],
  });
  return {
    script: result.outputFiles.find((file) => file.path.endsWith('.js')).text,
    css: result.outputFiles.find((file) => file.path.endsWith('.css'))?.text || '',
  };
}
async function domCase(browser, code, css, rows, baseline) {
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="root"></div>');
    await page.addStyleTag({ content: css + code.css });
    await page.addScriptTag({ content: code.script });
    return await page.evaluate(
      async ({ rows, baseline }) => {
        const { React, createRoot, flushSync, Message, ConversationTimeline } = window.bench;
        const root = createRoot(document.getElementById('root'));
        const scrollRef = React.createRef(),
          timeline = React.createRef();
        const noop = () => {};
        const render = (text) => {
          const all = [
            ...rows,
            { id: 'live', kind: 'assistant', turnId: 'live', streaming: true, text },
          ];
          flushSync(() =>
            root.render(
              React.createElement(
                'div',
                { ref: scrollRef, style: { width: 800, height: 600, overflow: 'auto' } },
                React.createElement(
                  'div',
                  { className: 'conversation' },
                  baseline
                    ? all.map((row) =>
                        React.createElement(Message, {
                          key: row.id,
                          row,
                          notify: noop,
                          onRetry: noop,
                        }),
                      )
                    : React.createElement(ConversationTimeline, {
                        ref: timeline,
                        rows: all,
                        scrollRef,
                        activeTurnId: 'live',
                        notify: noop,
                        onRetry: noop,
                      }),
                ),
              ),
            ),
          );
          document.getElementById('root').offsetHeight;
        };
        const start = performance.now();
        render('Live answer');
        const initialMs = performance.now() - start;
        for (let n = 0; n < 4; n++) await new Promise((resolve) => requestAnimationFrame(resolve));
        const domNodes = document.querySelectorAll('#root *').length;
        const mountedRows = document.querySelectorAll('[data-row-id]').length;
        const samples = [];
        for (let n = 0; n < 25; n++) {
          const start = performance.now();
          render('Live answer '.repeat(n + 1));
          if (n >= 5) samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        for (let n = 0; n < 4; n++) await new Promise((resolve) => requestAnimationFrame(resolve));
        const manualScrollMountedLast = !!document.querySelector(
          `[data-row-id="${rows.at(-1).id}"]`,
        );
        let navigated = true;
        if (!baseline) {
          const wanted = rows[Math.floor(rows.length / 2)];
          const node = await timeline.current.scrollToRow(wanted.id);
          navigated = node?.dataset.rowId === wanted.id;
        }
        return {
          initialRenderLayoutMs: Number(initialMs.toFixed(2)),
          domNodes,
          mountedRows,
          liveMedianMs: Number(samples[10].toFixed(2)),
          liveP95Ms: Number(samples[18].toFixed(2)),
          navigationComplete: navigated,
          manualScrollMountedLast,
        };
      },
      { rows, baseline },
    );
  } finally {
    await page.close();
  }
}
async function main() {
  const old = await import(
    'data:text/javascript;base64,' + Buffer.from(sourceAt('src/timeline.mjs')).toString('base64')
  );
  const next = await import(pathToFileURL(path.join(root, 'src/timeline.mjs')));
  const [oldBundle, newBundle, css] = await Promise.all([
    bundle(true),
    bundle(false),
    fs.readFile(path.join(root, 'src/styles.css'), 'utf8'),
  ]);
  const browser = await launchBrowser();
  const report = {
    baselineRef,
    node: process.version,
    browser: browser.version(),
    method:
      'Synthetic 100/300/500 turns, each 1 user + 20 thought + 2 tool + 200 assistant deltas. Replay: 1 warmup + median of 3; render: production React + forced layout; live: 5 warmups + 20 samples. Objects count all recursively retained objects/arrays, not heap bytes. Same full texts and semantic rows asserted.',
    cases: [],
  };
  try {
    for (const turns of [100, 300, 500]) {
      const updates = fixture(turns),
        compact = [];
      for (const update of updates) appendHistoryUpdate(compact, update);
      const oldRows = old.fromReplay(updates, 'fixture'),
        newRows = next.fromReplay(compact, 'fixture');
      assert.equal(textOf(updates), textOf(compact));
      assert.deepEqual(plain(newRows), plain(oldRows));
      const result = {
        turns,
        textChars: textOf(updates).length,
        rows: newRows.length,
        before: {
          updates: updates.length,
          retainedObjects: objects(updates),
          serializedBytes: Buffer.byteLength(JSON.stringify(updates)),
          replayMs: measure(() => old.fromReplay(updates, 'fixture')),
        },
        after: {
          updates: compact.length,
          retainedObjects: objects(compact),
          serializedBytes: Buffer.byteLength(JSON.stringify(compact)),
          replayRawMs: measure(() => next.fromReplay(updates, 'fixture')),
          replayMs: measure(() => next.fromReplay(compact, 'fixture')),
        },
      };
      const frameUpdates = Array.from({ length: 64 }, () => ({
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'live delta ' },
        },
        turnId: 'live-frame',
      }));
      result.before.liveFrameUpdateMs = measure(() =>
        frameUpdates.reduce(
          (rows, item) => old.appendUpdate(rows, item.update, item.turnId),
          oldRows,
        ),
      );
      result.after.liveFrameUpdateMs = measure(() => next.appendUpdates(newRows, frameUpdates));
      result.before.render = await domCase(browser, oldBundle, css, oldRows, true);
      result.after.render = await domCase(browser, newBundle, css, newRows, false);
      assert.equal(result.after.render.navigationComplete, true);
      assert.equal(result.after.render.manualScrollMountedLast, true);
      report.cases.push(result);
      process.stderr.write(`Measured ${turns} turns\n`);
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
