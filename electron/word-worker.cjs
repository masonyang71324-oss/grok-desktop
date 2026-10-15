'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const WordExtractor = require('word-extractor');
const fs = require('node:fs/promises');

(async () => {
  const { filename, maxTextBytes = 1024 * 1024 } = workerData;
  const source =
    filename ||
    Buffer.from(workerData.bytes.buffer, workerData.bytes.byteOffset, workerData.bytes.byteLength);
  let prefix;
  if (filename) {
    const handle = await fs.open(filename, 'r');
    try {
      if (!(await handle.stat()).isFile()) throw new Error('Not a file');
      prefix = Buffer.alloc(2);
      if ((await handle.read(prefix, 0, 2, 0)).bytesRead < 2) throw new Error('Empty document');
    } finally {
      await handle.close();
    }
  } else prefix = source;
  const document =
    prefix.readUInt16BE(0) === 0x504b
      ? await require('./docx.cjs')(source, { maxTextBytes })
      : await new WordExtractor().extract(source);
  const options = { filterUnicode: false };
  const sections = [
    ['正文', document.getBody(options)],
    ['文本框', document.getTextboxes(options)],
    ['页眉', document.getHeaders({ ...options, includeFooters: false })],
    ['页脚', document.getFooters(options)],
    ['脚注', document.getFootnotes(options)],
    ['尾注', document.getEndnotes(options)],
    ['批注', document.getAnnotations(options)],
  ].filter(([, text]) => text.trim());
  if (!sections.length) return parentPort.postMessage({ error: 'empty' });
  if (sections.reduce((size, [, text]) => size + Buffer.byteLength(text), 0) > maxTextBytes)
    return parentPort.postMessage({ error: 'text-limit' });
  parentPort.postMessage({ sections });
})().catch((error) =>
  parentPort.postMessage({ error: error.code === 'text-limit' ? 'text-limit' : 'parse-failed' }),
);
