const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const XLSX = require('xlsx');

test('diff keeps raw source while numbering multiple hunks and pairing changed lines', async () => {
  const { parseDiff, splitRows, wordParts, foldContext } = await import('../src/diff-model.mjs');
  const raw =
    'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -3,3 +5,3 @@\n same\n-old word\n+new word\n tail\n@@ -40 +50 @@\n-before\n+after\n\\ No newline at end of file\n';
  const model = parseDiff(raw);
  assert.equal(model.raw, raw);
  assert.deepEqual(
    model.rows.filter((r) => r.kind === 'remove').map((r) => r.before),
    [4, 40],
  );
  assert.deepEqual(
    model.rows.filter((r) => r.kind === 'add').map((r) => r.after),
    [6, 50],
  );
  const paired = splitRows(model.rows).filter((r) => r.left?.kind === 'remove');
  assert.equal(paired[0].right.text, 'new word');
  assert.deepEqual(wordParts('old word', 'new word').before, [
    { text: 'old', changed: true },
    { text: ' word', changed: false },
  ]);
  const context = parseDiff(
    '@@ -1,12 +1,12 @@\n' + Array.from({ length: 12 }, (_, i) => ` line${i}`).join('\n'),
  );
  assert.equal(foldContext(context.rows, 2).find((r) => r.kind === 'fold').count, 8);
});

test('project search excludes hidden/generated folders, finds paths and reports limited results', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-search-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  for (const folder of ['src/nested', '.private', 'node_modules', 'dist', '.git'])
    await fs.mkdir(path.join(cwd, folder), { recursive: true });
  for (const file of [
    'src/nested/readme.md',
    'src/readme.md',
    'src/other.md',
    '.private/readme.md',
    'node_modules/readme.md',
    'dist/readme.md',
    '.git/readme.md',
  ])
    await fs.writeFile(path.join(cwd, file), 'test');
  const workspace = require('../electron/workspace.cjs');
  assert.equal(typeof workspace.searchFiles, 'function');
  const found = await workspace.searchFiles({ cwd, query: 'src/readme', limit: 100 });
  assert.deepEqual(
    found.files.map((f) => f.name),
    ['src/readme.md'],
  );
  const limited = await workspace.searchFiles({ cwd, query: 'readme', limit: 1 });
  assert.equal(limited.files.length, 1);
  assert.equal(limited.truncated, true);
  assert.equal(path.isAbsolute(limited.files[0].path), true);
  const full = await workspace.searchFiles({ cwd, query: 'readme', limit: 100 });
  assert.equal(full.files.length, 2);
  assert.equal(full.truncated, false);
});

test('sheet preview preserves coordinates, merges and formats without fabricating formula cache', async () => {
  const { buildOfficePreview } = require('../electron/office-preview-model.cjs');
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['Title'], [0.5, 0]]);
  sheet.A2.z = '0%';
  sheet.B2.f = 'SUM(1,2)';
  sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  XLSX.utils.book_append_sheet(book, sheet, '预算');
  const zip = await JSZip.loadAsync(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  const xml = (await zip.file('xl/worksheets/sheet1.xml').async('string')).replace(
    /(<c r="B2"[\s\S]*?<f>[\s\S]*?<\/f>)<v>[^<]*<\/v>/,
    '$1<v/>',
  );
  zip.file('xl/worksheets/sheet1.xml', xml);
  const model = await buildOfficePreview(await zip.generateAsync({ type: 'nodebuffer' }), '.xlsx');
  assert.equal(model.readOnly, true);
  assert.equal(model.kind, 'sheet');
  assert.equal(model.sheets[0].cells.find((c) => c.address === 'A2').text, '50%');
  const formula = model.sheets[0].cells.find((c) => c.address === 'B2');
  assert.equal(formula.text, '');
  assert.equal(formula.formula, 'SUM(1,2)');
  assert.equal(formula.uncached, true);
  assert.deepEqual(model.sheets[0].merges, [{ startRow: 0, startCol: 0, endRow: 0, endCol: 1 }]);
});

