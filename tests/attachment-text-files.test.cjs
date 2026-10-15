'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const iconv = require('iconv-lite');
const {
  readPrefix,
  savePreparedText,
  prepareLargeText,
  textReference,
} = require('../electron/attachment-text-files.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-text-files-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, outputDirectory: path.join(directory, 'prepared') };
}

test('prefix reads return only the requested bytes and close their handle on abort', async (t) => {
  const { directory } = await fixture(t);
  const filename = path.join(directory, 'text.txt');
  await fs.writeFile(filename, 'abcdef');
  assert.deepEqual(await readPrefix(filename, 3), Buffer.from('abc'));
  assert.deepEqual(await readPrefix(filename, 20), Buffer.from('abcdef'));
  assert.deepEqual(await readPrefix(filename, 0), Buffer.alloc(0));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readPrefix(filename, 3, controller.signal), { name: 'AbortError' });
  await fs.rename(filename, `${filename}.moved`);
});

test('valid large UTF-8 stays at its original path without an output directory', async (t) => {
  const { directory } = await fixture(t);
  const filename = path.join(directory, '文本.txt');
  const text = `${'a'.repeat(65535)}🙂中文\r\n${'b'.repeat(1024 * 1024)}结尾`;
  await fs.writeFile(filename, text);
  assert.equal(await prepareLargeText(filename, '文本.txt'), filename);
  assert.equal(await fs.readFile(filename, 'utf8'), text);
  assert.deepEqual(await fs.readdir(directory), ['文本.txt']);
});

test('GB18030 after a megabyte of ASCII is converted completely without losing trailing Chinese', async (t) => {
  const { directory, outputDirectory } = await fixture(t);
  const filename = path.join(directory, '中文 GB.txt');
  const text = `${'a'.repeat(1024 * 1024 + 65535)}中文末尾𠀀\r\n结束`;
  const bytes = iconv.encode(text, 'gb18030');
  await fs.writeFile(filename, bytes);
  let referenced;
  const result = await prepareLargeText(filename, '../../中文 GB.txt', {
    outputDirectory,
    onReference: async (value) => {
      referenced = value;
      await assert.rejects(fs.stat(value), { code: 'ENOENT' });
    },
  });
  assert.equal(result, referenced);
  assert.equal(path.dirname(result), outputDirectory);
  assert.match(path.basename(result), /^Extracted-[a-f0-9-]+\.txt$/);
  assert.equal(await fs.readFile(result, 'utf8'), text);
  assert.deepEqual(await fs.readFile(filename), bytes);
});

for (const encoding of ['utf16-le', 'utf16-be']) {
  test(`${encoding} with BOM converts to complete UTF-8 text across chunk boundaries`, async (t) => {
    const { directory, outputDirectory } = await fixture(t);
    const filename = path.join(directory, `${encoding}.txt`);
    const text = `${'中'.repeat(32766)}🙂尾部\r\n${'文'.repeat(66000)}`;
    await fs.writeFile(filename, iconv.encode(text, encoding, { addBOM: true }));
    const result = await prepareLargeText(filename, 'unicode.txt', { outputDirectory });
    assert.equal(await fs.readFile(result, 'utf8'), text);
  });
}

test('generated text writes intact Unicode, protects the target before writing and never uses the source name as a path', async (t) => {
  const { directory, outputDirectory } = await fixture(t);
  const source = path.join(directory, 'keep.txt');
  await fs.writeFile(source, 'original');
  const text = `${'a'.repeat(65535)}🙂${'中'.repeat(65535)}🙂tail`;
  let referenced;
  const result = await savePreparedText(text, source, {
    outputDirectory,
    onReference: (value) => {
      referenced = value;
    },
  });
  assert.equal(result, referenced);
  assert.equal(path.dirname(result), outputDirectory);
  assert.notEqual(result, source);
  assert.equal(await fs.readFile(result, 'utf8'), text);
  assert.equal(await fs.readFile(source, 'utf8'), 'original');
});

