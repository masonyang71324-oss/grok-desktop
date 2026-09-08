const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const iconv = require('iconv-lite');
const JSZip = require('jszip');
const fs = require('node:fs');
const path = require('node:path');
const extract = require('../electron/document-sheets.cjs');

function workbook() {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['客户编号', '日期', '金额'],
    ['00123', 45000, 12.5],
  ]);
  sheet.B2 = { t: 'd', v: new Date('2023-03-15T00:00:00Z'), z: 'yyyy"-"mm"-"dd', w: '2023-03-15' };
  sheet.C2.z = '0.00';
  sheet.C2.w = '12.50';
  sheet.D2 = { t: 'n', v: 999, f: 'C2*2' };
  sheet.E2 = { t: 'n', v: 7, z: '00000', w: '00007' };
  sheet['!ref'] = 'A1:E2';
  XLSX.utils.book_append_sheet(book, sheet, '客户清单');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['第二张表']]), '汇总');
  return book;
}

for (const [extension, bookType] of [
  ['.xlsx', 'xlsx'],
  ['.xlsm', 'xlsm'],
  ['.xlsb', 'xlsb'],
  ['.xls', 'biff8'],
  ['.et', 'biff8'],
  ['.ett', 'biff8'],
  ['.xlt', 'biff8'],
  ['.xltx', 'xlsx'],
  ['.xltm', 'xlsm'],
  ['.ods', 'ods'],
  ['.ots', 'ods'],
  ['.fods', 'fods'],
]) {
  test(`${extension} preserves Chinese sheets, identifiers and meaningful dates`, async () => {
    let bytes = XLSX.write(workbook(), { type: 'buffer', bookType });
    if (extension === '.xltx' || extension === '.xltm') {
      const zip = await JSZip.loadAsync(bytes);
      const types = await zip.file('[Content_Types].xml').async('string');
      zip.file(
        '[Content_Types].xml',
        types
          .replace('spreadsheetml.sheet.main+xml', 'spreadsheetml.template.main+xml')
          .replace(
            'ms-excel.sheet.macroEnabled.main+xml',
            'ms-excel.template.macroEnabled.main+xml',
          ),
      );
      bytes = await zip.generateAsync({ type: 'nodebuffer' });
    } else if (extension === '.ots') {
      const zip = await JSZip.loadAsync(bytes);
      zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet-template');
      const manifest = await zip.file('META-INF/manifest.xml').async('string');
      zip.file(
        'META-INF/manifest.xml',
        manifest.replaceAll(
          'application/vnd.oasis.opendocument.spreadsheet',
          'application/vnd.oasis.opendocument.spreadsheet-template',
        ),
      );
      bytes = await zip.generateAsync({ type: 'nodebuffer' });
    }
    const text = await extract(bytes, extension);
    assert.match(text, /客户清单/);
    assert.match(text, /A2[^\n]*00123/);
    assert.match(text, /B2[^\n]*2023-03-15/);
    assert.match(text, /C2[^\n]*12\.50/);
    assert.match(text, /E2[^\n]*00007/);
    assert.match(text, /汇总[\s\S]*第二张表/);
  });
}

test('XLSX keeps cached display and formula without calculation', async () => {
  const bytes = XLSX.write(workbook(), { type: 'buffer', bookType: 'xlsx' });
  assert.match(await extract(bytes, '.xlsx'), /D2[^\n]*999[^\n]*C2\*2/);
});

test('independent FODS fixture preserves rendered date, currency and formula', async () => {
  const text = await extract(
    fs.readFileSync(path.join(__dirname, 'fixtures/documents/sheets/chinese.fods')),
    '.fods',
  );
  assert.match(text, /A1[^\n]*00123/);
  assert.match(text, /B1[^\n]*2026年09月08日/);
  assert.match(text, /C1[^\n]*¥12\.50/);
  assert.match(text, /D1[^\n]*25\.00[^\n]*C1\*2/);
});

test('UOS recognizes UOF spreadsheet XML with Chinese tag names', async () => {
  const text = await extract(
    fs.readFileSync(path.join(__dirname, 'fixtures/documents/sheets/chinese.uos')),
    '.uos',
  );
  assert.match(text, /中文工作表/);
  assert.match(text, /A1[^\n]*客户编号/);
  assert.match(text, /B1[^\n]*00123/);
});

