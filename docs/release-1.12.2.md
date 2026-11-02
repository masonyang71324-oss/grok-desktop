# Grok Build Desktop 1.12.2

修复 Windows 上 Grok Build 自更新失败后需要手动重装的问题。

- 更新前暂停重连，等待外壳自己的 catalog 和空闲会话引擎真正退出，再备份程序并开始更新。活动任务、后台审批和登录流程需要先结束，不强制中断它们。
- 自更新失败或实际版本不符时，自动调用一次官方安装器，固定目标版本和当前安装目录。校验实际程序版本后才恢复连接并报告成功。
- 自动修复也失败时，检查旧程序；必要时恢复本次程序备份，再尝试恢复可用连接，同时保留原始错误。账号和会话目录不参与程序文件恢复。
- 更新、修复、验证、重连进度在同一个引擎面板显示。更新期间阻止关闭程序、自动重连及额外引擎启动，避免文件替换被打断。
- 保留会话快照、草稿和暂停队列，不自动重发任务。验证了 Grok Build 1.0.70 的初始化、登录状态、模型和命令；新版原生图片输入通过已有能力协商自动启用。

本机通过官方安装器修复到 **1.0.70 (f50904eaee6c)**。安装前后既有会话文件元数据和认证文件元数据一致，除官方安装字段外的配置保持一致；升级后登录已验证，现有项目会话可列出。测试不需要付费模型请求。

安装器来自官方 x.ai，可能更新安装配置与 PATH；外壳不会清空账号、配置或会话。恢复仅针对本次备份的程序文件，不保证网络故障或官方服务不可用时也能完成升级。原生引擎仍独立安装，不捆绑进桌面安装包。

Windows x64：推荐 `Grok-Desktop-1.12.2-Setup.exe`，便携版为 `Grok-Desktop-1.12.2-Windows.exe`。安装包尚未配置发布者代码签名。

## English

- Pause reconnection and wait for the desktop-owned engine processes to exit before backing up and updating program files.
- Automatically use the official installer once when self-update fails or leaves the wrong version, targeting the configured directory and expected version.
- Verify the actual executable before reporting success. On failed repair, verify the surviving program and restore the program backup when needed; retain the original error.
- Show progress in the existing engine panel, block conflicting engine launches and prevent app exit while replacement is in progress.
- Preserve conversation snapshots, drafts and paused queues without replaying prompts. Confirmed initialization, authentication, models and commands with Grok Build 1.0.70.

Program recovery never restores or clears account/session directories. The official installer may update installation configuration and PATH. A working network and official download service remain necessary. Windows x64; packages remain unsigned.
