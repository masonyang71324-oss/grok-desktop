# 官方 CLI 与本地合成模型运行验证

验证日期：2026-10-03（北京时间）；最终运行开始于 `2026-10-02T19:08:53.890Z`。产品基线为 `991d863fa908ff906b5cdaad060dbbfee3720213` / Grok Desktop 1.7.1，本报告没有修改产品代码。

**J02 的官方历史恢复，以及 J05 的普通前台命令后代取消/退出，均取得了真实官方 CLI 的通过证据。** 本轮使用 `grok 1.0.46 (2765805b9442)`、实际 `GrokClient`/`SessionHub`、真实 ACP 通信和真实 Windows 进程。模型端是仅监听 `127.0.0.1` 的确定性 HTTP/SSE 服务。这不是 mock ACP，也不是付费模型、生产服务或模型质量验收。

## 隔离与执行

可复查脚本：`scripts/verify-cli-local-model.cjs`。运行命令：

```powershell
node scripts/verify-cli-local-model.cjs
```

默认可执行文件是此前从官方分发下载的 `test-results/cli-install-probe/grok.exe`；也可把官方 CLI 的绝对路径作为第一个参数。脚本仅在 Windows 运行。原始结果保存到忽略目录下的 `test-results/cli-local-model.json`，含模型请求路径、批准请求、PID 父子关系、恢复结果和清理状态。

脚本为每次运行创建独立临时根目录，其中 `GROK_HOME`、`USERPROFILE`、`HOME`、`APPDATA`、`LOCALAPPDATA`、`TEMP`、`TMP` 和会话 cwd 均为空的新目录。子进程环境从操作系统变量白名单构造，不复制完整 `process.env`，没有继承真实 API key，也没有读取用户的认证/config 文件。唯一模型凭据为固定假值 `LOCAL_AUDIT_KEY=audit-fake-local-key`；本地服务逐次核对收到的 Authorization 和模型名称。没有启动、操作或退出用户正在运行的 Desktop。

模型配置依据该官方 CLI 随包生成的 `11-custom-models.md`、`05-configuration.md`、`26-config-reference.md`，采用：

```toml
[models]
default = "local-audit"
allowed_models = ["local-audit"]
remote_fetch = false
session_summary = "local-audit"
prompt_suggestion = "local-audit"

[model.local-audit]
model = "local-audit"
name = "Local synthetic audit"
base_url = "http://127.0.0.1:<ephemeral-port>/v1"
env_key = "LOCAL_AUDIT_KEY"
api_backend = "chat_completions"
```

同时关闭 updater、telemetry、trace upload、relay、managed MCP 和相关后台功能，将公开端点覆盖到本地服务；HTTP/HTTPS/ALL proxy 也指向拒绝转发的本地端点。最终记录到 7 个本地 Chat Completions 请求和 5 个本地元数据请求，代理未收到外部目标请求。该配置与记录用于证明本次模型请求走本地；不把环境代理宣称为 OS 网络沙箱。

## J02：后台完成后，新的官方 CLI 恢复最终回复

脚本创建真实会话 A、B，为 A 发送单条无工具提示，并在本地模型实际收到 A 请求后暂缓发送最终回复。然后调用真实 `SessionHub.setActiveSession(B)`，再释放 A 的 SSE 回复。断言 B 仍为当前会话、A 的拥有条目状态为 completed，A 的最终助手文本严格等于 `LOCAL_AUDIT_FINAL_A_20261003`。

随后销毁第一个 Hub，确认原 CLI PID `29312`、`13744` 均已退出，创建新的 Hub 和 CLI PID `29740`，调用官方 `session/load` 加载原 A。返回的 5 条历史更新中包含完全相同的最终助手文本。桌面队列/摘要文件不包含该助手文本，因此此结果没有依赖桌面自建的完整会话备份。

