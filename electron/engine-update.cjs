'use strict';
const path = require('node:path');
const { translate: t } = require('./i18n.cjs');

/** @typedef {{path:string,version:string,repaired:boolean,recovery?:boolean,updateResult?:unknown}} UpdateResult */
/**
 * @param {{executable:string,expectedVersion:string,stop:()=>Promise<unknown>,
 * update:()=>Promise<any>,repair:(input:{executable:string,binDir:string,version:string})=>Promise<any>,
 * probe:(filename:string)=>Promise<{exitCode:number,stdout:string}>,
 * reconnect:(result:UpdateResult)=>Promise<unknown>,restore?:()=>Promise<unknown>,
 * onState?:(state:{phase:string})=>void}} options
 * @returns {Promise<UpdateResult>}
 */
async function runEngineUpdate({
  executable,
  expectedVersion,
  stop,
  update,
  repair,
  probe,
  reconnect,
  restore,
  onState,
}) {
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(expectedVersion || ''))
    throw new Error(t('无法确认目标引擎版本，请重新检查更新。'));
  const publish = (phase) => onState?.({ phase });
  async function versionAt(filename) {
    const result = await probe(filename);
    if (result?.exitCode !== 0) return undefined;
    return String(result.stdout || '').match(/\bgrok\s+v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i)?.[1];
  }
  async function verify(filename) {
    const version = await versionAt(filename);
    if (version !== expectedVersion)
      throw new Error(t('未能验证目标引擎版本 {version}。', { version: expectedVersion }));
    return version;
  }
  function checkCommand(result) {
    if (Number.isInteger(result?.exitCode) && result.exitCode !== 0)
      throw new Error(
        String(
          result.text || result.stderr || result.stdout || t('引擎更新命令未成功完成。'),
        ).trim(),
      );
  }
  publish('stopping');
  // A stop failure leaves process ownership uncertain: never start changing files.
  try {
    await stop();
  } catch (error) {
    publish('failed');
    throw error;
  }
  let updateResult,
    version,
    installedPath = executable,
    repaired = false;
  publish('updating');
  try {
    updateResult = await update();
    checkCommand(updateResult);
    publish('verifying');
    version = await verify(executable);
  } catch (updateError) {
    publish('repairing');
    try {
      const installation = await repair({
        executable,
        binDir: path.dirname(executable),
        version: expectedVersion,
      });
      if (installation?.status && installation.status !== 'installed')
        throw new Error(installation.error || t('官方引擎修复未成功完成，请稍后重试。'));
      checkCommand(installation);
      installedPath = installation?.path || executable;
      publish('verifying');
      version = await verify(installedPath);
      repaired = true;
    } catch (repairError) {
      let survivingVersion, restoreError, reconnectError;
      try {
        survivingVersion = await versionAt(executable);
      } catch {
        /* Probe is best effort. */
      }
      if (!survivingVersion && restore) {
        publish('restoring');
        try {
          await restore();
          survivingVersion = await versionAt(executable);
        } catch (error) {
          restoreError = error;
        }
      }
      if (survivingVersion) {
        try {
          await reconnect({
            path: executable,
            version: survivingVersion,
            repaired: false,
            recovery: true,
          });
        } catch (error) {
          reconnectError = error;
        }
      }
      const hint = survivingVersion
        ? t('更新未成功完成；检测到引擎 {version} 仍可运行。', { version: survivingVersion })
        : t('更新未成功完成，无法确认引擎可用。请通过首次引导重新安装或选择 Grok 程序。');
      const details = [
        hint,
        t('自动修复失败：{message}', { message: repairError.message || String(repairError) }),
        t('原始更新错误：{message}', { message: updateError.message || String(updateError) }),
        ...(restoreError
          ? [
              t('程序文件恢复失败：{message}', {
                message: restoreError.message || String(restoreError),
              }),
            ]
          : []),
        ...(reconnectError
          ? [
              t('引擎可运行，但重新连接失败：{message}', {
                message: reconnectError.message || String(reconnectError),
              }),
            ]
          : []),
      ];
      publish('failed');
      throw Object.assign(new Error(details.join('\n'), { cause: updateError }), {
        code: 'ENGINE_UPDATE_FAILED',
        engineVersion: survivingVersion,
        repairError,
        restoreError,
        reconnectError,
      });
    }
  }
  const result = {
    path: installedPath,
    version,
    repaired,
    ...(updateResult === undefined ? {} : { updateResult }),
  };
  publish('reconnecting');
  try {
    await reconnect(result);
  } catch (error) {
    publish('failed');
    throw Object.assign(
      new Error(
        t('引擎已更新至 {version}，但重新连接失败。请刷新引擎与模型。', { version }) +
          '\n' +
          (error.message || String(error)),
        { cause: error },
      ),
      {
        code: 'ENGINE_RECONNECT_FAILED',
        engineVersion: version,
        path: installedPath,
      },
    );
  }
  publish('ready');
  return result;
}

module.exports = { runEngineUpdate };
