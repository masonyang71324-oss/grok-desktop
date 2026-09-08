module.exports = {
  '已提取工作表和单元格数据；公式显示文件中的已有结果，不会重新计算。图片、图表和排版未包含在内。':
    'Worksheet and cell data extracted. Formulas show saved results and are not recalculated. Images, charts and layout are not included.',
  '已提取正文和邮件信息；内嵌附件仅列出名称，需另行添加才能读取。图片和排版未包含在内。':
    'Body text and email information extracted. Embedded attachments are listed by name; attach them separately to read them. Images and layout are not included.',
  '已提取文档文字；图片、签章和原始排版未包含在内。':
    'Document text extracted; images, seals and original layout are not included.',
  常见文档: 'Common documents',
  'Word 与 WPS 文字': 'Word and WPS documents',
  表格: 'Spreadsheets',
  演示文稿: 'Presentations',
  'PDF 与 OFD': 'PDF and OFD',
  '文档单个不得超过 10 MB。': 'Documents are limited to 10 MB each.',
  '原生文档单个不得超过 10 MB，总计不得超过 20 MB。':
    'Native documents are limited to 10 MB each and 20 MB combined.',
  '文件不是有效的 {format} 文档。请确认能正常打开。':
    'This is not a valid {format} document. Check that it opens normally.',
  '此类 CAJ 文献暂不能可靠地自动转换。请用 CAJViewer 打开并打印为 PDF，再添加 PDF；草稿和原文件会保留。':
    'This CAJ document cannot be converted reliably yet. Open it in CAJViewer, print to PDF, then attach the PDF. Your draft and original file are preserved.',
  '不支持此文件格式或文本编码：{name}。请另存为 PDF 或 UTF-8 文本后重试。':
    'Unsupported file format or text encoding: {name}. Save as PDF or UTF-8 text and retry.',
  '已提取文档文字和数据；图片、签章和原始排版未包含在内。公式不会重新计算，邮件内的附件仅列出名称。':
    'Document text and data extracted; images, seals and original layout are not included. Formulas are not recalculated; email attachments are listed by name only.',
  '无法读取文档。请确认文件未加密且能正常打开，或另存为 PDF、DOCX、XLSX 后重试。':
    'Could not read document. Check that it is unencrypted and opens normally, or save as PDF, DOCX or XLSX and retry.',
  '暂不支持此文件的内部格式。请用原软件另存为 PDF、DOCX 或 XLSX 后重试。':
    'This internal file format is not supported. Save as PDF, DOCX or XLSX in the original app and retry.',
  '文档中没有可提取的文字或数据。扫描文档请另存为 PDF 或图片后添加。':
    'No extractable text or data in this document. Save scanned documents as PDF or images and attach them.',
  '文档提取内容超过 1 MB，请拆分文档后重试。':
    'Extracted document content exceeds 1 MB. Split the document and retry.',
  '文档读取超时，请拆分文档或另存为 PDF 后重试。':
    'Document reading timed out. Split the document or save as PDF and retry.',
  '发送后由 Grok 原生读取 PDF 页面，支持扫描页和图片。读取范围以会话中的工具结果为准。':
    'Grok reads PDF pages natively, including scanned pages and images. The tool results in the conversation show which pages were read.',
  '发送后由 Grok 原生读取幻灯片文字和备注；不保证读取其中的图片和图表。':
    'Grok reads slide text and speaker notes natively. Embedded images and charts may not be read.',
  '发送后由 Grok 原生读取笔记本单元格和已有输出，不会为预览运行代码。':
    'Grok reads notebook cells and existing outputs natively. Preview does not execute code.',
  'Word 文档': 'Word documents',
  'Word 文档单个不得超过 10 MB。': 'Word documents are limited to 10 MB each.',
  '已提取 Word 文字；图片、签章和原始排版未包含在内。':
    'Word text extracted; images, seals and original layout are not included.',
  '无法读取 Word 文档。请确认文件未加密且能正常打开，或另存为 TXT 后重试。':
    'Could not read Word document. Check that it is unencrypted and opens normally, or save it as TXT and retry.',
  'Word 文档中没有可提取的文字。扫描页或图片请另存为图片后添加。':
    'No extractable text in this Word document. Attach scanned pages or images as image files.',
  'Word 提取文字超过 1 MB，请拆分文档后重试。':
    'Extracted Word text exceeds 1 MB. Split the document and retry.',
  'Word 文档读取超时，请拆分文档或另存为 TXT 后重试。':
    'Word document reading timed out. Split the document or save it as TXT and retry.',
  '提取后的文本单个不得超过 1 MB，总计不得超过 4 MB。请拆分附件后重试。':
    'Extracted text is limited to 1 MB per attachment and 4 MB in total. Split the attachments and retry.',
  正文: 'Body',
  文本框: 'Text boxes',
  页眉: 'Headers',
  页脚: 'Footers',
  脚注: 'Footnotes',
  尾注: 'Endnotes',
  批注: 'Comments',
  '检查点编号无效。': 'Invalid checkpoint id.',
  '检查点存储已达到 512 MB 上限，请删除旧检查点记录后重试。':
    'Checkpoint storage has reached the 512 MB limit. Remove old checkpoint records in Project tools and retry.',
  无法读取: 'Unreadable',
  超过文件数量上限: 'File count limit exceeded',
  已排除的目录: 'Excluded directory',
  不支持的文件类型: 'Unsupported file type',
  超过文件大小上限: 'Size limit exceeded',
  '二进制或非 UTF-8 文件': 'Binary or non-UTF-8 file',
  '上级目录已变更。': 'A parent directory has changed.',
  '文件类型已变更。': 'The file type has changed.',
  '文件编码已变更。': 'The file encoding has changed.',
  '请从已完成的检查点中选择文件。': 'Select files from a completed checkpoint.',
  '文件不在此检查点中：{path}': 'File is not in this checkpoint: {path}',
  '这些文件在本轮之后已变更：{paths}': 'These files changed after this turn: {paths}',
  '未找到 npm，请安装 Node.js 并重新打开桌面应用。':
    'npm was not found. Install Node.js and reopen the desktop.',
  '项目正在运行，请先停止再重新运行。': 'Project is already running. Stop it before restarting.',
  '请选择已有的 npm 脚本。': 'Select an existing npm script.',
  'npm 已退出，代码：{code}': 'npm exited with code: {code}',
  '无法停止项目进程（{code}）。': 'Could not stop the project process ({code}).',
  '无法删除正在记录的检查点。': 'Cannot delete a checkpoint that is still recording.',
  '已取消发送。': 'Sending cancelled.',
  '请先选择权限请求所属的会话。': 'Select the conversation that owns this approval request.',
  '请先停止任务并移除排队消息，再删除会话。':
    'Stop the task and remove queued messages before deleting the conversation.',
  '此目录仍有任务在运行，请完成后再恢复文件。':
    'This folder has a task running. Wait for it to finish before restoring files.',
  '重新载入界面后会恢复仍在运行的任务和待批准操作。':
    'Reloading the interface restores running tasks and pending approvals.',
  '图片单个不得超过 10 MB，总计不得超过 20 MB。':
    'Images are limited to 10 MB each and 20 MB in total.',
  '图片格式无效，请选择 PNG、JPEG、WebP 或 GIF。':
    'Invalid image format. Choose PNG, JPEG, WebP or GIF.',
  请输入消息或添加附件: 'Enter a message or add an attachment',
  '剪贴板中没有有效的 PNG 图片。': 'The clipboard does not contain a valid PNG image.',
  图片: 'Images',
  '包括此应用启动的本地代理、后台任务和项目脚本。会话记录会保留。':
    'This includes local agents, background tasks and project scripts started by this app. Conversation history will be kept.',
};
