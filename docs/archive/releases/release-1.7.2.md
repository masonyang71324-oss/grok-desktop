# Grok Desktop 1.7.2

此候选被云端原生终端探针的计时问题阻止发布。最终正式版为1.7.3，见[发布说明](release-1.7.3.md)。

补齐竞品问题对照自查，并修复两处经过复现的显示问题：

- 差异视图在多次切换并排、统一和折叠状态后，可能重复显示一条上下文行；已修复并加入回归。
- 长终端日志保留最近输出时，可能截断 emoji 的一半而显示乱码；已保留完整字符边界。

验证：427项测试、源码和打包版完整Electron流程，以及一次性Windows上的真实官方CLI安装/取消/历史恢复/工具后代退出检查通过。

原49项发现逐项对应到当前实现：36项有对应防护、11项不适用、2项有修复验证记录。该分类不是49个漏洞全部实机重现或“零漏洞”声明；DiffViewer本轮显示修复另外记录。

新增验证包含真实官方CLI的23项模型/推理强度/上下文配置检查，官方CLI配合本地受控模型的后台历史恢复及真实工具后代退出，以及一次性Windows上的官方安装、下载中取消、PATH和未登录状态。Office/Markdown/网页预览也增加了只读和隔离检查。没有调用真实付费模型或开启麦克风。

## English

- Fix duplicated diff context rows after switching layouts and folding states.
- Preserve Unicode character boundaries when retaining the tail of long terminal output.
- Reconcile all49 competitor findings with current protections and applicability; add scoped official-CLI, disposable-Windows installer and content-isolation evidence.
- Keep native terminal deadlines unchanged, improve failure diagnostics, and wait for the shell prompt before the lifecycle probe types its command, matching the real terminal E2E flow.

The official CLI/local-model fixture is not a production-model or model-quality test. Interactive OAuth, actual microphone recognition and every Windows variant remain outside these checks. Windows packages remain unsigned.
