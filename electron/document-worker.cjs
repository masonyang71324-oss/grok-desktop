'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs/promises');
(async () => {
  const {
    kind,
    extension,
    filename,
    maxTextBytes = 1024 * 1024,
    maxInputBytes = 128 * 1024 * 1024,
  } = workerData;
  let bytes;
  if (filename) {
    const handle = await fs.open(filename, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('Not a file');
      if (stat.size > maxInputBytes) return parentPort.postMessage({ error: 'input-limit' });
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
  } else
    bytes = Buffer.from(
      workerData.bytes.buffer,
      workerData.bytes.byteOffset,
      workerData.bytes.byteLength,
    );
  if (bytes.length > maxInputBytes) return parentPort.postMessage({ error: 'input-limit' });
  const readers = {
    sheets: './document-sheets.cjs',
    rich: './document-rich.cjs',
    structured: './document-structured.cjs',
    ppt: './document-ppt.cjs',
  };
  if (!readers[kind]) throw Object.assign(new Error('Unknown document'), { code: 'unsupported' });
  const text = await require(readers[kind])(bytes, extension, { maxTextBytes });
  if (typeof text !== 'string' || !text.trim()) return parentPort.postMessage({ error: 'empty' });
  if (Buffer.byteLength(text) > maxTextBytes)
    return parentPort.postMessage({ error: 'text-limit' });
  parentPort.postMessage({ text });
})().catch((error) => parentPort.postMessage({ error: error.code || 'parse-failed' }));
