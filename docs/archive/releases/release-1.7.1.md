# Grok Desktop 1.7.1

完成竞品审计后的16项功能改进，保留现有会话、权限、排队、草稿恢复、文档提取与检查点功能。

验证：420项单元/组件测试、完整源码及打包版Electron端到端流程通过，安装版和便携版构建成功。新增10项真实窗口检查包括原生剪贴板、PowerShell终端、Office、网页截图归属、尺寸记忆和中英文界面。

修复了云端快速执行发现的界面设置保存问题：导航切换立即保存，面板尺寸在拖动结束或键盘调整时保存。

## 对话与阅读

- 当前会话全文搜索，包含消息、工具内容和当前保留的错误；可展开并跳到命中位置。
- 按用户提问排列的问题目录。
- 格式化复制与原文复制并存，表格、列表、代码可以带格式粘贴。
- 本地数学公式排版，代码和原文复制保持原样。
- 优化长会话更新，提供可复现的100/500条消息基准。

## 项目与文件

- 差异提供统一/左右视图、行内标记、未改行折叠和独立行号。
- 输入区按钮搜索并多选引用项目文件。
- Office只读排版预览：DOCX、工作表、PPTX静态内容；保留文字视图和外部打开。
- 侧栏、文件栏和输入区支持拖动/键盘调整、记忆尺寸；双击分隔线恢复自动大小。
- 应用内交互终端，支持实际PowerShell输入、隐藏保留、停止和明确重启；外置终端入口保留。
- 隔离网页预览窗口，可把截图加入原会话草稿，不会自动发送。

## 上手与维护

- 首次使用引导：官方CLI安装或选择、登录检查、项目选择；安装可取消和重试。
- 模型来源图形配置，保留已有TOML注释与未知字段，使用环境变量引用密钥。
- 回收完全空闲的CLI连接；恢复同一会话时保留附件和桌面回合信息。
- 每周检查官方CLI与ACP元数据，保留可下载的维护报告；不自动修改代码或权限。
- 输入区语音按钮启动Windows自带语音输入，识别内容仍需手动发送。

## 使用边界

搜索范围是当前已载入会话；不声称检索CLI未返回的历史错误。Office预览是只读近似布局，旧格式、继承母版坐标或复杂图表可转为明确标注的文字预览，原始排版仍可用默认程序查看。语音的麦克风、语言及服务可用性由Windows控制。自定义模型需要其服务支持及已配置的环境变量密钥。

终端原生依赖采用随包提供的Node-API预编译模块，并运行于独立进程；Windows安装包仍未签名。

## English

Sixteen practical improvements: conversation search and question outline; formatted copying; first-run CLI setup; enhanced split/unified diffs; project file references; read-only Office layout previews; isolated web preview with capture-to-draft; interactive PowerShell terminal; custom model provider forms; measured long-conversation rendering improvements; idle connection reclamation; remembered resizable panels; local math rendering; upstream CLI/ACP checks; and Windows voice typing.

Existing approvals, queues, drafts, document extraction, images, checkpoints and external tools are retained. Search covers the loaded conversation. Office layout is approximate and read-only, with explicit text fallbacks and external opening for unsupported structures. Dictation uses Windows voice typing; nothing is sent automatically. Provider secrets stay in environment variables. Windows packages remain unsigned.
