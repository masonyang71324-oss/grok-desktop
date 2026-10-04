const { translate: t } = require('./i18n.cjs');
const { spawn } = require('node:child_process');
const { windowsSystemExecutable } = require('./system-launch.cjs');

/**
 * @param {string} executable
 * @param {string[]} args
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, timeout?: number, maxBytes?: number}} [options]
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
function runProcess(
  executable,
  args,
  { cwd, env, timeout = 30000, maxBytes = 4 * 1024 * 1024 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      size = 0,
      settled = false,
      stopping = false,
      closed = false;
    let resolveClosed;
    /** @type {Promise<void>} */
    const closedPromise = new Promise((done) => {
      resolveClosed = done;
    });
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(result);
    };
    async function terminateTree() {
      if (closed || !child.pid) return false;
      if (process.platform === 'win32') {
        // After the owner exits its PID can be reused; never target that PID again.
        if (child.exitCode !== null || child.signalCode !== null) return false;
        await new Promise((done, fail) => {
          const killer = spawn(
            windowsSystemExecutable('taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'],
            { windowsHide: true, shell: false, stdio: 'ignore' },
          );
          killer.once('error', fail);
          killer.once('close', (code) => {
            if (code === 0 || closed) done(undefined);
            else fail(new Error(t('无法停止项目进程（{code}）。', { code })));
          });
        });
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
          return false;
        }
      }
      return true;
    }
    async function stopWithError(error) {
      if (settled || stopping) return;
      stopping = true;
      clearTimeout(timer);
      try {
        if (await terminateTree()) await closedPromise;
      } catch (cause) {
        error.cause = cause;
      }
      finish(error);
    }
    const timer = setTimeout(() => {
      void stopWithError(new Error(t('操作等待超时，请检查网络或稍后重试。')));
    }, timeout);
    for (const [stream, target] of /** @type {const} */ ([
      [child.stdout, 'stdout'],
      [child.stderr, 'stderr'],
    ])) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        if (stopping || settled) return;
        size += Buffer.byteLength(chunk);
        if (size > maxBytes) {
          void stopWithError(new Error(t('输出内容过大，请缩小查看范围。')));
        } else if (target === 'stdout') stdout += chunk;
        else stderr += chunk;
      });
    }
    child.on(
      'error',
      /** @param {NodeJS.ErrnoException} error */ (error) =>
        finish(
          Object.assign(
            new Error(
              error.code === 'ENOENT'
                ? t('找不到可执行程序：{path}', { path: executable })
                : error.message,
            ),
            { code: error.code },
          ),
        ),
    );
    child.on('close', (code) => {
      closed = true;
      resolveClosed();
      if (!stopping) finish(null, { stdout, stderr, exitCode: code ?? -1 });
    });
  });
}

async function runChecked(executable, args, options) {
  const result = await runProcess(executable, args, options);
  if (result.exitCode !== 0)
    throw new Error(
      (
        result.stderr ||
        result.stdout ||
        t('程序退出，代码 {code}', { code: result.exitCode })
      ).trim(),
    );
  return result;
}

module.exports = { runProcess, runChecked };
