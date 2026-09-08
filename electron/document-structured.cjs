const {
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
} = require('./document-xml.cjs');

const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
const OFD = 'http://www.ofdspec.org/2016';

function readOdf(root, output) {
  if (root.uri !== OFFICE || !['document', 'document-content'].includes(root.local))
    throw error('unsupported');
  const body = elements(root, 'body', OFFICE)[0];
  if (
    !body ||
    !elements(body).some((n) => n.uri === OFFICE && ['text', 'presentation'].includes(n.local))
  )
    throw error('unsupported');
  function visit(node, inText = false) {
    if (node.uri === TEXT && ['tracked-changes', 'deletion'].includes(node.local)) return;
    if (node.uri === OFFICE && ['annotation', 'scripts', 'binary-data'].includes(node.local))
      return;
    const paragraph = node.uri === TEXT && ['p', 'h'].includes(node.local);
    if (node.uri === TEXT && node.local === 's') {
      const count = Number(attr(node, 'c', TEXT) || 1);
      if (!Number.isSafeInteger(count) || count < 1) throw error('parse-failed');
      if (count > TEXT_LIMIT) throw error('text-limit');
      output.add(' '.repeat(count));
      return;
    }
    if (node.uri === TEXT && ['tab', 'line-break'].includes(node.local)) {
      output.add(node.local === 'tab' ? '\t' : '\n');
      return;
    }
    for (const child of node.children) {
      if (typeof child === 'string') {
        if (inText || paragraph) output.add(child);
      } else visit(child, inText || paragraph);
    }
    if (paragraph || (node.uri === DRAW && node.local === 'page')) output.add('\n');
  }
  visit(body);
}

async function readOfd(zip, output) {
  const root = parseXml(await zip.read('OFD.xml'));
  if (root.uri !== OFD || root.local !== 'OFD') throw error('unsupported');
  const documents = elements(root, 'DocBody', OFD);
  if (!documents.length) throw error('parse-failed');
  for (const doc of documents) {
    const ref = elements(doc, 'DocRoot', OFD)[0];
    if (!ref) throw error('parse-failed');
    const docPath = resolvePath('OFD.xml', content(ref).trim());
    const document = parseXml(await zip.read(docPath));
    if (document.uri !== OFD || document.local !== 'Document') throw error('parse-failed');
    const templates = new Map(
      descendants(document, 'TemplatePage', OFD).map((n) => [
        attr(n, 'ID'),
        resolvePath(docPath, attr(n, 'BaseLoc')),
      ]),
    );
    const pages = elements(document, 'Pages', OFD)[0];
    if (!pages) throw error('parse-failed');
    async function readPage(pagePath, ancestry = []) {
      if (ancestry.includes(pagePath) || ancestry.length > 16) throw error('parse-failed');
      const page = parseXml(await zip.read(pagePath));
      if (page.uri !== OFD || page.local !== 'Page') throw error('parse-failed');
      const refs = elements(page, 'Template', OFD);
      const addTemplate = async (template) => {
        const target = templates.get(attr(template, 'TemplateID'));
        if (!target) throw error('parse-failed');
        await readPage(target, [...ancestry, pagePath]);
      };
      for (const template of refs.filter((n) => attr(n, 'ZOrder') !== 'Foreground'))
        await addTemplate(template);
      for (const object of descendants(page, 'TextObject', OFD)) {
        for (const code of descendants(object, 'TextCode', OFD)) output.add(content(code));
        output.add('\n');
      }
      for (const template of refs.filter((n) => attr(n, 'ZOrder') === 'Foreground'))
        await addTemplate(template);
      output.add('\n');
    }
    for (const page of elements(pages, 'Page', OFD))
      await readPage(resolvePath(docPath, attr(page, 'BaseLoc')));
  }
}

async function readEpub(zip, output) {
  const OCF = 'urn:oasis:names:tc:opendocument:xmlns:container';
  const OPF = 'http://www.idpf.org/2007/opf';
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const container = parseXml(await zip.read('META-INF/container.xml'));
  const rootfile = descendants(container, 'rootfile', OCF).find(
    (n) => attr(n, 'media-type') === 'application/oebps-package+xml',
  );
  if (!rootfile) throw error('unsupported');
  const packagePath = resolvePath('', attr(rootfile, 'full-path'));
  const pkg = parseXml(await zip.read(packagePath));
  if (pkg.local !== 'package' || pkg.uri !== OPF) throw error('unsupported');
  const manifest = elements(pkg, 'manifest', OPF)[0];
  const spine = elements(pkg, 'spine', OPF)[0];
  if (!manifest || !spine) throw error('parse-failed');
  const items = new Map(elements(manifest, 'item', OPF).map((n) => [attr(n, 'id'), n]));
  const encrypted = new Set();
  if (zip.has('META-INF/encryption.xml')) {
    for (const ref of descendants(
      parseXml(await zip.read('META-INF/encryption.xml')),
      'CipherReference',
      'http://www.w3.org/2001/04/xmlenc#',
    )) {
      encrypted.add(resolvePath('', decodeURIComponent(attr(ref, 'URI'))));
    }
  }
  for (const ref of elements(spine, 'itemref', OPF)) {
    const item = items.get(attr(ref, 'idref'));
    if (!item) throw error('parse-failed');
    if (attr(item, 'media-type') !== 'application/xhtml+xml')
      throw error('unsupported', 'EPUB spine requires XHTML');
    const chapterPath = resolvePath(packagePath, decodeURIComponent(attr(item, 'href')));
    if (encrypted.has(chapterPath)) throw error('unsupported', 'Encrypted EPUB text');
    const chapter = parseXml(await zip.read(chapterPath), { xhtml: true });
    if (chapter.local !== 'html' || chapter.uri !== XHTML) throw error('unsupported');
    const body = elements(chapter, 'body', XHTML)[0];
    if (!body) throw error('parse-failed');
    function visit(node, pre = false) {
      if (node.uri !== XHTML || ['script', 'style', 'template'].includes(node.local)) return;
      for (const child of node.children) {
        if (typeof child === 'string')
          output.add(pre || node.local === 'pre' ? child : child.replace(/[\t\r\n ]+/g, ' '));
        else visit(child, pre || node.local === 'pre');
      }
      if (/^(?:p|div|h[1-6]|li|br|tr|section|article|blockquote|pre)$/.test(node.local))
        output.add('\n');
      if (node.local === 'td' || node.local === 'th') output.add('\t');
    }
    visit(body);
    output.add('\n');
  }
}

module.exports = async function extractStructured(bytes, extension) {
  const ext = extension.toLowerCase().replace(/^\./, '');
  try {
    const output = createOutput();
    if (ext === 'ofd') await readOfd(await readZip(bytes), output);
    else if (ext === 'epub') await readEpub(await readZip(bytes), output);
    else if (['odt', 'ott', 'odp', 'otp', 'fodt', 'fodp', 'uot', 'uop'].includes(ext)) {
      const flat =
        ['fodt', 'fodp'].includes(ext) ||
        !Buffer.from(bytes).subarray(0, 2).equals(Buffer.from('PK'));
      const xml = flat ? bytes : await (await readZip(bytes)).read('content.xml');
      readOdf(parseXml(xml), output);
    } else throw error('unsupported');
    return output.finish();
  } catch (err) {
    if (['empty', 'text-limit', 'unsupported', 'parse-failed'].includes(err.code)) throw err;
    throw error('parse-failed', err.message);
  }
};