test('PPTX preview preserves shape positions and embedded image data', async () => {
  const { buildOfficePreview } = require('../electron/office-preview-model.cjs');
  const zip = new JSZip();
  zip.file(
    'ppt/presentation.xml',
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="r1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>',
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
  );
  zip.file(
    'ppt/slides/slide1.xml',
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="1828800" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="2400" b="1"/><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:blipFill><a:blip r:embed="img"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic></p:spTree></p:cSld></p:sld>',
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    '<Relationships><Relationship Id="img" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
  );
  zip.file('ppt/media/image1.png', Buffer.from('89504e470d0a1a0a', 'hex'));
  const model = await buildOfficePreview(await zip.generateAsync({ type: 'nodebuffer' }), '.pptx');
  assert.equal(model.readOnly, true);
  assert.equal(model.slides.length, 1);
  assert.equal(model.slides[0].shapes[0].x, 10);
  assert.equal(model.slides[0].shapes[0].width, 20);
  assert.equal(model.slides[0].shapes[0].paragraphs[0].runs[0].text, 'Hello');
  assert.match(model.slides[0].shapes[1].src, /^data:image\/png;base64,/);
  assert.ok(model.notices.includes('pptx-limitations'));
});

test('DOCX preview removes HTML altChunks before rendering while preserving paragraph/table/image package', async () => {
  const { buildOfficePreview } = require('../electron/office-preview-model.cjs');
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p><w:tbl/><w:altChunk r:id="html"/></w:body></w:document>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<Relationships><Relationship Id="html" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="bad.html"/></Relationships>',
  );
  zip.file('word/bad.html', '<script>alert(1)</script>');
  const model = await buildOfficePreview(await zip.generateAsync({ type: 'nodebuffer' }), '.docx');
  assert.equal(model.kind, 'docx');
  assert.equal(model.readOnly, true);
  const safe = await JSZip.loadAsync(Buffer.from(model.base64, 'base64'));
  assert.doesNotMatch(await safe.file('word/document.xml').async('string'), /altChunk/);
  assert.equal(safe.file('word/bad.html'), null);
  assert.match(await safe.file('word/document.xml').async('string'), /<w:tbl\/>/);
});

test('legacy Office preview explicitly returns text with layout limitation and never writes', async () => {
  const { buildOfficePreview } = require('../electron/office-preview-model.cjs');
  const model = await buildOfficePreview(Buffer.from('legacy'), '.ppt', {
    extractText: async () => 'Legacy text',
  });
  assert.equal(model.kind, 'text');
  assert.equal(model.readOnly, true);
  assert.equal(model.text, 'Legacy text');
  assert.ok(model.notices.includes('legacy-layout'));
});

test('an unsupported layout keeps available text and labels the fallback explicitly', async () => {
  const { buildOfficePreview } = require('../electron/office-preview-model.cjs');
  const zip = new JSZip();
  zip.file('unsupported.xml', '<document/>');
  const model = await buildOfficePreview(await zip.generateAsync({ type: 'nodebuffer' }), '.docx', {
    extractText: async () => 'Readable fallback',
  });
  assert.equal(model.kind, 'text');
  assert.equal(model.text, 'Readable fallback');
  assert.ok(model.notices.includes('unsupported-layout'));
});

test('Office worker preview leaves source bytes unchanged', async (t) => {
  const { previewOffice } = require('../electron/office-preview.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-office-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'readonly.xlsx'),
    book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['immutable', 42]]), 'Sheet');
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  await fs.writeFile(filename, bytes);
  const model = await previewOffice({ path: filename });
  assert.equal(model.readOnly, true);
  assert.equal(model.kind, 'sheet');
  assert.deepEqual(await fs.readFile(filename), bytes);
});
