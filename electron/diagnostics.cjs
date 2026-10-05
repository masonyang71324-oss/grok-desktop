const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const JSZip = require('jszip');
const { renameWithRetry } = require('./file-retry.cjs');
const { translate: t } = require('./i18n.cjs');

const VERSION = /^\d{1,5}(?:\.\d{1,5}){1,3}(?:-(?:alpha|beta|rc)\.\d{1,5})?$/;
const EVENTS = new Set([
  'app-start',
  'app-stop',
  'connection',
  'turn-error',
  'request-failed',
  'renderer-gone',
  'notification-failed',
  'workspace-watch-failed',
  'recovery-dialog-failed',
  'update-install-failed',
  'app-update',
]);
const OPERATIONS = new Set([
  'bootstrap',
  'cli',
  'providers',
  'office',
  'workspace',
  'terminal',
  'preview',
  'dictation',
  'settings',
  'drafts',
  'clipboard',
  'attachment',
  'attachments',
  'dialog',
  'sessions',
  'session',
  'account',
  'tasks',
  'checkpoints',
  'runner',
  'update',
  'diagnostics',
]);
const CODES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'AbortError',
  'TimeoutError',
  'EACCES',
  'EPERM',
  'ENOENT',
  'ENOSPC',
  'EIO',
  'EBUSY',
  'EEXIST',
  'ENOTDIR',
  'EISDIR',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'CHECKPOINT_CONFLICT',
  'CHECKPOINT_STORAGE_FULL',
  'CHECKPOINT_CORRUPT',
  'CHECKPOINT_CANCELLED',
]);
const CONNECTIONS = ['disconnected', 'connecting', 'ready', 'error', 'sleeping'];
const UPDATE_STATES = [
  'idle',
  'checking',
  'available',
  'downloading',
  'downloaded',
  'current',
  'staged',
  'error',
  'unsupported',
];
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const version = (value) => (typeof value === 'string' && VERSION.test(value) ? value : undefined);
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : undefined);
const oneOf = (value, choices) => (choices.includes(value) ? value : undefined);
const boolean = (value) => (typeof value === 'boolean' ? value : undefined);
const compact = (value) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

function cliVersion(value) {
  if (version(value)) return value;
  if (typeof value !== 'string') return undefined;
  // Official CLI output is "grok 1.0.46 (hex commit)". Never preserve its wrapper/hash.
  const match = value.match(
    /^grok (\d{1,5}(?:\.\d{1,5}){2}(?:-(?:alpha|beta|rc)\.\d{1,5})?) \([a-f0-9]{7,40}\)$/,
  );
  return match ? version(match[1]) : undefined;
}

function sanitizeMetadata(input) {
  const source = object(input),
    versions = object(source.versions),
    settings = object(source.settings);
  const counts = object(source.counts),
    engine = object(source.engine),
    ui = object(settings.ui);
  const zoom =
    Number.isFinite(ui.zoomPercent) && ui.zoomPercent >= 25 && ui.zoomPercent <= 500
      ? ui.zoomPercent
      : undefined;
  return compact({
    versions: compact({
      app: version(versions.app),
      electron: version(versions.electron),
      node: version(versions.node),
      chrome: version(versions.chrome),
      cli: cliVersion(versions.cli),
    }),
    platform: oneOf(source.platform, ['win32', 'darwin', 'linux']),
    arch: oneOf(source.arch, ['x64', 'arm64', 'ia32', 'arm']),
    settings: compact({
      language: oneOf(settings.language, ['zh-CN', 'en']),
      theme: oneOf(settings.theme, ['light', 'dark', 'system']),
      permissionMode: oneOf(settings.permissionMode, ['ask', 'read', 'auto']),
      updateChannel: oneOf(settings.updateChannel, ['stable', 'beta']),
      autoReconnect: boolean(settings.autoReconnect),
      notifications: boolean(settings.notifications),
      ui: zoom === undefined ? undefined : { zoomPercent: zoom },
    }),
    counts: compact({
      sessions: count(counts.sessions),
      activeTasks: count(counts.activeTasks),
      queuedTasks: count(counts.queuedTasks),
      pendingApprovals: count(counts.pendingApprovals),
    }),
    engine: compact({
      configured: boolean(engine.configured),
      connection: oneOf(engine.connection, CONNECTIONS),
    }),
  });
}

