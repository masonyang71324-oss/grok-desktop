# Grok Desktop 1.3.2

## 中文

- 支持常见 Word `.doc` / `.docx` 附件：添加后点击可预览文字，发送时自动提取并交给 Grok。
- 无需安装 Word/WPS 或配置转换工具，不修改原文件。
- 读取在后台完成，有超时和大小限制；文件无法读取时说明原因并保留草稿，不发送部分结果。
- 中文与英文预览、处理状态和错误提示同步支持。

这是文字提取功能：文档里的图片、签章和原始排版不包含在内，也不进行 OCR。Word 文件单个限 10 MB，提取文字单个限 1 MB、全部文本附件总计限 4 MB。

## English

- Attach common Word DOC/DOCX files, preview extracted text and send it to Grok automatically.
- No Word/WPS installation or converter setup is needed; original files are preserved.
- Background extraction has time and size limits. Unreadable documents keep the draft and produce a clear error instead of partial output.
- Preview, processing and error states are available in English and Chinese.

Text extraction omits images, seals and original layout, without OCR. Word files are limited to 10 MB each; extracted text is limited to 1 MB each and 4 MB across all text attachments.

This is a prerelease. Windows installer and portable builds are unsigned.
