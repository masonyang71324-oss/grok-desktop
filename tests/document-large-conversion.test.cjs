const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const JSZip = require('jszip');
const { extractWord, wordText } = require('../electron/word.cjs');
const { extractDocument, documentText } = require('../electron/document.cjs');

const MB = 1024 * 1024;
async function directory(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grok large documents '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function docx(filename, body, picture = false) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="bmp" ContentType="image/bmp"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  const drawing = picture
    ? '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1900000" cy="1900000"/><wp:docPr id="1" name="Test image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="large.bmp"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1900000" cy="1900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
    : '';
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p>${drawing}</w:body></w:document>`,
  );
  if (picture) {
    // An actual uncompressed 1900 x 1900, 24-bit BMP (~10.3 MiB), not ZIP padding.
    const bmp = Buffer.alloc(54 + 1900 * 1900 * 3, 255);
    bmp.fill(0, 0, 54);
    bmp.write('BM');
    bmp.writeUInt32LE(bmp.length, 2);
    bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(1900, 18);
    bmp.writeInt32LE(1900, 22);
    bmp.writeUInt16LE(1, 26);
    bmp.writeUInt16LE(24, 28);
    zip.file('word/media/large.bmp', bmp);
    zip.file(
      'word/_rels/document.xml.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/large.bmp"/></Relationships>',
    );
  }
  await fs.writeFile(
    filename,
    await zip.generateAsync({ type: 'nodebuffer', compression: picture ? 'STORE' : 'DEFLATE' }),
  );
}

test('DOCX paths read text from a valid image-heavy document larger than 10 MiB', async (t) => {
  const file = path.join(await directory(t), '大图 合同.docx');
  await docx(file, '合同金额12800。尾部标记-END', true);
  assert.ok((await fs.stat(file)).size > 10 * MB);
  const text = await wordText(file, '大图合同');
  assert.match(text, /合同金额12800。尾部标记-END/);
});

test('large Word text is complete with an explicit budget while the preview default stays bounded', async (t) => {
  const file = path.join(await directory(t), '长文档.docx');
  const body = '完整正文'.repeat(100000) + '末尾哨兵-END';
  await docx(file, body);
  await assert.rejects(extractWord(file), { code: 'DOCUMENT_TEXT_LIMIT' });
  const sections = await extractWord(file, { maxTextBytes: 32 * MB });
  assert.equal(sections.find(([label]) => label === '正文')[1].trim(), body);
  assert.match(await wordText(file, '长文档', { maxTextBytes: 32 * MB }), /末尾哨兵-END\s*$/);
});

test('generic document paths preserve complete text beyond 1 MiB and report converter input budgets', async (t) => {
  const file = path.join(await directory(t), '大表.csv');
  const source =
    '编号,内容\n' +
    Array.from({ length: 24000 }, (_, i) => `${i},完整内容-1234567890`).join('\n') +
    '\n24000,尾部哨兵-END';
  await fs.writeFile(file, source);
  const text = await documentText(file, '.csv', '大表', { maxTextBytes: 32 * MB });
  assert.ok(Buffer.byteLength(text) > MB);
  assert.match(text, /A24002: 24000\nB24002: 尾部哨兵-END\s*$/);
  await assert.rejects(extractDocument(file, '.csv', { maxInputBytes: 32 }), {
    code: 'DOCUMENT_INPUT_LIMIT',
  });
  await assert.rejects(extractDocument(file, '.csv'), { code: 'DOCUMENT_TEXT_LIMIT' });
});

test('all parser families honor an explicit text budget without silently truncating', async () => {
  const payload = '完整内容'.repeat(100000) + '尾部哨兵-END';
  const samples = [
    ['.html', `<html><body><p>${payload}</p></body></html>`],
    [
      '.fodt',
      `<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>${payload}</text:p></office:text></office:body></office:document>`,
    ],
  ];
  for (const [ext, source] of samples) {
    await assert.rejects(extractDocument(Buffer.from(source), ext), {
      code: 'DOCUMENT_TEXT_LIMIT',
    });
    assert.equal(
      await extractDocument(Buffer.from(source), ext, { maxTextBytes: 32 * MB }),
      payload,
    );
  }
  const slides = new JSZip();
  slides.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
  );
  slides.file(
    'ppt/presentation.xml',
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
  );
  slides.file(
    'ppt/_rels/presentation.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
  );
  slides.file(
    'ppt/slides/slide1.xml',
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${payload}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  );
  const bytes = await slides.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(extractDocument(bytes, '.pptm'), { code: 'DOCUMENT_TEXT_LIMIT' });
  assert.match(
    await extractDocument(bytes, '.pptm', { maxTextBytes: 32 * MB }),
    /尾部哨兵-END\s*$/,
  );
});

test('XLSX paths larger than 10 MiB keep first and last cells with a 32 MiB conversion budget', async (t) => {
  const file = path.join(await directory(t), '大工作簿.xlsx');
  const XLSX = require('xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['开始编号', '开始内容']]),
    '数据',
  );
  const zip = await JSZip.loadAsync(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  const repeated = '完整单元格'.repeat(14);
  const rows = Array.from(
    { length: 40000 },
    (_, index) =>
      `<row r="${index + 1}"><c r="A${index + 1}" t="inlineStr"><is><t>${index === 39999 ? '尾部哨兵-END' : repeated}</t></is></c></row>`,
  ).join('');
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A40000"/><sheetData>${rows}</sheetData></worksheet>`,
  );
  await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
  assert.ok((await fs.stat(file)).size > 10 * MB);
  const text = await extractDocument(file, '.xlsx', { maxTextBytes: 32 * MB });
  assert.ok(text.startsWith('[Sheet: 数据]\nA1: 完整单元格'));
  assert.match(text, /A40000: 尾部哨兵-END\s*$/);
});

test('path converters cancel and time out cleanly, then accept a fresh extraction', async (t) => {
  const dir = await directory(t);
  const csv = path.join(dir, '表格.csv');
  await fs.writeFile(csv, '编号,金额\n00001,12800');
  const word = path.join(dir, '正文.docx');
  await docx(word, '恢复后可以读取');
  for (const run of [
    (options) => extractWord(word, options),
    (options) => extractDocument(csv, '.csv', options),
  ]) {
    const before = new AbortController();
    before.abort();
    await assert.rejects(run({ signal: before.signal }), { name: 'AbortError', code: 'ABORT_ERR' });
    const during = new AbortController();
    const pending = run({ signal: during.signal });
    during.abort();
    await assert.rejects(pending, { name: 'AbortError', code: 'ABORT_ERR' });
    await assert.rejects(run({ timeoutMs: 1 }), { code: 'DOCUMENT_TIMEOUT' });
    assert.ok(await run({}));
  }
});

test('local XML structural limits are reported separately from the output text budget', async () => {
  const xml = `<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0">${'<nested>'.repeat(130)}small text${'</nested>'.repeat(130)}</office:document>`;
  await assert.rejects(extractDocument(Buffer.from(xml), '.fodt', { maxTextBytes: 32 * MB }), {
    code: 'DOCUMENT_RESOURCE_LIMIT',
  });
});
