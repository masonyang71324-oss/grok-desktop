// Exact subset used by our word-extractor 1.0.4 subclass. The package ships JavaScript only.
declare module 'word-extractor/lib/open-office-extractor' {
  interface ExtractedWordDocument {
    _textboxes: string;
    _headerTextboxes: string;
    getBody(options?: object): string;
    getFootnotes(options?: object): string;
    getEndnotes(options?: object): string;
    getHeaders(options?: object): string;
    getFooters(options?: object): string;
    getAnnotations(options?: object): string;
    getTextboxes(options?: object): string;
  }
  class OpenOfficeExtractor {
    _streamTypes: Record<string, boolean>;
    _context: [string, ...(string | string[])[]] | null;
    _pieces: string[];
    _document: ExtractedWordDocument;
    createXmlParser(): import('saxes').SaxesParser<{}>;
    handleOpenTag(node: import('saxes').SaxesTagPlain): void;
    handleCloseTag(node: import('saxes').SaxesTagPlain): void;
    extract(reader: unknown): Promise<ExtractedWordDocument>;
  }
  export = OpenOfficeExtractor;
}
