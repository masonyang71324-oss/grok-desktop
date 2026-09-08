# Synthetic spreadsheet fixtures

These fixtures were authored for this project and contain no user data.

- `chinese.fods`: independent flat OpenDocument spreadsheet XML with a Chinese
  sheet name, leading-zero identifier, displayed Chinese date, currency, and an
  OpenFormula expression with cached display text.
- `chinese.uos`: minimal UOF XML exercising the Chinese element names understood
  by SheetJS (`工作表`, `行`, `数据`, `文本串`). This covers that XML representation,
  not every UOS/UOF version or proprietary archive variant.

`tests/document-sheets.test.cjs` generates BIFF8, XLSX, XLSM, XLSB and ODS files
using SheetJS's writer with hand-checked literal expectations. XLTX/XLTM fixtures
use the corresponding template content types; OTS uses the template media type.
ET/ETT and XLT exercise BIFF8-compatible content under those extensions. They were
not exported from WPS and do not establish compatibility with proprietary WPS
variants. The module rejects unrecognized structures.

HTML table exports under XLS/ET are generated in UTF-8 with BOM, UTF-16LE with
BOM, and GB18030. Their literal Chinese dates and leading-zero identifiers are
preserved as strings.

Malformed and sparse XLSX cases edit actual worksheet XML in the generated ZIP.
The sparse fixture has only two cells despite a full-size worksheet dimension.
