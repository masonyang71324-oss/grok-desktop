'use strict';
const path = require('node:path').posix;
const JSZip = require('jszip');
const XLSX = require('xlsx');
const {
  parseXml,
  elements,
  descendants,
  content,
  attr,
  resolvePath,
} = require('./document-xml.cjs');

const LIMIT = 64 * 1024 * 1024;
const fail = (message) => Object.assign(new Error(message), { code: 'preview-failed' });
const one = (node, local) => descendants(node, local)[0];
const number = (node, name, fallback = 0) => Number(node && attr(node, name)) || fallback;

async function packageZip(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  let size = 0;
  const cache = new Map();
  return {
    zip,
    async read(name) {
      if (cache.has(name)) return cache.get(name);
      const file = zip.file(name);
      if (!file) throw fail(`Missing Office part: ${name}`);
      const chunks = [];
      let partSize = 0;
      const value = await new Promise((resolve, reject) => {
        const stream = file.internalStream('nodebuffer');
        stream.on('data', (chunk) => {
          size += chunk.length;
          partSize += chunk.length;
          if (size > LIMIT || partSize > 32 * 1024 * 1024) {
            stream.pause();
            reject(fail('Office preview exceeds 64 MB'));
          } else chunks.push(chunk);
        });
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.resume();
      });
      cache.set(name, value);
      return value;
    },
  };
}
async function relationships(pkg, part) {
  const name = path.join(path.dirname(part), '_rels', path.basename(part) + '.rels');
  if (!pkg.zip.file(name)) return [];
  const root = parseXml(await pkg.read(name));
  return elements(root, 'Relationship').map((node) => ({
    id: attr(node, 'Id'),
    target: attr(node, 'Target'),
    type: attr(node, 'Type'),
    external: attr(node, 'TargetMode') === 'External',
  }));
}
async function picture(pkg, part, rel) {
  if (!rel || rel.external) return undefined;
  const name = resolvePath(part, rel.target);
  const bytes = await pkg.read(name);
  const { imageMime } = require('./attachments.cjs');
  const mime = imageMime(bytes);
  return mime ? `data:${mime};base64,${bytes.toString('base64')}` : undefined;
}

