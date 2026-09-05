const { translate: t } = require('./i18n.cjs');
const { spawn } = require('node:child_process');

function runProcess(executable, args, { cwd, timeout = 30000, maxBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      size = 0,
      settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(t('操作等待超时，请检查网络或稍后重试。')));
    }, timeout);
    for (const [stream, target] of [
      [child.stdout, 'stdout'],
      [child.stderr, 'stderr'],
    ]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        size += Buffer.byteLength(chunk);
        if (size > maxBytes) {
          child.kill();
          finish(new Error(t('输出内容过大，请缩小查看范围。')));
        } else if (target === 'stdout') stdout += chunk;
        else stderr += chunk;
      });
    }
    child.on('error', (error) =>
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
    child.on('close', (code) => finish(null, { stdout, stderr, exitCode: code ?? -1 }));
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
