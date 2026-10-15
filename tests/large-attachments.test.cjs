const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const iconv = require('iconv-lite');
const { preparePrompt, previewAttachment } = require('../electron/attachments.cjs');
const MB = 1024 * 1024;
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-large-attachments-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const outputDirectory = path.join(directory, 'managed');
  await fs.mkdir(outputDirectory);
  return { directory, outputDirectory };
}
async function sparse(directory, name, header, bytes) {
  const filename = path.join(directory, name);
  const handle = await fs.open(filename, 'w');
  try {
    await handle.write(header);
    await handle.truncate(bytes);
  } finally {
    await handle.close();
  }
  return { name, path: filename };
}
test('large native inputs and native totals use bounded header reads and exact local paths', async (t) => {
  const { directory } = await fixture(t);
  const files = [
    await sparse(directory, 'large.pdf', Buffer.from('%PDF-1.7\n'), 80 * MB),
    await sparse(directory, 'large.pptx', Buffer.from('PK\x03\x04'), 24 * MB),
    await sparse(directory, 'large.ipynb', Buffer.from('{"nbformat":4,"cells":['), 12 * MB),
  ];
  const originalRead = fs.readFile;
  t.mock.method(fs, 'readFile', (...args) => {
    assert.ok(
      !files.some((file) => file.path === args[0]),
      'must not read a native document in full',
    );
    return originalRead(...args);
  });
  const content = await preparePrompt('read all', files, {});
  assert.equal(content.length, 4);
  for (const file of files)
    assert.ok(content.some((block) => block.text?.includes(JSON.stringify(file.path))));
  assert.ok(JSON.stringify(content).length < 6000);
  assert.equal((await previewAttachment({ path: files[1].path })).native, true);
});
test('large images automatically use local reading even when inline images are negotiated', async (t) => {
  const { directory } = await fixture(t);
  const file = await sparse(
    directory,
    'large.png',
    Buffer.from('89504e470d0a1a0a', 'hex'),
    24 * MB,
  );
  for (const image of [false, true]) {
    const content = await preparePrompt('', [file], { image });
    assert.equal(content[0].type, 'text');
    assert.ok(content[0].text.includes(JSON.stringify(file.path)));
  }
});
test('large selected text is kept completely in a managed reference before it can be cleaned', async (t) => {
  const { outputDirectory } = await fixture(t);
  const text = '大型文档内容\n'.repeat(100000) + 'FINAL_SENTINEL';
  const references = [];
  const content = await preparePrompt(
    '',
    [{ name: 'selection', text }],
    {},
    {
      outputDirectory,
      onReference: (filename) => references.push(filename),
    },
  );
  assert.equal(references.length, 1);
  assert.equal(path.dirname(references[0]), outputDirectory);
  assert.equal(await fs.readFile(references[0], 'utf8'), text);
  assert.ok(content[0].text.includes(JSON.stringify(references[0])));
  assert.ok(JSON.stringify(content).length < 2000);
});
test('large UTF-8 files remain local paths and preview is an explicit bounded excerpt', async (t) => {
  const { directory, outputDirectory } = await fixture(t);
  const filename = path.join(directory, 'long.txt');
  const text = 'text\n'.repeat(250000) + 'FINAL_SENTINEL';
  await fs.writeFile(filename, text);
  const content = await preparePrompt(
    '',
    [{ path: filename, name: 'long.txt' }],
    {},
    { outputDirectory },
  );
  assert.ok(content[0].text.includes(JSON.stringify(filename)));
  const preview = await previewAttachment({ path: filename });
  assert.equal(preview.truncated, true);
  assert.ok(preview.text.length <= 65536);
  assert.equal((await fs.readdir(outputDirectory)).length, 0);
});
test('large legacy Chinese text is converted completely without losing its final lines', async (t) => {
  const { directory, outputDirectory } = await fixture(t);
  const filename = path.join(directory, 'legacy.txt');
  const text = 'ASCII row\n'.repeat(120000) + '最后一行：维护费用壹万元';
  await fs.writeFile(filename, iconv.encode(text, 'gb18030'));
  const references = [];
  const content = await preparePrompt(
    '',
    [{ path: filename }],
    {},
    { outputDirectory, onReference: (file) => references.push(file) },
  );
  assert.equal(references.length, 1);
  assert.equal(await fs.readFile(references[0], 'utf8'), text);
  assert.ok(content[0].text.includes(JSON.stringify(references[0])));
});
test('cancelled attachment preparation creates no managed file and sends no partial content', async (t) => {
  const { outputDirectory } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    preparePrompt(
      '',
      [{ text: 'large'.repeat(MB) }],
      {},
      { outputDirectory, signal: controller.signal },
    ),
    { name: 'AbortError' },
  );
  assert.deepEqual(await fs.readdir(outputDirectory), []);
});

test('large Word extraction is sent as complete managed text rather than a truncated preview', async (t) => {
  const { directory, outputDirectory } = await fixture(t);
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(
    await fs.readFile(path.join(__dirname, 'fixtures/word/chinese.docx')),
  );
  const source = await zip.file('word/document.xml').async('string');
  zip.file(
    'word/document.xml',
    source.replace(
      '</w:body>',
      `<w:p><w:r><w:t>${'长文正文'.repeat(100000)}文档尾部完整标记</w:t></w:r></w:p></w:body>`,
    ),
  );
  const filename = path.join(directory, 'long-content.docx');
  await fs.writeFile(
    filename,
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );
  const references = [];
  const content = await preparePrompt(
    'read',
    [{ path: filename, name: 'long-content.docx' }],
    {},
    { outputDirectory, onReference: (p) => references.push(p) },
  );
  assert.equal(references.length, 1);
  const complete = await fs.readFile(references[0], 'utf8');
  assert.ok(Buffer.byteLength(complete) > MB);
  assert.ok(complete.includes('文档尾部完整标记'));
  assert.ok(JSON.stringify(content).length < 2000);
  const preview = await previewAttachment({ path: filename });
  assert.equal(preview.truncated, true);
  assert.ok(!preview.text.includes('文档尾部完整标记'));
  assert.equal(
    (await fs.readdir(outputDirectory)).length,
    1,
    'preview must not create send-side files',
  );
});
