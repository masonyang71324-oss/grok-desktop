# Grok Desktop 1.4.0

## 中文

- 接通 Grok Build 原生 PDF、PPTX、Jupyter 附件读取，支持 PDF 扫描页。
- 新增 Excel/WPS 表格、旧版 PPT/WPS 演示、OFD、开放文档、RTF、邮件与 EPUB 文字提取，以及 Word/Office 模板和宏文档的只读提取。
- 支持 GBK/GB18030、带 BOM 的 UTF-16 中文文本，减少乱码。
- 添加附件后点击预览，可核对提取内容或用默认程序打开原文件；无需额外配置或安装 Office。
- 后台读取有超时和大小限制，失败保留草稿和附件，不修改原文件、不运行宏或重算公式。

本地提取不包含图片、签章和原始排版。WPS 支持可识别的兼容结构，未知专有变体会提示转换。CAJ/NH/HN/KDH 仍需用 CAJViewer 打印为 PDF；不宣称完整支持。详细格式与限制见仓库 `docs/attachment-formats.md`。

## English

- Native Grok Build reading for PDF, PPTX and Jupyter attachments, including scanned PDF pages.
- Local extraction for spreadsheets, legacy presentations, compatible WPS documents, OFD, OpenDocument, RTF, email and EPUB, plus Office templates and macro-enabled documents without executing macros.
- Chinese GBK/GB18030 and BOM UTF-16 text decoding.
- Preview extracted content or open originals using the default app. No Office installation or converter setup required.
- Bounded background extraction preserves drafts and originals on failure.

Local extraction omits images, seals and layout. WPS support depends on recognized
compatible structures. CAJ/NH/HN/KDH still require printing to PDF with CAJViewer.
See `docs/attachment-formats.md` for the complete matrix and limits.

This is a prerelease. Windows installer and portable builds are unsigned.
