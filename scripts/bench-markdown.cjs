const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');
const { launchBrowser } = require('./browser-launch.cjs');

async function main() {
  const repo = path.join(__dirname, '..');
  const { outputFiles } = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom'; import {Markdown} from './src/components'; import {marked} from 'marked'; import DOMPurify from 'dompurify';
        function FullReplacement({text}) { const html=DOMPurify.sanitize(marked.parse(text,{async:false,gfm:true,breaks:true})); return <div className="markdown" dangerouslySetInnerHTML={{__html:html}}/>; }
        window.bench={React,createRoot,flushSync,Markdown,FullReplacement};`,
      resolveDir: repo,
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
    await page.route('**/*', (route) => route.abort());
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: outputFiles[0].text });
    await page.addStyleTag({
      content: await fs.readFile(path.join(repo, 'src/styles.css'), 'utf8'),
    });
    const cases = await page.evaluate(() => {
      const { React, createRoot, flushSync, Markdown, FullReplacement } = window.bench;
      const root = createRoot(document.getElementById('root'));
      const paragraph =
        '### 项目审阅结果\n\n当前模块已经完成基础读取，需要保持原有设置和上下文。此处给出完整说明和下一步建议。\n\n- **发现**：显示正常，流式数据按顺序更新。\n- **建议**：仅修改存在证据的问题。\n- **验证**：运行针对性的检查。\n\n';
      const results = [];
      for (const chars of [10000, 30000, 60000]) {
        const text = paragraph.repeat(Math.ceil(chars / paragraph.length)).slice(0, chars);
        const result = { chars };
        for (const [label, component] of [
          ['fullReplacement', FullReplacement],
          ['current', Markdown],
        ]) {
          const times = [];
          for (let sample = 0; sample < 20; sample++) {
            const start = performance.now();
            flushSync(() =>
              root.render(React.createElement(component, { text: text + '\n' + sample })),
            );
            document.getElementById('root').offsetHeight;
            if (sample >= 5) times.push(performance.now() - start);
          }
          times.sort((a, b) => a - b);
          result[label] = {
            medianMs: Number(times[7].toFixed(2)),
            maxMs: Number(times.at(-1).toFixed(2)),
            nodes: document.querySelectorAll('.markdown *').length,
          };
        }
        result.reductionPercent = Math.round(
          (1 - result.current.medianMs / result.fullReplacement.medianMs) * 100,
        );
        results.push(result);
      }
      return results;
    });
    console.log(
      JSON.stringify(
        {
          browser: browser.version(),
          metric: 'Synchronous React render and layout; 5 warmups, 15 measured updates',
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