test('malformed spreadsheet XML cannot silently produce partial cells', async () => {
  const source = fs.readFileSync(
    path.join(__dirname, 'fixtures/documents/sheets/chinese.fods'),
    'utf8',
  );
  await assert.rejects(extract(Buffer.from(source.replace('</office:document>', '')), '.fods'), {
    code: 'parse-failed',
  });
});

test('malformed worksheet inside XLSX cannot silently produce partial cells', async () => {
  const zip = await JSZip.loadAsync(XLSX.write(workbook(), { type: 'buffer', bookType: 'xlsx' }));
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  zip.file('xl/worksheets/sheet1.xml', sheet.replace('</worksheet>', ''));
  await assert.rejects(extract(await zip.generateAsync({ type: 'nodebuffer' }), '.xlsx'), {
    code: 'parse-failed',
  });
});

test('formula-only cells remain available without a cached numeric value', async () => {
  const zip = await JSZip.loadAsync(XLSX.write(workbook(), { type: 'buffer', bookType: 'xlsx' }));
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  for (const source of [sheet, sheet.replace('r="D2" t="n"', 'r="D2"')]) {
    zip.file('xl/worksheets/sheet1.xml', source.replace('<v>999</v>', ''));
    const result = await extract(await zip.generateAsync({ type: 'nodebuffer' }), '.xlsx');
    assert.match(result, /D2[^\n]*C2\*2/);
    assert.doesNotMatch(result, /D2: 0/);
  }
});

test('large sparse worksheet visits populated cells in row order', async () => {
  const zip = await JSZip.loadAsync(XLSX.write(workbook(), { type: 'buffer', bookType: 'xlsx' }));
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:XFD1048576"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>开始</t></is></c></row><row r="1048576"><c r="XFD1048576" t="inlineStr"><is><t>末尾</t></is></c></row></sheetData></worksheet>`,
  );
  const text = await extract(await zip.generateAsync({ type: 'nodebuffer' }), '.xlsx');
  assert.match(text, /A1[^\n]*开始[\s\S]*XFD1048576[^\n]*末尾/);
  assert.ok(text.length < 200);
});

for (const [encoding, extension, separator] of [
  ['utf8', '.csv', ','],
  ['utf16le', '.tsv', '\t'],
  ['gb18030', '.csv', ','],
]) {
  test(`${encoding} ${extension} preserves identifiers and literal formulas`, async () => {
    const source = `编号${separator}说明\n00123${separator}中文\n00007${separator}=1+2`;
    const bytes = iconv.encode(source, encoding, { addBOM: encoding === 'utf16le' });
    const text = await extract(bytes, extension);
    assert.match(text, /A2[^\n]*00123/);
    assert.match(text, /B2[^\n]*中文/);
    assert.match(text, /B3[^\n]*=1\+2/);
  });
}

for (const [encoding, extension] of [
  ['utf8', '.xls'],
  ['utf16le', '.et'],
  ['gb18030', '.xls'],
]) {
  test(`HTML table exported as ${extension} in ${encoding} preserves Chinese and identifiers`, async () => {
    const source = `<html><head><meta charset="${encoding}"></head><body><table><tr><th>客户编号</th><th>日期</th></tr><tr><td>00123</td><td>2026年9月8日</td></tr><tr><td>00007</td><td>中文客户</td></tr></table></body></html>`;
    const bytes = iconv.encode(source, encoding, { addBOM: encoding !== 'gb18030' });
    const result = await extract(bytes, extension);
    assert.match(result, /A1[^\n]*客户编号/);
    assert.match(result, /A2[^\n]*00123/);
    assert.match(result, /B2[^\n]*2026年9月8日/);
    assert.match(result, /A3[^\n]*00007/);
    assert.match(result, /B3[^\n]*中文客户/);
  });
}

test('random text and unrelated ZIP cannot impersonate office spreadsheets', async () => {
  for (const extension of ['.xlsx', '.xls', '.et', '.ett', '.uos']) {
    await assert.rejects(extract(Buffer.from('hello,world'), extension), { code: 'unsupported' });
  }
  const zip = new JSZip().file('hello.txt', 'hello');
  await assert.rejects(extract(await zip.generateAsync({ type: 'nodebuffer' }), '.xlsx'), {
    code: 'unsupported',
  });
});

test('empty spreadsheets and oversized output fail explicitly', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), '空表');
  await assert.rejects(extract(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), '.xlsx'), {
    code: 'empty',
  });
  await assert.rejects(extract(Buffer.from('汉'.repeat(360000)), '.csv'), { code: 'text-limit' });
});