function sanitizeEvent(input) {
  const source = object(input);
  if (!EVENTS.has(source.event)) return null;
  const result = { event: source.event };
  const time = source.time ?? source.timestamp;
  if (
    typeof time === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(time) &&
    Number.isFinite(Date.parse(time))
  )
    result.time = new Date(time).toISOString();
  if (source.event === 'connection') result.state = oneOf(source.state, CONNECTIONS);
  if (source.event === 'app-start') result.version = version(source.version);
  if (source.event === 'app-update') {
    result.version = version(source.version);
    if (typeof source.state === 'string') {
      const [mode, state, extra] = source.state.split(':');
      if (
        !extra &&
        ['installer', 'portable', 'development'].includes(mode) &&
        UPDATE_STATES.includes(state)
      )
        result.state = `${mode}:${state}`;
    }
  }
  if (source.event === 'request-failed') {
    // Operation families are sufficient to locate the failing area; arbitrary command names are excluded.
    const operation = typeof source.command === 'string' ? source.command.split('.')[0] : undefined;
    if (OPERATIONS.has(operation)) result.operation = operation;
  }
  if (['request-failed', 'update-install-failed'].includes(source.event) && CODES.has(source.code))
    result.code = source.code;
  if (source.event === 'renderer-gone')
    result.reason = oneOf(source.reason, [
      'clean-exit',
      'abnormal-exit',
      'killed',
      'crashed',
      'oom',
      'launch-failed',
      'integrity-failure',
    ]);
  return compact(result);
}

function sanitizeLogs(input) {
  const events = [];
  for (const text of Array.isArray(input) ? input.slice(-3) : []) {
    if (typeof text !== 'string') continue;
    for (const line of text.slice(-1024 * 1024).split(/\r?\n/)) {
      try {
        const event = sanitizeEvent(JSON.parse(line));
        if (event) events.push(event);
      } catch {
        /* Unstructured/truncated log data is never copied. */
      }
    }
  }
  return events.slice(-500);
}

/** @param {{getMetadata: () => unknown | Promise<unknown>, readLogs: () => unknown | Promise<unknown>, chooseDestination: (input: {defaultName: string}) => string | null | Promise<string | null>}} options */
function createDiagnostics({ getMetadata, readLogs, chooseDestination }) {
  // Store serialized snapshots privately: callers cannot mutate the content of an export.
  const previews = new Map();
  return {
    async preview() {
      const [metadata, logs] = await Promise.all([getMetadata(), readLogs()]);
      const report = {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        ...sanitizeMetadata(metadata),
        events: sanitizeLogs(logs),
      };
      const id = randomUUID();
      previews.set(id, JSON.stringify(report, null, 2) + '\n');
      // A few concurrently open/recent previews remain exportable without retaining an unbounded history.
      if (previews.size > 8) previews.delete(previews.keys().next().value);
      return { id, report };
    },
    async export(id) {
      const saved = typeof id === 'string' ? previews.get(id) : undefined;
      if (!saved)
        throw Object.assign(new Error(t('诊断预览已失效，请重新生成。')), {
          code: 'DIAGNOSTICS_PREVIEW_EXPIRED',
        });
      const destination = await chooseDestination({ defaultName: 'Grok-Desktop-diagnostics.zip' });
      if (!destination) return { canceled: true };
      const zip = new JSZip();
      zip.file('diagnostics.json', saved);
      const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, archive);
        await renameWithRetry(temporary, destination);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
      return { canceled: false };
    },
  };
}

module.exports = { createDiagnostics };