test('conversion and generated text require an explicit output directory', async (t) => {
  const { directory } = await fixture(t);
  const filename = path.join(directory, 'legacy.txt');
  await fs.writeFile(filename, iconv.encode('中文', 'gb18030'));
  await assert.rejects(savePreparedText('text', 'file.txt'), {
    code: 'ATTACHMENT_OUTPUT_DIRECTORY_REQUIRED',
  });
  await assert.rejects(prepareLargeText(filename, 'file.txt'), {
    code: 'ATTACHMENT_OUTPUT_DIRECTORY_REQUIRED',
  });
});

for (const bytes of [
  Buffer.from([77, 90, 0, 1]),
  Buffer.from([0x81]),
  Buffer.from([0xff, 0xfe, 65]),
  Buffer.from([0xff, 0xfe, 0, 0]),
]) {
  test(`binary or incomplete encoded data is rejected without a partial output: ${bytes.toString('hex')}`, async (t) => {
    const { directory, outputDirectory } = await fixture(t);
    const filename = path.join(directory, 'bad.txt');
    await fs.writeFile(filename, bytes);
    await assert.rejects(prepareLargeText(filename, 'bad.txt', { outputDirectory }), {
      code: 'ATTACHMENT_UNSUPPORTED_TEXT',
    });
    assert.deepEqual(
      await fs
        .readdir(outputDirectory)
        .catch((error) => (error.code === 'ENOENT' ? [] : Promise.reject(error))),
      [],
    );
    assert.deepEqual(await fs.readFile(filename), bytes);
  });
}

test('abort before preparing creates no output and preserves the original', async (t) => {
  const { directory, outputDirectory } = await fixture(t);
  const filename = path.join(directory, 'text.txt');
  await fs.writeFile(filename, 'original');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    prepareLargeText(filename, 'text.txt', { outputDirectory, signal: controller.signal }),
    { name: 'AbortError' },
  );
  await assert.rejects(
    savePreparedText('text', 'text.txt', { outputDirectory, signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.deepEqual(await fs.readdir(directory), ['text.txt']);
});

for (const mode of ['save', 'convert']) {
  test(`abort during ${mode} removes only its generated partial file`, async (t) => {
    const { directory, outputDirectory } = await fixture(t);
    await fs.mkdir(outputDirectory);
    const keep = path.join(outputDirectory, 'keep.txt');
    await fs.writeFile(keep, 'keep');
    const filename = path.join(directory, 'legacy.txt');
    const text = '中'.repeat(4 * 1024 * 1024);
    if (mode === 'convert')
      await fs.writeFile(filename, iconv.encode(text, 'utf16-le', { addBOM: true }));
    const controller = new AbortController();
    let abortWatch;
    const options = {
      outputDirectory,
      signal: controller.signal,
      onReference: (target) => {
        abortWatch = (async () => {
          while (!controller.signal.aborted) {
            const stat = await fs.stat(target).catch(() => null);
            if (stat?.size) {
              controller.abort();
              break;
            }
            await new Promise((resolve) => setImmediate(resolve));
          }
        })();
      },
    };
    const operation =
      mode === 'save'
        ? savePreparedText(text, 'large.txt', options)
        : prepareLargeText(filename, 'legacy.txt', options);
    await assert.rejects(operation, { name: 'AbortError' });
    await abortWatch;
    assert.deepEqual(await fs.readdir(outputDirectory), ['keep.txt']);
    assert.equal(await fs.readFile(keep, 'utf8'), 'keep');
  });
}

test('text references quote exact paths and request continuation without editing the file', () => {
  const filename = 'C:\\项目\\say "hello".txt';
  const prompt = textReference(filename, '说明.txt');
  assert.ok(prompt.includes(JSON.stringify(filename)));
  assert.match(prompt, /read_file/);
  assert.match(prompt, /offset\/limit/);
  assert.match(prompt, /end of the file/);
  assert.match(prompt, /Do not modify/);
});
