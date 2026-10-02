'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { parseForESLint, getStaticTOMLValue } = require('toml-eslint-parser');
const { translate: t } = require('./i18n.cjs');

const FIELDS = ['model', 'base_url', 'name', 'env_key', 'api_backend', 'context_window'];
const fail = (message) => {
  throw new Error(t(message));
};
function parse(text) {
  try {
    const ast = parseForESLint(text).ast;
    return {
      ast,
      value: getStaticTOMLValue(ast),
      tables: ast.body[0].body.filter((node) => node.type === 'TOMLTable'),
    };
  } catch {
    fail('无法解析 Grok 配置。请在外部编辑器修正 TOML 后重试。');
  }
}
const sameKey = (node, keys) => JSON.stringify(node.resolvedKey) === JSON.stringify(keys);
const quote = (value) => JSON.stringify(value);
function replaceRanges(text, edits) {
  for (const { start, end, value } of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, start) + value + text.slice(end);
  return text;
}
function editableTable(parsed, keys) {
  const matches = parsed.tables.filter((node) => sameKey(node, keys));
  if (matches.length !== 1 || matches[0].kind !== 'standard')
    fail('此配置布局不能安全编辑。请在外部编辑器使用标准 TOML 表。');
  return matches[0];
}
function editFields(text, table, fields) {
  const edits = [],
    additions = [];
  for (const [key, value] of Object.entries(fields)) {
    const matches = table.body.filter(
      (node) => node.key.keys.length === 1 && getStaticTOMLValue(node.key.keys[0]) === key,
    );
    if (matches.length > 1) fail('此配置布局不能安全编辑。请在外部编辑器使用标准 TOML 表。');
    if (value === null) {
      if (matches[0])
        edits.push({ start: matches[0].range[0], end: matches[0].range[1], value: '' });
      continue;
    }
    const encoded =
      typeof value === 'string'
        ? quote(value)
        : Array.isArray(value)
          ? `[${value.map(quote).join(', ')}]`
          : String(value);
    if (matches[0])
      edits.push({
        start: matches[0].value.range[0],
        end: matches[0].value.range[1],
        value: encoded,
      });
    else additions.push(`${key} = ${encoded}`);
  }
  if (additions.length) {
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const next = text.indexOf('\n', table.range[1]);
    const offset = next === -1 ? text.length : next + 1;
    edits.push({
      start: offset,
      end: offset,
      value: `${offset && text[offset - 1] !== '\n' ? newline : ''}${additions.join(newline)}${newline}`,
    });
  }
  return replaceRanges(text, edits);
}
function editDisabledList(text, parsed, id, enabled) {
  let table = editableTable(parsed, ['models']);
  let node = table.body.find(
    (item) =>
      item.key.keys.length === 1 && getStaticTOMLValue(item.key.keys[0]) === 'disabled_models',
  );
  if (!node) return editFields(text, table, { disabled_models: enabled ? [] : [id] });
  if (node.value.type !== 'TOMLArray')
    fail('此配置布局不能安全编辑。请在外部编辑器使用标准 TOML 表。');
  if (!enabled) {
    if (getStaticTOMLValue(node.value).includes(id)) return text;
    const last = node.value.elements.at(-1);
    const offset = last ? last.range[1] : node.value.range[0] + 1;
    return text.slice(0, offset) + `${last ? ', ' : ''}${quote(id)}` + text.slice(offset);
  }
  // Edit only element/comma token ranges; comments and unrelated values survive.
  for (;;) {
    const element = node.value.elements.find((item) => getStaticTOMLValue(item) === id);
    if (!element) return text;
    const next = node.value.elements.find((item) => item.range[0] > element.range[1]);
    const followingComma = parsed.ast.tokens.find(
      (token) =>
        token.value === ',' &&
        token.range[0] >= element.range[1] &&
        token.range[1] < (next?.range[0] ?? node.value.range[1]),
    );
    const precedingComma = parsed.ast.tokens
      .filter(
        (token) =>
          token.value === ',' &&
          token.range[0] > node.value.range[0] &&
          token.range[1] <= element.range[0],
      )
      .at(-1);
    const edits = [{ start: element.range[0], end: element.range[1], value: '' }];
    const comma = followingComma || precedingComma;
    if (comma) edits.push({ start: comma.range[0], end: comma.range[1], value: '' });
    text = replaceRanges(text, edits);
    parsed = parse(text);
    table = editableTable(parsed, ['models']);
    node = table.body.find(
      (item) =>
        item.key.keys.length === 1 && getStaticTOMLValue(item.key.keys[0]) === 'disabled_models',
    );
  }
}
function validateFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) fail('模型字段无效。');
  for (const [key, value] of Object.entries(fields)) {
    if (!FIELDS.includes(key)) fail('模型字段无效。');
    if (key === 'context_window') {
      if (value !== null && (!Number.isSafeInteger(value) || value <= 0))
        fail('上下文窗口必须是正整数。');
    } else if (typeof value !== 'string') fail('模型字段无效。');
    if (key === 'api_backend' && !['chat_completions', 'responses', 'messages'].includes(value))
      fail('模型协议无效。');
    if (key === 'env_key' && value && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
      fail('环境变量名称无效。');
    if (key === 'base_url' && value) {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          fail('模型地址必须是 HTTP(S) 地址，且不能包含凭据。');
      } catch {
        fail('模型地址必须是 HTTP(S) 地址，且不能包含凭据。');
      }
    }
  }
}