async function docxModel(bytes) {
  const pkg = await packageZip(bytes);
  if (!pkg.zip.file('word/document.xml')) throw fail('No DOCX document part');
  const root = parseXml(await pkg.read('word/document.xml'));
  if (root.local !== 'document') throw fail('Not a DOCX document');
  let omitted = false;
  // docx-preview never receives executable HTML altChunks. It still receives
  // ordinary document XML, tables, relationships and embedded image assets.
  for (const entry of Object.values(pkg.zip.files)) {
    if (entry.dir || !pkg.zip.file(entry.name)) continue;
    const data = await pkg.read(entry.name);
    if (entry.name.endsWith('.xml') || entry.name.endsWith('.rels')) {
      const xml = data.toString('utf8');
      parseXml(data);
      if (/<(?:\w+:)?altChunk\b/.test(xml)) {
        omitted = true;
        pkg.zip.file(
          entry.name,
          xml.replace(/<(?:\w+:)?altChunk\b[^>]*(?:\/>|>[\s\S]*?<\/(?:\w+:)?altChunk>)/g, ''),
        );
      }
      if (entry.name.endsWith('.rels') && /aFChunk/.test(xml)) {
        const relRoot = parseXml(data);
        for (const rel of elements(relRoot, 'Relationship')) {
          if (!attr(rel, 'Type')?.endsWith('/aFChunk')) continue;
          const part = entry.name.replace(/\/_rels\//, '/').replace(/\.rels$/, '');
          if (attr(rel, 'TargetMode') !== 'External')
            pkg.zip.remove(resolvePath(part, attr(rel, 'Target')));
        }
        pkg.zip.file(
          entry.name,
          xml.replace(
            /<(?:\w+:)?Relationship\b[^>]*\bType=["'][^"']*\/aFChunk["'][^>]*(?:\/>|>[\s\S]*?<\/(?:\w+:)?Relationship>)/g,
            '',
          ),
        );
      }
    }
  }
  return {
    kind: 'docx',
    readOnly: true,
    notices: ['docx-layout', ...(omitted ? ['embedded-html-omitted'] : [])],
    base64: (await pkg.zip.generateAsync({ type: 'nodebuffer' })).toString('base64'),
  };
}

function color(node) {
  if (!node) return undefined;
  const rgb = attr(node, 'rgb') || attr(node, 'val');
  return /^[a-f\d]{6,8}$/i.test(rgb || '') ? '#' + rgb.slice(-6) : undefined;
}
async function sheetStyles(pkg) {
  if (!pkg.zip.file('xl/styles.xml')) return [];
  const root = parseXml(await pkg.read('xl/styles.xml'));
  const list = (local) => elements(root, local)[0];
  const fonts = elements(list('fonts') || { children: [] });
  const fills = elements(list('fills') || { children: [] });
  return elements(list('cellXfs') || { children: [] }).map((xf) => {
    const font = fonts[number(xf, 'fontId')],
      fill = fills[number(xf, 'fillId')],
      align = elements(xf, 'alignment')[0];
    const style = {};
    if (font) {
      if (elements(font, 'b').some((n) => attr(n, 'val') !== '0')) style.bold = true;
      if (elements(font, 'i').some((n) => attr(n, 'val') !== '0')) style.italic = true;
      style.color = color(elements(font, 'color')[0]);
      const sz = number(elements(font, 'sz')[0], 'val');
      if (sz) style.fontSize = Math.min(48, sz);
    }
    if (fill) {
      const pattern = one(fill, 'patternFill');
      if (attr(pattern || { attrs: {} }, 'patternType') === 'solid')
        style.background = color(one(fill, 'fgColor'));
    }
    if (align) {
      const horizontal = attr(align, 'horizontal');
      if (['left', 'center', 'right'].includes(horizontal)) style.align = horizontal;
      style.wrap = attr(align, 'wrapText') === '1';
    }
    return style;
  });
}
async function sheetModel(bytes, extension) {
  let pkg,
    styles = [],
    byPath = new Map(),
    sheetPaths = [];
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    pkg = await packageZip(bytes);
    if (
      !pkg.zip.file('xl/workbook.xml') &&
      !pkg.zip.file('xl/workbook.bin') &&
      !pkg.zip.file('content.xml')
    )
      throw fail('Not a spreadsheet package');
    if (pkg.zip.file('xl/workbook.xml')) {
      styles = await sheetStyles(pkg);
      const workbook = parseXml(await pkg.read('xl/workbook.xml'));
      const rels = await relationships(pkg, 'xl/workbook.xml');
      sheetPaths = descendants(workbook, 'sheet').map((node) => {
        const rel = rels.find((r) => r.id === attr(node, 'id'));
        return rel && !rel.external ? resolvePath('xl/workbook.xml', rel.target) : undefined;
      });
      for (const filename of sheetPaths.filter(Boolean)) {
        const root = parseXml(await pkg.read(filename));
        const cells = new Map();
        for (const node of descendants(root, 'c')) {
          const formula = elements(node, 'f')[0],
            value = elements(node, 'v')[0];
          cells.set(attr(node, 'r'), {
            style: number(node, 's'),
            uncached: !!formula && (!value || !content(value).trim()),
          });
        }
        byPath.set(filename, cells);
      }
    }
  } else if (!['.csv', '.tsv', '.xls', '.xlsb'].includes(extension))
    throw fail('Unrecognized spreadsheet');
  const source = ['.csv', '.tsv'].includes(extension)
    ? require('./document-text.cjs').decodeText(bytes)
    : bytes;
  const workbook = XLSX.read(source, {
    type: typeof source === 'string' ? 'string' : 'buffer',
    cellStyles: true,
    cellNF: true,
    cellFormula: true,
    cellText: true,
    sheetStubs: true,
    raw: true,
    ...(extension === '.tsv' ? { FS: '\t' } : {}),
  });
  let truncated = workbook.SheetNames.length > 30;
  const sheets = workbook.SheetNames.slice(0, 30).map((name, index) => {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
    const endRow = Math.min(range.e.r, range.s.r + 199),
      endCol = Math.min(range.e.c, range.s.c + 39);
    if (endRow < range.e.r || endCol < range.e.c) truncated = true;
    const metadata = byPath.get(sheetPaths[index]);
    const cells = [];
    for (const address of Object.keys(sheet)) {
      if (!/^[A-Z]+[1-9]\d*$/.test(address)) continue;
      const { r, c } = XLSX.utils.decode_cell(address);
      if (r < range.s.r || r > endRow || c < range.s.c || c > endCol) continue;
      const cell = sheet[address],
        meta = metadata?.get(address);
      const uncached = !!cell.f && (meta?.uncached || cell.v == null);
      cells.push({
        address,
        row: r,
        col: c,
        text: uncached
          ? ''
          : String(cell.w ?? (cell.v == null ? '' : XLSX.utils.format_cell(cell))),
        formula: cell.f,
        uncached,
        format: cell.z,
        style: styles[meta?.style || 0] || {},
      });
    }
    const merges = (sheet['!merges'] || [])
      .filter((m) => m.s.r >= range.s.r && m.s.c >= range.s.c && m.e.r <= endRow && m.e.c <= endCol)
      .map((m) => ({ startRow: m.s.r, startCol: m.s.c, endRow: m.e.r, endCol: m.e.c }));
    if (merges.length < (sheet['!merges'] || []).length) truncated = true;
    return {
      name,
      startRow: range.s.r,
      startCol: range.s.c,
      endRow,
      endCol,
      cells,
      merges,
      columns: Array.from({ length: endCol - range.s.c + 1 }, (_, i) =>
        Math.min(
          300,
          Math.max(
            48,
            sheet['!cols']?.[i + range.s.c]?.wpx ||
              (sheet['!cols']?.[i + range.s.c]?.wch || 12) * 8,
          ),
        ),
      ),
      rows: Array.from({ length: endRow - range.s.r + 1 }, (_, i) =>
        Math.min(
          150,
          Math.max(
            22,
            sheet['!rows']?.[i + range.s.r]?.hpx ||
              (sheet['!rows']?.[i + range.s.r]?.hpt || 18) * 1.333,
          ),
        ),
      ),
    };
  });
  return {
    kind: 'sheet',
    readOnly: true,
    notices: ['sheet-limitations', ...(truncated ? ['preview-truncated'] : [])],
    sheets,
    truncated,
  };
}

