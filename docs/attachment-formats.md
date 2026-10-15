# 附件格式 / Attachment formats

Grok Build Desktop 1.12.0。操作仍为添加附件 → 点击预览 → 发送。
无需安装 Office/WPS 或单独配置转换器。文件必须未加密、未损坏。

| 类型 / Type                   | 后缀 / Extensions                               | 读取方式 / Reader                                                                               |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| PDF（含扫描页）               | pdf                                             | Grok 原生按页查看 / native visual pages                                                         |
| PowerPoint                    | pptx                                            | Grok 原生文字与备注 / native text and notes                                                     |
| Jupyter                       | ipynb                                           | Grok 原生单元格与已有输出 / native cells and existing outputs                                   |
| Word、模板、兼容 WPS 文字     | doc, docx, docm, dot, dotx, dotm, wps, wpt      | 本地提取文字 / local text extraction                                                            |
| Excel、WPS 表格               | xls, xlsx, xlsm, xlsb, xlt, xltx, xltm, et, ett | 本地读取工作表、单元格和已有公式结果 / local sheet data and cached formula results              |
| 开放表格与标文通              | ods, ots, fods, uos                             | 本地读取数据 / local spreadsheet data                                                           |
| 旧版 PPT、模板、兼容 WPS 演示 | ppt, pps, pot, dps, dpt                         | 本地提取当前幻灯片与备注 / current slide text and notes                                         |
| 其他 PowerPoint 格式          | pptm, ppsx, ppsm, potx, potm                    | 本地提取文字与备注 / local text and notes                                                       |
| 开放文档                      | odt, ott, odp, otp, fodt, fodp                  | 本地提取文字 / local text                                                                       |
| OFD 发票、公文                | ofd                                             | 本地按文档与页面顺序提取文字 / ordered document and page text                                   |
| 电子书                        | epub                                            | 按阅读顺序提取正文 / text in spine order                                                        |
| 富文本                        | rtf                                             | 本地提取文字 / local text                                                                       |
| 邮件、网页存档                | eml, msg, mht, mhtml                            | 邮件头、正文及内嵌附件名称 / headers, body and embedded attachment names                        |
| 文本表格                      | csv, tsv                                        | 保留文本编号和工作表数据 / text identifiers and tabular data                                    |
| 文本、代码、网页源码          | txt, md, json, xml, html, htm, 源代码等         | 原文本；支持 UTF-8、带 BOM 的 UTF-16、GBK/GB18030 / original text with Chinese encoding support |
| 图片                          | png, jpg, jpeg, webp, gif                       | ACP 图片输入或 Grok 本地图片工具 / ACP image input or native local image reading                |

## 使用边界

- WPS 后缀并不代表唯一格式。支持可识别的 Word、BIFF、OOXML 等兼容结构；未知的早期专有结构会提示另存为 PDF/DOCX/XLSX。不会仅更改后缀就假定成功。
- CAJ/NH/HN/KDH 尚无可靠的通用自动转换。点击“用默认程序打开原文件”，用 CAJViewer 打印为 PDF，再添加 PDF。此类失败保留草稿和附件。
- 原生文档预览展示读取方式，可打开原文件核对；实际读取范围看会话中的工具结果。长 PDF 会提示 Grok 分批阅读，不声称一次读完全部页。
- 本地转换仅提取文字/数据，不包含图片、图表视觉信息、签章或原始排版；OFD 提取不验证发票真伪或签名。扫描 OFD 可先用原软件打印为 PDF。
- 不运行宏、不计算公式、不执行笔记本。表格显示已有结果与公式；邮件里的附件只列名称，需另行添加才能读取。
- PDF/PPTX/IPYNB 仅做轻量检查并交给 Grok 按本地路径读取，外壳不再设置原来的单个 10 MB／合计 20 MB 限制。实际页数、格式、读取范围与上游限制以 Grok 工具结果为准，不承诺无限大文件或自动读完每一页。
- 较大图片自动采用本地路径；仅较小、协商支持的图片才内嵌发送。剪贴板图片按当前官方行为保留 50 MB 边界。
- 大 UTF-8 文本按原路径读取；UTF-16/GB18030 文本按流转成完整 UTF-8 副本。Word/Excel 等完整提取内容超过单个 1 MB／内嵌合计 4 MB 时，保存为应用管理的文本文件，供 Grok 分段读取，不静默截断。派生文件不改变原文，当前会话使用期间受附件清理保护。
- DOCX 按需读取文本 XML，跳过无关大图片；通用格式仍需本地转换器。为保持稳定，本地通用转换原文件预算为 128 MiB、提取文字预算为 32 MiB、超时为 30 秒，并保留解析结构/内存保护；这些是转换器边界，不是 Grok Build 文件限制。达到边界会明确报错，可另存为 PDF 后交给原生工具。
- 大文件跳过耗内存的排版预览，文字预览最多展示 65,536 个字符并标注摘录。排版预览仍有独立的 10 MB 预算；预览不生成发送用的派生文件。
- 预览和发送分别读取当前文件；期间编辑后应重新预览。原生通路在 Grok 调用工具时读取本地文件。

