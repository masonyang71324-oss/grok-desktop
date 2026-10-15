# Grok Build Desktop 1.12.0

本次更新解决“大附件被外壳提前拒绝”，并同步 Grok Build 1.0.52 的后台审批行为。操作仍是添加附件、点击发送。

- **原生大文件按需读取**：PDF/PPTX/IPYNB 不再被外壳的单个 10 MB／合计 20 MB 门槛拦截，只做轻量检查并传递本地路径。大图片也自动采用路径；剪贴板图片边界与当前官方 50 MB 行为对齐。
- **Word/Excel 后台转换**：保留必要的转换能力。DOCX 按需读文本、跳过大图片；通用转换器在后台读取文件。长结果保存为完整 UTF-8 文本供 Grok 分段读取，不再因旧内嵌文本预算拒绝，也不静默丢掉末尾。
- **预览与发送分开**：大文件自动跳过耗内存的排版预览，文字摘录有明确说明。预览不制造发送副本；正在使用的完整文本受附件清理保护。取消准备会终止转换，保留草稿且不提交半截内容。
- **后台审批保留**：主任务正常结束后，后台子任务仍有效的审批继续显示；取消、错误和断连仍会清理对应请求，不影响其他会话。
- **引擎能力同步**：核对当前稳定版 1.0.52、模型/命令和公共 ACP 元数据。官方的大文件、长会话、自动压缩等改进由引擎提供；不复制一套行为，也不把标准新增能力误认为引擎已支持。

验证使用真实 Grok Build 1.0.52 与本地合成模型：19,695,446 字节 PPTX、19,661,663 字节 PDF 均返回末尾哨兵；DOCX/XLSX 仍需外壳转换。新增桌面流程覆盖三份 >10 MiB 混合附件、>1 MiB 完整正文、预览摘录、取消和存储保护。没有使用真实用户文件、登录凭据或付费推理。

实际读取仍受 Grok 工具自身的格式、页数和输出边界影响。为保持稳定，通用本地转换保留 128 MiB 原文件、32 MiB 提取文字和 30 秒超时等资源保护；这些不是 Grok 的文件上限。达到边界会明确提示，并可另存为 PDF 后交给原生工具。既有会话、草稿、设置和原文件保留。

Windows x64：推荐 `Grok-Desktop-1.12.0-Setup.exe`，也提供 `Grok-Desktop-1.12.0-Windows.exe` 便携版。已有安装版可在应用内检查更新。非官方项目；安装包尚未配置发布者代码签名。

## English

- Remove the desktop's former 10/20 MB gate for native PDF/PPTX/IPYNB references. Use bounded header inspection and local paths; large images also use local reading.
- Convert Word/Excel in cancellable background workers. Read DOCX text without loading unrelated large images. Store long, complete UTF-8 output for incremental reading instead of rejecting or silently truncating it.
- Keep preview excerpts separate from complete send content. Skip expensive layout previews for large files and protect generated text while sessions use it.
- Preserve valid background approvals after normal foreground completion, while keeping cancellation, failure and disconnect cleanup scoped to the originating session.
- Synchronize the verified Grok Build 1.0.52 and public ACP metadata baseline without advertising unverified upstream capabilities.

Real CLI verification used generated ~19 MB PPTX/PDF files and a local synthetic provider. DOCX/XLSX still require conversion. Native upstream limits continue to apply. Generic local converters retain a 128 MiB input budget, 32 MiB text budget, 30-second timeout and parser resource limits; these are not Grok file limits. Failures remain explicit and preserve original files and drafts.

Windows x64. Choose Setup.exe for installation/in-app updates or Windows.exe for the portable build. Unofficial project; packages remain unsigned.
