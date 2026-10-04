const fs = require('node:fs/promises');
const path = require('node:path');
const { translate: t } = require('./i18n.cjs');

/** @param {{directory: string, referencedPaths?: () => string[] | Promise<string[]>}} options */
function createAttachmentStorage({ directory, referencedPaths = () => [] }) {
  directory = path.resolve(directory);
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  const normalize = (value) =>
    process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const location = (name) => {
    if (
      typeof name !== 'string' ||
      !name ||
      name === '.' ||
      name === '..' ||
      /[\\/]/.test(name) ||
      path.basename(name) !== name
    )
      throw new Error(t('附件文件名无效。'));
    return path.join(directory, name);
  };
  const protection = async (extra = []) =>
    new Set(
      [...(await referencedPaths()), ...extra]
        .filter((value) => typeof value === 'string' && value)
        .map(normalize),
    );
  return {
    /** @param {{protectedPaths?: string[]}} [options] */
    async list({ protectedPaths = [] } = {}) {
      await queue;
      let names;
      try {
        names = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') return { directory, bytes: 0, files: [] };
        throw error;
      }
      const protectedFiles = await protection(protectedPaths);
      const files = [];
      for (const entry of names) {
        if (!entry.isFile()) continue;
        const filename = location(entry.name),
          stat = await fs.lstat(filename);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        files.push({
          name: entry.name,
          path: filename,
          createdAt: stat.mtime.toISOString(),
          bytes: stat.size,
          protected: protectedFiles.has(normalize(filename)),
        });
      }
      files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { directory, bytes: files.reduce((sum, file) => sum + file.bytes, 0), files };
    },
    /** @param {{names: string[], protectedPaths?: string[]}} options */
    removeMany({ names, protectedPaths = [] }) {
      const operation = queue.then(async () => {
        if (!Array.isArray(names)) throw new Error(t('附件文件名无效。'));
        const selected = [...new Set(names)].map((name) => ({ name, path: location(name) }));
        // Re-read live queue/running references at deletion time; preflight every selection.
        const protectedFiles = await protection(protectedPaths);
        for (const file of selected) {
          if (protectedFiles.has(normalize(file.path)))
            throw Object.assign(new Error(t('附件仍在草稿、队列或运行任务中使用，无法删除。')), {
              code: 'ATTACHMENT_IN_USE',
            });
          const stat = await fs.lstat(file.path);
          if (!stat.isFile() || stat.isSymbolicLink())
            throw new Error(t('只能删除应用附件目录中的普通文件。'));
        }
        const removed = [];
        for (const file of selected) {
          await fs.unlink(file.path);
          removed.push(file.name);
        }
        return { removed };
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}

module.exports = { createAttachmentStorage };
