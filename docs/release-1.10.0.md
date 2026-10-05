# Grok Desktop 1.10.0

这次更新落实五个架构方向，保留现有会话、草稿、审批和恢复方式。

- **检查点共享内容**：相同文本只存一份；继续按实际文件内容检查变化。旧检查点无需转换即可读取和恢复。存储页面显示实际占用与单条记录至少可回收的空间，损坏或无法识别的记录会阻止不安全的共享内容回收。
- **异常退出回收**：Windows 内部终端、npm 运行器与其子进程归当前应用持有的进程句柄和 Job 管理。关闭或崩溃会清理内部任务；明确单独打开的外部终端保留独立生命周期，不保存旧 PID 并在下次启动杀进程。
- **任务状态与诊断**：主进程任务快照统一驱动运行、停止和排队状态，仍保留发送前准备状态。在“设置 → 提醒与诊断 → 诊断预览与导出”查看完整内容后保存 ZIP，只包含白名单版本、常规设置、任务数量和运行事件，不包含对话正文、附件、密钥或路径，不自动上传。
- **只读批准与重连**：对话权限增加“只自动批准已确认的读取操作”。基于当前官方 CLI 验证过的结构化工具信息判断，支持读取、列目录和搜索；范围限制在当前已信任项目及已授权附件。命令、写入、未知工具和不确定配置仍需手动批准。意外断线后尝试一次恢复连接，不重发任务、不继续中断队列；可在设置关闭自动重连。
- **更新通道与分批推送**：默认稳定版，设置里可选择测试版。按完整语义版本比较，禁止自动降级，正在检查或已下载更新时禁止切换通道。发布者可以通过 GitHub Actions 调整某个发布的安装版推送比例，操作只替换更新清单，不重建安装包。

只读判断已用隔离本地模型验证 Grok Build **1.0.46**；配置 `RIPGREP_CONFIG_PATH` 的搜索操作继续询问。检查点仍受原有文件类型、大小与扫描范围限制，去重不扩大覆盖。进程验证覆盖当前 Windows / Electron 内部终端与 Node/npm 子进程，不代表所有操作系统和任意外部程序。

## English

- Store identical checkpoint content once, retain legacy records, verify content before restoration, and account for physical shared storage.
- Own internal Windows terminal and npm process lifetimes through live process handles and kill-on-close jobs; preserve independently opened terminals.
- Derive task controls from main-process runtime snapshots while retaining local preparation. Preview a private, whitelisted diagnostic report before exporting the exact snapshot as ZIP.
- Add conservative verified-read approval and one automatic connection recovery. Never automatically replay an interrupted prompt or resume its queue.
- Keep stable updates as the default, offer explicit beta opt-in, prevent automatic downgrades, and provide a manifest-only staged-rollout workflow.

Packages remain unsigned until publisher signing credentials are supplied.
