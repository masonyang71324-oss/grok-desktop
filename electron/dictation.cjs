const path = require('node:path');
const { runProcess } = require('./process.cjs');
const { translate: t } = require('./i18n.cjs');
async function launchDictation({
  platform = process.platform,
  run = runProcess,
  scriptPath = path.join(__dirname, 'voice-typing.ps1'),
} = {}) {
  if (platform !== 'win32') throw new Error(t('此语音入口需要 Windows 语音输入。'));
  const result = await run(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { timeout: 10000, maxBytes: 4000 },
  );
  if (result.exitCode !== 0)
    throw new Error(
      result.stderr.trim() || t('无法打开 Windows 语音输入，请在输入框中按 Win + H。'),
    );
  return { method: 'windows-voice-typing', requested: true };
}
module.exports = { launchDictation };
