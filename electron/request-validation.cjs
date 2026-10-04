const { translate: t } = require('./i18n.cjs');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value) => typeof value === 'string' && !value.includes('\0');
const number = (value) => typeof value === 'number' && Number.isFinite(value);
const strings = (value) => Array.isArray(value) && value.every(string);
const optional = (payload, name, check) => payload[name] === undefined || check(payload[name]);
const required = {
  'workspace.list': ['cwd'],
  'workspace.search': ['cwd'],
  'workspace.read': ['cwd', 'path'],
  'workspace.save': ['cwd', 'path', 'text'],
  'workspace.changes': ['cwd'],
  'workspace.diff': ['cwd', 'path'],
  'project.open': ['cwd'],
  'project.trust': ['cwd'],
  'sessions.list': ['cwd'],
  'session.new': ['cwd'],
  'session.load': ['cwd', 'sessionId'],
  'session.send': ['sessionId'],
  'session.enqueue': ['sessionId'],
  'session.cancel': ['sessionId'],
  'session.configure': ['sessionId'],
  'session.permissions': ['sessionId', 'permissionMode'],
  'session.rename': ['sessionId', 'title'],
  'session.delete': ['sessionId'],
  'session.export': ['sessionId', 'cwd'],
  'session.usage': ['sessionId'],
  'tasks.resume': ['sessionId'],
  'tasks.remove': ['sessionId', 'queueId'],
  'terminal.open': ['cwd'],
  'terminal.input': ['id', 'data'],
  'terminal.resize': ['id'],
  'terminal.close': ['id'],
  'runner.inspect': ['cwd'],
  'runner.state': ['cwd'],
  'runner.start': ['cwd', 'script'],
  'runner.stop': ['cwd'],
  'checkpoints.list': ['cwd'],
  'checkpoints.detail': ['id'],
  'checkpoints.remove': ['id'],
  'checkpoints.restore': ['id'],
  'system.open': ['target'],
  'system.run': ['action'],
  'clipboard.write': ['text'],
  'office.preview': ['path'],
  'attachment.reauthorize': ['path'],
};
function validateRequest(command, payload = {}) {
  if (!object(payload)) throw new Error(t('操作参数无效。'));
  const fail = () => {
    throw new Error(t('操作参数无效。'));
  };
  for (const name of required[command] || []) if (!string(payload[name])) fail();
  for (const name of [
    'cwd',
    'path',
    'text',
    'name',
    'url',
    'modelId',
    'effort',
    'modeId',
    'sessionId',
    'grokPath',
    'language',
    'theme',
    'permissionMode',
  ])
    if (!optional(payload, name, string)) fail();
  for (const name of ['cols', 'rows', 'line', 'expectedMtimeMs', 'contextWindow'])
    if (!optional(payload, name, number)) fail();
  for (const name of ['ids', 'paths', 'names', 'protectedPaths'])
    if (!optional(payload, name, strings)) fail();
  for (const name of ['cancelled', 'staged', 'showHidden', 'checkUpdate'])
    if (!optional(payload, name, (value) => typeof value === 'boolean')) fail();
  if (
    payload.attachments !== undefined &&
    (!Array.isArray(payload.attachments) ||
      !payload.attachments.every(
        (file) =>
          object(file) &&
          optional(file, 'name', string) &&
          optional(file, 'path', string) &&
          optional(file, 'text', string) &&
          optional(file, 'kind', string),
      ))
  )
    fail();
  if (
    command === 'terminal.resize' &&
    (!number(payload.cols) ||
      !number(payload.rows) ||
      payload.cols < 1 ||
      payload.rows < 1 ||
      payload.cols > 1000 ||
      payload.rows > 1000)
  )
    fail();
  if (command === 'terminal.state' && !string(payload.id) && !string(payload.cwd)) fail();
  if (
    command === 'system.open' &&
    payload.target === 'url' &&
    (!string(payload.url) || !/^https?:\/\//i.test(payload.url))
  )
    fail();
  if (
    command === 'preview.open' &&
    (!object(payload.owner) || !string(payload.owner.cwd) || !string(payload.url))
  )
    fail();
  if (
    command === 'session.permission' &&
    (!['string', 'number'].includes(typeof payload.requestId) ||
      !optional(payload, 'optionId', string))
  )
    fail();
  if (command === 'system.run' && !optional(payload, 'values', object)) fail();
  if (command === 'settings.save') {
    if (
      !optional(payload, 'recentProjects', strings) ||
      !optional(payload, 'ui', object) ||
      !optional(payload, 'promptTemplates', Array.isArray)
    )
      fail();
    if (Object.hasOwn(payload, 'projectTrust') || Object.hasOwn(payload, 'selectedAttachments'))
      fail();
  }
  return payload;
}
module.exports = { validateRequest };
