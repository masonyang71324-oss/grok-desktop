# Grok Build Desktop 1.11.4

修复“登录 Grok Build”只弹出终端、没有完整网页登录反馈的问题。

- 登录按钮现在直接调用官方 CLI 的浏览器 OAuth 授权，显示等待状态并允许取消。
- 官方进程完成后再次核实登录状态；确认成功才自动刷新引擎与模型。
- 首次使用引导和登录失效后的恢复入口使用相同流程，无需手动敲命令或额外点击检查。
- 启动失败、授权未完成和超时有明确提示；关闭程序会回收本程序正在等待的登录进程。
- 保留草稿与现有会话，不会自动重发任务。授权仍由用户在官方浏览器页面完成，桌面程序不读取认证文件，也不记录登录进程输出。

Windows x64：普通用户下载 `Grok-Desktop-1.11.4-Setup.exe`；免安装用户下载 `Grok-Desktop-1.11.4-Windows.exe`。已有安装版可在应用中检查更新。该项目是非官方 Grok Build 外壳，安装包目前尚未配置发布者代码签名。

## English

Fix the Grok Build sign-in button launching a terminal without a complete browser sign-in flow.

- Start the official CLI browser OAuth flow directly, show progress and allow cancellation.
- Verify authentication after the CLI completes before automatically refreshing the engine and model catalog.
- Use the same flow in onboarding and authentication recovery, without manual commands or an extra status-check click.
- Show actionable launch, authorization and timeout errors; clean up the owned pending login when the app exits.
- Preserve drafts and sessions without replaying tasks. Users still authorize in the official browser page; the desktop does not read credential files or record login process output.

Windows x64. Choose **Setup.exe** for installation and in-app updates, or **Windows.exe** for the portable build. This is an unofficial Grok Build wrapper. Packages remain unsigned.
