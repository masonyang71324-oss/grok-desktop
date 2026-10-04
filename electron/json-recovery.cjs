const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { translate: t } = require('./i18n.cjs');

// A failed backup must not be followed by a write of fallback/default data.
const blockedWrites = new Map();
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

function readJsonWithRecovery(filename, { kind, isValid, onRecovery = () => {} }) {
  const resolved = path.resolve(filename);
  const label = t(kind === 'settings' ? '设置' : '任务队列');
  let source;
  try {
    source = fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    const message = t('无法读取{label}，原文件保持不变，本次运行无法保存{label}。', { label });
    blockedWrites.set(resolved, message);
    onRecovery({ kind, message, sourcePath: resolved, recoveryFailed: true });
    return undefined;
  }
  try {
    const value = JSON.parse(source);
    if (!isValid(value)) throw new Error('Invalid saved data structure');
    blockedWrites.delete(resolved);
    return value;
  } catch {
    const backupPath = `${resolved}.corrupt-${Date.now()}-${randomUUID()}.json`;
    try {
      fs.renameSync(resolved, backupPath);
    } catch {
      const message = t('无法备份损坏的{label}，原文件保持不变，本次运行无法保存{label}。', {
        label,
      });
      blockedWrites.set(resolved, message);
      onRecovery({ kind, message, sourcePath: resolved, recoveryFailed: true });
      return undefined;
    }
    blockedWrites.delete(resolved);
    onRecovery({
      kind,
      message: t('{label}文件损坏，已保留备份并使用默认值：{path}', { label, path: backupPath }),
      sourcePath: resolved,
      backupPath,
    });
    return undefined;
  }
}

function assertJsonWritable(filename) {
  const message = blockedWrites.get(path.resolve(filename));
  if (message) throw new Error(message);
}

module.exports = { readJsonWithRecovery, assertJsonWritable, isObject };
