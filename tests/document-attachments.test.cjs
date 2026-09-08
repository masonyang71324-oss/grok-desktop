const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const iconv = require('iconv-lite');
const { preparePrompt, previewAttachment } = require('../electron/attachments.cjs');
async function file(t, name, bytes) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grok attachment formats '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, name);
  await fs.writeFile(filename, bytes);
  return { name, path: filename };
}
for (const ext of ['pdf', 'pptx', 'ipynb'])
  test(`native ${ext} uses exact path without binary embedding`, async (t) => {
    const bytes =
      ext === 'pdf'
        ? Buffer.from('%PDF-1.7\n\0fixture')
        : ext === 'pptx'
          ? Buffer.from('PK\x03\x04\0fixture')
          : Buffer.from('{"nbformat":4,"cells":[]}');
    const a = await file(t, `报价 空格.${ext}`, bytes);
    const result = await preparePrompt('', [a], { embeddedContext: false });
    assert.equal(result[0].type, 'text');
    assert.ok(result[0].text.includes(JSON.stringify(a.path)));
    assert.match(result[0].text, /read_file/);
    const preview = await previewAttachment({ path: a.path });
    assert.equal(preview.native, true);
    assert.ok(!preview.text.includes('PK\x03'));
    assert.deepEqual(await fs.readFile(a.path), bytes);
  });
for (const encoding of ['utf8', 'utf16le', 'utf16be', 'gb18030'])
  test(`Chinese ${encoding} text preserves exact content`, async (t) => {
    const text = '报价合同：“维护费”12800元\r\n第二行';
    let bytes = iconv.encode(text, encoding);
    if (encoding === 'utf16le') bytes = Buffer.concat([Buffer.from([255, 254]), bytes]);
    if (encoding === 'utf16be') bytes = Buffer.concat([Buffer.from([254, 255]), bytes]);
    const a = await file(t, '报价.txt', bytes);
    const result = await preparePrompt('', [a], { embeddedContext: true });
    assert.equal(result[0].resource.text, text);
    assert.equal((await previewAttachment({ path: a.path })).text, text);
  });
test('plain text still works when embedded resources are unavailable', async (t) => {
  const a = await file(t, '说明.txt', '中文说明');
  assert.match((await preparePrompt('', [a], {}))[0].text, /中文说明/);
});
test('native input size, invalid signature and missing files fail before send', async (t) => {
  const a = await file(t, 'large.pdf', Buffer.alloc(10 * 1024 * 1024 + 1));
  await assert.rejects(preparePrompt('', [a], {}), /10 MB/);
  await fs.writeFile(a.path, 'not a pdf');
  await assert.rejects(preparePrompt('', [a], {}), /PDF/);
  await fs.unlink(a.path);
  await assert.rejects(preparePrompt('', [a], {}), /ENOENT/);
});
test('CAJ and unknown binary give actionable failure instead of text garbage', async (t) => {
  const a = await file(t, '论文.caj', Buffer.from('CAJ\0\0\0\0'));
  await assert.rejects(preparePrompt('keep draft', [a], {}), /CAJViewer.*PDF/);
  const b = await file(t, 'unknown.bin', Buffer.from([0, 1, 2, 3]));
  await assert.rejects(preparePrompt('', [b], { embeddedContext: true }), /不支持|Unsupported/);
});
test('Word-compatible WPS/template extensions preserve the existing verified extraction', async (t) => {
  const bytes = await fs.readFile(path.join(__dirname, 'fixtures/word/chinese.docx'));
  for (const ext of ['docm', 'dotx', 'wps', 'wpt']) {
    const a = await file(t, '合同.' + ext, bytes);
    const result = await preparePrompt('', [a], {});
    assert.match(result[0].text, /12800/);
  }
});
test('Word HTML exports with UTF-8 and UTF-16 BOM preserve Chinese text', async (t) => {
  for (const encoding of ['utf8', 'utf16le', 'utf16be']) {
    const html = '<?xml version="1.0"?><html><body><p>中文报价12800</p></body></html>';
    const bytes = iconv.encode(html, encoding, { addBOM: true });
    const a = await file(t, 'export.doc', bytes);
    assert.match((await preparePrompt('', [a], {}))[0].text, /中文报价12800/);
  }
});
test('actual Word template and macro-enabled main-part types retain body text', async (t) => {
  const JSZip = require('jszip');
  const bytes = await fs.readFile(path.join(__dirname, 'fixtures/word/chinese.docx'));
  for (const [ext, type] of [
    ['dotx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml'],
    ['docm', 'application/vnd.ms-word.document.macroEnabled.main+xml'],
    ['dotm', 'application/vnd.ms-word.template.macroEnabledTemplate.main+xml'],
  ]) {
    const zip = await JSZip.loadAsync(bytes);
    const types = await zip.file('[Content_Types].xml').async('string');
    zip.file(
      '[Content_Types].xml',
      types.replace(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        type,
      ),
    );
    const a = await file(t, '合同.' + ext, await zip.generateAsync({ type: 'nodebuffer' }));
    assert.match((await preparePrompt('', [a], {}))[0].text, /维护费[\s\S]*12800/);
  }
});
test('worker timeout terminates and allows subsequent extraction', async () => {
  const { extractDocument } = require('../electron/document.cjs');
  await assert.rejects(
    extractDocument(Buffer.from('{\\rtf1 text}'), '.rtf', { timeoutMs: 1 }),
    /超时|timed out/,
  );
  assert.match(await extractDocument(Buffer.from('{\\rtf1 recovered}'), '.rtf'), /recovered/);
});
