const { translate: t } = require('./i18n.cjs');
const { runChecked } = require('./process.cjs');

function required(values, key, label) {
  const value = String(values[key] ?? '').trim();
  if (!value) throw new Error(t('请填写{label}。', { label }));
  if (value.startsWith('-')) throw new Error(t('{label}不能以“-”开头。', { label }));
  return value;
}

function argumentList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const array = JSON.parse(text);
      if (!Array.isArray(array) || array.some((x) => typeof x !== 'string')) throw new Error();
      return array;
    } catch {
      throw new Error(t('启动参数 JSON 格式不正确，请使用字符串数组。'));
    }
  }
  const result = [];
  let quote = '',
    token = '',
    started = false;
  for (const c of text) {
    if (quote) {
      if (c === quote) quote = '';
      else token += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) {
        result.push(token);
        token = '';
        started = false;
      }
    } else {
      token += c;
      started = true;
    }
  }
  if (quote) throw new Error(t('启动参数的引号没有闭合。'));
  if (started) result.push(token);
  return result;
}

function buildCommand(action, values = {}) {
  let args,
    mutates = false,
    timeout = 30000;
  const scope = values.scope === 'project' ? 'project' : 'user';
  const read = {
    inspect: ['inspect', '--json'],
    doctor: ['doctor'],
    models: ['models'],
    'update-check': ['update', '--check', '--json'],
    'mcp-list': ['mcp', 'list', '--json'],
    'mcp-doctor': ['mcp', 'doctor'],
    'plugin-list': ['plugin', 'list', '--json'],
    'plugin-marketplaces': ['plugin', 'marketplace', 'list'],
    'worktree-list': ['worktree', 'list', '--json'],
  };
  if (read[action]) args = read[action];
  else if (action === 'mcp-add') {
    const name = required(values, 'name', t('服务器名称'));
    const transport = ['stdio', 'http', 'sse'].includes(values.transport)
      ? values.transport
      : 'stdio';
    args = ['mcp', 'add', name, '--scope', scope, '--transport', transport];
    for (const env of String(values.env || '')
      .split(/\r?\n/)
      .filter((x) => x.trim()))
      args.push('--env', required({ value: env }, 'value', t('环境变量')));
    for (const header of String(values.headers || '')
      .split(/\r?\n/)
      .filter((x) => x.trim()))
      args.push('--header', required({ value: header }, 'value', t('请求头')));
    if (transport === 'stdio')
      args.push('--', required(values, 'command', t('启动程序')), ...argumentList(values.args));
    else {
      const url = required(values, 'url', t('服务地址'));
      if (!/^https?:\/\//i.test(url))
        throw new Error(t('服务地址必须以 http:// 或 https:// 开头。'));
      args.push(url);
    }
    mutates = true;
  } else if (action === 'mcp-remove') {
    args = ['mcp', 'remove', required(values, 'name', t('服务器名称')), '--scope', scope];
    mutates = true;
  } else if (action === 'mcp-enable' || action === 'mcp-disable') {
    args = ['mcp', action.slice(4), required(values, 'name', t('服务器名称'))];
    mutates = true;
  } else if (action === 'plugin-install') {
    args = ['plugin', 'install', required(values, 'plugin', t('插件来源')), '--trust'];
    mutates = true;
    timeout = 120000;
  } else if (['plugin-uninstall', 'plugin-enable', 'plugin-disable'].includes(action)) {
    args = ['plugin', action.slice(7), required(values, 'plugin', t('插件名称'))];
    if (action === 'plugin-uninstall') args.push('--confirm', '--keep-data');
    mutates = true;
  } else if (action === 'plugin-update') {
    args = ['plugin', 'update'];
    if (values.plugin) args.push(required(values, 'plugin', t('插件名称')));
    mutates = true;
    timeout = 120000;
  } else if (action === 'marketplace-add') {
    args = ['plugin', 'marketplace', 'add', required(values, 'source', t('市场来源'))];
    mutates = true;
    timeout = 60000;
  } else if (action === 'update-install') {
    args = ['update'];
    mutates = true;
    timeout = 120000;
  } else throw new Error(t('不支持的管理操作：{action}', { action }));
  return { args, mutates, timeout };
}

async function runManagement(executable, action, values, cwd) {
  const command = buildCommand(action, values);
  const result = await runChecked(executable, command.args, { cwd, timeout: command.timeout });
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {}
  return {
    text: (result.stdout + (result.stderr ? '\n' + result.stderr : '')).trim() || t('操作已完成。'),
    data,
    exitCode: result.exitCode,
  };
}

module.exports = { buildCommand, runManagement, argumentList };
