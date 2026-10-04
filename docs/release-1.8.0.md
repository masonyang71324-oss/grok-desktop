# Grok Desktop 1.8.0

补齐独立审阅中此前后置的性能、权限、存储和工程改进。

- 长对话和会话列表按需渲染，历史分片合并与线性回放，保留完整内容、搜索定位、选区和复制。500 轮合成夹具回放从约 460ms 降到约 1.85ms；这不是所有机器的速度保证。
- 检查点轻量索引、请求摘要、空记录筛选；项目日志增量传输。新增应用截图存储管理，删除需明确选择，并保护草稿与在途任务。
- 原生项目/附件权限登记，新项目可先只看文件，信任后启用写入和运行。信任状态跨重启保存；升级前的项目外附件可原生重选恢复授权，数据不会丢弃。外部项目终端未退出时不能降级信任。
- 终端迁至 Utility Process，ASAR 完整性与运行时加固。命令超时清理自有进程树，短暂文件占用有界重试，引擎更新失败显示本地健康检查与恢复指引。
- 后端类型检查与 lint、会话/引擎组件拆分、Actions 固定提交和历史文档归档。实际 Windows 签名仍需发行者凭据，默认包未签名。

验证：518 项测试通过；源码与打包版桌面流程、实际打包 Fuse 和原生终端纳入发布门禁。真实 CLI 的单一 stdio MCP 生命周期与草稿整树强退恢复均完成隔离验证。

## English

- Compact history, replay linearly, and virtualize chat/session lists while preserving full text, search, selection and copying.
- Index checkpoints, stream project logs, and add protected cleanup of app-owned screenshots.
- Register native project/file grants and offer files-only project mode with explicit trust for editing and execution.
- Use Utility Process for terminals, harden the packaged runtime, clean owned command trees, and provide bounded file-lock retries and failed-update health guidance.
- Add backend type/lint checks, split UI responsibilities, pin Actions and archive historical reports.

Packages remain unsigned until publisher credentials are supplied. Cancellation does not roll back completed tool effects. See [implementation and evidence](https://github.com/masonyang71324-oss/grok-desktop/blob/v1.8.0/docs/implementation-1.8.0.md).
