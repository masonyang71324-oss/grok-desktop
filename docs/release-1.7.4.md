# Grok Desktop 1.7.4

本次集中修复独立源码审阅中确认的安全、恢复和交互问题。

- 模型回复里的原始 HTML 显示为源码，防止样式隐藏审批按钮或覆盖界面；Markdown、代码高亮、公式和复制保持可用。
- 登录和终端启动使用系统程序绝对路径；后台 Git 禁用 fsmonitor 和可选索引刷新；打开可执行或脚本文件前确认。正式安装包忽略开发网址覆盖。
- 大项目扫描达到上限后，保留已确定的新建、删除与修改。项目工具新增跨项目检查点存储管理；满额时可取消并清理，或明确选择本轮不创建检查点。不会自动删除旧恢复记录，恢复仍须先保存撤销记录。
- 损坏的设置和队列保留备份并在启动后提醒；连续输入也会定期保存草稿，写入后请求刷盘。
- 文件树刷新保留展开状态；准备阶段可以停止，取消后不再提交新请求；中断队列明确说明重新发送的含义，并提供查看现有改动入口。
- 更新错误显示具体原因并补英文文案。Electron 更新至 44.5.1，修复构建依赖告警并减少重复打包的前端依赖。

验证：474 项测试全部通过，生产构建、源码及打包版完整 Electron 流程通过；npm audit 当前报告 0 项已知告警。

说明：草稿刷盘不承诺断电零丢失；准备期停止可能需要等待已开始的加载或文档提取收尾。Windows 安装包仍未配置发布者签名。

## English

- Prevent raw model HTML from restyling the application or obscuring approvals.
- Use explicit system executable paths, harden background Git queries, confirm executable file opens, and ignore development URLs in packaged builds.
- Preserve known checkpoint changes under scan limits; add cross-project storage cleanup and an explicit choice to continue a turn without a checkpoint. Undo protection remains mandatory for restores.
- Back up corrupt local settings/queues, display recovery notices, and bound draft persistence delay.
- Retain expanded folders, handle cancellation during preparation, and explain interrupted-request replay.
- Upgrade Electron to 44.5.1 and http-cache-semantics to 4.3.0; reduce duplicated renderer dependencies.

See the [review response](https://github.com/masonyang71324-oss/grok-desktop/blob/v1.7.4/docs/review-response-1.7.4.md) for verification and deferred architecture work. Packages remain unsigned. No paid-model, interactive login, or microphone testing was performed for this patch.
