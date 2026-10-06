# Grok Build Desktop 1.11.3

本次稳定版汇总自 1.10.0 以来的界面与交互更新，并修复发布验证发现的会话状态显示问题。

## 更新内容

- 应用选定的新 G 图标和 Grok Build Desktop 名称，统一桌面界面、安装程序和快捷方式的品牌外观。
- 精简输入区布局；宽窗口支持独立的右侧项目上下文面板，切换布局保留编辑器未保存内容。
- 首页可直接选择深色、浅色或跟随系统，保存选择并同步终端外观。
- 推理强度采用平面绿色能量滑轨，滑块、填充和纹理平滑过渡。升降档、重置、键盘和拖动均可用，并尊重系统减少动画设置。实际档位仍以 Grok Build 提供的能力为准。
- 区分开发版和正式版的 Windows 应用标识，避免 Electron 开发快捷方式与正式版任务栏图标混用。
- 修复缺少界面设置时意外打开文件面板的问题，小窗口默认保留会话列表及其草稿、审批和排队提示；仍尊重已保存的布局选择。

既有会话、草稿、设置和安装数据目录保留。

## 下载与更新

- **普通用户推荐安装版：** `Grok-Desktop-1.11.3-Setup.exe`。已有安装版可在应用中检查更新；安装时沿用原安装目录。
- **免安装版：** `Grok-Desktop-1.11.3-Windows.exe`。便携版更新通过下载新版完成。
- `latest.yml` 和 `.blockmap` 是自动更新文件，无需手动打开。

Windows x64。该项目是非官方 Grok Build 桌面外壳，使用 Grok Build 仍需自行安装并登录。当前安装包尚未配置发布者代码签名。

## English

This stable release includes all UI and interaction updates since 1.10.0, plus a session-status display fix identified during release validation:

- Apply the selected G icon and Grok Build Desktop branding throughout the app, installer and shortcuts.
- Refine the composer and add an independent right-hand project context pane on wide windows, preserving unsaved editor content across layout changes.
- Select Dark, Light or System appearance directly from the main toolbar; persist the preference and update terminal colors.
- Use a flat green effort control with smooth thumb, fill and plasma transitions. Preserve keyboard/pointer input, reset, reduced-motion support and engine-authoritative options.
- Separate development and production Windows application identities to avoid taskbar icon collisions with development Electron shortcuts.
- Keep session navigation visible by default when saved UI preferences are missing, including draft, approval and queue indicators on small windows; preserve explicit layout preferences.

Existing conversations, drafts, settings and installation data are preserved. Choose **Setup.exe** for installation and in-app updates, or **Windows.exe** for the portable build. The update manifest and blockmap are updater assets and do not need to be opened manually.

Windows x64. This is an unofficial desktop wrapper; Grok Build installation and sign-in are still required. Packages remain unsigned.
