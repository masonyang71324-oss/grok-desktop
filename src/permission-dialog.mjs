import { contentText } from './timeline.mjs';

const rawText = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

function approvalDiffs(content) {
  if (Array.isArray(content)) return content.flatMap(approvalDiffs);
  if (!content || typeof content !== 'object') return [];
  if (content.type !== 'diff') return content.content != null ? approvalDiffs(content.content) : [];
  if (
    typeof content.path !== 'string' ||
    !(content.oldText == null || typeof content.oldText === 'string') ||
    typeof content.newText !== 'string'
  )
    return [];
  const lines = (text) => {
    if (!text) return [];
    const result = text.split(/\r?\n/);
    if (result.at(-1) === '') result.pop();
    return result.map((text, index) => ({
      text,
      terminated: index < result.length - 1,
    }));
  };
  const before = lines(content.oldText || '');
  const after = lines(content.newText);
  if (before.length) before.at(-1).terminated = content.oldText.endsWith('\n');
  if (after.length) after.at(-1).terminated = content.newText.endsWith('\n');
  const same = (a, b) => a.text === b.text && a.terminated === b.terminated;
  let prefix = 0,
    suffix = 0;
  while (prefix < before.length && prefix < after.length && same(before[prefix], after[prefix]))
    prefix++;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    same(before[before.length - 1 - suffix], after[after.length - 1 - suffix])
  )
    suffix++;
  const marked = (rows, sign) =>
    rows.flatMap((row) => [
      sign + row.text,
      ...(!row.terminated ? ['\\ No newline at end of file'] : []),
    ]);
  return [
    {
      path: content.path,
      text: [
        `--- ${content.oldText == null ? '/dev/null' : content.path}`,
        `+++ ${content.path}`,
        `@@ -${before.length ? 1 : 0},${before.length} +${after.length ? 1 : 0},${after.length} @@`,
        ...marked(before.slice(0, prefix), ' '),
        ...marked(before.slice(prefix, before.length - suffix), '-'),
        ...marked(after.slice(prefix, after.length - suffix), '+'),
        ...marked(after.slice(after.length - suffix), ' '),
      ].join('\n'),
    },
  ];
}

