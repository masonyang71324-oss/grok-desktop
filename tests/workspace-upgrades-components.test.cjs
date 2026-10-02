const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
const JSZip = require('jszip');
let browser, bundle;
before(async () => {
  bundle = buildSync({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import DiffViewer from './src/DiffViewer';import ProjectFilePicker from './src/ProjectFilePicker';import OfficePreview from './src/OfficePreview';import ResizeHandle from './src/ResizeHandle';const root=createRoot(document.getElementById('root'));window.show=(kind,props)=>root.render(kind==='diff'?<DiffViewer {...props}/>:kind==='picker'?<ProjectFilePicker {...props} onClose={()=>{}} onSelect={(files,owner)=>window.selected={files,owner}}/>:kind==='office'?<OfficePreview {...props}/>:<ResizeHandle {...props} label="Resize panel" onChange={value=>{window.changed=value}} onCommit={value=>window.committed=value}/>);`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  }).outputFiles[0].text;
  browser = await launchBrowser();
});
after(async () => browser?.close());
async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.calls = [];
    window.pending = [];
    window.desktop = {
      request: (command, payload) => {
        window.calls.push({ command, payload });
        return new Promise((resolve) => window.pending.push({ command, payload, resolve }));
      },
    };
  });
  await page.addScriptTag({ content: bundle });
  return page;
}
test('split diff shows paired changed words and context expands without altering source', async (t) => {
  const page = await fixture(t);
  const text =
    '@@ -1,12 +1,12 @@\n' +
    Array.from({ length: 10 }, (_, i) => ` unchanged ${i}`).join('\n') +
    '\n-old word\n+new word\n tail';
  await page.evaluate((text) => window.show('diff', { text }), text);
  await page.getByRole('button', { name: '并排' }).click();
  assert.equal(await page.locator('.diff-split-row mark').count(), 2);
  await page.getByRole('button', { name: /展开 .* 行上下文/ }).click();
  assert.ok((await page.locator('.diff-split-row').count()) >= 12);
});
test('picker ignores late prior-project search and attaches multiple files with captured owner', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.show('picker', { cwd: 'C:/old', sessionId: 'old' }));
  await page.waitForFunction(() => window.pending.length === 1);
  await page.evaluate(() => window.show('picker', { cwd: 'C:/new', sessionId: 'new' }));
  await page.waitForFunction(() => window.pending.length === 2);
  await page.evaluate(() =>
    window.pending[0].resolve({
      ok: true,
      data: { files: [{ name: 'old.txt', path: 'C:/old/old.txt' }], truncated: false },
    }),
  );
  await page.evaluate(() =>
    window.pending[1].resolve({
      ok: true,
      data: {
        files: [
          { name: 'a.txt', path: 'C:/new/a.txt' },
          { name: 'b.txt', path: 'C:/new/b.txt' },
        ],
        truncated: true,
      },
    }),
  );
  await page.getByRole('checkbox', { name: 'a.txt' }).check();
  await page.getByRole('checkbox', { name: 'b.txt' }).check();
  assert.equal(await page.getByText('old.txt', { exact: true }).count(), 0);
  assert.equal(await page.getByText(/搜索结果未完整显示/).count(), 1);
  await page.getByRole('button', { name: /添加 .* 个文件/ }).click();
  const selected = await page.evaluate(() => window.selected);
  assert.equal(selected.files.length, 2);
  assert.equal(selected.owner.cwd, 'C:/new');
  assert.equal(selected.owner.sessionId, 'new');
});
test('sheet cells remain readonly with empty uncached formula and no save IPC', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.show('office', { path: 'C:/book.xlsx' }));
  await page.waitForFunction(() => window.pending.length === 1);
  await page.evaluate(() =>
    window.pending[0].resolve({
      ok: true,
      data: {
        kind: 'sheet',
        readOnly: true,
        notices: ['sheet-limitations'],
        sheets: [
          {
            name: 'Sheet1',
            startRow: 0,
            startCol: 0,
            endRow: 0,
            endCol: 1,
            cells: [
              {
                address: 'A1',
                row: 0,
                col: 0,
                text: '',
                formula: 'SUM(1,2)',
                uncached: true,
                style: {},
              },
            ],
            merges: [],
            columns: [96, 96],
            rows: [24],
          },
        ],
      },
    }),
  );
  await page.locator('td[data-address="A1"]').waitFor();
  assert.equal(await page.locator('td[data-address="A1"]').innerText(), '');
  assert.match(await page.locator('td[data-address="A1"]').getAttribute('title'), /SUM\(1,2\)/);
  assert.equal(await page.locator('[contenteditable=true],textarea,input').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.calls.map((c) => c.command)), [
    'office.preview',
  ]);
});
test('separator keyboard sizing constrains values and commits user changes', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() =>
    window.show('resize', { axis: 'horizontal', value: 240, min: 200, max: 260 }),
  );
  const handle = page.getByRole('separator');
  await handle.focus();
  await handle.press('ArrowRight');
  assert.equal(await page.evaluate(() => window.changed), 250);
  assert.equal(await page.evaluate(() => window.committed), 250);
  await handle.press('End');
  assert.equal(await page.evaluate(() => window.changed), 260);
});

test('separator pointer sizing commits the constrained final drag value', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() =>
    window.show('resize', { axis: 'horizontal', value: 240, min: 200, max: 260 }),
  );
  await page
    .locator('.resize-handle')
    .evaluate((handle) => Object.assign(handle.style, { width: '10px', height: '100px' }));
  const handle = page.getByRole('separator'),
    box = await handle.boundingBox();
  await page.mouse.move(box.x + 5, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 10);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.changed), 260);
  assert.equal(await page.evaluate(() => window.committed), 260);
});

test('picker clears selections when a different session uses the same project', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.show('picker', { cwd: 'C:/same', sessionId: 'first' }));
  await page.waitForFunction(() => window.pending.length === 1);
  await page.evaluate(() =>
    window.pending[0].resolve({
      ok: true,
      data: { files: [{ name: 'a.txt', path: 'C:/same/a.txt' }], truncated: false },
    }),
  );
  await page.getByRole('checkbox', { name: 'a.txt' }).check();
  await page.evaluate(() => window.show('picker', { cwd: 'C:/same', sessionId: 'second' }));
  await page.waitForFunction(() => window.pending.length === 2);
  await page.evaluate(() =>
    window.pending[1].resolve({
      ok: true,
      data: { files: [{ name: 'a.txt', path: 'C:/same/a.txt' }], truncated: false },
    }),
  );
  await page.getByRole('checkbox', { name: 'a.txt' }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: 'a.txt' }).isChecked(), false);
  assert.equal(await page.getByRole('button', { name: '添加 0 个文件' }).isDisabled(), true);
});

test('DOCX renders paragraphs tables and images in an isolated readonly document', async (t) => {
  const page = await fixture(t);
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>Paragraph preview</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="image1"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="image1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
  );
  zip.file(
    'word/media/image1.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh2sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const { buildOfficePreview } = require('../electron/office-preview-model.cjs');
  const model = await buildOfficePreview(await zip.generateAsync({ type: 'nodebuffer' }), '.docx');
  await page.evaluate(() => window.show('office', { path: 'C:/preview.docx' }));
  await page.waitForFunction(() => window.pending.length === 1);
  await page.evaluate((model) => window.pending[0].resolve({ ok: true, data: model }), model);
  const frame = page.frameLocator('.office-docx-frame');
  await frame.getByText('Paragraph preview', { exact: true }).waitFor();
  assert.equal(await frame.locator('table td').innerText(), 'Table cell');
  await frame.locator('img').waitFor();
  assert.equal(await frame.locator('script,[contenteditable=true],input,textarea').count(), 0);
  assert.equal(await page.locator('#root table').count(), 0);
  assert.equal(await frame.locator('meta[http-equiv="Content-Security-Policy"]').count(), 1);
  assert.equal(
    await page.locator('.office-docx-frame').getAttribute('sandbox'),
    'allow-same-origin',
  );
});

test('PPTX placeholder fallback remains visible instead of an empty slide canvas', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.show('office', { path: 'C:/placeholder.pptx' }));
  await page.waitForFunction(() => window.pending.length === 1);
  await page.evaluate(() =>
    window.pending[0].resolve({
      ok: true,
      data: {
        kind: 'pptx',
        readOnly: true,
        notices: ['pptx-unpositioned-text'],
        width: 9144000,
        height: 5143500,
        slides: [{ shapes: [], unpositionedText: 'Title retained\nBody retained' }],
      },
    }),
  );
  await page.getByText('Title retained\nBody retained', { exact: true }).waitFor();
  assert.equal(await page.locator('.office-slide').count(), 0);
  assert.equal(
    await page
      .getByText('部分文字使用母版或布局坐标，现显示为文字预览。请用默认程序查看原始位置。', {
        exact: true,
      })
      .count(),
    1,
  );
});
