const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { preparePrompt, previewAttachment } = require('../electron/attachments.cjs');
const { extractWord } = require('../electron/word.cjs');

for (const ext of ['doc', 'docx']) {
  test(`${ext} attachment sends readable body, headers and footers without changing the original`, async () => {
    const file = path.join(__dirname, 'fixtures/word', `sample.${ext}`);
    const original = await fs.readFile(file);
    const prompt = await preparePrompt('Summarize', [{ name: `sample.${ext}`, path: file }], {
      embeddedContext: true,
    });
    assert.equal(prompt[0].text, 'Summarize');
    assert.equal(prompt[1].type, 'text');
    assert.match(prompt[1].text, /Header test file/);
    assert.match(prompt[1].text, /Section 1 – odd page header/);
    assert.match(prompt[1].text, /Section 3 – first page footer/);
    const preview = await previewAttachment({ path: file });
    assert.equal(preview.text, prompt[1].text);
    assert.match(preview.notice, /文字|text/i);
    assert.deepEqual(await fs.readFile(file), original);
  });
}

test('a Word-only request works without ACP embedded context support', async () => {
  const file = path.join(__dirname, 'fixtures/word/sample.doc');
  const prompt = await preparePrompt('', [{ name: 'sample.doc', path: file }], {
    embeddedContext: false,
  });
  assert.match(prompt[0].text, /Some random text/);
});

test('damaged and oversized Word attachments fail explicitly and keep the supplied draft', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'word attachments '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'broken.doc');
  await fs.writeFile(file, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0]));
  const attachments = [{ name: 'broken.doc', path: file }];
  await assert.rejects(
    preparePrompt('Keep this draft', attachments, { embeddedContext: true }),
    /无法读取 Word|Could not read Word/,
  );
  assert.equal(attachments[0].path, file);
  await fs.writeFile(file, Buffer.alloc(10 * 1024 * 1024 + 1));
  await assert.rejects(preparePrompt('', attachments, { embeddedContext: true }), /10 MB/);
});

test('Chinese punctuation and table values survive extraction', async () => {
  const { text } = await previewAttachment({
    path: path.join(__dirname, 'fixtures/word/chinese.docx'),
  });
  assert.match(text, /巡检维护报价：“按月结算”/);
  assert.match(text, /维护费[\s\S]*12800 元/);
});

test('empty documents and excessive extracted text fail instead of silently sending partial content', async () => {
  await assert.rejects(
    previewAttachment({ path: path.join(__dirname, 'fixtures/word/empty.docx') }),
    /没有可提取|No extractable/,
  );
  await assert.rejects(
    previewAttachment({ path: path.join(__dirname, 'fixtures/word/oversized-text.docx') }),
    /1 MB/,
  );
  const file = path.join(__dirname, 'fixtures/word/large-text.docx');
  await assert.rejects(
    preparePrompt(
      '',
      Array.from({ length: 8 }, () => ({ name: 'large.docx', path: file })),
    ),
    /4 MB/,
  );
});

test('a timed-out Word worker is stopped and the next document can still be read', async () => {
  const bytes = await fs.readFile(path.join(__dirname, 'fixtures/word/sample.doc'));
  await assert.rejects(extractWord(bytes, { timeoutMs: 1 }), /超时|timed out/);
  assert.ok((await extractWord(bytes)).some(([, text]) => text.includes('Header test file')));
});

test('long Chinese DOCX text decodes across XML byte chunks without corruption', async () => {
  const sections = await extractWord(
    await fs.readFile(path.join(__dirname, 'fixtures/word/long-chinese.docx')),
  );
  assert.equal(sections.find(([label]) => label === '正文')[1].trim(), '中文报价维护'.repeat(2000));
});

test('DrawingML textboxes are retained exactly once with or without a VML fallback', async () => {
  for (const file of ['drawing-textbox.docx', 'alternate-textbox.docx']) {
    const sections = await extractWord(
      await fs.readFile(path.join(__dirname, 'fixtures/word', file)),
    );
    const text = sections.map(([, value]) => value).join('\n');
    assert.equal(text.split('文本框金额12800元').length - 1, 1, file);
  }
});
