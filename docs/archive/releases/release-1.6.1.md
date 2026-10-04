# Grok Desktop 1.6.1

根据同类项目审计提炼的失败场景，检查并加固现有功能。

- 文件保存尚未结束时保留编辑窗口与最后输入，保存结束后继续正常提示未保存修改。
- 取消工作树目录选择时，显示“已取消创建”，保留表单，不再误报完成。
- 修复分段接收错误输出时中文字符可能乱码的问题。
- 补充截断文件预览不能编辑/保存的回归检查；将文件、会话、取消、权限与状态真实性写入后续改动的可靠性要求。

本版未引入新的文档编辑器、代理或权限系统，现有功能继续沿用。

验证：354项单元/组件测试、生产构建、源码与打包后的完整Electron端到端流程通过；安装版和便携版均已构建。

## English

- Preserve the editor and newer input while a save is in flight.
- Keep the worktree form and show cancellation when its destination picker is dismissed.
- Preserve UTF-8 characters split across ACP stderr chunks.
- Add regressions for these cases and truncated read-only previews, with documented reliability requirements for subsequent changes.

Validated with 354 unit/component tests, a production build, and the full Electron E2E suite against both source and packaged builds. NSIS and portable packages were built successfully.

Windows packages remain unsigned.
