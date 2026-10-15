'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const iconv = require('iconv-lite');

const CHUNK_BYTES = 64 * 1024;
/** @typedef {{outputDirectory?: string, onReference?: (filename: string) => unknown, signal?: AbortSignal}} PreparationOptions */

function unsupportedText() {
  return Object.assign(
    new Error('The file contains binary data or an unsupported text encoding.'),
    {
      code: 'ATTACHMENT_UNSUPPORTED_TEXT',
    },
  );
}

/** @param {string} filename @param {number} limit @param {AbortSignal} [signal] */
async function readPrefix(filename, limit, signal) {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Invalid prefix length.');
  signal?.throwIfAborted();
  const handle = await fsp.open(filename, 'r');
  try {
    const bytes = Buffer.alloc(limit);
    let offset = 0;
    while (offset < limit) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(bytes, offset, limit - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    signal?.throwIfAborted();
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

/** @param {string} filename @param {AbortSignal} [signal] */
async function isUtf8Text(filename, signal) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const source = fs.createReadStream(filename, { highWaterMark: CHUNK_BYTES, signal });
  try {
    for await (const bytes of source) {
      if (bytes.includes(0)) throw unsupportedText();
      decoder.decode(bytes, { stream: true });
    }
    decoder.decode();
    return true;
  } catch (error) {
    if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') return false;
    throw error;
  }
}

// iconv's fallback decoders replace malformed input by default. Validate every
// byte, including the final incomplete character, before accepting their output.
function validatedBytes(encoding) {
  const utf16 = encoding === 'utf16-le' || encoding === 'utf16-be';
  const decoder = new TextDecoder(
    encoding === 'utf16-le' ? 'utf-16le' : encoding === 'utf16-be' ? 'utf-16be' : encoding,
    { fatal: true },
  );
  let pending = Buffer.alloc(0);
  return new Transform({
    transform(chunk, _encoding, callback) {
      try {
        if (decoder.decode(chunk, { stream: true }).includes('\0')) throw unsupportedText();
        if (!utf16) return callback(null, chunk);
        const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        let end = bytes.length - (bytes.length % 2);
        if (end >= 2) {
          const last =
            encoding === 'utf16-le' ? bytes.readUInt16LE(end - 2) : bytes.readUInt16BE(end - 2);
          // UTF-16BE's iconv stream encodes each emitted string immediately;
          // never hand it half of a surrogate pair at a read boundary.
          if (last >= 0xd800 && last <= 0xdbff) end -= 2;
        }
        pending = Buffer.from(bytes.subarray(end));
        callback(null, bytes.subarray(0, end));
      } catch {
        callback(unsupportedText());
      }
    },
    flush(callback) {
      try {
        if (decoder.decode().includes('\0')) throw unsupportedText();
        callback(null, pending);
      } catch {
        callback(unsupportedText());
      }
    },
  });
}

/**
 * @param {PreparationOptions} options
 * @param {(handle: import('node:fs/promises').FileHandle) => Promise<void>} write
 */
async function writeGenerated(options, write) {
  const { outputDirectory, onReference, signal } = options;
  signal?.throwIfAborted();
  if (typeof outputDirectory !== 'string' || !outputDirectory.trim())
    throw Object.assign(new Error('An attachment output directory must be configured.'), {
      code: 'ATTACHMENT_OUTPUT_DIRECTORY_REQUIRED',
    });
  const directory = path.resolve(outputDirectory);
  await fsp.mkdir(directory, { recursive: true });
  const filename = path.join(directory, `Extracted-${randomUUID()}.txt`);
  signal?.throwIfAborted();
  await onReference?.(filename);
  signal?.throwIfAborted();
  const handle = await fsp.open(filename, 'wx');
  try {
    await write(handle);
    signal?.throwIfAborted();
    return filename;
  } catch (error) {
    await handle.close();
    await fsp.unlink(filename);
    throw error;
  } finally {
    await handle.close();
  }
}

function* textChunks(text) {
  // Each string contains at most 16K code units (at most 48KiB UTF-8).
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + CHUNK_BYTES / 4, text.length);
    if (end < text.length) {
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
    }
    yield text.slice(start, end);
    start = end;
  }
}

/** @param {string} text @param {string} _name @param {PreparationOptions} [options] */
async function savePreparedText(text, _name, options = {}) {
  return writeGenerated(options, async (handle) => {
    await pipeline(
      Readable.from(textChunks(text)),
      handle.createWriteStream({ highWaterMark: CHUNK_BYTES }),
      { signal: options.signal },
    );
  });
}

/** @param {string} filename @param {string} _name @param {PreparationOptions} [options] */
async function prepareLargeText(filename, _name, options = {}) {
  const prefix = await readPrefix(filename, 2, options.signal);
  const encoding =
    prefix[0] === 0xff && prefix[1] === 0xfe
      ? 'utf16-le'
      : prefix[0] === 0xfe && prefix[1] === 0xff
        ? 'utf16-be'
        : 'gb18030';
  if (encoding === 'gb18030' && (await isUtf8Text(filename, options.signal))) return filename;
  return writeGenerated(options, async (handle) => {
    await pipeline(
      fs.createReadStream(filename, { highWaterMark: CHUNK_BYTES, signal: options.signal }),
      validatedBytes(encoding),
      iconv.decodeStream(encoding),
      handle.createWriteStream({ highWaterMark: CHUNK_BYTES }),
      { signal: options.signal },
    );
  });
}

function textReference(filename, name) {
  return `Attached local text ${JSON.stringify(name)} (JSON-encoded absolute path): ${JSON.stringify(filename)}\nUse read_file with offset/limit in batches through the end of the file. Continue when output is truncated; do not silently omit the remainder. Do not modify the file merely to read it. If reading fails, report the actual error instead of guessing its contents.`;
}

module.exports = { readPrefix, savePreparedText, prepareLargeText, textReference };
