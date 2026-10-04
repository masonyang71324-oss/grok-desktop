# Grok Desktop 1.4.3

这次更新适配新版 Grok Build，重点是让首页显示的状态和引擎实际执行保持一致。

- 首页分别显示桌面外壳版本、Grok Build 版本和登录状态。点击引擎入口即可登录、检查更新、刷新模型或在任务结束后更新引擎。
- 引擎更新后会核对实际程序版本；如果官方更新器安装到了用户目录，会将外壳连接到已更新的程序。
- 支持模型公布的上下文窗口选择。真实 Grok Build 1.0.46 已验证 Grok 4.7 的 256K、500K 窗口和推理档位切换。
- 修复“默认推理”无效、旧偏好阻止新建会话、切换会话后模式与配置显示过期的问题。
- 接入实时模型列表，保留当前会话已选模型、草稿和后台任务；修复自定义模型别名的确认结果。
- 更新 Markdown 清理、邮件解析及打包工具依赖的兼容补丁，依赖审计为 0 个已知漏洞。

外壳升级与官方 Grok Build 升级是两项独立更新。4.7 与 Fast 的可用性以登录账号实际返回的列表为准。安装包仍未配置发布者签名，Windows 可能显示 SmartScreen 提示。

## English

This maintenance release aligns the home screen with the actual Grok Build engine state.

- Separate Desktop/Build versions and authenticated, login-required or unknown status, with native sign-in, update checks, catalog refresh and idle-only engine updates.
- Verify the updated executable and follow the official installation path when an older configured copy was not replaced.
- Choose an advertised context window per session. Real Grok Build 1.0.46 configuration checks verified Grok 4.7's 256K/500K choices and effort switching.
- Fix default-effort reset, outdated creation preferences and stale conversation configuration; consume live catalogs and preserve custom model aliases.
- Keep current conversations, drafts and background work intact during catalog refresh. Controls remain available in English and Simplified Chinese.
- Patch Markdown sanitization, email parsing and compatible build-tool dependencies; the dependency audit reports no known vulnerabilities.

Desktop and CLI updates are separate. Model access depends on the signed-in account. Windows packages are unsigned and may trigger SmartScreen.

Validation: 274 automated tests, production build, and real Electron workflow checks. Live engine configuration was verified without sending inference prompts.
