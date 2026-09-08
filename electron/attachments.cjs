const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { translate: t } = require('./i18n.cjs');
const documents = require('./document.cjs');
const { decodeText } = require('./document-text.cjs');

const MB = 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
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

async function preparePrompt(text, attachments = [], capabilities = {}) {
  const content = text?.trim() ? [{ type: 'text', text }] : [];
  let textBytes = 0,
    imageBytes = 0,
    nativeBytes = 0;
  for (const attachment of attachments || []) {
    const name = String(attachment.name || 'Context');
    if (typeof attachment.text === 'string') {
      const size = Buffer.byteLength(attachment.text);
      textBytes += size;
      if (size > MB || textBytes > 4 * MB)
        throw new Error(t('文本附件单个不得超过 1 MB，总计不得超过 4 MB'));
      content.push({ type: 'text', text: `${name}\n${attachment.text}` });
      continue;
    }
    const filename = path.resolve(attachment.path);
    const extension = path.extname(filename).toLowerCase();
    const stat = await fs.stat(filename);
    if (!stat.isFile()) throw new Error(t('附件不是文件：{name}', { name }));
    const isImage =
      attachment.kind === 'image' || IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
    if (isImage) {
      imageBytes += stat.size;
      if (stat.size > 10 * MB || imageBytes > 20 * MB)
        throw new Error(t('图片单个不得超过 10 MB，总计不得超过 20 MB。'));
      const bytes = await fs.readFile(filename);
      const mimeType = imageMime(bytes);
      if (!mimeType) throw new Error(t('图片格式无效，请选择 PNG、JPEG、WebP 或 GIF。'));
      if (capabilities.image === true) {
        content.push({ type: 'image', mimeType, data: bytes.toString('base64') });
      } else {
        content.push({
          type: 'text',
          text: `Attached local image (JSON-encoded absolute path): ${JSON.stringify(filename)}\nUse read_file to view this exact image before answering the user's request. Read the image visually, not as raw bytes or terminal text. If you cannot view it, explain the failure instead of guessing its contents.`,
        });
      }
    } else if (documents.native.has(extension)) {
      nativeBytes += stat.size;
      if (stat.size > 10 * MB || nativeBytes > 20 * MB)
        throw new Error(t('原生文档单个不得超过 10 MB，总计不得超过 20 MB。'));
      const bytes = await fs.readFile(filename);
      const valid =
        extension === '.pdf'
          ? bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))
          : extension === '.pptx'
            ? bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
            : (() => {
                try {
                  const n = JSON.parse(decodeText(bytes));
                  return n.nbformat === 4 && Array.isArray(n.cells);
                } catch {
                  return false;
                }
              })();
      if (!valid)
        throw new Error(
          t('文件不是有效的 {format} 文档。请确认能正常打开。', {
            format: extension.slice(1).toUpperCase(),
          }),
        );
      content.push({ type: 'text', text: documents.nativePrompt(filename, extension) });
    } else if (['.caj', '.nh', '.hn', '.kdh'].includes(extension)) {
      throw new Error(
        t(
          '此类 CAJ 文献暂不能可靠地自动转换。请用 CAJViewer 打开并打印为 PDF，再添加 PDF；草稿和原文件会保留。',
        ),
      );
    } else if (documents.documentKind(extension) && !['.html', '.htm'].includes(extension)) {
      const isWord = documents.documentKind(extension) === 'word';
      if (stat.size > 10 * MB)
        throw new Error(t(isWord ? 'Word 文档单个不得超过 10 MB。' : '文档单个不得超过 10 MB。'));
      const bytes = await fs.readFile(filename);
      if (bytes.length > 10 * MB) throw new Error(t('文档单个不得超过 10 MB。'));
      const prefix = (
        (bytes[0] === 255 && bytes[1] === 254) || (bytes[0] === 254 && bytes[1] === 255)
          ? decodeText(bytes).slice(0, 200)
          : bytes.subarray(0, 200).toString('utf8')
      ).trimStart();
      const disguised =
        isWord &&
        (/^\{\\rtf/i.test(prefix)
          ? '.rtf'
          : /^(?:<\?xml[^>]*>\s*)?(?:<!doctype html\b|<html\b)/i.test(prefix)
            ? '.html'
            : null);
      const extracted =
        isWord && !disguised
          ? await require('./word.cjs').wordText(bytes, name)
          : await documents.documentText(bytes, disguised || extension, name);
      const size = Buffer.byteLength(extracted);
      textBytes += size;
      if (size > MB || textBytes > 4 * MB)
        throw new Error(t('提取后的文本单个不得超过 1 MB，总计不得超过 4 MB。请拆分附件后重试。'));
      content.push({ type: 'text', text: extracted });
    } else {
      if (stat.size > MB) throw new Error(t('文本附件单个不得超过 1 MB，总计不得超过 4 MB'));
      const bytes = await fs.readFile(filename);
      let decoded;
      try {
        decoded = decodeText(bytes);
      } catch {
        throw new Error(
          t('不支持此文件格式或文本编码：{name}。请另存为 PDF 或 UTF-8 文本后重试。', { name }),
        );
      }
      textBytes += Buffer.byteLength(decoded);
      if (Buffer.byteLength(decoded) > MB || textBytes > 4 * MB)
        throw new Error(t('文本附件单个不得超过 1 MB，总计不得超过 4 MB'));
      content.push(
        capabilities.embeddedContext
          ? {
              type: 'resource',
              resource: {
                uri: pathToFileURL(filename).href,
                mimeType: 'text/plain',
                text: decoded,
              },
            }
          : { type: 'text', text: `${name}\n${decoded}` },
      );
    }
  }
  if (!content.length) throw new Error(t('请输入消息或添加附件'));
  return content;
}

async function storeClipboardImage(bytes, directory) {
  if (!bytes?.length) return null;
  if (bytes.length > 10 * MB) throw new Error(t('图片单个不得超过 10 MB，总计不得超过 20 MB。'));
  if (imageMime(bytes) !== 'image/png') throw new Error(t('剪贴板中没有有效的 PNG 图片。'));
  await fs.mkdir(directory, { recursive: true });
  const name = `Screenshot-${Date.now()}.png`;
  const filename = path.join(directory, `${randomUUID()}.png`);
  await fs.writeFile(filename, bytes, { flag: 'wx' });
  return { name, path: filename, kind: 'image', mimeType: 'image/png' };
}

async function previewAttachment({ path: filename }) {
  const content = await preparePrompt('', [{ name: path.basename(filename), path: filename }], {
    image: true,
    embeddedContext: true,
  });
  const item = content[0];
  const extension = path.extname(filename).toLowerCase();
  if (documents.native.has(extension))
    return { native: true, text: documents.nativeDescription(extension) };
  return item.type === 'image'
    ? { dataUrl: `data:${item.mimeType};base64,${item.data}` }
    : item.type === 'text'
      ? { text: item.text, notice: documents.documentNotice() }
      : { text: item.resource.text };
}

module.exports = { preparePrompt, storeClipboardImage, imageMime, previewAttachment };
