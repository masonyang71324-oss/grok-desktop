const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { GrokClient } = require('../electron/acp.cjs');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);

async function fixture(t, capabilities) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-attachments-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const client = new GrokClient({ getExecutable: () => '', emit: () => {} });
  client.capabilities = { promptCapabilities: capabilities };
  return { directory, client };
}

test('selected code sends literal text without reading an empty attachment path', async (t) => {
  const { client } = await fixture(t, { embeddedContext: true });
  const content = await client._promptContent('Explain', [
    { name: 'app.ts:2-3', path: '', kind: 'text', text: 'const text = "你好";\r\n' },
  ]);
  assert.equal(content[1].type, 'text');
  assert.match(content[1].text, /app\.ts:2-3/);
  assert.ok(content[1].text.endsWith('const text = "你好";\r\n'));
});

test('image-only prompt carries actual image bytes when negotiated image capability is available', async (t) => {
  const { directory, client } = await fixture(t, { image: true, embeddedContext: false });
  const filename = path.join(directory, 'screenshot.png');
  await fs.writeFile(filename, png);
  const content = await client._promptContent('', [{ name: 'screenshot.png', path: filename }]);
  assert.deepEqual(content, [
    { type: 'image', mimeType: 'image/png', data: png.toString('base64') },
  ]);
});

test('without native image input the prompt asks Grok to read each exact local image path', async (t) => {
  const { directory, client } = await fixture(t, { image: false, embeddedContext: false });
  const filename = path.join(directory, '截图 one.png');
  await fs.writeFile(filename, png);
  const second = path.join(directory, 'second.png');
  await fs.writeFile(second, png);
  const attachments = [
    { name: 'screenshot.png', path: filename },
    { name: 'second.png', path: second },
  ];
  const content = await client._promptContent('Compare screenshots', attachments);
  assert.equal(content[0].text, 'Compare screenshots');
  assert.equal(content.length, 3);
  for (const [index, file] of [filename, second].entries()) {
    assert.equal(content[index + 1].type, 'text');
    assert.match(content[index + 1].text, /read_file/);
    assert.ok(content[index + 1].text.includes(JSON.stringify(file)));
    assert.ok(!content[index + 1].text.includes(png.toString('base64')));
  }
  assert.equal(attachments.length, 2);
  assert.deepEqual(await fs.readFile(filename), png);
});

test('image-only fallback works and refuses a deleted or fake image before submitting', async (t) => {
  const { directory, client } = await fixture(t, { image: false });
  const filename = path.join(directory, 'image.png');
  const attachments = [{ name: 'image.png', path: filename }];
  await fs.writeFile(filename, png);
  assert.match((await client._promptContent('', attachments))[0].text, /read_file/);
  await fs.writeFile(filename, 'not a PNG');
  await assert.rejects(client._promptContent('', attachments), /图片格式|image format/i);
  await fs.unlink(filename);
  await assert.rejects(client._promptContent('', attachments), /ENOENT/);
});

test('invalid image content and oversized selected text cannot be submitted', async (t) => {
  const { directory, client } = await fixture(t, { image: true, embeddedContext: true });
  const filename = path.join(directory, 'fake.png');
  await fs.writeFile(filename, 'this is not an image');
  await assert.rejects(
    client._promptContent('look', [{ name: 'fake.png', path: filename }]),
    /图片|image/i,
  );
  await assert.rejects(
    client._promptContent('look', [
      { name: 'selection', path: '', text: 'x'.repeat(1024 * 1024 + 1) },
    ]),
    /1 MB/,
  );
});
