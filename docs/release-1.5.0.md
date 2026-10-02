# Grok Desktop 1.5.0

这次更新让日常操作更直观，保留任务、草稿、审批和文件恢复保护。

- 首页显示实际套餐额度、当前会话上下文统计、读取时间和刷新入口。缺失数据保持未知；更新失败会标明上次数据。
- 显示读取、修改、执行、验证、等待审批、后台运行和整理结果等实际阶段，并记录真实耗时。
- 完成后显示简洁成果卡片：检查点记录的文件变更、命令验证结果和结果位置。明细默认收起；查看与恢复进入原有流程，恢复仍需确认并检查冲突。
- 提供快速、标准、深入推理按钮，只使用模型公布的档位；不自动切换模型。
- 收藏常用提示词，使用时追加到当前草稿，保留附件并由用户决定发送。
- 中英双语、最小窗口布局、会话切换、重启恢复、迟到统计响应和后台任务已覆盖。

文件计数仅包含已有检查点可记录的文本文件；未返回明确可靠退出码的验证保持未确认。用量读取只调用官方统计接口。

验证：325 项自动测试和完整源码 Electron 流程通过，生产依赖审计为 0 个已知漏洞。

## English

- Visible account allowance, session context statistics, timestamps and bounded refresh, with explicit unknown/stale data.
- Actual task phases and elapsed time, including approvals, background work and checkpoint finalization.
- Compact outcome cards with recorded checkpoint changes and reliable exit-code results. Details are collapsed by default; recovery retains confirmation and conflict checks.
- Supported Quick/Standard/Deep effort controls and saved prompt favorites that append to a draft without sending.
- Persistent timing/count facts, bilingual controls, minimum-window layout and session/restart coverage.

File counts cover recorded text checkpoints. Missing or ambiguous validation results remain unconfirmed. 325 automated tests and complete source Electron workflows passed; production dependency audit found no known vulnerabilities. Windows packages remain unsigned and may show SmartScreen.
