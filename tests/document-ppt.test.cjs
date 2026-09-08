const { test } = require('node:test');
const assert = require('node:assert/strict');
const CFB = require('cfb');
const JSZip = require('jszip');
const extract = require('../electron/document-ppt.cjs');
const fs = require('node:fs');
const path = require('node:path');

function record(type, data = Buffer.alloc(0), version = 0, instance = 0) {
  const header = Buffer.alloc(8);
  header.writeUInt16LE((instance << 4) | version);
  header.writeUInt16LE(type, 2);
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data]);
}
const container = (type, children, instance = 0) =>
  record(type, Buffer.concat(children), 15, instance);
const uint = (value) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
};
const text = (value) => [record(3999, uint(1)), record(4000, Buffer.from(value, 'utf16le'))];
const textbox = (records) => record(0xf00d, Buffer.concat(records));
const drawing = (boxes) =>
  container(1036, [
    container(0xf002, [
      container(
        0xf003,
        boxes.map((box) => container(0xf004, [box])),
      ),
    ]),
  ]);
function slide(value, notes = 0, outline = false) {
  const atom = Buffer.alloc(24);
  atom.writeUInt32LE(1, 12);
  atom.writeUInt32LE(notes, 16);
  return container(1006, [
    record(1007, atom, 2),
    drawing([textbox(outline ? [record(3998, uint(0)), ...text(value)] : text(value))]),
  ]);
}
function persist(id, slideId, texts = 0) {
  return record(1011, Buffer.concat([uint(id), uint(0), uint(texts), uint(slideId), uint(0)]));
}
function doc(slides, notes = []) {
  return container(1000, [
    record(1001, Buffer.alloc(40), 1),
    container(4080, slides),
    container(4080, notes, 2),
  ]);
}
function fixture({ encrypted = false, broken = false, longText = false } = {}) {
  const parts = [];
  let offset = 0;
  const append = (b) => {
    const old = offset;
    parts.push(b);
    offset += b.length;
    return old;
  };
  const oldDoc = append(doc([persist(2, 256), persist(3, 257)]));
  const oldSlide = append(slide('旧修订内容'));
  const deletedSlide = append(slide('已删除幻灯片秘密'));
  const unchangedSlide = append(slide('仍保留的第二页'));
  const oldNotes = append(
    container(1008, [
      record(1009, Buffer.concat([uint(256), uint(0)]), 1),
      drawing([textbox(text('已删除备注'))]),
    ]),
  );
  const dir = (entries) =>
    record(6002, Buffer.concat(entries.flatMap(([id, loc]) => [uint((1 << 20) | id), uint(loc)])));
  const edit = (previous, directory) =>
    record(
      4085,
      Buffer.concat([
        uint(256),
        Buffer.from([0, 0, 0, 3]),
        uint(previous),
        uint(directory),
        uint(1),
        uint(8),
        uint(0),
      ]),
    );
  const oldDir = append(
    dir([
      [1, oldDoc],
      [2, oldSlide],
      [3, deletedSlide],
      [4, unchangedSlide],
      [5, oldNotes],
    ]),
  );
  const oldEdit = append(edit(0, oldDir));
  const currentDoc = append(
    doc([persist(4, 258), persist(2, 256, 1), ...text('当前中文标题')], [persist(6, 1001)]),
  );
  const currentSlide = append(slide(longText ? '中'.repeat(350000) : '当前正文', 1001, true));
  const currentNotes = append(
    container(1008, [
      record(1009, Buffer.concat([uint(256), uint(0)]), 1),
      drawing([
        textbox([
          ...text('当前演讲备注'),
          record(3999, uint(1)),
          record(4008, Buffer.from([0x63, 0x61, 0x66, 0xe9])),
        ]),
      ]),
    ]),
  );
  const newDir = append(
    dir([
      [1, currentDoc],
      [2, broken ? 0xffffff00 : currentSlide],
      [6, currentNotes],
    ]),
  );
  const newEdit = append(edit(oldEdit, newDir));
  const current = Buffer.alloc(24);
  current.writeUInt32LE(20);
  current.writeUInt32LE(encrypted ? 0xf3d1c4df : 0xe391c05f, 4);
  current.writeUInt32LE(newEdit, 8);
  current.writeUInt16LE(0x03f4, 14);
  current[16] = 3;
  current.writeUInt32LE(8, 20);
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, 'Current User', record(4086, current));
  CFB.utils.cfb_add(cfb, 'PowerPoint Document', Buffer.concat(parts));
  return CFB.write(cfb, { type: 'buffer' });
}

test('legacy PPT resolves current revisions, ordered live slides, outlines and associated notes', async () => {
  for (const ext of ['ppt', 'pps', 'pot', 'dps', 'dpt']) {
    const result = await extract(fixture(), ext);
    assert.ok(result.indexOf('仍保留的第二页') < result.indexOf('当前中文标题'));
    assert.match(result, /当前正文/);
    assert.match(result, /当前演讲备注/);
    assert.match(result, /café/);
    assert.equal(result.split('当前中文标题').length - 1, 1);
    assert.doesNotMatch(result, /旧修订|已删除/);
  }
});

