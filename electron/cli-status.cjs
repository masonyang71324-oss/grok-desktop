const { translate: t } = require('./i18n.cjs');
const { runProcess } = require('./process.cjs');

function versionFrom(stdout) {
  return String(stdout || '').match(/\bgrok\s+v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i)?.[1];
}

async function readCliStatus(executable, { run = runProcess, checkUpdate = false } = {}) {
  const status = { path: executable, authStatus: 'unknown' };
  try {
    const version = await run(executable, ['--version'], { timeout: 10000 });
    if (version.exitCode === 0) status.version = versionFrom(version.stdout);
    const models = await run(executable, ['models'], { timeout: 30000 });
    if (/not authenticated|not logged in|please (?:sign|log) in/i.test(models.stdout)) {
      status.authStatus = 'required';
    } else if (
      /invalid_grant|RefreshTokenRejected|Invalid or expired credentials|No auth credentials/i.test(
        models.stderr,
      )
    ) {
      status.authStatus = 'required';
    } else if (/you are logged in|you are signed in/i.test(models.stdout)) {
      status.authStatus = 'authenticated';
    }
    if (models.exitCode !== 0 && status.authStatus !== 'required')
      status.error = t('无法检查 Grok 登录状态，请检查网络后重试。');
  } catch {
    status.error = t('无法检查 Grok 登录状态，请检查网络后重试。');
  }
  if (checkUpdate) {
    try {
      const result = await run(executable, ['update', '--check', '--json'], { timeout: 30000 });
      if (result.exitCode !== 0) throw new Error();
      const line = result.stdout
        .trim()
        .split(/\r?\n/)
        .reverse()
        .find((value) => value.trim().startsWith('{'));
      const update = JSON.parse(line || '');
      if (
        update.error ||
        typeof update.updateAvailable !== 'boolean' ||
        typeof update.latestVersion !== 'string' ||
        !update.latestVersion
      )
        throw new Error();
      status.latestVersion = update.latestVersion;
      status.updateAvailable = update.updateAvailable;
    } catch {
      status.error = t('无法检查 Grok Build 更新，请检查网络后重试。');
    }
  }
  return status;
}

async function selectUpdatedCli(
  configuredPath,
  officialPath,
  expectedVersion,
  { run = runProcess } = {},
) {
  for (const executable of [...new Set([configuredPath, officialPath])]) {
    if (!executable) continue;
    const result = await run(executable, ['--version'], { timeout: 10000 }).catch(() => null);
    if (result?.exitCode === 0 && versionFrom(result.stdout) === expectedVersion) return executable;
  }
  throw new Error(t('更新后未找到对应版本的 Grok Build，请在设置中检查程序路径。'));
}

module.exports = { readCliStatus, selectUpdatedCli };
