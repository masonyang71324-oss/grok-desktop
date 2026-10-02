const { build } = require('esbuild');
const path = require('node:path');
const { launchBrowser } = require('./browser-launch.cjs');

async function main() {
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom'; import {Message} from './src/components'; window.bench={React,createRoot,flushSync,Message};`,
      resolveDir: path.join(__dirname, '..'),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="root" style="width:800px;height:600px;overflow:auto"></div><style>.markdown pre{max-width:700px;overflow:auto}</style>',
    );
    await page.addScriptTag({ content: result.outputFiles[0].text });
    const cases = await page.evaluate(() => {
      const { React, createRoot, flushSync, Message } = window.bench;
      const root = createRoot(document.getElementById('root'));
      const paragraph =
        '### 项目审阅\n\n保持原有会话和上下文，以下为检查结果。\n\n- **发现**：显示正常。\n- **建议**：保持稳定。\n\n';
      const noop = () => {};
      return [100, 500].map((rowCount) => {
        const rows = Array.from({ length: rowCount }, (_, index) => ({
          id: `row-${index}`,
          kind: 'assistant',
          text: paragraph.repeat(3),
          turnId: 'history',
          streaming: false,
        }));
        const prefix = '```txt\n' + 'example '.repeat(200) + '\n```\n\n' + paragraph.repeat(100);
        const render = (tail) =>
          flushSync(() =>
            root.render(
              React.createElement(
                React.Fragment,
                null,
                ...rows.map((row) =>
                  React.createElement(Message, { key: row.id, row, notify: noop, onRetry: noop }),
                ),
                React.createElement(Message, {
                  key: 'tail',
                  row: {
                    id: 'tail',
                    kind: 'assistant',
                    text: tail,
                    turnId: 'active',
                    streaming: true,
                  },
                  notify: noop,
                  onRetry: noop,
                }),
              ),
            ),
          );
        render(prefix);
        const code =
          document.querySelector('[data-row-id="tail"] pre') ||
          document.querySelectorAll('pre')[document.querySelectorAll('pre').length - 1];
        code.scrollLeft = 120;
        const range = document.createRange();
        range.setStart(code.querySelector('code').firstChild, 0);
        range.setEnd(code.querySelector('code').firstChild, 7);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        const scroller = document.getElementById('root');
        scroller.scrollTop = 300;
        const times = [];
        for (let sample = 0; sample < 25; sample++) {
          const start = performance.now();
          render(prefix + '流式尾部 '.repeat(sample + 1));
          scroller.offsetHeight;
          if (sample >= 5) times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        return {
          rowCount,
          tailChars: prefix.length,
          medianMs: Number(times[10].toFixed(2)),
          p95Ms: Number(times[18].toFixed(2)),
          preserved: {
            codeScroll: code.scrollLeft,
            selection: window.getSelection().toString(),
            scrollTop: scroller.scrollTop,
          },
        };
      });
    });
    console.log(
      JSON.stringify(
        {
          browser: browser.version(),
          metric:
            'Production React synchronous streaming update + forced layout; 5 warmups / 20 samples; stable historical row references and callbacks',
          cases,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
