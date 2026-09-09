# Grok Desktop 1.4.1

## 中文

- 安装版会自动检查 GitHub 公开稳定版本；发现新版后由用户点击下载，显示进度，下载完成后由用户选择何时重启安装。
- 便携版不会尝试替换正在运行的程序，只会提示新版并打开官方下载页。
- 更新安装继续遵守任务运行和未保存文件保护，不强制退出；后台发现新版时显示系统通知。
- 更新 Electron、JSZip、RTF 解析器和 electron-updater 的同主版本补丁，依赖审计无已知漏洞。

1.4.0 及更早版本没有桌面更新程序，需要手动安装一次 1.4.1。安装包尚未配置发布者签名，Windows 可能显示 SmartScreen 提示。

## English

- Installed editions check public stable GitHub releases. Download starts only after a click, shows progress, and lets the user choose when to restart and install.
- Portable editions never try to replace the running executable; they open the official release page instead.
- Update installation respects running-task and unsaved-file protection. A background notification announces available releases.
- Patch updates for Electron, JSZip, the RTF extractor and electron-updater are included; the dependency audit reports no known vulnerabilities.

Version 1.4.0 and earlier do not contain the desktop updater, so they need one manual installation of 1.4.1. The Windows binaries are currently unsigned and may trigger a SmartScreen warning.
