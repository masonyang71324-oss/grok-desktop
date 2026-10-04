const { translate: t } = require('./i18n.cjs');
/**
 * @template T
 * @param {string} executable
 * @param {()=>Promise<T>} update
 * @param {(executable:string)=>Promise<{stdout:string,exitCode:number}>} probe
 * @returns {Promise<T>}
 */
async function withUpdateHealth(executable, update, probe) {
  try {
    return await update();
  } catch (error) {
    let version;
    try {
      const result = await probe(executable);
      if (result.exitCode === 0)
        version = result.stdout.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0];
    } catch {
      /* The original update error remains the cause. */
    }
    const hint = version
      ? t('更新未成功完成；检测到引擎 {version} 仍可运行。', { version })
      : t('更新未成功完成，无法确认引擎可用。请通过首次引导重新安装或选择 Grok 程序。');
    throw Object.assign(new Error(`${hint}\n${error.message || String(error)}`, { cause: error }), {
      code: error.code,
      engineVersion: version,
    });
  }
}
module.exports = { withUpdateHealth };
