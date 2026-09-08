'use strict';
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { kind, extension } = workerData;
  const bytes = Buffer.from(workerData.bytes);
  const readers = {
    sheets: './document-sheets.cjs',
    rich: './document-rich.cjs',
    structured: './document-structured.cjs',
    ppt: './document-ppt.cjs',
  };
  if (!readers[kind]) throw Object.assign(new Error('Unknown document'), { code: 'unsupported' });
  const text = await require(readers[kind])(bytes, extension);
  if (typeof text !== 'string' || !text.trim()) return parentPort.postMessage({ error: 'empty' });
  if (Buffer.byteLength(text) > 1024 * 1024) return parentPort.postMessage({ error: 'text-limit' });
  parentPort.postMessage({ text });
})().catch((error) => parentPort.postMessage({ error: error.code || 'parse-failed' }));
