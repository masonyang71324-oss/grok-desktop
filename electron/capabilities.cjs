const { translate: t } = require('./i18n.cjs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function defaultMemoryRoot() {
  return path.join(process.env.GROK_HOME || path.join(os.homedir(), '.grok'), 'memory');
}

async function listMemory({ memoryRoot = defaultMemoryRoot() } = {}) {
  const root = path.resolve(memoryRoot);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      text: t('尚未创建记忆目录：{path}。启用 Grok 记忆并保存内容后，文件会显示在这里。', {
        path: root,
      }),
      data: { root, exists: false, files: [] },
    };
  }

  const files = [];
  async function visit(directory, children) {
    for (const entry of children) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(filename, await fs.readdir(filename, { withFileTypes: true }));
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
        const stat = await fs.stat(filename);
        files.push({
          path: filename,
          name: entry.name,
          relativePath: path.relative(root, filename),
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
        });
      }
    }
  }
  await visit(root, entries);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return {
    text: files.length
      ? t('找到 {count} 个记忆文件。\n{files}', {
          count: files.length,
          files: files.map((file) => file.relativePath).join('\n'),
        })
      : t('记忆目录中暂无 Markdown 文件：{path}', { path: root }),
    data: { root, exists: true, files },
  };
}

// All six methods use Grok's ExtMethodResult envelope inside the JSON-RPC result.
const actions = {
  'workflow-list': {
    method: '_x.ai/workflows/list',
    fields: ['sessionId'],
    list: 'workflows',
    label: '工作流',
  },
  'task-list': {
    method: '_x.ai/task/list',
    fields: ['sessionId'],
    list: 'tasks',
    label: '后台任务',
  },
  'subagent-list': {
    method: '_x.ai/subagent/list_running',
    fields: ['sessionId'],
    list: 'subagents',
    label: '运行中的子任务',
  },
  'task-stop': { method: '_x.ai/task/kill', fields: ['sessionId', 'taskId'] },
  'subagent-stop': { method: '_x.ai/subagent/cancel', fields: ['subagentId'] },
  'schedule-delete': { method: '_x.ai/scheduler/delete', fields: ['sessionId', 'taskId'] },
};

function requiredTarget(values, field) {
  const value = String(values[field] ?? '').trim();
  const label = { sessionId: t('会话'), taskId: t('任务'), subagentId: t('子任务') }[field];
  if (!value) throw new Error(t('请先选择{label}。', { label }));
  return value;
}

function unwrapResult(response) {
  if (response?.error != null) {
    const error = response.error;
    throw new Error(typeof error === 'string' ? error : error.message || JSON.stringify(error));
  }
  if (!response?.result || typeof response.result !== 'object' || Array.isArray(response.result)) {
    throw new Error(t('Grok 未返回有效的操作结果，请刷新会话后重试。'));
  }
  return response.result;
}

function inventoryText(entries, label) {
  if (!entries.length) return t('当前会话没有{label}。', { label: t(label) });
  return entries
    .map((entry) => {
      const name = entry.name || entry.title || entry.label || entry.description || entry.command;
      const id = entry.taskId || entry.task_id || entry.subagentId || entry.subagent_id || entry.id;
      const status = typeof entry.status === 'string' ? entry.status : entry.state;
      return (
        [name, id && id !== name ? `(${id})` : '', status ? `[${status}]` : '']
          .filter(Boolean)
          .join(' ') || JSON.stringify(entry)
      );
    })
    .join('\n');
}

async function runCapability(client, action, values = {}) {
  const definition = actions[action];
  if (!definition) throw new Error(t('不支持的能力操作：{action}', { action }));
  const params = Object.fromEntries(
    definition.fields.map((field) => [field, requiredTarget(values, field)]),
  );
  const data = unwrapResult(await client.extension(definition.method, params, values.sessionId));
  if (definition.list) {
    if (!Array.isArray(data[definition.list]))
      throw new Error(t('Grok 返回的能力列表格式不正确。'));
    return { text: inventoryText(data[definition.list], definition.label), data };
  }
  if (action === 'schedule-delete' && typeof data.deleted === 'boolean') {
    return {
      text: data.deleted ? t('已删除所选计划。') : t('未找到该计划，未删除任何计划。'),
      data,
    };
  }
  // Preserve the server's outcome, including already-finished/not-found results.
  return { text: t('停止请求结果：\n{result}', { result: JSON.stringify(data, null, 2) }), data };
}

function createCapabilities(options = {}) {
  return { listMemory: () => listMemory(options), runCapability };
}

module.exports = { createCapabilities, listMemory, runCapability };
