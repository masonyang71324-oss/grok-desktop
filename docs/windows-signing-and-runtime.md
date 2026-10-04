# Windows 签名与 Electron 运行时构建

当前默认构建仍为**未签名**。本轮没有证书、没有使用签名账户，也没有生成自签名证书冒充发行者签名。准备好的 `npm run dist:signed` 会要求真实签名成功；没有凭据时应失败。

## 使用已有代码签名证书

构建器锁定版本为 electron-builder 26.15.3，以下参数按仓库安装的 v26 schema 核对。不要直接照搬最新版 v27 的 `win.sign` 配置替代这里的 `win.signtoolOptions` / `win.azureSignOptions`。

在授权的构建环境中配置 `WIN_CSC_LINK`（已有 PFX/P12 文件路径或其 base64）和 `WIN_CSC_KEY_PASSWORD`；也支持构建器的 `CSC_LINK` / `CSC_KEY_PASSWORD`。通过 CI Secret 或受控终端环境提供，勿写入仓库或输出日志。之后运行：

```powershell
npm ci
npm run dist:signed
```

脚本启用 `win.signExecutable=true` 与 `forceCodeSigning=true`，覆盖默认未签名开关，且明确使用 `--publish never`。它只生成待验证的签名产物，不上传发行版。实际证书、私钥使用权限和发布者名称由发行者提供。

若证书在 Windows 证书存储或硬件令牌中，用 v26 的 `win.signtoolOptions.certificateSha1` 或 `certificateSubjectName` 选择既有证书。证书选择参数应由发行者提供；不要把证书密码放在配置文件中。可将 `win.signtoolOptions.signingHashAlgorithms` 设置为 `["sha256"]`，并按组织的签名策略配置时间戳。

## 使用已有 Azure Trusted Signing 服务

v26 接入点为 `win.azureSignOptions`，不能同时配置 `win.signtoolOptions`。在组织提供的本机构建配置中填入：

```json
{
  "win": {
    "signExecutable": true,
    "azureSignOptions": {
      "publisherName": "填写已有证书的发布者名称",
      "endpoint": "填写已有签名账户所在区域的 endpoint",
      "certificateProfileName": "填写已有证书配置名称",
      "codeSigningAccountName": "填写已有签名账户名称"
    }
  },
  "forceCodeSigning": true
}
```

由发行者按 [Microsoft EnvironmentCredential](https://learn.microsoft.com/en-us/dotnet/api/azure.identity.environmentcredential) 提供现有身份凭据，例如 `AZURE_TENANT_ID`、`AZURE_CLIENT_ID`、`AZURE_CLIENT_SECRET`，或组织批准的其他受支持身份方式。本仓库没有账户或证书，不会自动申请、购买或登录。使用该配置时应继承本仓库的完整 build 配置；不要省略 ASAR、Fuses、图标和打包文件规则。

## 产物验证与更新

签名完成后，在 Windows 用 `Get-AuthenticodeSignature` 或已安装 Windows SDK 的 `signtool verify /pa /all /v` 验证主程序、NSIS 安装器和 portable 程序；确认状态有效且发布者正确。为发布者明确配置与证书一致的 `publisherName`，保留更新签名验证。首次转向签名分发需要发行者验证旧安装升级到新包的实际路径；不以本地未签名构建替代这项确认。

Fuses 由 electron-builder 的原生 `electronFuses` 配置在签名前处理，ASAR 完整性资源由构建器嵌入 Windows 可执行文件；不要在签名后修改程序或 app.asar。对最终包执行：

```powershell
$env:GROK_DESKTOP_TEST_EXE = (Resolve-Path 'release/win-unpacked/Grok Desktop.exe').Path
node scripts/verify-packaged-fuses.cjs $env:GROK_DESKTOP_TEST_EXE
node --test tests/terminal-native.test.cjs
npm run test:e2e:upgrades
node tests/e2e-review-fixes.cjs
```

已配置关闭 `RunAsNode` 与 `EnableNodeOptionsEnvironmentVariable`，启用 `OnlyLoadAppFromAsar` 与 `EnableEmbeddedAsarIntegrityValidation`。PTY 使用 Electron `utilityProcess`，不再依赖 `ELECTRON_RUN_AS_NODE`。`EnableNodeCliInspectArguments` **暂时保持启用**，因为本项目对真实最终包的 Playwright Electron 验证依赖 inspector；尚未完成独立测试传输迁移前，不通过关闭它牺牲最终包实测。

关闭 NodeOptions fuse 同时影响 Electron 自身的 `NODE_EXTRA_CA_CERTS` 入口；企业证书应通过系统/Chromium 信任配置或明确支持的应用代理设置处理，不能假称该环境变量仍对打包后的 Electron 生效。外部用户 CLI/项目工具自己的 Node 环境不是这里修改的对象。

## GitHub Actions 来源固定

工作流中的 checkout、setup-node、upload-artifact 已固定至官方 tag 对应提交并保留版本注释；Dependabot 的 github-actions 配置保留。upload-artifact 更新到 Node 24 运行时版本，使用 GitHub 托管 runner，无需为已弃用 Node 20 运行时设置豁免。凭据尚未配置前，现有发行工作流保持明确的未签名默认行为，不伪称已具备发布者身份认证。

参考：

- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process) 与 [parentPort](https://www.electronjs.org/docs/latest/api/parent-port)
- [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses) 与 [ASAR Integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)
- [electron-builder Fuses](https://www.electron.build/docs/tutorials/adding-electron-fuses/)
- [electron-builder v26.15.3 Windows 配置源码](https://github.com/electron-userland/electron-builder/blob/v26.15.3/packages/app-builder-lib/src/options/winOptions.ts)
- [electron-builder 签名概述](https://www.electron.build/docs/features/code-signing/)

## 主进程静态检查

`npm run lint:electron` 对 `electron/**/*.cjs` 检查未定义名字、不可达代码、重复参数/键、错误的控制流和恒定二元表达式。`npm run typecheck:electron` 对所有 Electron 主进程模块启用 `allowJs`、`checkJs`、`noEmit`；两项均已纳入 Windows CI 和发行构建流程。当前没有启用旧 JavaScript 全面的 strict/noImplicitAny 迁移，也没有用 `@ts-nocheck` 排除模块。

对固定版本第三方库缺失的声明，`electron/types/` 只补项目实际使用的 XML、ZIP、Word 和 RTF 接口形状；升级相关依赖时应重新核对这些声明和文档解析测试。
