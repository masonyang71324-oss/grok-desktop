# 附件格式 / Attachment formats

Grok Desktop 1.4.0。操作仍为添加附件 → 点击预览 → 发送。
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
- 文档单个 10 MB；本地提取内容单个 1 MB、全部文本合计 4 MB；原生文档合计 20 MB。后台提取最长 30 秒；超过限制或损坏时提示错误，不静默发送部分内容。
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

Documents: 10 MB each. Extracted text: 1 MB each / 4 MB combined. Native documents:
20 MB combined. Worker extraction times out after 30 seconds, with explicit
failure instead of silent truncation. Re-preview after editing an attachment.

## Native evidence / 原生能力依据

On 2026-09-08, Grok Build **1.0.13** was tested via its actual ACP transport with
independently generated Chinese samples. PDF and PPTX returned the expected test
amounts, IPYNB returned notebook content. XLSX, DOCX, ODT and ODP returned
`Cannot read binary file`; RTF returned control words rather than decoded text.
This matrix describes the desktop adapter, not the Grok website or Files API.

- [Grok Build changelog](https://x.ai/build/changelog): native PPTX extraction and PDF rendering.
- [SheetJS formats](https://docs.sheetjs.com/docs/miscellany/formats/): spreadsheet readers.
- [CAJ converter limitations](https://github.com/caj2pdf/caj2pdf): partial format support; not a dependable universal converter.
