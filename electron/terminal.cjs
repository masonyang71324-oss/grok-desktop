const { randomUUID } = require('node:crypto');
const { translate: t } = require('./i18n.cjs');
const { windowsPowerShellPath } = require('./system-launch.cjs');

function dimensions(cols = 90, rows = 24) {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 2 ||
    cols > 500 ||
    rows < 2 ||
    rows > 300
  )
    throw new Error(t('终端尺寸无效。'));
  return { cols, rows };
}

/**
 * @typedef {{type: string, id?: string, cwd?: string, sequence?: number, data?: string, state?: object}} TerminalEvent
 * @param {{spawnPty?: (shell: string, args: string[], options: import('node-pty').IPtyForkOptions | import('node-pty').IWindowsPtyForkOptions) => Pick<import('node-pty').IPty, 'onData'|'onExit'|'write'|'resize'|'kill'>, emit?: (event: TerminalEvent) => void, platform?: NodeJS.Platform}} [options]
 */
function createTerminalManager({ spawnPty, emit = () => {}, platform = process.platform } = {}) {
  const entries = new Map();
  const byDirectory = new Map();
  const snapshot = (entry) => ({
    id: entry.id,
    cwd: entry.cwd,
    status: entry.status,
    log: entry.log,
    sequence: entry.sequence,
    exitCode: entry.exitCode,
  });
  function find(id) {
    const entry = entries.get(id);
    if (!entry) throw new Error(t('终端已关闭，请重新打开。'));
    return entry;
  }
  function running(id) {
    const entry = find(id);
    if (entry.status !== 'running') throw new Error(t('终端已退出，请重新启动。'));
    return entry;
  }
  function flush(entry) {
    clearTimeout(entry.timer);
    entry.timer = null;
    if (!entry.pending) return;
    emit({
      type: 'terminal-data',
      id: entry.id,
      cwd: entry.cwd,
      sequence: entry.sequence,
      data: entry.pending,
    });
    entry.pending = '';
  }
  function open({ cwd, cols = 90, rows = 24, restart = false }) {
    if (typeof cwd !== 'string' || !cwd) throw new Error(t('请选择有效的项目目录。'));
    const previous = entries.get(byDirectory.get(cwd));
    if (previous && (!restart || previous.status === 'running')) {
      flush(previous);
      return snapshot(previous);
    }
    const size = dimensions(cols, rows);
    const shell = platform === 'win32' ? windowsPowerShellPath() : process.env.SHELL || '/bin/sh';
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env, TERM: 'xterm-256color' };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = (spawnPty || require('node-pty').spawn)(
      shell,
      platform === 'win32' ? ['-NoLogo', '-NoProfile'] : [],
      {
        name: 'xterm-256color',
        ...size,
        cwd,
        env,
        encoding: 'utf8',
        useConpty: true,
      },
    );
    const entry = {
      id: randomUUID(),
      cwd,
      child,
      status: 'running',
      log: '',
      pending: '',
      sequence: 0,
      timer: null,
      exitCode: undefined,
      resolveExit: null,
    };
    entry.exited = new Promise((resolve) => {
      entry.resolveExit = resolve;
    });
    if (previous) entries.delete(previous.id);
    entries.set(entry.id, entry);
    byDirectory.set(cwd, entry.id);
    child.onData((data) => {
      const log = entry.log + data;
      let start = Math.max(0, log.length - 200000);
      // Keep a trimmed snapshot from starting halfway through an astral character.
      if (start > 0 && /[\uDC00-\uDFFF]/.test(log[start])) start++;
      entry.log = log.slice(start);
      entry.pending += data;
      entry.sequence++;
      if (entry.pending.length >= 32768) flush(entry);
      else if (!entry.timer) {
        entry.timer = setTimeout(() => flush(entry), 16);
        entry.timer.unref?.();
      }
    });
    child.onExit(({ exitCode }) => {
      if (entry.status === 'exited') return;
      flush(entry);
      entry.status = 'exited';
      entry.exitCode = exitCode;
      emit({ type: 'terminal-exit', state: snapshot(entry) });
      entry.resolveExit();
    });
    return snapshot(entry);
  }
  async function close({ id }) {
    const entry = find(id);
    if (entry.status === 'running') {
      entry.child.kill();
      let timer;
      await Promise.race([
        entry.exited,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(t('终端仍在退出，请稍后再试。'))), 5000);
        }),
      ]).finally(() => clearTimeout(timer));
    }
    return snapshot(entry);
  }
  return {
    open,
    /** @param {{id?: string, cwd?: string}} input */
    state({ id, cwd }) {
      const entry = id ? find(id) : entries.get(byDirectory.get(cwd));
      if (entry) flush(entry);
      return entry ? snapshot(entry) : null;
    },
    write({ id, data }) {
      if (typeof data !== 'string' || data.length > 65536) throw new Error(t('终端输入无效。'));
      running(id).child.write(data);
    },
    resize({ id, cols, rows }) {
      const size = dimensions(cols, rows);
      running(id).child.resize(size.cols, size.rows);
    },
    close,
    get busy() {
      return [...entries.values()].some((entry) => entry.status === 'running');
    },
    async dispose() {
      await Promise.allSettled([...entries.values()].map((entry) => close({ id: entry.id })));
    },
  };
}
module.exports = { createTerminalManager };
