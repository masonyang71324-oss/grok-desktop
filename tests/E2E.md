# 本地 Electron 冒烟测试

先运行 `npm run build`，再运行 `npm run test:e2e`。测试通过 Playwright 启动真实 Electron 主进程、preload 和页面；需要项目的开发依赖，无需 Grok 账号，也不会调用模型服务。

默认使用源码 Electron。检查已打包版本时，在 PowerShell 中设置 `$env:GROK_DESKTOP_TEST_EXE` 为桌面程序的绝对路径，再执行同一测试命令。目标版本必须包含 `GROK_DESKTOP_TEST_GROK_SCRIPT` 测试入口。

每次运行会建立独立的系统临时目录，包含桌面配置、项目文件、模拟会话及事件日志；输出中的 `Artifacts` 指向该目录。测试不会读取或修改用户日常使用的桌面数据。模拟器日志可包含测试提示词和临时文件路径，用于核对实际收到的协议内容；这与正式应用的脱敏运行日志不同。

`scripts/mock-grok.cjs` 是独立的 Node ACP stdio 服务，支持初始化、模型与命令发现、新建/列出/恢复/重命名/删除会话、流式回复、权限回复和取消。测试通过主进程启动它，走实际 JSON-RPC 与 IPC 链路。模拟器将非当前空会话从列表中省略，但仍允许加载，以保留官方 CLI 的这一实际行为。

模拟器环境变量：`GROK_DESKTOP_MOCK_STATE` 指定会话状态文件，`GROK_DESKTOP_MOCK_LOG` 指定事件日志文件。测试提示词包含 `MOCK_PERMISSION` 时挂起等待真实权限回复，包含 `MOCK_CANCEL` 时挂起等待取消，包含 `MOCK_RENDER` 时显示固定的代码块和文件 diff，其他文本产生三段固定回复。模拟器只服务测试，不代表官方模型行为或并发能力。

冒烟测试覆盖版本握手、可执行文件选择 IPC、流式消息、审批遮罩及确认、取消、历史恢复、设置与窗口恢复，以及退出前的草稿保存。最后将代码、diff 和设置页面截图保存到 `test-results/e2e-desktop.png`、`test-results/e2e-diff.png`、`test-results/e2e-settings.png`。

文件边界测试通过 Playwright 文件输入选择真实临时文件，再将该磁盘文件放入 `DataTransfer` 并向输入区派发拖放事件，验证真实 preload 的 `webUtils.getPathForFile` 路径与附件移除。另由测试进程写入项目新文件，等待目录监听事件自动刷新文件列表，全程不依赖模型回合结束或手动刷新。默认程序打开与资源管理器定位入口也走真实页面和 IPC，但测试暂时替换 Electron shell 方法，仅检查最终路径，不启动外部程序。

双语流程从中文设置切换到 English，检查即时保存、未保存的其他设置、原生菜单、代码 DOM 和消息内容、英文批准按钮及其真实协议 ID。停止后的状态提示也双向切换。关闭后重新启动，检查英文和草稿恢复，再切回中文。英文主界面、设置和审批截图分别保存在 `test-results/e2e-desktop-en.png`、`test-results/e2e-settings-en.png`、`test-results/e2e-permission-en.png`。

`npm run test:e2e` 还依次运行 `e2e-lifecycle.cjs`、`e2e-recovery.cjs` 和 `e2e-workflows.cjs`。生命周期检查包含未保存文件退出确认、app.quit 取消、任务与编辑同时存在时取消退出、明确放弃和保存后退出。恢复检查触发现有界面异常处理器并真正重新载入页面，确认原回合和待批准请求继续有效且未重复发送，再验证新消息与批准。工作流检查覆盖任务路由、检查点、项目脚本和截图附件。均支持同一个打包程序路径环境变量；不声称覆盖操作系统级崩溃或真实模型服务。

截图专项 e2e-images.cjs 也纳入 npm run test:e2e：使用 GROK_DESKTOP_MOCK_IMAGE=false 模拟当前 CLI，检查粘贴保存、缩略图、预览、纯图片发送、本地路径协议、草稿重载与文件丢失；另以英文界面验证原生图片通道。剪贴板测试先完整读取备份内容，再替换测试图片，结束后恢复。
