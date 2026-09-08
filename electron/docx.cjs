'use strict';
const { StringDecoder } = require('node:string_decoder');
const OpenOfficeExtractor = require('word-extractor/lib/open-office-extractor');
const BufferReader = require('word-extractor/lib/buffer-reader');

// word-extractor is pinned to 1.0.4: retain its document semantics while fixing
// split UTF-8 chunks and modern textboxes without duplicating alternate markup.
class DocxExtractor extends OpenOfficeExtractor {
  createXmlParser() {
    const parser = super.createXmlParser();
    const decoder = new StringDecoder('utf8');
    const write = parser.write.bind(parser);
    const close = parser.close.bind(parser);
    parser.write = (chunk) => write(Buffer.isBuffer(chunk) ? decoder.write(chunk) : chunk);
    parser.close = () => {
      write(decoder.end());
      return close();
    };
    const alternates = [];
    let skipped = 0;
    parser.on('opentag', (node) => {
      if (skipped) {
        skipped++;
        return;
      }
      if (node.name === 'mc:AlternateContent') alternates.push({ chosen: false });
      const alternate = alternates.at(-1);
      if (alternate && (node.name === 'mc:Choice' || node.name === 'mc:Fallback')) {
        if (alternate.chosen) {
          skipped = 1;
          return;
        }
        alternate.chosen = true;
      }
      this.handleOpenTag(node);
    });
    parser.on('closetag', (node) => {
      if (skipped) {
        skipped--;
        return;
      }
      this.handleCloseTag(node);
      if (node.name === 'mc:AlternateContent') alternates.pop();
    });
    parser.on('text', (text) => {
      if (!skipped && ['content', 'cell', 'textbox'].includes(this._context?.[0]))
        this._pieces.push(text);
    });
    return parser;
  }

  handleCloseTag(node) {
    // The upstream implementation discards DrawingML textboxes because it
    // expects VML fallback text. Modern documents can omit that fallback.
    const drawingTextbox = node.name === 'w:txbxContent' && this._context?.[2] === 'drawing';
    const text = drawingTextbox ? this._pieces.join('') : '';
    const field = this._context?.includes('header') ? '_headerTextboxes' : '_textboxes';
    super.handleCloseTag(node);
    if (text) this._document[field] = [this._document[field], text].filter(Boolean).join('\n');
  }
}

module.exports = (bytes) => new DocxExtractor().extract(new BufferReader(bytes));
