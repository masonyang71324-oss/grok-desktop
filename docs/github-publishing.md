# GitHub 发布说明

公开仓库：[masonyang71324-oss/grok-desktop](https://github.com/masonyang71324-oss/grok-desktop)。Windows 下载程序通过 [Releases](https://github.com/masonyang71324-oss/grok-desktop/releases) 分发。

把 `desktop` 的内容作为仓库根目录：README、package.json 和 .github 应在同一层。不要把外层旧版 GUI、个人数据或整个工作区一并上传。打包的源码压缩包采用这个目录结构，解压后即可用作仓库内容。

## 源码与下载程序

源码仓库包含 src、electron、tests、scripts、assets、docs、.github、项目配置和 package-lock.json。.gitignore 排除 node_modules、dist、release 和 test-results；这些目录不需要提交。

Windows 安装包和便携包分别是 `Grok-Desktop-<version>-Setup.exe` 和 `Grok-Desktop-<version>-Windows.exe`。推送与 package.json 版本一致的 `v<version>` 标签后，`Publish Windows release` 工作流会运行测试、构建全部安装包，再通过一次 GitHub CLI 操作创建公开稳定版 Release。发布附件包括两个 exe、安装包 blockmap 和 `latest.yml`；后三者供安装版自动更新使用。exe 超过普通 Git 文件的 100 MiB 限制，应通过 Releases 分发。[GitHub 文件大小与二进制分发说明](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)

自动更新只读取公开稳定版 Release。1.4.1 是首个带桌面更新功能的版本，老版本用户需要手动安装一次；以后安装版可在“设置 → 软件更新”完成下载和重启安装。便携版只提示并打开下载页。当前安装包仍未配置发布者签名，发布说明应保留此限制。

## 发布者需要确定的信息

- 许可证目前为 `UNLICENSED`，没有代替所有者选择开源协议。如要作为开源项目发布，先确定适用的许可证并在仓库根目录放入 LICENSE，再同步 package.json 的 license 字段。[GitHub 许可证说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
- 仓库已启用私密漏洞报告渠道，实际报告入口见 [SECURITY.md](../SECURITY.md)。迁移仓库时同步更新报告链接。[GitHub 私密漏洞报告设置](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
- 保留 README 中的非官方项目说明。仓库地址、维护者身份、签名和自动更新源应填写真实信息。

## 新环境验证

使用 Node.js 22.22 或更高版本，按照 README 运行 npm ci、安装 Playwright Chromium、npm test、npm run build 和 npm run test:e2e。E2E 使用本地 mock Grok，不需要真实账号。

仓库包含 Windows CI，上传后查看 GitHub Actions 的实际结果。普通检查使用只读权限；仅标签触发的发布工作流使用仓库自带的 `GITHUB_TOKEN` 写入 Release，不需要维护者另建 token 或向最终用户索取认证。此前本机干净副本验证不能代替 GitHub 托管环境的第一次运行。
