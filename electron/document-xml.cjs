const JSZip = require('jszip');
const { SaxesParser } = require('saxes');
const path = require('node:path').posix;

const TEXT_LIMIT = 1024 * 1024;
const XML_LIMIT = 32 * 1024 * 1024;
function error(code, message = code) {
  return Object.assign(new Error(message), { code });
}
function createOutput() {
  const parts = [];
  let size = 0;
  return {
    add(value) {
      size += Buffer.byteLength(value, 'utf8');
      if (size > TEXT_LIMIT) throw error('text-limit');
      parts.push(value);
    },
    finish() {
      const text = parts.join('').replace(/\r\n?/g, '\n').trim();
      if (!text) throw error('empty');
      return text;
    },
  };
}
function decodeXml(bytes) {
  if (typeof bytes === 'string') return bytes;
  const b = Buffer.from(bytes);
  if (b.length > XML_LIMIT) throw error('text-limit');
  let encoding = 'utf-8';
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0x3c && b[1] === 0)) encoding = 'utf-16le';
  if ((b[0] === 0xfe && b[1] === 0xff) || (b[0] === 0 && b[1] === 0x3c)) encoding = 'utf-16be';
  return new TextDecoder(encoding, { fatal: true }).decode(b);
}
function parseXml(bytes, { xhtml = false } = {}) {
  const parser = new SaxesParser({ xmlns: true });
  const xml = decodeXml(bytes);
  if (xhtml) {
    // XHTML entity names are decoded from a local standard table. Saxes does
    // not fetch external DTDs; internal/custom entity declarations stay disabled.
    const { decodeHTMLStrict } = require('entities');
    for (const match of xml.matchAll(/&([a-z][a-z0-9]+);/gi)) {
      if (Object.hasOwn(parser.ENTITIES, match[1])) continue;
      const decoded = decodeHTMLStrict(match[0]);
      if (decoded !== match[0]) parser.ENTITIES[match[1]] = decoded;
    }
  }
  const stack = [];
  let root;
  let count = 0;
  parser.on('doctype', (declaration) => {
    if (!xhtml || !/^\s*html(?:\s|$)/i.test(declaration) || declaration.includes('[')) {
      throw error('unsupported', 'XML DTD is unsupported');
    }
  });
  parser.on('opentag', (tag) => {
    if (++count > 250000 || stack.length > 128) throw error('text-limit');
    const node = { local: tag.local, uri: tag.uri, attrs: tag.attributes, children: [] };
    if (stack.length) stack.at(-1).children.push(node);
    else root = node;
    stack.push(node);
  });
  const onText = (value) => {
    if (stack.length) stack.at(-1).children.push(value);
  };
  parser.on('text', onText);
  parser.on('cdata', onText);
  parser.on('closetag', () => stack.pop());
  parser.write(xml).close();
  if (!root) throw error('parse-failed');
  return root;
}
function elements(node, local, uri) {
  return node.children.filter(
    (n) => typeof n !== 'string' && (!local || n.local === local) && (!uri || n.uri === uri),
  );
}
function descendants(node, local, uri) {
  const result = [];
  for (const child of elements(node)) {
    if (child.local === local && (!uri || child.uri === uri)) result.push(child);
    result.push(...descendants(child, local, uri));
  }
  return result;
}
function content(node) {
  return node.children.map((n) => (typeof n === 'string' ? n : content(n))).join('');
}
function attr(node, local, uri) {
  return Object.values(node.attrs).find((a) => a.local === local && (!uri || a.uri === uri))?.value;
}
function resolvePath(base, target) {
  if (!target || /[\\\0]|^[a-z][a-z0-9+.-]*:/i.test(target))
    throw error('parse-failed', 'Invalid document reference');
  const name = path.normalize(
    target.startsWith('/') ? target.slice(1) : path.join(path.dirname(base), target),
  );
  if (name === '..' || name.startsWith('../'))
    throw error('parse-failed', 'Invalid document reference');
  return name;
}
async function readZip(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  let total = 0;
  return {
    has: (name) => !!zip.file(name),
    async read(name) {
      const file = zip.file(name);
      if (!file) throw error('parse-failed', `Missing document part: ${name}`);
      return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        const stream = file.internalStream('nodebuffer');
        stream.on('data', (chunk) => {
          size += chunk.length;
          total += chunk.length;
          if (size > XML_LIMIT || total > 64 * 1024 * 1024) {
            stream.pause();
            reject(error('text-limit'));
          } else chunks.push(chunk);
        });
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.resume();
      });
    },
  };
}
module.exports = {
  TEXT_LIMIT,
  error,
  createOutput,
  parseXml,
  elements,
  descendants,
  content,
  attr,
  resolvePath,
  readZip,
};
