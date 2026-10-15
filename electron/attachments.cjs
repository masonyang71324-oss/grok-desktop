const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { translate: t } = require('./i18n.cjs');
const documents = require('./document.cjs');
const { decodeText } = require('./document-text.cjs');
const {
  readPrefix,
  savePreparedText,
  prepareLargeText,
  textReference,
} = require('./attachment-text-files.cjs');

const MB = 1024 * 1024;
const PREVIEW_CHARACTERS = 65536;
const CONVERSION_TEXT_BYTES = 32 * MB;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
/** @param {Buffer} bytes */
function imageMime(bytes) {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  return null;
}

/**
 * @typedef {{name?: string, path?: string, kind?: string, text?: string, mimeType?: string}} PromptAttachment
 * @typedef {{type: 'text', text: string} | {type: 'image', mimeType: string, data: string} | {type: 'resource', resource: {uri: string, mimeType: string, text: string}}} PromptContent
 */
/**
 * @param {string} text
 * @param {PromptAttachment[]} [attachments]
 * @param {{image?: boolean, embeddedContext?: boolean}} [capabilities]
 * @param {{outputDirectory?: string, onReference?: (filename:string) => void, signal?: AbortSignal}} [options]
 * @returns {Promise<PromptContent[]>}
 */
async function preparePrompt(text, attachments = [], capabilities = {}, options = {}) {
  /** @type {PromptContent[]} */
  const content = text?.trim() ? [{ type: 'text', text }] : [];
  let textBytes = 0,
    imageBytes = 0;
  const check = () => {
    if (options.signal?.aborted)
      throw Object.assign(new Error(t('已取消发送。')), { name: 'AbortError', code: 'ABORT_ERR' });
  };
  async function addText(value, name, filename = '', embedded = false) {
    check();
    const size = Buffer.byteLength(value);
    if (size > MB || textBytes + size > 4 * MB) {
      if (!options.outputDirectory)
        throw new Error(t('文本附件单个不得超过 1 MB，总计不得超过 4 MB'));
      const prepared = await savePreparedText(value, name, options);
      content.push({ type: 'text', text: textReference(prepared, name) });
    } else {
      textBytes += size;
      content.push(
        embedded && capabilities.embeddedContext
          ? {
              type: 'resource',
              resource: { uri: pathToFileURL(filename).href, mimeType: 'text/plain', text: value },
            }
          : { type: 'text', text: embedded ? `${name}\n${value}` : value },
      );
    }
  }
  check();
  for (const attachment of attachments || []) {
    check();
    const name = String(attachment.name || 'Context');
    if (typeof attachment.text === 'string') {
      const size = Buffer.byteLength(attachment.text);
      if (size > MB || textBytes + size > 4 * MB) {
        if (!options.outputDirectory)
          throw new Error(t('文本附件单个不得超过 1 MB，总计不得超过 4 MB'));
        const prepared = await savePreparedText(attachment.text, name, options);
        content.push({ type: 'text', text: textReference(prepared, name) });
      } else {
        textBytes += size;
        content.push({ type: 'text', text: `${name}\n${attachment.text}` });
      }
      continue;
    }
    const filename = path.resolve(attachment.path);
    const extension = path.extname(filename).toLowerCase();
    const stat = await fs.stat(filename);
    if (!stat.isFile()) throw new Error(t('附件不是文件：{name}', { name }));
    const isImage =
      attachment.kind === 'image' || IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
    if (isImage) {
      const mimeType = imageMime(await readPrefix(filename, 32, options.signal));
      if (!mimeType) throw new Error(t('图片格式无效，请选择 PNG、JPEG、WebP 或 GIF。'));
      if (
        capabilities.image === true &&
        stat.size <= 10 * MB &&
        imageBytes + stat.size <= 20 * MB
      ) {
        const bytes = await readPrefix(filename, 10 * MB + 1, options.signal);
        if (bytes.length <= 10 * MB && imageBytes + bytes.length <= 20 * MB) {
          imageBytes += bytes.length;
          content.push({ type: 'image', mimeType, data: bytes.toString('base64') });
        } else content.push({ type: 'text', text: imageReference(filename) });
      } else {
        content.push({ type: 'text', text: imageReference(filename) });
      }
    } else if (documents.native.has(extension)) {
      await validateNative(filename, extension, stat.size, options.signal);
      content.push({ type: 'text', text: documents.nativePrompt(filename, extension) });
    } else if (['.caj', '.nh', '.hn', '.kdh'].includes(extension)) {
      throw new Error(
        t(
          '此类 CAJ 文献暂不能可靠地自动转换。请用 CAJViewer 打开并打印为 PDF，再添加 PDF；草稿和原文件会保留。',
        ),
      );
    } else if (
      isConvertedDocument(extension) &&
      !(stat.size > MB && ['.csv', '.tsv'].includes(extension))
    ) {
      const extracted = await convertedText(filename, extension, name, options.signal);
      await addText(extracted, name);
    } else {
      if (stat.size > MB) {
        const prepared = await prepareTextFile(filename, name, options);
        content.push({ type: 'text', text: textReference(prepared, name) });
        continue;
      }
      const bytes = await readPrefix(filename, MB + 1, options.signal);
      if (bytes.length > MB) {
        const prepared = await prepareTextFile(filename, name, options);
        content.push({ type: 'text', text: textReference(prepared, name) });
        continue;
      }
      let decoded;
      try {
        decoded = decodeText(bytes);
      } catch {
        throw new Error(
          t('不支持此文件格式或文本编码：{name}。请另存为 PDF 或 UTF-8 文本后重试。', { name }),
        );
      }
      await addText(decoded, name, filename, true);
    }
  }
  if (!content.length) throw new Error(t('请输入消息或添加附件'));
  return content;
}

