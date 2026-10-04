'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { translate: t } = require('./i18n.cjs');
const { windowsPowerShellPath, windowsSystemExecutable } = require('./system-launch.cjs');

async function killOwnedTree(child) {
  if (!child?.pid) return;
  if (process.platform !== 'win32') {
    child.kill();
    return;
  }
  await new Promise((resolve) => {
    const killer = spawn(
      windowsSystemExecutable('taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'],
      {
        windowsHide: true,
        stdio: 'ignore',
        shell: false,
      },
    );
    killer.once('close', resolve);
    killer.once('error', () => {
      child.kill();
      resolve();
    });
  });
}
class CliInstaller {
  /** @param {{emit?: (event: {type: 'cli-install-state', state: {status: string, log: string, error?: string, path?: string, version?: string}}) => void, binDir?: string, spawnFn?: typeof spawn, killTree?: typeof killOwnedTree, timeout?: number}} [options] */
  constructor({
    emit = () => {},
    binDir = path.join(os.homedir(), '.grok', 'bin'),
    spawnFn = spawn,
    killTree = killOwnedTree,
    timeout = 5 * 60_000,
  } = {}) {
    this.emit = emit;
    this.binDir = binDir;
    this.spawnFn = spawnFn;
    this.killTree = killTree;
    this.timeout = timeout;
    this.current = { status: 'idle', log: '' };
    this.operation = null;
    this.closed = false;
  }
  state() {
    return structuredClone(this.current);
  }
  _publish(patch) {
    this.current = { ...this.current, ...patch };
    this.emit({ type: 'cli-install-state', state: this.state() });
  }
  _process(executable, args, op, env) {
    return new Promise((resolve, reject) => {
      if (op.cancelled) {
        reject(new Error(t('CLI 安装已取消。')));
        return;
      }
      const child = this.spawnFn(executable, args, {
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(env ? { env } : {}),
      });
      op.child = child;
      let output = '',
        settled = false;
      const finish = (error, code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (op.child === child) op.child = null;
        op.abort = null;
        if (op.stopReason) error = new Error(op.stopReason);
        error ? reject(error) : resolve({ code, output });
      };
      op.abort = (reason) => {
        op.stopReason = reason;
        if (!op.stopping) op.stopping = this.killTree(child).then(() => finish(new Error(reason)));
        return op.stopping;
      };
      const timer = setTimeout(
        () => void op.abort?.(t('CLI 安装等待超时，请检查网络后重试。')),
        this.timeout,
      );
      for (const stream of [child.stdout, child.stderr]) {
        stream.setEncoding('utf8');
        stream.on('data', (chunk) => {
          if (settled || op.cancelled) return;
          output = (output + chunk).slice(-32_000);
          // Installer progress only; do not log output through application telemetry.
          this._publish({ log: (this.current.log + chunk).slice(-32_000) });
        });
      }
      child.once('error', () => finish(new Error(t('无法启动 CLI 安装程序。'))));
      child.once('close', (code) => finish(null, code));
    });
  }
  start() {
    if (this.operation) return this.operation.done;
    if (this.closed) return Promise.reject(new Error(t('CLI 安装器已关闭。')));
    const op = { cancelled: false };
    this.operation = op;
    this.current = { status: 'installing', log: '' };
    this._publish({});
    op.done = this._run(op).finally(() => {
      if (this.operation === op) this.operation = null;
    });
    return op.done;
  }
  async _run(op) {
    try {
      /** @type {NodeJS.ProcessEnv} */
      const env = { ...process.env, GROK_CHANNEL: 'stable', GROK_BIN_DIR: this.binDir };
      // Explicit stable release ignores an inherited version pin / deployment configuration.
      delete env.GROK_VERSION;
      delete env.GROK_DEPLOYMENT_KEY;
      const result = await this._process(
        windowsPowerShellPath(),
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); & ([scriptblock]::Create((Invoke-RestMethod -Uri 'https://x.ai/cli/install.ps1')))",
        ],
        op,
        env,
      );
      if (op.cancelled) throw new Error(t('CLI 安装已取消。'));
      if (result.code !== 0) throw new Error(t('官方 CLI 安装程序未成功退出，请查看进度后重试。'));
      const executable = path.join(this.binDir, 'grok.exe');
      this._publish({ status: 'verifying' });
      const verification = await this._process(executable, ['--version'], op);
      if (op.cancelled) throw new Error(t('CLI 安装已取消。'));
      const version = verification.output.match(/\bgrok\s+v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i)?.[1];
      if (verification.code !== 0 || !version)
        throw new Error(t('安装后无法验证 grok.exe 版本，请重新选择程序或重试。'));
      this._publish({ status: 'installed', path: executable, version });
    } catch (error) {
      this._publish({
        status: op.cancelled ? 'cancelled' : 'error',
        ...(op.cancelled ? {} : { error: error.message }),
      });
    }
    return this.state();
  }
  async cancel() {
    const op = this.operation;
    if (!op) return this.state();
    op.cancelled = true;
    await op.abort?.(t('CLI 安装已取消。'));
    await op.done;
    return this.state();
  }
  async dispose() {
    this.closed = true;
    return this.cancel();
  }
}
module.exports = { CliInstaller, killOwnedTree };
