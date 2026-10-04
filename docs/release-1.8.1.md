# Grok Desktop 1.8.1

- 修复启动恢复项目/会话期间过早点选附件，导致附件留在后台草稿而当前页面不可见的问题。输入和附件入口在准备完成后启用，粘贴/拖放也使用同一准备状态；准备好后原有功能保持可用。
- 文档流程测试等待本轮检查点收尾完成后再测试下一轮失败请求，避免把“任务原始结束通知”当作整个任务已完成。不延长原有关闭或读取时限。
- 延续 1.8.0 的历史渲染、检查点索引、项目信任、存储管理和运行时改进。安装包及公开更新清单同步升级。

## English

- Keep composer input and attachment entry points unavailable until project/session restoration completes, preventing an early selection from landing in a hidden startup draft.
- Wait for authoritative task finalization before document failure scenarios in desktop tests; retain existing timeouts.
- Includes all 1.8.0 improvements. Packages remain unsigned until publisher signing credentials are available.
