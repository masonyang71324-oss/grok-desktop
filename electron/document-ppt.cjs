const CFB = require('cfb');
const path = require('node:path').posix;
const {
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

// MS-PPT §2.1.2: live records are resolved through Current User, the edit chain,
// and the current DocumentContainer lists. Scanning all TextAtoms leaks dead edits.
// https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/1fc22d56-28f9-4818-bd45-67c2bf721ccf
function readBinary(bytes, output) {
  const cfb = CFB.read(bytes, { type: 'buffer' });
  const currentEntry = CFB.find(cfb, '/Current User');
  const streamEntry = CFB.find(cfb, '/PowerPoint Document');
  if (!currentEntry || !streamEntry) throw error('unsupported');
  const current = Buffer.from(currentEntry.content);
  const stream = Buffer.from(streamEntry.content);
  let count = 0;
  function record(buffer, offset, end = buffer.length, type) {
    if (++count > 250000) throw error('text-limit');
    if (!Number.isInteger(offset) || offset < 0 || offset + 8 > end)
      throw error('parse-failed', 'Invalid PPT record offset');
    const flags = buffer.readUInt16LE(offset);
    const recType = buffer.readUInt16LE(offset + 2);
    const start = offset + 8;
    const limit = start + buffer.readUInt32LE(offset + 4);
    if (limit > end || (type !== undefined && type !== recType))
      throw error('parse-failed', 'Invalid PPT record');
    return {
      type: recType,
      version: flags & 15,
      instance: flags >>> 4,
      start,
      end: limit,
      length: limit - start,
    };
  }
  const u32 = (r, offset) => {
    if (offset + 4 > r.length) throw error('parse-failed');
    return stream.readUInt32LE(r.start + offset);
  };
  function children(parent) {
    const result = [];
    for (let pos = parent.start; pos < parent.end;) {
      const child = record(stream, pos, parent.end);
      result.push(child);
      pos = child.end;
    }
    return result;
  }
  const user = record(current, 0, current.length, 4086);
  if (user.length < 20) throw error('parse-failed');
  if (current.readUInt32LE(user.start + 4) !== 0xe391c05f || current[user.start + 16] !== 3)
    throw error('unsupported', 'Encrypted or unsupported PowerPoint version');
  let editOffset = current.readUInt32LE(user.start + 8);
  const visited = new Set();
  const directory = new Map();
  let docId;
  do {
    if (visited.has(editOffset)) throw error('parse-failed', 'Cyclic PPT edit chain');
    visited.add(editOffset);
    const edit = record(stream, editOffset, stream.length, 4085);
    if (edit.length < 28) throw error('parse-failed');
    if (edit.length >= 32 && u32(edit, 28) !== 0)
      throw error('unsupported', 'Encrypted PowerPoint');
    docId ??= u32(edit, 16);
    const persist = record(stream, u32(edit, 12), stream.length, 6002);
    for (let pos = persist.start; pos < persist.end;) {
      if (pos + 4 > persist.end) throw error('parse-failed');
      const packed = stream.readUInt32LE(pos);
      pos += 4;
      const firstId = packed & 0xfffff;
      const length = packed >>> 20;
      if (!firstId || !length || pos + length * 4 > persist.end) throw error('parse-failed');
      for (let i = 0; i < length; i++, pos += 4) {
        // Newest entries win; old directories still supply unchanged objects.
        if (!directory.has(firstId + i)) directory.set(firstId + i, stream.readUInt32LE(pos));
      }
    }
    editOffset = u32(edit, 8);
  } while (editOffset !== 0);
  function resolve(id, type) {
    if (!directory.has(id)) throw error('parse-failed', 'Missing PPT persist reference');
    const result = record(stream, directory.get(id), stream.length, type);
    if (result.version !== 15) throw error('parse-failed');
    return result;
  }
  const document = resolve(docId, 1000);
  const lists = children(document).filter((r) => r.type === 4080);
  const slides = [];
  const notes = new Map();
  function textAtom(r) {
    if (r.type === 4000 && r.length % 2) throw error('parse-failed');
    // TextBytesAtom is compressed Unicode (high byte zero), not the system codepage.
    return stream
      .subarray(r.start, r.end)
      .toString(r.type === 4000 ? 'utf16le' : 'latin1')
      .replace(/[\r\v]/g, '\n')
      .replace(/\0/g, '');
  }
  for (const list of lists) {
    if (list.instance === 0) {
      let slide;
      for (const child of children(list)) {
        if (child.type === 1011) {
          if (child.length < 20) throw error('parse-failed');
          slide = { persistId: u32(child, 0), id: u32(child, 12), outlines: [] };
          slides.push(slide);
        } else if (child.type === 3999) {
          if (!slide) throw error('parse-failed');
          slide.outlines.push('');
        } else if ([4000, 4008].includes(child.type)) {
          if (!slide?.outlines.length) throw error('parse-failed');
          slide.outlines[slide.outlines.length - 1] += textAtom(child);
        }
      }
    } else if (list.instance === 2) {
      for (const child of children(list).filter((r) => r.type === 1011))
        notes.set(u32(child, 12), u32(child, 0));
    }
  }
  let hasText = false;
  const addText = (value) => {
    if (value.trim()) hasText = true;
    output.add(value + '\n');
  };
  function drawingText(container, outlines = []) {
    const used = new Set();
    function walk(parent, depth = 0) {
      if (depth > 64) throw error('text-limit');
      for (const child of children(parent)) {
        if (child.type === 0xf00d) {
          for (const atom of children(child)) {
            if ([4000, 4008].includes(atom.type)) addText(textAtom(atom));
            else if (atom.type === 3998) {
              const index = u32(atom, 0);
              if (index >= outlines.length) throw error('parse-failed', 'Missing PPT outline text');
              addText(outlines[index]);
              used.add(index);
            }
          }
        } else if ([1036, 0xf002, 0xf003, 0xf004].includes(child.type)) walk(child, depth + 1);
      }
    }
    walk(container);
    // Some compatible writers keep placeholder text solely in the live slide list.
    outlines.forEach((value, index) => {
      if (!used.has(index)) addText(value);
    });
  }
  for (const [index, slide] of slides.entries()) {
    const slideRecord = resolve(slide.persistId, 1006);
    output.add(`[Slide ${index + 1}]\n`);
    drawingText(slideRecord, slide.outlines);
    const atom = children(slideRecord).find((r) => r.type === 1007);
    if (!atom || atom.length < 24) throw error('parse-failed');
    const notesId = u32(atom, 16);
    if (notesId) {
      if (!notes.has(notesId)) throw error('parse-failed', 'Missing PPT notes');
      const noteRecord = resolve(notes.get(notesId), 1008);
      const noteAtom = children(noteRecord).find((r) => r.type === 1009);
      if (!noteAtom || u32(noteAtom, 0) !== slide.id)
        throw error('parse-failed', 'Invalid PPT notes association');
      output.add('[Notes]\n');
      drawingText(noteRecord);
    }
    output.add('\n');
  }
  if (!hasText) throw error('empty');
}

const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const PML = [
  'http://schemas.openxmlformats.org/presentationml/2006/main',
  'http://purl.oclc.org/ooxml/presentationml/main',
];
const DML = [
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main',
];
async function readOoxml(bytes, output) {
  const zip = await readZip(bytes);
  if (!zip.has('_rels/.rels')) throw error('unsupported');
  async function relationships(part) {
    const file = part
      ? path.join(path.dirname(part), '_rels', path.basename(part) + '.rels')
      : '_rels/.rels';
    if (!zip.has(file)) return [];
    const root = parseXml(await zip.read(file));
    if (root.local !== 'Relationships' || root.uri !== REL) throw error('parse-failed');
    return elements(root, 'Relationship', REL).map((n) => ({
      id: attr(n, 'Id'),
      type: attr(n, 'Type'),
      target: attr(n, 'Target'),
      external: attr(n, 'TargetMode') === 'External',
    }));
  }
  const main = (await relationships('')).find((r) => r.type?.endsWith('/officeDocument'));
  if (!main || main.external) throw error('unsupported');
  const presentationPath = resolvePath('', main.target);
  const presentation = parseXml(await zip.read(presentationPath));
  if (presentation.local !== 'presentation' || !PML.includes(presentation.uri))
    throw error('unsupported');
  const rels = await relationships(presentationPath);
  const slideList = elements(presentation, 'sldIdLst', presentation.uri)[0];
  if (!slideList) throw error('empty');
  let hasText = false;
  async function partText(part, expectedRoot) {
    const root = parseXml(await zip.read(part));
    if (root.local !== expectedRoot || !PML.includes(root.uri)) throw error('parse-failed');
    const common = elements(root, 'cSld', root.uri)[0];
    if (!common) throw error('parse-failed');
    function visit(node) {
      if (node.local === 'sp' && expectedRoot === 'notes') {
        const placeholder = descendants(node, 'ph', root.uri)[0];
        if (
          placeholder &&
          ['sldNum', 'hdr', 'ftr', 'dt', 'sldImg'].includes(attr(placeholder, 'type'))
        )
          return;
      }
      if (DML.includes(node.uri) && node.local === 't') {
        const value = content(node);
        if (value.trim()) hasText = true;
        output.add(value);
      } else {
        for (const child of elements(node)) visit(child);
        if (DML.includes(node.uri) && ['p', 'br'].includes(node.local)) output.add('\n');
      }
    }
    visit(common);
  }
  for (const [index, slide] of elements(slideList, 'sldId', presentation.uri).entries()) {
    const refId = Object.values(slide.attrs).find((a) => a.local === 'id' && a.uri)?.value;
    const rel = rels.find((r) => r.id === refId && r.type?.endsWith('/slide'));
    if (!rel || rel.external) throw error('parse-failed');
    const slidePath = resolvePath(presentationPath, rel.target);
    output.add(`[Slide ${index + 1}]\n`);
    await partText(slidePath, 'sld');
    for (const note of (await relationships(slidePath)).filter((r) =>
      r.type?.endsWith('/notesSlide'),
    )) {
      if (note.external) throw error('parse-failed');
      output.add('[Notes]\n');
      await partText(resolvePath(slidePath, note.target), 'notes');
    }
    output.add('\n');
  }
  if (!hasText) throw error('empty');
}

module.exports = async function extractPresentation(bytes, extension) {
  try {
    const ext = extension.toLowerCase().replace(/^\./, '');
    if (
      ![
        'ppt',
        'pps',
        'pot',
        'dps',
        'dpt',
        'pptx',
        'pptm',
        'ppsx',
        'ppsm',
        'potx',
        'potm',
        'uop',
      ].includes(ext)
    )
      throw error('unsupported');
    const buffer = Buffer.from(bytes);
    const output = createOutput();
    if (buffer.subarray(0, 2).equals(Buffer.from('PK'))) await readOoxml(buffer, output);
    else if (buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')))
      readBinary(buffer, output);
    else throw error('unsupported');
    return output.finish();
  } catch (err) {
    if (['empty', 'text-limit', 'unsupported', 'parse-failed'].includes(err.code)) throw err;
    throw error('parse-failed', err.message);
  }
};