test('legacy PPT rejects encryption, broken persist offsets, unknown WPS bytes and oversized text', async () => {
  await assert.rejects(extract(fixture({ encrypted: true }), 'ppt'), { code: 'unsupported' });
  await assert.rejects(extract(fixture({ broken: true }), 'ppt'), { code: 'parse-failed' });
  await assert.rejects(extract(Buffer.from('WPS proprietary presentation'), 'dps'), {
    code: 'unsupported',
  });
  await assert.rejects(extract(fixture({ longText: true }), 'ppt'), { code: 'text-limit' });
});

async function zippedPresentation() {
  const zip = new JSZip();
  const rels = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  zip.file(
    '_rels/.rels',
    `<Relationships xmlns="${rels}"><Relationship Id="r1" Type="${r}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation xmlns:p="${p}" xmlns:r="${r}"><p:sldIdLst><p:sldId id="257" r:id="s2"/><p:sldId id="256" r:id="s1"/></p:sldIdLst></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships xmlns="${rels}"><Relationship Id="s1" Type="${r}/slide" Target="slides/slide1.xml"/><Relationship Id="s2" Type="${r}/slide" Target="slides/slide2.xml"/></Relationships>`,
  );
  const slideXml = (value, tag = 'sld') =>
    `<p:${tag} xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${value}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:${tag}>`;
  zip.file('ppt/slides/slide1.xml', slideXml('一：中文&amp;内容'));
  zip.file('ppt/slides/slide2.xml', slideXml('二：先展示'));
  zip.file('ppt/slides/slide3.xml', slideXml('已删除的页'));
  zip.file(
    'ppt/slides/_rels/slide2.xml.rels',
    `<Relationships xmlns="${rels}"><Relationship Id="n1" Type="${r}/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
  );
  zip.file('ppt/notesSlides/notesSlide1.xml', slideXml('中文备注', 'notes'));
  return zip.generateAsync({ type: 'nodebuffer' });
}
test('OOXML presentation aliases and compatible WPS ZIP follow relationships and slide order', async () => {
  const bytes = await zippedPresentation();
  for (const ext of ['pptm', 'ppsx', 'ppsm', 'potx', 'potm', 'dps', 'dpt']) {
    const result = await extract(bytes, ext);
    assert.ok(result.indexOf('二：先展示') < result.indexOf('一：中文&内容'));
    assert.match(result, /中文备注/);
    assert.doesNotMatch(result, /已删除/);
  }
});

test('OOXML presentation fails on missing slide references and does not call labels extracted text', async () => {
  const original = await zippedPresentation();
  const broken = await JSZip.loadAsync(original);
  broken.remove('ppt/slides/slide2.xml');
  await assert.rejects(extract(await broken.generateAsync({ type: 'nodebuffer' }), 'pptm'), {
    code: 'parse-failed',
  });
  const empty = await JSZip.loadAsync(original);
  for (const part of [
    'ppt/slides/slide1.xml',
    'ppt/slides/slide2.xml',
    'ppt/notesSlides/notesSlide1.xml',
  ]) {
    empty.file(
      part,
      (await empty.file(part).async('string')).replace(/<a:t>.*?<\/a:t>/g, '<a:t/>'),
    );
  }
  await assert.rejects(extract(await empty.generateAsync({ type: 'nodebuffer' }), 'potx'), {
    code: 'empty',
  });
});

test('legacy PPT edit cycles fail explicitly instead of hanging', async () => {
  const cfb = CFB.read(fixture(), { type: 'buffer' });
  const user = CFB.find(cfb, '/Current User').content;
  const editOffset = user.readUInt32LE(16);
  CFB.find(cfb, '/PowerPoint Document').content.writeUInt32LE(editOffset, editOffset + 16);
  await assert.rejects(extract(CFB.write(cfb, { type: 'buffer' }), 'ppt'), {
    code: 'parse-failed',
  });
});

test('Apache POI PowerPoint sample preserves both slides and their associated notes', async () => {
  const bytes = fs.readFileSync(
    path.join(__dirname, 'fixtures/documents/structured-legacy/basic_test_ppt_file.ppt'),
  );
  assert.equal(
    await extract(bytes, 'ppt'),
    '[Slide 1]\nThis is a test title\nThis is a test subtitle\nThis is on page 1\n[Notes]\nThese are the notes for page 1\n\n[Slide 2]\nThis is the title on page 2\nThis is page two\nIt has several blocks of text\nNone of them have formatting\n[Notes]\nThese are the notes on page two, again lacking formatting',
  );
});

test('Apache POI CJK sample preserves compressed, full-width and supplementary Unicode', async () => {
  const bytes = fs.readFileSync(
    path.join(__dirname, 'fixtures/documents/structured-legacy/54880_chinese.ppt'),
  );
  const result = await extract(bytes, 'ppt');
  assert.match(result, /複数の文字/);
  assert.match(result, /ﾊﾝｶｸ/);
  assert.match(result, /表Mixパﾋﾟ𠮟/);
});

test('Apache POI SampleShow matches independently maintained source text', async () => {
  const dir = path.join(__dirname, 'fixtures/documents/structured-legacy');
  const result = await extract(fs.readFileSync(path.join(dir, 'SampleShow.ppt')), 'ppt');
  // The source text also lists metadata and presentation labels; this reader
  // exposes slide/notes content. Bullet glyphs are formatting in the source.
  const expected = fs
    .readFileSync(path.join(dir, 'SampleShow.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((s) => s.trim() && !s.includes(' = ') && !s.startsWith('('))
    .map((s) => s.replace(/^\* /, ''));
  for (const line of expected) assert.ok(result.includes(line), `Missing source text: ${line}`);
});