## English limitations

WPS extensions cover multiple structures. Recognized Word/BIFF/OOXML-compatible
files are supported; unknown proprietary variants fail with save-as guidance.
CAJ/NH/HN/KDH need CAJViewer → Print to PDF; automatic general conversion is not
claimed. Drafts and original files are preserved on failure.

Native previews explain the reading route and can open the original. Actual
coverage is shown in Grok tool results. Locally extracted text omits images,
visual charts, seals and layout. OFD extraction does not verify invoice validity
or signatures. Macros/notebooks are not executed and formulas are not calculated.
Email attachments are listed by name only.

Native PDF/PPTX/IPYNB inputs use bounded inspection and local paths, without the
desktop's former 10/20 MB gate. Actual upstream limits and coverage still apply.
Large images use local paths; clipboard images retain the official 50 MB bound.
Large UTF-8 text uses its source path; legacy text is streamed to complete UTF-8.
Long extracted text is stored as a managed file for incremental reading rather
than embedded or silently truncated. Files remain unchanged. Generic local
converters retain a 128 MiB input budget, 32 MiB extracted-text budget, 30-second
timeout and parser memory/structure bounds; DOCX path reading skips unrelated
embedded media. These are converter limits, not Grok limits. Layout preview has
its own 10 MB budget and text previews show an explicitly marked 65,536-character
excerpt. Re-preview after editing an attachment.

## Native evidence / 原生能力依据

On 2026-10-15, the actual **Grok Build 1.0.52 (0920c8169e27)** binary read a
19,695,446-byte PPTX and a 19,661,663-byte PDF, preserving their final sentinels.
The PDF check used `format:text,pages:1`; visual PDF coverage was not inferred
from that text-mode test. DOCX and XLSX still returned `Cannot read binary file`.
The reproducible `scripts/verify-cli-large-documents.cjs` uses generated files,
an isolated home and a loopback-only synthetic provider, without paid inference
or user credentials. The public source mirror predates this binary and is not
treated as proof of its exact file limits.

On 2026-09-08, Grok Build **1.0.13** was tested via its actual ACP transport with
independently generated Chinese samples. PDF and PPTX returned the expected test
amounts, IPYNB returned notebook content. XLSX, DOCX, ODT and ODP returned
`Cannot read binary file`; RTF returned control words rather than decoded text.
This matrix describes the desktop adapter, not the Grok website or Files API.

- [Grok Build changelog](https://x.ai/build/changelog): native PPTX extraction and PDF rendering.
- [SheetJS formats](https://docs.sheetjs.com/docs/miscellany/formats/): spreadsheet readers.
- [CAJ converter limitations](https://github.com/caj2pdf/caj2pdf): partial format support; not a dependable universal converter.
