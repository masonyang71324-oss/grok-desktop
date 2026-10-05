# Grok Desktop 1.9.0

落实五组日常使用改进，保留现有功能与审批规则。

- 会话列表显示运行、等待审批、排队数量和未发送草稿；任务中心优先列出需要处理和正在运行的任务，仍可切换查看全部历史。
- 审批直接显示官方提供的文件差异与工作目录。删除文件、硬重置、强制推送有清楚说明；完整参数和原来的批准选项保留。
- 常见文件占用、权限不足、磁盘空间不足和文件不存在错误有中英文解释与处理建议，原始错误可以展开和复制。
- 设置新增界面大小，即时应用并在重启后保留；同步菜单缩放，改善重要文字与窄窗口侧栏。回到最新消息按钮固定在消息区域，避免遮挡输入。
- 点击系统通知进入对应会话和审批；拖入单个文件夹可选择只看文件或信任后打开。取消不会添加附件，混合拖入文件夹与文件会明确说明操作方式。

跨项目通知同步目标项目的信任状态，切换保留草稿；跨项目仍有文件编辑器打开时，先提示保存关闭。双语、目录拖入、通知路由、缩放持久化与原始错误详情通过独立临时项目验证，源码和安装包均纳入发布检查。

## English

- Session activity, approval, queue and draft indicators; an action-first task center with a Show all view.
- Approval diffs, working directories and clear destructive-operation notices, preserving official permission IDs and full details.
- Plain-language filesystem errors with expandable, copyable originals.
- Persistent interface size, menu zoom and readable compact layouts.
- Notifications navigate to their originating conversation; native folder drops open projects with explicit trust choices.

Existing functionality and approval semantics remain available. Packages remain unsigned until publisher signing credentials are supplied.
