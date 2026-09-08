'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const WordExtractor = require('word-extractor');

(async () => {
  const bytes = Buffer.from(workerData.bytes);
  const document =
    bytes.readUInt16BE(0) === 0x504b
      ? await require('./docx.cjs')(bytes)
      : await new WordExtractor().extract(bytes);
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
  if (sections.reduce((size, [, text]) => size + Buffer.byteLength(text), 0) > 1024 * 1024)
    return parentPort.postMessage({ error: 'text-limit' });
  parentPort.postMessage({ sections });
})().catch(() => parentPort.postMessage({ error: 'parse-failed' }));
