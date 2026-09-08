const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { translate: t } = require('./i18n.cjs');

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
    imageBytes = 0;
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
    const stat = await fs.stat(filename);
    if (!stat.isFile()) throw new Error(t('附件不是文件：{name}', { name }));
    const isImage =
      attachment.kind === 'image' || IMAGE_EXTENSIONS.has(path.extname(filename).toLowerCase());
    if (isImage) {
      if (capabilities.image !== true)
        throw new Error(
          t('当前 Grok 版本不支持图片输入。请移除图片，或更新到支持图片的 Grok 版本。'),
        );
      imageBytes += stat.size;
      if (stat.size > 10 * MB || imageBytes > 20 * MB)
        throw new Error(t('图片单个不得超过 10 MB，总计不得超过 20 MB。'));
      const bytes = await fs.readFile(filename);
      const mimeType = imageMime(bytes);
      if (!mimeType) throw new Error(t('图片格式无效，请选择 PNG、JPEG、WebP 或 GIF。'));
      content.push({ type: 'image', mimeType, data: bytes.toString('base64') });
    } else {
      if (!capabilities.embeddedContext) throw new Error(t('当前 Grok 版本不支持附件上下文'));
      textBytes += stat.size;
      if (stat.size > MB || textBytes > 4 * MB)
        throw new Error(t('文本附件单个不得超过 1 MB，总计不得超过 4 MB'));
      const bytes = await fs.readFile(filename);
      if (bytes.includes(0)) throw new Error(t('目前仅支持文本附件：{name}', { name }));
      content.push({
        type: 'resource',
        resource: {
          uri: pathToFileURL(filename).href,
          mimeType: 'text/plain',
          text: bytes.toString('utf8'),
        },
      });
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
  return item.type === 'image'
    ? { dataUrl: `data:${item.mimeType};base64,${item.data}` }
    : { text: item.resource.text };
}

module.exports = { preparePrompt, storeClipboardImage, imageMime, previewAttachment };
