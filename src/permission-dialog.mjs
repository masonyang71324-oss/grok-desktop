import { contentText } from './timeline.mjs';

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

export function permissionOverview(toolCall = {}) {
  const rawInput = toolCall.rawInput;
  const originalTitle = typeof toolCall.title === 'string' ? toolCall.title : '';
  const objectInput =
    rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : null;
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
    if (Object.keys(other).length) sections.push({ label: '其他参数', text: contentText(other) });
  } else if (rawInput != null && !command) {
    sections.push({ label: '操作参数', text: contentText(rawInput) });
  }
  const normalized = (value) => value.replace(/\s+/g, ' ').trim();
  if (originalTitle && (!command || !normalized(originalTitle).includes(normalized(command)))) {
    sections.push({ label: '工具原始标题', text: originalTitle });
  }
  const content = contentText(toolCall.content);
  if (content && !sections.some((section) => normalized(section.text) === normalized(content)))
    sections.push({ label: '操作详情', text: content });
  return { title, preview: preview === title ? '' : preview, sections };
}
