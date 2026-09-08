# Common document attachments — 1.4.0

Goal: keep Attach → Preview → Send while accepting common Chinese office files.
User authorization: add common formats, prefer verified Grok Build native support,
preserve stability, simplicity, original files and failed drafts.

## Evidence and design

Grok Build 1.0.13 was probed with independent Chinese PDF, PPTX, XLSX, DOCX,
RTF, IPYNB, ODT and ODP fixtures. Its read_file reads PDF visually and PPTX
text, but rejects XLSX/DOCX/ODT/ODP as binary; RTF returns markup. The installed
tool description also identifies PDF/PPTX/IPYNB/images. See
https://x.ai/build/changelog (0.1.212 and 0.1.211).

Native PDF/PPTX/IPYNB use exact local paths with read_file instructions and a
preview explanation with an Open original button. Existing image behavior stays.
Other office files use bounded local worker extraction. No macros or external
converters run. Word keeps its verified extractor; compatible templates route
there too. Chinese UTF-8/BOM UTF-16/GB18030 text is decoded locally.

Built-in extraction: XLS/XLSX/XLSM/XLSB/ET/ETT/ODS/FODS/templates/CSV/TSV;
RTF, HTML, EML/MSG/MHT; ODT/ODP and OFD text; legacy PPT/PPS/POT/DPS/DPT
when their actual structure is supported. WPS/WPT use actual compatible Word
structures. Unknown proprietary variants must fail clearly, never expose binary
garbage or silently pretend success. CAJ/HN has no reliably general converter;
show an actionable viewer → PDF flow, retaining attachment/draft. Do not claim
universal CAJ support.

Document input limit 10 MB, extracted text 1 MB each / 4 MB combined, worker
timeout 30 seconds and bounded heap. Read current bytes, never modify originals.
Extraction output is text, not original layout, embedded images or signatures.
Sheet output includes sheet names, cell addresses, displayed values and formulas
without calculation. Email embedded attachments are listed, not opened.

## Tasks

- [x] Main: native route, worker supervisor, format routing, localized failures,
      preview and file picker updates. Tests for native routes, GBK/UTF-16, limits,
      unsupported CAJ, word preservation, worker timeout and malformed inputs.
- [x] Sheets and rich-text worker readers: `electron/document-sheets.cjs`,
      `electron/document-rich.cjs`; isolated tests and synthetic fixtures.
- [x] Structured/legacy document worker readers: `electron/document-structured.cjs`,
      `electron/document-ppt.cjs`; OFD page order, ODT/ODP, legacy active text tests.
- [x] Integrate, review, source/packaged Electron tests, build, audit new dependencies.
- [ ] Bilingual format matrix and release notes, package 1.4.0, CI, publish and
      update local launchers after verification (existing release authorization).

All extraction modules export async `(bytes, extension) => string` and use
errors with `code` = `empty`, `text-limit`, `unsupported` or `parse-failed`.
They run only in `document-worker.cjs`; main thread handles localization and
formatting. Shared ZIP/XML utilities may be owned by the structured reader task.

Ruling: broad format support does not mean accepting corrupt, encrypted or unknown
proprietary files. These require an explicit actionable error to honor reliability.

Verification: 237 tests passed, full source Electron regressions passed, packaged
Word/common-document/basic UI checks passed. Native probe and parser limitations
are recorded in attachment-formats.md. Independent review findings (RTF revisions,
EPUB declarations, BOM Word HTML and actual Word main-part aliases) were fixed
and verified. npm audit reports zero known vulnerabilities.
