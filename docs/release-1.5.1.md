# Grok Desktop 1.5.1

这次是最终复查后的稳定性补丁，操作入口保持不变。

- 修复准备附件或切换模型期间点击“停止”后，任务仍可能被发送的问题。
- “任务已完成”通知等待后台工作和文件检查点真正结束；停止、失败和中断分别提示。
- 修复 `[id].tsx` 等带方括号的文件路径可能显示其他文件差异的问题。
- 内置编辑器拒绝有损读取非 UTF-8 文件，提示使用系统应用打开，避免 GBK 中文被乱码覆盖；保留 UTF-8 BOM。
- 新会话选择默认推理时，显示模型公布的默认档位，不再残留上一会话的档位。

Windows 安装包仍未配置发布者签名。文档附件的 GBK/GB18030 提取支持不受内置编辑器的编码限制影响。

验证：333 项自动测试、类型检查、生产构建和完整源码 Electron 流程通过；依赖审计报告 0 个已知漏洞。

## English

- Stop prevents prompts from being sent after attachment or model preparation.
- Completion notifications wait for background tasks and checkpoint finalization.
- Bracketed filenames use literal Git path matching for accurate diffs.
- The built-in editor rejects lossy non-UTF-8 decoding and preserves UTF-8 BOM; document attachment extraction is unchanged.
- New conversations display the advertised default effort instead of the previous conversation's selection.

Windows packages remain unsigned.

Validation: 333 automated tests, type checking, production build and complete source Electron workflows passed; dependency audit reported no known vulnerabilities.