// These are display hints for recognizable commands, not an execution policy or a shell parser.
function commandRisks(command) {
  const found = new Set();
  const inspect = (source) => {
    const tokens = source.match(/"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^\s;&|]+|[;&|\n]/g) || [];
    let words = [];
    const unquote = (word) => (/^(['"])[\s\S]*\1$/.test(word) ? word.slice(1, -1) : word);
    const inspectWords = () => {
      if (!words.length) return;
      let args = words.map(unquote);
      if (args[0].toLowerCase() === 'sudo') args = args.slice(1);
      const executable = (args[0] || '')
        .split(/[\\/]/)
        .at(-1)
        .replace(/\.exe$/i, '')
        .toLowerCase();
      if (['powershell', 'pwsh', 'bash', 'sh', 'cmd'].includes(executable)) {
        const flag = args.findIndex((arg) => /^(?:-command|-c|\/c)$/i.test(arg));
        if (flag >= 0) inspect(args.slice(flag + 1).join(' '));
        return;
      }
      const lower = args.map((arg) => arg.toLowerCase());
      if (
        ['rm', 'rmdir', 'rd', 'del', 'erase', 'remove-item'].includes(executable) &&
        !lower.includes('-whatif')
      )
        found.add('delete');
      if (executable !== 'git') return;
      let action = 1;
      while (args[action]?.startsWith('-')) {
        const takesValue = [
          '-C',
          '-c',
          '--git-dir',
          '--work-tree',
          '--namespace',
          '--config-env',
        ].includes(args[action]);
        action += takesValue ? 2 : 1;
      }
      if (!['push', 'reset', 'clean'].includes(lower[action])) return;
      const flags = lower.slice(action + 1);
      if (flags.includes('--dry-run')) return;
      if (lower[action] === 'reset' && flags.includes('--hard')) found.add('reset');
      if (
        lower[action] === 'push' &&
        flags.some((arg) => /^--force(?:=|$)|^--force-with-lease(?:=|$)|^-[^-]*f|^\+/.test(arg))
      )
        found.add('force-push');
      if (
        lower[action] === 'clean' &&
        !flags.some((arg) => /^-[^-]*n/.test(arg)) &&
        flags.some((arg) => arg === '--force' || /^-[^-]*f/.test(arg))
      )
        found.add('delete');
    };
    for (const token of tokens) {
      if (/^[;&|\n]$/.test(token)) {
        inspectWords();
        words = [];
      } else words.push(token);
    }
    inspectWords();
  };
  inspect(command);
  const descriptions = {
    delete: {
      title: '删除文件或目录',
      description: '此命令包含删除操作，文件可能不会进入回收站。请核对目标路径。',
    },
    reset: {
      title: '丢弃未提交的修改',
      description: 'git reset --hard 会重置已跟踪文件，并丢弃其中未提交的修改。',
    },
    'force-push': {
      title: '改写远程分支历史',
      description: '强制推送可能改写远程分支已有提交，请确认分支和协作者的变更。',
    },
  };
  return [...found].map((kind) => ({ kind, ...descriptions[kind] }));
}

export function permissionChoice(option) {
  const original = typeof option.name === 'string' ? option.name : '';
  const scopeText = original.toLowerCase();
  const commandScope = /(?:this|same|specific) command\b/.test(scopeText);
  const commandToolScope = /\b(?:bash|shell|powershell|terminal) commands?\b/.test(scopeText);
  const toolScope = /\b(?:this|same) tool\b/.test(scopeText);
  const scope = commandScope
    ? '此命令'
    : commandToolScope
      ? '命令工具'
      : toolScope
        ? '此工具'
        : '此类操作';
  switch (option.kind) {
    case 'allow_once':
      return { label: '允许本次', description: '仅允许这一次请求。', original };
    case 'reject_once':
      return {
        label: '拒绝本次',
        description: '拒绝这一次请求，可继续向 Grok 说明你的要求。',
        original,
      };
    case 'allow_always':
      return {
        label: `允许${scope}且不再询问`,
        description: `记住此选项指定范围的允许决定。`,
        original,
      };
    case 'reject_always':
      return {
        label: `拒绝${scope}且不再询问`,
        description: `记住此选项指定范围的拒绝决定。`,
        original,
      };
    default:
      return {
        label: /[\u3400-\u9fff]/.test(original) ? original : '其他处理方式',
        description: '请先展开查看此选项的官方原始说明。',
        original,
      };
  }
}

export function permissionOverview(toolCall = {}, cwd = '') {
  const rawInput = toolCall.rawInput;
  const originalTitle = typeof toolCall.title === 'string' ? toolCall.title : '';
  const objectInput =
    rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : null;
  const directoryKey =
    objectInput &&
    ['cwd', 'workdir', 'working_directory', 'workingDirectory'].find(
      (key) => typeof objectInput[key] === 'string' && objectInput[key].trim(),
    );
  const workingDirectory = directoryKey ? objectInput[directoryKey] : cwd;
  const commandKey = objectInput
    ? ['command', 'cmd', 'script'].find((key) => typeof objectInput[key] === 'string')
    : null;
  const command = commandKey
    ? objectInput[commandKey]
    : typeof rawInput === 'string'
      ? rawInput
      : '';
  const source = `${originalTitle}\n${command}`;
  const powerShell = /\b(?:powershell|pwsh)(?:\.exe)?\b/i.test(source);
  const shell = powerShell || !!command || /\b(?:bash|shell|cmd\.exe)\b/i.test(originalTitle);
  const title = powerShell
    ? '运行 PowerShell 命令'
    : shell
      ? '运行命令工具'
      : originalTitle.length <= 70 &&
          !originalTitle.includes('\n') &&
          /[\u3400-\u9fff]/.test(originalTitle)
        ? originalTitle
        : '执行工具操作';
  const previewSource = (command || originalTitle).replace(/\s+/g, ' ').trim();
  const preview = previewSource.length > 140 ? `${previewSource.slice(0, 139)}…` : previewSource;
  const sections = [];
  if (command) sections.push({ label: '完整命令', text: command });
  if (objectInput && commandKey) {
    const other = { ...objectInput };
    delete other[commandKey];
    if (Object.keys(other).length) sections.push({ label: '其他参数', text: rawText(other) });
  } else if (rawInput != null && !command) {
    sections.push({ label: '操作参数', text: rawText(rawInput) });
  }
  const normalized = (value) => value.replace(/\s+/g, ' ').trim();
  if (originalTitle && (!command || !normalized(originalTitle).includes(normalized(command)))) {
    sections.push({ label: '工具原始标题', text: originalTitle });
  }
  const content = contentText(toolCall.content);
  if (content && !sections.some((section) => normalized(section.text) === normalized(content)))
    sections.push({ label: '操作详情', text: content });
  return {
    title,
    preview: preview === title ? '' : preview,
    sections,
    cwd: workingDirectory,
    diffs: approvalDiffs(toolCall.content),
    risks: commandRisks(command),
    raw: rawText(toolCall),
  };
}
