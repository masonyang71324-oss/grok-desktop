'use strict';
const { spawn } = require('node:child_process');
const os = require('node:os');
const { translate: t } = require('./i18n.cjs');
const { killOwnedTree } = require('./cli-installer.cjs');

class CliLogin {
  /** @param {{spawnFn?: (executable: string, args: string[], options: import('node:child_process').SpawnOptions) => import('node:child_process').ChildProcess, killTree?: typeof killOwnedTree, timeout?: number}} [options] */
  constructor({ spawnFn = spawn, killTree = killOwnedTree, timeout = 5 * 60_000 } = {}) {
    this.spawnFn = spawnFn;
    this.killTree = killTree;
    this.timeout = timeout;
    this.operation = null;
    this.closed = false;
  }

  start(executable) {
    if (this.operation) return this.operation.done;
    if (this.closed) return Promise.reject(new Error(t('Grok Build 登录已关闭。')));
    const op = { child: null, stopping: null, stopReason: null };
    this.operation = op;
    op.done = new Promise((resolve, reject) => {
      let settled = false,
        timer;
      const finish = (error, cancelled = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        op.child = null;
        error ? reject(error) : resolve({ cancelled });
      };
      op.stop = (reason) => {
        if (settled) return Promise.resolve();
        if (op.stopping) return op.stopping;
        op.stopReason = reason;
        const child = op.child;
        op.stopping = (async () => {
          try {
            // Never use a recorded PID after its child has already exited.
            if (child?.pid && child.exitCode === null && child.signalCode === null)
              await this.killTree(child);
            finish(reason === 'cancelled' ? null : new Error(reason), reason === 'cancelled');
          } catch {
            finish(new Error(t('无法停止 Grok Build 登录，请关闭登录窗口后重试。')));
          }
        })();
        return op.stopping;
      };
      try {
        const child = this.spawnFn(executable, ['--no-auto-update', 'login', '--oauth'], {
          cwd: os.homedir(),
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        op.child = child;
        // OAuth URLs/codes and credentials belong to the official CLI. Drain, never retain them.
        child.stdout.resume();
        child.stderr.resume();
        child.once('error', () => {
          if (!op.stopReason)
            finish(new Error(t('无法启动 Grok Build 登录，请检查引擎路径后重试。')));
        });
        child.once('close', (code) => {
          if (!op.stopReason)
            finish(
              code === 0
                ? null
                : new Error(t('Grok Build 登录未完成，请检查浏览器授权和网络后重试。')),
            );
        });
        timer = setTimeout(() => {
          void op.stop(t('Grok Build 登录等待超时，请重新点击登录并完成浏览器授权。'));
        }, this.timeout);
      } catch {
        finish(new Error(t('无法启动 Grok Build 登录，请检查引擎路径后重试。')));
      }
    }).finally(() => {
      if (this.operation === op) this.operation = null;
    });
    return op.done;
  }

  async cancel() {
    const op = this.operation;
    if (!op) return { cancelled: true };
    await op.stop('cancelled');
    return op.done;
  }

  dispose() {
    this.closed = true;
    return this.cancel();
  }
}

module.exports = { CliLogin };