结果：通过。这里实际重启的是 CLI 进程和会话服务对象；A/B 活动选择通过真实 SessionHub 设置，未开启 Electron UI 或做屏幕点击。该证据证明官方 CLI 在此本地模型场景中的持久化与恢复，结合既有 UI 夹具覆盖活动视图路由。它不证明远端生产服务的同步、账户历史或付费多轮上下文。

## J05：确认工具后代就绪后，再取消或关闭

脚本从临时模型请求中读取官方工具 schema。当前 CLI 提供 `run_terminal_command`，其描述明确为 Windows PowerShell 5.1。合成模型只返回一次预定工具调用：使用当前 Node 可执行文件运行临时目录中的 `owned-wait.cjs`，脚本再创建一个 Node 子进程。子进程写出含自身 PID、父 PID 和 cwd 的 readiness 文件，然后保持运行。

每次收到真实 ACP `session/request_permission` 后，仅当 `rawInput.command` 与预先构造的完整命令完全相同，才选择 `allow_once`。没有开启 auto/yolo，没有接受 `allow_always`，其他命令一律拒绝。取消和关闭场景各实际收到并批准 1 次请求。

读到 readiness 文件后，脚本用精确 PID 查询 Windows 进程信息，逐级确认 `grok.exe → powershell.exe → node.exe → node.exe` 关系，并确认两层 Node 都存活，才发出取消/关闭动作。最初本机记录使用CIM；后续云端CIM观察步骤失败后，脚本改用只读的Windows内核进程快照（`scripts/read-process-ancestry.ps1`，`CreateToolhelp32Snapshot`/`Process32FirstW`），继续核对相同父子链，不依赖WMI服务或扩大等待期限。模型/CLI行为和退出断言不变。

| 动作                                        | 动作前确认的真实 PID 链                                        | 结果                                   |
| ------------------------------------------- | -------------------------------------------------------------- | -------------------------------------- |
| `SessionHub.cancel` → 官方 `session/cancel` | CLI `22356` → PowerShell `18936` → Node `21740` → Node `25180` | 11 ms 后所有工具后代均消失；CLI 仍存活 |
| `SessionHub.dispose` → `GrokClient.dispose` | CLI `22036` → PowerShell `15368` → Node `23492` → Node `19600` | 67 ms 后 CLI 及全部工具后代均消失      |

结果：两条路径通过。时间是本次本地运行从发出动作到检查通过的观测值，不是性能保证。成功记录前没有人工/taskkill 补杀；脚本只在失败或最终清理中对自己已记录的 PID 做兜底清理，本次无需补杀存活进程。

这是当前官方 CLI 的普通前台 `run_terminal_command` 及其两层后代的真实生命周期证据，不能外推为所有工具、脱离进程树的服务、subagent、workflow 或未测试平台均已通过。完整 Electron 关窗/退出事件链仍由既有生命周期测试覆盖，本轮未重复操作用户 Desktop。

## 验证与清理结论

最终命令退出码为 `0`，J02、J05 cancel、J05 dispose 三个场景均通过。输出记录确认所有本轮 CLI 和已观察到的后代均退出、本地 HTTP 服务关闭、临时根目录已删除；临时 `GROK_HOME` 未生成 `auth.json`。只保留上述可复查脚本、此报告以及忽略目录中的结果 JSON。

没有据此新增产品修复，没有跑全套测试，没有提交或推送。本报告补足两个指定的运行时验证点，付费服务、多轮模型效果、真实设备码登录、完整 Windows 首装及其他工具类别继续按各自证据范围描述。

云端增补时还发现测试目录可能采用`RUNNER~1`短名，而Node返回`runneradmin`长名；验证现比较`fs.realpath`后的同一目录，未降低cwd归属检查。工具readiness中的两个自有PID会立即记录，确保观察步骤失败时仍清理已启动的工具。内核快照版本在本机重跑后，J02、J05取消与关闭再次通过，所有自有进程和临时目录退出/清理正常。