const imageReference = (filename) =>
  `Attached local image (JSON-encoded absolute path): ${JSON.stringify(filename)}\nUse read_file to view this exact image before answering the user's request. Read the image visually, not as raw bytes or terminal text. If you cannot view it, explain the actual failure instead of guessing its contents.`;
async function prepareTextFile(filename, name, options) {
  try {
    return await prepareLargeText(filename, name, options);
  } catch (error) {
    if (error.code === 'ATTACHMENT_UNSUPPORTED_TEXT')
      throw new Error(
        t('不支持此文件格式或文本编码：{name}。请另存为 PDF 或 UTF-8 文本后重试。', { name }),
      );
    throw error;
  }
}
const isConvertedDocument = (extension) =>
  documents.documentKind(extension) && !['.html', '.htm'].includes(extension);
async function validateNative(filename, extension, size, signal) {
  const bytes = await readPrefix(
    filename,
    extension === '.ipynb' && size <= MB ? MB : 1024,
    signal,
  );
  let valid =
    extension === '.pdf'
      ? bytes.includes(Buffer.from('%PDF-'))
      : extension === '.pptx'
        ? bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
        : true;
  if (extension === '.ipynb' && size <= MB) {
    try {
      const notebook = JSON.parse(decodeText(bytes));
      valid = notebook.nbformat === 4 && Array.isArray(notebook.cells);
    } catch {
      valid = false;
    }
  }
  // Large notebooks are validated by the native reader, never JSON.parse'd on the UI/main thread.
  if (!valid)
    throw new Error(
      t('文件不是有效的 {format} 文档。请确认能正常打开。', {
        format: extension.slice(1).toUpperCase(),
      }),
    );
}
async function convertedText(filename, extension, name, signal) {
  const bytes = await readPrefix(filename, 1024, signal);
  const isWord = documents.documentKind(extension) === 'word';
  const prefix = (
    (bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 254 && bytes[1] === 255)
      ? new TextDecoder(bytes[0] === 255 ? 'utf-16le' : 'utf-16be')
          .decode(bytes.subarray(2), { stream: true })
          .slice(0, 200)
      : bytes.subarray(0, 200).toString('utf8')
  ).trimStart();
  const disguised =
    isWord &&
    (/^\{\\rtf/i.test(prefix)
      ? '.rtf'
      : /^(?:<\?xml[^>]*>\s*)?(?:<!doctype html\b|<html\b)/i.test(prefix)
        ? '.html'
        : null);
  const options = { maxTextBytes: CONVERSION_TEXT_BYTES, signal };
  return isWord && !disguised
    ? require('./word.cjs').wordText(filename, name, options)
    : documents.documentText(filename, disguised || extension, name, options);
}

/** @param {Buffer} bytes @param {string} directory */
async function storeClipboardImage(bytes, directory) {
  if (!bytes?.length) return null;
  if (bytes.length > 50 * MB)
    throw new Error(t('剪贴板图片超过 50 MB，请压缩图片或选择本地文件。'));
  if (imageMime(bytes) !== 'image/png') throw new Error(t('剪贴板中没有有效的 PNG 图片。'));
  await fs.mkdir(directory, { recursive: true });
  const name = `Screenshot-${Date.now()}.png`;
  const filename = path.join(directory, `${randomUUID()}.png`);
  await fs.writeFile(filename, bytes, { flag: 'wx' });
  return { name, path: filename, kind: 'image', mimeType: 'image/png' };
}

/** @param {{path: string}} attachment */
async function previewAttachment({ path: filename }) {
  const extension = path.extname(filename).toLowerCase();
  const stat = await fs.stat(filename);
  if (!stat.isFile()) throw new Error(t('附件不是文件：{name}', { name: path.basename(filename) }));
  if (documents.native.has(extension)) {
    await validateNative(filename, extension, stat.size);
    return {
      native: true,
      text: documents.nativeDescription(extension),
      layoutAvailable: stat.size <= 10 * MB,
    };
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    const mimeType = imageMime(await readPrefix(filename, 32));
    if (!mimeType) throw new Error(t('图片格式无效，请选择 PNG、JPEG、WebP 或 GIF。'));
    const bytes = stat.size <= 10 * MB ? await readPrefix(filename, 10 * MB + 1) : null;
    return bytes && bytes.length <= 10 * MB
      ? { dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}` }
      : { native: true, text: t('大图片将在发送后由 Grok 按需读取，可用默认程序查看原图。') };
  }
  if (['.caj', '.nh', '.hn', '.kdh'].includes(extension))
    throw new Error(
      t(
        '此类 CAJ 文献暂不能可靠地自动转换。请用 CAJViewer 打开并打印为 PDF，再添加 PDF；草稿和原文件会保留。',
      ),
    );
  let text,
    truncated = false,
    notice;
  if (isConvertedDocument(extension) && !(stat.size > MB && ['.csv', '.tsv'].includes(extension))) {
    text = await convertedText(filename, extension, path.basename(filename));
    notice = documents.documentNotice(extension);
  } else {
    const bytes = await readPrefix(filename, 256 * 1024);
    truncated = stat.size > bytes.length;
    try {
      if (!truncated) text = decodeText(bytes);
      else if (bytes[0] === 255 && bytes[1] === 254)
        text = new TextDecoder('utf-16le').decode(bytes.subarray(2), { stream: true });
      else if (bytes[0] === 254 && bytes[1] === 255)
        text = new TextDecoder('utf-16be').decode(bytes.subarray(2), { stream: true });
      else {
        if (bytes.includes(0)) throw new Error('Binary');
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
        } catch {
          text = new TextDecoder('gb18030', { fatal: true }).decode(bytes, { stream: true });
        }
      }
    } catch {
      throw new Error(
        t('不支持此文件格式或文本编码：{name}。请另存为 PDF 或 UTF-8 文本后重试。', {
          name: path.basename(filename),
        }),
      );
    }
  }
  truncated ||= text.length > PREVIEW_CHARACTERS;
  return {
    text: text.slice(0, PREVIEW_CHARACTERS),
    notice,
    truncated,
    layoutAvailable: stat.size <= 10 * MB,
  };
}

module.exports = { preparePrompt, storeClipboardImage, imageMime, previewAttachment };
