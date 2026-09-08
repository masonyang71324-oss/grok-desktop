const XLSX = require('xlsx');
const JSZip = require('jszip');
const { SaxesParser } = require('saxes');
const path = require('node:path').posix;
const { decodeText } = require('./document-text.cjs');

const TEXT_LIMIT = 1024 * 1024;
const EXTENSIONS = new Set([
  'xls',
  'xlsx',
  'xlsm',
  'xlsb',
  'et',
  'ett',
  'xlt',
  'xltx',
  'xltm',
  'ods',
  'ots',
  'fods',
  'uos',
  'csv',
  'tsv',
]);
const failure = (code, message) => Object.assign(new Error(message), { code });

async function spreadsheetInput(bytes, extension) {
  if (extension === 'csv' || extension === 'tsv') return { source: decodeText(bytes) };
  if (bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) return { source: bytes };
  // SheetJS deliberately guesses text/CSV for almost any input. Only real
  // office containers or spreadsheet XML should reach that parser here.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = await JSZip.loadAsync(bytes);
    if (!zip.file('xl/workbook.xml') && !zip.file('xl/workbook.bin') && !zip.file('content.xml')) {
      throw failure('unsupported', 'No supported spreadsheet in this container');
    }
    const noCacheByPath = new Map();
    const relationships = new Map();
    for (const entry of Object.values(zip.files)) {
      if (
        entry.dir ||
        !/^(?:xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml|sharedStrings\.xml|styles\.xml)|content\.xml|styles\.xml)$/.test(
          entry.name,
        )
      )
        continue;
      const parser = new SaxesParser();
      const noCache = new Set();
      let cell;
      let inValue = false;
      parser.on('opentag', (tag) => {
        const local = tag.name.split(':').pop();
        if (local === 'Relationship')
          relationships.set(
            tag.attributes.Id,
            path.normalize(path.join('xl', tag.attributes.Target.replace(/^\//, '../'))),
          );
        if (local === 'c') cell = { address: tag.attributes.r, formula: false, value: false };
        if (cell && local === 'f') cell.formula = true;
        if (cell && local === 'v') inValue = true;
      });
      parser.on('text', (text) => {
        if (cell && inValue && text.trim()) cell.value = true;
      });
      parser.on('closetag', (tag) => {
        const local = tag.name.split(':').pop();
        if (local === 'v') inValue = false;
        if (local === 'c' && cell) {
          if (cell.formula && !cell.value) noCache.add(cell.address);
          cell = undefined;
        }
      });
      parser.write(await entry.async('string')).close();
      if (noCache.size) noCacheByPath.set(entry.name, noCache);
    }
    return { source: bytes, noCacheByPath, relationships };
  }
  // Older standalone BIFF workbooks start with a BOF record.
  if (bytes.length >= 8 && [0x0009, 0x0209, 0x0409, 0x0809].includes(bytes.readUInt16LE(0)))
    return { source: bytes };
  const xml = decodeText(bytes);
  // Many business systems export an HTML table with an Excel/WPS extension.
  // Keep raw string semantics so account numbers and Chinese dates survive.
  if (
    ['xls', 'xlt', 'et', 'ett'].includes(extension) &&
    /<table\b[^>]*>[\s\S]*<tr\b[^>]*>[\s\S]*<t[dh]\b[^>]*>[\s\S]*<\/table\s*>/i.test(xml)
  )
    return { source: xml };
  if (
    !/<(?:\w+:)?Workbook\b[^>]*urn:schemas-microsoft-com:office:spreadsheet|<(?:\w+:)?document\b[^>]*urn:oasis:names:tc:opendocument:xmlns:office|<uof:UOF\b/i.test(
      xml,
    )
  ) {
    throw failure('unsupported', 'Unrecognized spreadsheet structure');
  }
  new SaxesParser().write(xml).close();
  return { source: xml };
}

module.exports = async function extractSpreadsheet(input, extension) {
  try {
    const bytes = Buffer.from(input);
    const ext = String(extension).toLowerCase().replace(/^\./, '');
    if (!EXTENSIONS.has(ext)) throw failure('unsupported', 'Unsupported spreadsheet extension');
    if (!bytes.length) throw failure('empty', 'Empty spreadsheet');
    const { source, noCacheByPath, relationships } = await spreadsheetInput(bytes, ext);
    const workbook = XLSX.read(source, {
      type: typeof source === 'string' ? 'string' : 'buffer',
      raw: true,
      dense: false,
      cellFormula: true,
      sheetStubs: true,
      cellText: true,
      cellNF: true,
      cellHTML: false,
      dateNF: 'yyyy-mm-dd',
      xlfn: true,
      WTF: true,
      ...(ext === 'csv' || ext === 'tsv' ? { FS: ext === 'tsv' ? '\t' : ',' } : {}),
    });
    const lines = [];
    let size = 0;
    let cells = 0;
    function append(line) {
      size += Buffer.byteLength(line, 'utf8') + 1;
      if (size > TEXT_LIMIT) throw failure('text-limit', 'Spreadsheet text exceeds 1 MB');
      lines.push(line);
    }
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) throw failure('parse-failed', 'Worksheet was not parsed');
      append(`[Sheet: ${name}]`);
      const relationshipId = workbook.Workbook?.Sheets?.find((item) => item.name === name)?.id;
      const noCache = noCacheByPath?.get(relationships?.get(relationshipId));
      const addresses = Object.keys(sheet)
        .filter((key) => /^[A-Z]+[1-9]\d*$/.test(key))
        .map((address) => ({ address, ...XLSX.utils.decode_cell(address) }))
        .sort((a, b) => a.r - b.r || a.c - b.c);
      for (const { address } of addresses) {
        const cell = sheet[address];
        if ((cell.t === 'z' || cell.v == null) && !cell.f) continue;
        // SheetJS may invent zero for a formula without cached <v>. Preserve
        // that distinction: extraction must never fabricate a calculated value.
        const value = noCache?.has(address)
          ? ''
          : (cell.w ?? (cell.v == null ? '' : XLSX.utils.format_cell(cell)));
        if (!String(value).trim() && !cell.f) continue;
        append(`${address}: ${value}${cell.f ? ` [Formula: =${cell.f}]` : ''}`);
        cells++;
      }
      append('');
    }
    if (!cells) throw failure('empty', 'Spreadsheet has no readable cells');
    return lines.join('\n').trim();
  } catch (error) {
    if (['empty', 'text-limit', 'unsupported', 'parse-failed'].includes(error.code)) throw error;
    throw failure('parse-failed', error.message || 'Spreadsheet parsing failed');
  }
};