class ProviderStore {
  constructor({
    configFile = path.join(
      process.env.GROK_HOME || path.join(os.homedir(), '.grok'),
      'config.toml',
    ),
    env = process.env,
  } = {}) {
    this.configFile = configFile;
    this.env = env;
    this.baseline = null;
  }
  _read() {
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        fs.readFileSync(this.configFile),
      );
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      fail('无法读取 Grok 配置。请检查文件和 UTF-8 编码。');
    }
  }
  list() {
    const text = this._read(),
      parsed = parse(text),
      token = randomUUID();
    this.baseline = { token, text };
    const disabled = parsed.value.models?.disabled_models || [];
    if (!Array.isArray(disabled) || disabled.some((id) => typeof id !== 'string'))
      fail('此配置布局不能安全编辑。请在外部编辑器使用标准 TOML 表。');
    const models = Object.entries(parsed.value.model || {})
      .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
      .map(([id, value]) => ({
        id,
        ...Object.fromEntries(
          FIELDS.filter((key) =>
            key === 'context_window'
              ? Number.isSafeInteger(value[key])
              : typeof value[key] === 'string',
          ).map((key) => [key, value[key]]),
        ),
        enabled: !disabled.includes(id),
        hasKey: !!(value.api_key || (value.env_key && this.env[value.env_key])),
      }));
    return { baseline: token, models };
  }
  _edit(baseline, action) {
    if (!this.baseline || baseline !== this.baseline.token || this._read() !== this.baseline.text)
      fail('Grok 配置已被外部修改。请重新载入后再保存。');
    const original = this.baseline.text;
    const next = action(original, parse(original));
    parse(next);
    // Keep a text baseline in main memory; no configuration or secret is sent to renderer.
    if (this._read() !== original) fail('Grok 配置已被外部修改。请重新载入后再保存。');
    fs.mkdirSync(path.dirname(this.configFile), { recursive: true });
    const temporary = `${this.configFile}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, next, {
        mode: fs.existsSync(this.configFile) ? fs.statSync(this.configFile).mode : 0o600,
      });
      fs.renameSync(temporary, this.configFile);
    } catch {
      try {
        fs.unlinkSync(temporary);
      } catch {}
      fail('Grok 配置保存失败。原配置和表单内容已保留。');
    }
    return this.list();
  }
  save({ baseline, id, fields }) {
    if (typeof id !== 'string' || !id.trim() || /[\r\n\0]/.test(id)) fail('模型标识不能为空。');
    validateFields(fields);
    return this._edit(baseline, (text, parsed) => {
      if (parsed.value.model && Object.hasOwn(parsed.value.model, id))
        return editFields(text, editableTable(parsed, ['model', id]), fields);
      if (
        parsed.value.model &&
        (typeof parsed.value.model !== 'object' ||
          !parsed.tables.some((table) => table.resolvedKey[0] === 'model'))
      )
        fail('此配置布局不能安全编辑。请在外部编辑器使用标准 TOML 表。');
      if (!fields.model?.trim() || !fields.base_url?.trim())
        fail('新模型必须填写模型名称和服务地址。');
      const newline = text.includes('\r\n') ? '\r\n' : '\n';
      return `${text}${text && !text.endsWith('\n') ? newline : ''}${newline}[model.${quote(id)}]${newline}${Object.entries(
        fields,
      )
        .filter(([, value]) => value !== null)
        .map(([key, value]) => `${key} = ${typeof value === 'string' ? quote(value) : value}`)
        .join(newline)}${newline}`;
    });
  }
  remove({ baseline, id }) {
    return this._edit(baseline, (text, parsed) => {
      const table = editableTable(parsed, ['model', id]);
      // Removing a model explicitly removes its own table including inline secrets.
      // Descendant tables would recreate it, so reject those layouts before writing.
      if (
        parsed.tables.some(
          (item) =>
            item.resolvedKey.length > 2 &&
            item.resolvedKey[0] === 'model' &&
            item.resolvedKey[1] === id,
        )
      )
        fail('此配置布局不能安全编辑。请在外部编辑器使用标准 TOML 表。');
      return text.slice(0, table.range[0]) + text.slice(table.range[1]);
    });
  }
  setEnabled({ baseline, id, enabled }) {
    if (typeof enabled !== 'boolean') fail('模型字段无效。');
    return this._edit(baseline, (text, parsed) => {
      if (!parsed.value.model || !Object.hasOwn(parsed.value.model, id))
        fail('模型不存在，请重新载入。');
      const previous = parsed.value.models?.disabled_models || [];
      if (!Array.isArray(previous) || previous.some((value) => typeof value !== 'string'))
        fail('此配置布局不能安全编辑。请在外部编辑器使用标准 TOML 表。');
      const disabled_models = previous.filter((value) => value !== id);
      if (!enabled) disabled_models.push(id);
      if (parsed.value.models) return editDisabledList(text, parsed, id, enabled);
      const newline = text.includes('\r\n') ? '\r\n' : '\n';
      return `${text}${text && !text.endsWith('\n') ? newline : ''}${newline}[models]${newline}disabled_models = [${disabled_models.map(quote).join(', ')}]${newline}`;
    });
  }
}
module.exports = { ProviderStore };
