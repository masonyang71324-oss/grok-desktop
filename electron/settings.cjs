const { translate: t } = require('./i18n.cjs');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { projectKey } = require('./access-policy.cjs');
const { renameWithRetry } = require('./file-retry.cjs');
const { readJsonWithRecovery, assertJsonWritable, isObject } = require('./json-recovery.cjs');
const { normalizeZoomPercent } = require('./interface-size.cjs');

const defaults = {
  grokPath: '',
  language: 'zh-CN',
  theme: 'dark',
  modelId: '',
  effort: '',
  permissionMode: 'ask',
  updateChannel: 'stable',
  autoReconnect: true,
  recentProjects: [],
  projectTrust: {},
  selectedAttachments: [],
  lastProject: '',
  notifications: true,
  promptTemplates: [],
  ui: {
    sidebar: true,
    inspector: false,
    inspectorTab: 'files',
    navigationTab: 'sessions',
    zoomPercent: 100,
  },
  window: null,
};

function normalizeSettings(input = {}) {
  return {
    grokPath: typeof input.grokPath === 'string' ? input.grokPath.trim() : '',
    language: input.language === 'en' ? 'en' : 'zh-CN',
    theme: ['dark', 'light', 'system'].includes(input.theme) ? input.theme : 'dark',
    modelId: typeof input.modelId === 'string' ? input.modelId : '',
    effort: typeof input.effort === 'string' ? input.effort : '',
    permissionMode: ['read', 'auto'].includes(input.permissionMode) ? input.permissionMode : 'ask',
    updateChannel: input.updateChannel === 'beta' ? 'beta' : 'stable',
    autoReconnect: input.autoReconnect !== false,
    projectTrust: Object.fromEntries(
      Object.entries(isObject(input.projectTrust) ? input.projectTrust : {})
        .filter(([key, value]) => path.isAbsolute(key) && typeof value === 'boolean')
        .map(([key, value]) => [projectKey(key), value]),
    ),
    selectedAttachments: [
      ...new Set(
        Array.isArray(input.selectedAttachments)
          ? input.selectedAttachments.filter(
              (value) => typeof value === 'string' && path.isAbsolute(value),
            )
          : [],
      ),
    ],
    recentProjects: [
      ...new Set(
        Array.isArray(input.recentProjects)
          ? input.recentProjects.filter((x) => typeof x === 'string' && path.isAbsolute(x))
          : [],
      ),
    ].slice(0, 12),
    lastProject: typeof input.lastProject === 'string' ? input.lastProject : '',
    notifications: input.notifications !== false,
    promptTemplates: (Array.isArray(input.promptTemplates) ? input.promptTemplates : [])
      .filter(
        (item) =>
          item &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          item.name.trim() &&
          item.name.length <= 80 &&
          typeof item.text === 'string' &&
          item.text.trim() &&
          item.text.length <= 20000,
      )
      .slice(0, 20)
      .map(({ id, name, text }) => ({ id, name, text })),
    ui: {
      zoomPercent: normalizeZoomPercent(input.ui?.zoomPercent),
      sidebar: input.ui?.sidebar !== false,
      inspector: input.ui?.inspector !== false,
      navigationTab: ['sessions', 'files', 'tasks'].includes(input.ui?.navigationTab)
        ? input.ui.navigationTab
        : input.ui?.inspector === true
          ? 'files'
          : 'sessions',
      inspectorTab: ['files', 'changes', 'plan'].includes(input.ui?.inspectorTab)
        ? input.ui.inspectorTab
        : 'files',
      ...(Number.isFinite(input.ui?.sidebarWidth)
        ? { sidebarWidth: Math.round(Math.max(200, Math.min(480, input.ui.sidebarWidth))) }
        : {}),
      ...(Number.isFinite(input.ui?.inspectorWidth)
        ? { inspectorWidth: Math.round(Math.max(200, Math.min(480, input.ui.inspectorWidth))) }
        : {}),
      ...(Number.isFinite(input.ui?.composerHeight) && input.ui.composerHeight > 0
        ? { composerHeight: Math.round(Math.max(90, Math.min(360, input.ui.composerHeight))) }
        : {}),
    },
    window:
      input.window &&
      ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(input.window[key])) &&
      input.window.width > 0 &&
      input.window.height > 0
        ? {
            x: Math.round(input.window.x),
            y: Math.round(input.window.y),
            width: Math.round(input.window.width),
            height: Math.round(input.window.height),
            maximized: input.window.maximized === true,
          }
        : null,
  };
}

/** @param {string} filename @param {(warning: {kind: string, message: string, sourcePath: string, backupPath?: string, recoveryFailed?: boolean}) => void} [onRecovery] */
function loadSettings(filename, onRecovery) {
  const saved = readJsonWithRecovery(filename, { kind: 'settings', isValid: isObject, onRecovery });
  return saved ? normalizeSettings(saved) : structuredClone(defaults);
}

/** @param {string} filename */
async function writeSettings(filename, settings) {
  assertJsonWritable(filename);
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  const normalized = normalizeSettings(settings);
  const temporary = filename + '.tmp';
  await fsp.writeFile(temporary, JSON.stringify(normalized, null, 2), {
    encoding: 'utf8',
    flush: true,
  });
  await renameWithRetry(temporary, filename);
  return normalized;
}

/** @param {string} [supplied] */
function resolveGrok(supplied) {
  if (supplied) {
    if (!fs.statSync(supplied, { throwIfNoEntry: false })?.isFile())
      throw new Error(t('找不到指定的 Grok 程序，请在设置中检查路径。'));
    return supplied;
  }
  const candidates = [
    ...(process.env.GROK_HOME ? [path.join(process.env.GROK_HOME, 'bin', 'grok.exe')] : []),
    path.join(os.homedir(), '.grok', 'bin', 'grok.exe'),
    ...(process.env.LOCALAPPDATA
      ? [path.join(process.env.LOCALAPPDATA, 'grok', 'bin', 'grok.exe')]
      : []),
  ];
  for (const directory of (process.env.PATH || '').split(path.delimiter))
    if (directory) candidates.push(path.join(directory.replace(/^"|"$/g, ''), 'grok.exe'));
  const found = candidates.find((candidate) =>
    fs.statSync(candidate, { throwIfNoEntry: false })?.isFile(),
  );
  if (!found)
    throw new Error(t('没有找到 Grok Build。请先安装官方 CLI，并在设置中指定 grok.exe。'));
  return found;
}

module.exports = {
  defaults,
  loadSettings,
  writeSettings,
  normalizeSettings,
  resolveGrok,
};
