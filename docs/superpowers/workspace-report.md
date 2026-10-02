# Workspace upgrades implementation report

Task B implements upgrades 5, 6, 7 and the resize control for 13. Root owns persisted settings and App/main/preload integration. Existing text extraction and prompt attachment preparation were not changed.

## Exports and integration

- `electron/workspace.cjs` exports `searchFiles({cwd,query='',limit=100})`, returning `{files:Attachment[],truncated:boolean}`. Register it as `workspace.search`. Paths are absolute; names are project-relative. Searches match names/paths, skip dot entries and the existing generated-directory set, stop after 100 matches or 20,000 examined entries, and use incremental `fs.opendir` iteration. An extra match, scan limit or unreadable subdirectory marks truncation.
- `electron/office-preview.cjs` exports `previewOffice({path:absolute}, {timeoutMs=30000}?)`. Register as `office.preview`. It reads original files without writes, caps input at 10 MB and runs parsing in a 256 MB worker. Completion/error/timeout settle once and terminate the worker. Application errors use current main-process language.
- `src/OfficePreview.tsx` default props: `{path:string,name?:string,onExternal?:()=>void}`. `canPreviewOffice(path)` is exported there and in `src/office-preview-model.ts`. Root should lazy-load OfficePreview in the attachment preview and provide external-open behavior. Inspector already lazy-loads it for workspace files. The own `OfficePreviewModel` type describes readonly DOCX/sheet/PPTX/text responses; root need not duplicate it in shared types.
- `src/ProjectFilePicker.tsx` default props: `{cwd,sessionId?,onClose,onSelect(files,owner),initialQuery?}`. `owner` is `{cwd,sessionId?}`. Query responses are scoped to owner and request version; owner changes clear selections, including different sessions in the same cwd. Root must additionally capture its authoritative draft key in the open/select closure so late results attach to the original draft. Add the composer button and optional explicit `@` action in App. Inspector also offers a search button and captures its add callback when opened.
- `src/DiffViewer.tsx` default props: `{text:string}`. `src/diff-model.mjs` exports `parseDiff`, `splitRows`, `foldContext`, `wordParts`. Raw text remains exact and Inspector's Add diff to context still submits that original text. Only display changes: unified/split, side-specific numbering, changed-line pairing, word marks and expandable context. Generated new-file/truncation metadata changes language; user file lines do not.
- `src/ResizeHandle.tsx` default props: `{axis:'horizontal'|'vertical',value,min,max,onChange,onCommit?,onReset?,label,reverse?,className?}`. Pointer movement calls `onChange`; pointer release/cancel commits the last bounded value. Arrow keys adjust 10 px, Shift+arrow 30 px, Home/End clamp to bounds. Double-click and Escape call `onReset`. Suggested persisted session/task and files width range: 200–480 px; composer: 90–360 px. Parent should derive rendered bounds from viewport (ensure min <= max), use `reverse:true` when dragging up increases composer height, and choose sidebarWidth for sessions/tasks or inspectorWidth for Files within the existing unified navigation. Parent supplies CSS placement and persistence/reset-to-auto behavior.
- Merge `workspaceUpgrades` from `src/locales/workspace-upgrades.ts` into renderer translations. Import `src/workspace-upgrades.css` centrally. Component files deliberately avoid CSS imports to retain compatibility with existing component-test bundling.

## Office behavior and limits

DOCX renders paragraphs, tables, images and ordinary document layout with docx-preview 0.4.1 in a same-origin sandboxed iframe without scripts. An iframe CSP blocks remote resources; document styles stay inside its document. HTML altChunks and their package targets are removed before rendering, and `renderAltChunks:false` provides a second explicit rendering restriction. Local embedded-font rendering is disabled; pagination/font/complex-object differences are declared.

Sheets have tabs, cell coordinates, saved number formatting, basic OOXML font/fill/alignment, merges and row/column dimensions. They show saved formula results and never calculate formulas. Empty/missing OOXML formula caches display blank rather than SheetJS's synthesized zero; formula and uncached state are available in cell tooltips. Each sheet preview is cropped to 200 rows/40 columns, at most 30 sheets, with a visible notice. Charts, conditional formatting and complex styles are declared limitations. CSV/TSV retain the original editable UTF-8 text path through an explicit Edit as text action in Inspector; the layout model itself is never writable.

PPTX renders static positioned text runs and embedded supported raster images using slide coordinates, basic run formatting, fill and rotation. Up to 100 slides are displayed. Master/layout-derived placeholders, grouped objects, charts and animation are explicitly outside fidelity guarantees. Unsupported layout structures use available extracted text when possible. Legacy DOC/PPT and related containers keep a labelled text fallback. External open remains available even on preview failure. Original send extraction/native-document behavior is unchanged.

## Verification evidence

Tests were introduced for missing diff/search/model/component behavior before implementation; unsupported-layout fallback also had a separate failing test before its implementation. The final bounded run passed **53/53**:

`node --test tests/inspector.test.cjs tests/workspace.test.cjs tests/i18n-components.test.cjs tests/workspace-upgrades.test.cjs tests/workspace-upgrades-components.test.cjs`

This includes real browser DOCX paragraph/table/image rendering and isolation, readonly sheet/no save IPC, unchanged source bytes via worker preview, pointer/keyboard resize, prior-project late search, same-project different-session selection reset, generated-label translation and all existing editor-save/CRLF/truncation protections. Updated only the existing diff numbering test's selector for the new row nesting; assertions remain the same.

Own source formatting check and diff whitespace check passed. TypeScript passed before concurrent root integration; the later check reported only the shared App event-union `sessionId` narrowing at App.tsx:673, communicated to root. Full suite, production/Electron packaged checks, persisted resizing and multilingual/small-window visual review remain root integration/release validation.

## Review corrections

Three confirmed review findings were reproduced before correction. PPTX slide relationships now select the namespace-qualified `r:id`, so ordinary numeric `id="256"` metadata cannot hide the real reference. The existing positioned-image fixture now includes both IDs; the repository's real `tests/fixtures/documents/native/sample.pptx` additionally verifies a complete standard package.

Diff parsing tracks each hunk's remaining old/new line counts. Added `++counter` and removed `--counter` are represented as `+++counter`/`---counter` in the raw diff, retain content/numbering, and are distinguished from subsequent file headers after the hunk ends.

Title/body placeholders with inherited master/layout positions retain readable text as per-slide `unpositionedText` instead of being silently omitted. The viewer shows this text and a bilingual layout notice; it suppresses an otherwise empty canvas for such slides. Positioned shapes still display normally. Coordinate inheritance/fidelity remains an explicit limitation.

The corrective regression run passed 23/23 (`workspace-upgrades`, `workspace-upgrades-components`, `i18n-components`), including the real PPTX fixture and visible fallback. TypeScript passed after current root integration. No shared integration files were edited for these corrections.
