const { translate: t } = require('./i18n.cjs');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const defaults = {
  grokPath: '',
  language: 'zh-CN',
  theme: 'dark',
  modelId: '',
  effort: '',
  permissionMode: 'ask',
  recentProjects: [],
  lastProject: '',
  notifications: true,
  ui: { sidebar: true, inspector: true, inspectorTab: 'files' },
  window: null,
};

function normalizeSettings(input = {}) {
  return {
    grokPath: typeof input.grokPath === 'string' ? input.grokPath.trim() : '',
    language: input.language === 'en' ? 'en' : 'zh-CN',
    theme: ['dark', 'light', 'system'].includes(input.theme) ? input.theme : 'dark',
    modelId: typeof input.modelId === 'string' ? input.modelId : '',
    effort: typeof input.effort === 'string' ? input.effort : '',
    permissionMode: input.permissionMode === 'auto' ? 'auto' : 'ask',
    recentProjects: [
      ...new Set(
        Array.isArray(input.recentProjects)
          ? input.recentProjects.filter((x) => typeof x === 'string' && path.isAbsolute(x))
          : [],
      ),
    ].slice(0, 12),
    lastProject: typeof input.lastProject === 'string' ? input.lastProject : '',
    notifications: input.notifications !== false,
    ui: {
      sidebar: input.ui?.sidebar !== false,
      inspector: input.ui?.inspector !== false,
      inspectorTab: ['files', 'changes', 'plan'].includes(input.ui?.inspectorTab)
        ? input.ui.inspectorTab
        : 'files',
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

function loadSettings(filename) {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(filename, 'utf8')));
  } catch {
    return { ...defaults, recentProjects: [] };
  }
}

async function writeSettings(filename, settings) {
  await fsp.mkdir(path.dirname(filename), { recursive: true });
  const normalized = normalizeSettings(settings);
  const temporary = filename + '.tmp';
  await fsp.writeFile(temporary, JSON.stringify(normalized, null, 2), 'utf8');
  await fsp.rename(temporary, filename);
  return normalized;
}

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
