// Only application-owned copy belongs here. Never translate server output or user content.
let locale = 'zh-CN';
const english = {
  文件有未保存的修改: 'Unsaved file changes',
  '关闭或重新载入会丢失尚未保存的文件修改。':
    'Closing or reloading will discard your unsaved file changes.',
  继续编辑: 'Keep editing',
  放弃修改并继续: 'Discard changes and continue',
  '重新连接会中断当前任务并清除待批准操作，然后从历史中恢复会话。':
    'Reconnecting will interrupt the current task and clear pending approvals, then restore the conversation from history.',
  重新连接并载入: 'Reconnect and reload',
  'Grok 需要你批准一项操作': 'Grok needs your approval',
  任务已停止: 'Task stopped',
  任务已完成: 'Task completed',
  '任务遇到问题，请返回查看': 'A task needs attention. Open Grok Desktop to review it.',
  '找不到指定的 Grok 程序，请在设置中检查路径。':
    'The selected Grok executable was not found. Check its path in Settings.',
  '没有找到 Grok Build。请先安装官方 CLI，并在设置中指定 grok.exe。':
    'Grok Build was not found. Install the official CLI, then select grok.exe in Settings.',
  '请选择有效的项目目录。': 'Select a valid project folder.',
  '项目目录不存在或无法访问，请重新选择。':
    'The project folder is missing or inaccessible. Select it again.',
  '只支持打开网页链接。': 'Only web links can be opened.',
  '请选择有效的文件或目录。': 'Select a valid file or folder.',
  导出会话: 'Export conversation',
  '当前项目还不是 Git 仓库，无法创建工作树。':
    'This project is not a Git repository. A worktree cannot be created.',
  '请先创建或打开一个会话。': 'Create or open a conversation first.',
  '请填写有效的工作树名称，不要使用路径符号。':
    'Enter a valid worktree name without path separators.',
  选择新工作树的存放目录: 'Choose a folder for the new worktree',
  '已取消创建。': 'Creation cancelled.',
  '工作树已存在：{path}': 'Worktree already exists: {path}',
  '工作树已创建：{path}': 'Worktree created: {path}',
  '配置已更新，Grok 已重新连接。': 'Settings updated. Grok has reconnected.',
  '复制内容无效。': 'The content to copy is invalid.',
  '选择 Grok Build 程序': 'Select the Grok Build executable',
  'Windows 程序': 'Windows executable',
  打开项目: 'Open project',
  添加文件上下文: 'Attach files',
  文本与代码: 'Text and code',
  所有文件: 'All files',
  '不支持的操作。': 'This operation is not supported.',
  界面已停止响应: 'The interface stopped responding',
  '界面进程异常退出。': 'The interface process exited unexpectedly.',
  '重新载入后可从历史中恢复会话。': 'Reload to restore your conversation from history.',
  重新载入: 'Reload',
  关闭: 'Close',
  任务仍在运行: 'A task is still running',
  '退出会中断 Grok 正在执行的任务。': 'Quitting will interrupt the tasks Grok is running.',
  '包括此应用启动的本地代理和后台任务。会话记录会保留。':
    'This includes local agents and background tasks started by this app. Conversation history will be kept.',
  继续运行: 'Keep running',
  停止并退出: 'Stop and quit',
  编辑: 'Edit',
  撤销: 'Undo',
  重做: 'Redo',
  剪切: 'Cut',
  复制: 'Copy',
  粘贴: 'Paste',
  全选: 'Select all',
  视图: 'View',
  实际大小: 'Actual size',
  放大: 'Zoom in',
  缩小: 'Zoom out',
  开发者工具: 'Developer tools',
  '正在执行管理操作或重新加载配置，请完成后再操作会话或更换 Grok 程序。':
    'A management operation or settings reload is in progress. Wait before changing conversations or the Grok executable.',
  'Grok 仍有任务在运行或正在切换会话。请先结束任务，再更改扩展或更新程序。':
    'Grok is running a task or switching conversations. Finish the task before changing extensions or updating Grok.',
  'Grok 未返回有效的套餐信息。': 'Grok did not return valid plan information.',
  '无法读取套餐信息。': 'Could not read plan information.',
  '启动参数 JSON 格式不正确，请使用字符串数组。':
    'Launch arguments must be a valid JSON array of strings.',
  '启动参数的引号没有闭合。': 'Launch arguments contain an unclosed quotation mark.',
  '请填写{label}。': 'Enter {label}.',
  '{label}不能以“-”开头。': '{label} cannot start with “-”.',
  服务器名称: 'server name',
  环境变量: 'environment variable',
  请求头: 'request header',
  启动程序: 'executable',
  服务地址: 'server URL',
  插件来源: 'plugin source',
  插件名称: 'plugin name',
  市场来源: 'marketplace source',
  '服务地址必须以 http:// 或 https:// 开头。':
    'The server URL must start with http:// or https://.',
  '不支持的管理操作：{action}': 'Unsupported management operation: {action}',
  '操作已完成。': 'Operation completed.',
  'Grok ACP 协议错误：{message}': 'Grok ACP protocol error: {message}',
  '无法向 Grok 写入请求：{message}': 'Could not write a request to Grok: {message}',
  '无法启动 Grok：{message}': 'Could not start Grok: {message}',
  'Grok 进程已退出 ({code}){detail}': 'Grok exited ({code}){detail}',
  'Grok 连接已关闭': 'The Grok connection is closed',
  '不支持 ACP 协议版本 {version}': 'Unsupported ACP protocol version {version}',
  'Grok 尚未连接，请重试': 'Grok is not connected. Please retry',
  'Grok 请求超时：{method}。请重新连接后重试。':
    'Grok request timed out: {method}. Reconnect and try again.',
  '收到无效 JSON-RPC 消息': 'Received an invalid JSON-RPC message',
  '响应缺少请求 ID': 'The response is missing a request ID',
  '响应缺少 result 或 error': 'The response is missing result or error',
  'Grok 请求失败：{method}': 'Grok request failed: {method}',
  'session/update 内容不完整': 'The session/update payload is incomplete',
  权限请求缺少会话或选项: 'The approval request is missing its session or options',
  '重复的权限请求 ID': 'Duplicate approval request ID',
  '请选择有效的权限模式：ask 或 auto。': 'Select a valid permission mode: ask or auto.',
  此权限请求已处理或已失效: 'This approval request was already handled or has expired',
  请选择有效的权限选项: 'Select a valid approval option',
  '当前任务正在运行，请先等待完成或停止任务。':
    'A task is running. Wait for it to finish or stop it first.',
  '正在切换或设置会话，请稍后重试。':
    'A conversation is being opened or configured. Try again shortly.',
  '此会话尚未载入，请先打开该会话后重试。':
    'This conversation has not been loaded. Open it and try again.',
  'Grok 未返回新会话 ID': 'Grok did not return a new conversation ID',
  '当前 Grok 版本未提供所选模型': 'This Grok version does not offer the selected model',
  所选模型不支持推理强度: 'The selected model does not support reasoning effort',
  所选模型不支持此推理强度: 'The selected model does not support this reasoning effort',
  当前会话未提供所选模式: 'The selected mode is not available in this conversation',
  '当前 Grok 版本不支持附件上下文': 'This Grok version does not support file attachments',
  '附件不是文件：{name}': 'The attachment is not a file: {name}',
  '文本附件单个不得超过 1 MB，总计不得超过 4 MB':
    'Text attachments are limited to 1 MB each and 4 MB in total',
  '目前仅支持文本附件：{name}': 'Only text attachments are supported: {name}',
  请输入消息或添加文本附件: 'Enter a message or attach a text file',
  所选会话没有正在运行的任务: 'No task is running in the selected conversation',
  'Grok 未在停止请求后结束。本应用的独立进程已终止，任务被中断；重新打开会话即可继续。':
    'Grok did not stop after the cancellation request. This app’s Grok process was terminated and the task was interrupted. Reopen the conversation to continue.',
  'Grok 会话列表返回了重复分页标记': 'Grok returned a repeated conversation pagination token',
  会话标题不能为空: 'The conversation title cannot be empty',
  'Grok 未确认会话已重命名': 'Grok did not confirm the conversation was renamed',
  'Grok 未确认会话已删除': 'Grok did not confirm the conversation was deleted',
  '操作等待超时，请检查网络或稍后重试。':
    'The operation timed out. Check your network or try again later.',
  '输出内容过大，请缩小查看范围。': 'The output is too large. Narrow the scope and try again.',
  '找不到可执行程序：{path}': 'Executable not found: {path}',
  '程序退出，代码 {code}': 'The process exited with code {code}',
  '请先选择项目目录。': 'Select a project folder first.',
  '文件必须位于当前项目目录内。': 'The file must be inside the current project folder.',
  '请选择一个文件。': 'Select a file.',
  '此文件为二进制内容，请使用系统应用打开。':
    'This is a binary file. Open it with a system application.',
  '保存内容必须为文本。': 'Only text content can be saved.',
  '文件已被 Grok 或其他应用修改，请重新打开后再保存。':
    'Grok or another app has changed this file. Reopen it before saving.',
  '分离 HEAD': 'Detached HEAD',
  '新文件 {path}\n': 'New file {path}\n',
  '\n… 内容已截断': '\n… Content truncated',
  '此文件没有可显示的文本差异。': 'There is no text diff to display for this file.',
  '请先创建或打开当前项目的会话。': 'Create or open a conversation in the current project first.',
  'Grok 连接已断开，无法继续等待工作树创建结果。':
    'Grok disconnected while waiting for worktree creation.',
  '创建工作树失败。': 'Could not create the worktree.',
  '创建工作树已取消。': 'Worktree creation was cancelled.',
  '工作树创建仍未完成，请查看 Grok 工作树列表确认状态后重试。':
    'Worktree creation has not finished. Check Grok’s worktree list before retrying.',
  'Grok 未确认工作树创建请求。': 'Grok did not confirm the worktree creation request.',
  '尚未创建记忆目录：{path}。启用 Grok 记忆并保存内容后，文件会显示在这里。':
    'The memory folder does not exist yet: {path}. Enable Grok memory and save content to see files here.',
  '找到 {count} 个记忆文件。\n{files}': 'Found {count} memory files.\n{files}',
  '记忆目录中暂无 Markdown 文件：{path}':
    'There are no Markdown files in the memory folder: {path}',
  工作流: 'workflows',
  后台任务: 'background tasks',
  运行中的子任务: 'running subtasks',
  会话: 'conversation',
  任务: 'task',
  子任务: 'subtask',
  '请先选择{label}。': 'Select a {label} first.',
  'Grok 未返回有效的操作结果，请刷新会话后重试。':
    'Grok did not return a valid result. Refresh the conversation and try again.',
  '当前会话没有{label}。': 'This session has no {label}.',
  '不支持的能力操作：{action}': 'Unsupported capability operation: {action}',
  'Grok 返回的能力列表格式不正确。': 'Grok returned an invalid capability list.',
  '已删除所选计划。': 'The selected schedule was deleted.',
  '未找到该计划，未删除任何计划。': 'That schedule was not found. No schedules were deleted.',
  '停止请求结果：\n{result}': 'Stop request result:\n{result}',
};

function setLocale(value) {
  locale = value === 'en' ? 'en' : 'zh-CN';
}
function getLocale() {
  return locale;
}
function translate(source, values = {}) {
  const template = locale === 'en' ? (english[source] ?? source) : source;
  return template.replace(/\{([A-Za-z]+)\}/g, (match, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

module.exports = { setLocale, getLocale, translate };