async function pptxModel(bytes) {
  const pkg = await packageZip(bytes);
  const part = 'ppt/presentation.xml';
  const root = parseXml(await pkg.read(part));
  if (root.local !== 'presentation') throw fail('Not a PPTX presentation');
  const size = elements(root, 'sldSz')[0],
    width = number(size, 'cx', 9144000),
    height = number(size, 'cy', 6858000);
  const slideRels = await relationships(pkg, part),
    ids = descendants(root, 'sldId');
  const slides = [];
  for (const id of ids.slice(0, 100)) {
    const rel = slideRels.find((r) => r.id === attr(id, 'id') && r.type?.endsWith('/slide'));
    if (!rel || rel.external) throw fail('Missing slide relationship');
    const slidePart = resolvePath(part, rel.target),
      slide = parseXml(await pkg.read(slidePart));
    const rels = await relationships(pkg, slidePart),
      tree = one(slide, 'spTree');
    const shapes = [];
    for (const shape of elements(tree || { children: [] })) {
      if (!['sp', 'pic'].includes(shape.local)) continue;
      const transform = one(shape, 'xfrm'),
        offset = transform && elements(transform, 'off')[0],
        extent = transform && elements(transform, 'ext')[0];
      if (!offset || !extent) continue;
      const geometry = {
        x: (number(offset, 'x') / width) * 100,
        y: (number(offset, 'y') / height) * 100,
        width: (number(extent, 'cx') / width) * 100,
        height: (number(extent, 'cy') / height) * 100,
        rotation: number(transform, 'rot') / 60000,
      };
      if (shape.local === 'pic') {
        const blip = one(shape, 'blip'),
          imageRel = rels.find((r) => r.id === attr(blip || { attrs: {} }, 'embed'));
        const src = await picture(pkg, slidePart, imageRel);
        if (src) shapes.push({ ...geometry, kind: 'image', src });
      } else {
        const tx = elements(shape, 'txBody')[0];
        const paragraphs = tx
          ? elements(tx, 'p').map((p) => {
              const prop = elements(p, 'pPr')[0];
              return {
                align:
                  { ctr: 'center', r: 'right', l: 'left', just: 'justify' }[
                    attr(prop || { attrs: {} }, 'algn')
                  ] || 'left',
                runs: elements(p)
                  .filter((r) => ['r', 'fld', 'br'].includes(r.local))
                  .map((run) => {
                    const rPr = elements(run, 'rPr')[0],
                      solid = rPr && one(rPr, 'solidFill');
                    return {
                      text: run.local === 'br' ? '\n' : elements(run, 't').map(content).join(''),
                      fontSize: number(rPr, 'sz', 1800) / 100,
                      bold: attr(rPr || { attrs: {} }, 'b') === '1',
                      italic: attr(rPr || { attrs: {} }, 'i') === '1',
                      color: solid && color(one(solid, 'srgbClr')),
                    };
                  }),
              };
            })
          : [];
        const fill = elements(shape, 'spPr')[0],
          solid = fill && elements(fill, 'solidFill')[0];
        shapes.push({
          ...geometry,
          kind: 'text',
          paragraphs,
          background: solid && color(one(solid, 'srgbClr')),
        });
      }
    }
    const background = one(slide, 'bgPr');
    slides.push({ shapes, background: background && color(one(background, 'srgbClr')) });
  }
  return {
    kind: 'pptx',
    readOnly: true,
    notices: ['pptx-limitations', ...(ids.length > 100 ? ['preview-truncated'] : [])],
    width,
    height,
    slides,
  };
}

async function buildOfficePreview(input, extension, { extractText } = {}) {
  const bytes = Buffer.from(input),
    ext = extension.toLowerCase();
  let layoutError;
  try {
    if (ext === '.docx') return await docxModel(bytes);
    if (['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.csv', '.tsv'].includes(ext))
      return await sheetModel(bytes, ext);
    if (ext === '.pptx') return await pptxModel(bytes);
  } catch (error) {
    layoutError = error;
  }
  try {
    const text = extractText
      ? await extractText(bytes, ext)
      : ['.doc', '.docx', '.docm', '.dot', '.dotx'].includes(ext)
        ? await require('./word.cjs').wordText(bytes, '')
        : ext === '.pptx'
          ? await require('./document-ppt.cjs')(bytes, ext)
          : await require('./document.cjs').documentText(bytes, ext, '');
    return {
      kind: 'text',
      readOnly: true,
      notices: [layoutError ? 'unsupported-layout' : 'legacy-layout'],
      text,
    };
  } catch (error) {
    throw layoutError || error;
  }
}
module.exports = { buildOfficePreview };
