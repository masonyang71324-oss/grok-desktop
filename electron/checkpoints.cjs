const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { translate: t } = require('./i18n.cjs');

const SKIP_LABELS = {
  unreadable: '无法读取',
  'file-count-limit': '超过文件数量上限',
  'excluded-directory': '已排除的目录',
  'unsupported-file-type': '不支持的文件类型',
  'size-limit': '超过文件大小上限',
  'binary-or-non-utf8': '二进制或非 UTF-8 文件',
};

const EXCLUDED = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'release',
  '.next',
  '.cache',
  'coverage',
  'vendor',
]);
const FILE_BYTES = 1024 * 1024;
const SNAPSHOT_BYTES = 16 * 1024 * 1024;
const STORE_BYTES = 512 * 1024 * 1024;

function equal(a, b) {
  return a === b || (!!a && !!b && a.content === b.content && a.mode === b.mode);
}

function createCheckpointStore({ directory }) {
  directory = path.resolve(directory);
  let queue = Promise.resolve();
  const active = new Set();
  const serial = (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const location = (id) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error(t('检查点编号无效。'));
    return path.join(directory, `${id}.json`);
  };
  async function read(id) {
    return JSON.parse(await fs.readFile(location(id), 'utf8'));
  }
  async function save(entry) {
    await fs.mkdir(directory, { recursive: true });
    const data = JSON.stringify(entry);
    let bytes = 0;
    for (const name of await fs.readdir(directory)) {
      if (name.endsWith('.json') && name !== `${entry.id}.json`)
        bytes += (await fs.stat(path.join(directory, name))).size;
    }
    if (bytes + Buffer.byteLength(data) > STORE_BYTES)
      throw new Error(t('检查点存储已达到 512 MB 上限，请删除旧检查点记录后重试。'));
    const temp = `${location(entry.id)}.tmp`;
    await fs.writeFile(temp, data);
    await fs.rename(temp, location(entry.id));
  }
  async function snapshot(cwd) {
    const files = Object.create(null),
      skipped = [];
    let bytes = 0,
      count = 0;
    async function walk(relative) {
      let entries;
      try {
        entries = await fs.readdir(path.join(cwd, relative), { withFileTypes: true });
      } catch (error) {
        skipped.push({ path: relative || '.', reason: error.code || 'unreadable' });
        return;
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        const absolute = path.join(cwd, name);
        if (count >= 2000) {
          skipped.push({ path: relative || '.', reason: 'file-count-limit' });
          break;
        }
        count++;
        if (EXCLUDED.has(entry.name) || absolute === directory) {
          skipped.push({ path: name, reason: 'excluded-directory' });
          continue;
        }
        if (entry.isDirectory()) {
          await walk(name);
          continue;
        }
        if (!entry.isFile()) {
          skipped.push({ path: name, reason: 'unsupported-file-type' });
          continue;
        }
        try {
          const stat = await fs.stat(absolute);
          if (stat.size > FILE_BYTES || bytes + stat.size > SNAPSHOT_BYTES) {
            skipped.push({ path: name, reason: 'size-limit' });
            continue;
          }
          const data = await fs.readFile(absolute);
          const content = data.toString('utf8');
          if (data.includes(0) || !Buffer.from(content).equals(data)) {
            skipped.push({ path: name, reason: 'binary-or-non-utf8' });
            continue;
          }
          bytes += data.length;
          files[name] = { content, mode: stat.mode & 0o777 };
        } catch (error) {
          skipped.push({ path: name, reason: error.code || 'unreadable' });
        }
      }
    }
    await walk('');
    return { files, skipped };
  }
  const omitted = (name, skipped) =>
    skipped.some(
      (item) => item.path === '.' || item.path === name || name.startsWith(`${item.path}/`),
    );
  function publicEntry(entry, detail = true) {
    const { baseline, ...result } = entry;
    return {
      ...result,
      status: entry.status === 'recording' && !active.has(entry.id) ? 'interrupted' : entry.status,
      skipped: entry.skipped.map((item) => ({
        ...item,
        reason: SKIP_LABELS[item.reason] ? t(SKIP_LABELS[item.reason]) : item.reason,
      })),
      files: (entry.files || []).map((file) => ({
        path: file.path,
        status: file.status,
        ...(detail
          ? { before: file.before?.content ?? null, after: file.after?.content ?? null }
          : {}),
      })),
    };
  }
  async function current(cwd, name) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) {
      try {
        const stat = await fs.lstat(path.join(cwd, ...parts.slice(0, i)));
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(t('上级目录已变更。'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    }
    try {
      const absolute = path.join(cwd, name),
        stat = await fs.lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > FILE_BYTES)
        throw new Error(t('文件类型已变更。'));
      const data = await fs.readFile(absolute);
      const content = data.toString('utf8');
      if (!Buffer.from(content).equals(data)) throw new Error(t('文件编码已变更。'));
      return { content, mode: stat.mode & 0o777 };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  return {
    begin: (input) =>
      serial(async () => {
        const cwd = await fs.realpath(input.cwd);
        const baseline = await snapshot(cwd);
        const entry = {
          ...input,
          cwd,
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          status: 'recording',
          baseline,
          files: [],
          skipped: baseline.skipped,
        };
        await save(entry);
        active.add(entry.id);
        return entry.id;
      }),
    finish: (id) =>
      serial(async () => {
        const entry = await read(id);
        if (entry.status === 'ready') return publicEntry(entry);
        const after = await snapshot(entry.cwd);
        entry.skipped = [...entry.baseline.skipped, ...after.skipped].filter(
          (item, i, all) =>
            all.findIndex((other) => other.path === item.path && other.reason === item.reason) ===
            i,
        );
        entry.files = [];
        for (const name of new Set([
          ...Object.keys(entry.baseline.files),
          ...Object.keys(after.files),
        ])) {
          if (omitted(name, entry.skipped)) continue;
          const before = entry.baseline.files[name] || null,
            next = after.files[name] || null;
          if (!equal(before, next))
            entry.files.push({
              path: name,
              status: !before ? 'created' : !next ? 'deleted' : 'modified',
              before,
              after: next,
            });
        }
        delete entry.baseline;
        entry.status = 'ready';
        await save(entry);
        return publicEntry(entry);
      }).finally(() => active.delete(id)),
    list: async ({ cwd, sessionId }) => {
      await queue;
      let names;
      try {
        names = await fs.readdir(directory);
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
      const resolved = path.resolve(cwd).toLowerCase();
      const entries = await Promise.all(
        names.filter((name) => name.endsWith('.json')).map((name) => read(name.slice(0, -5))),
      );
      return entries
        .filter(
          (entry) =>
            entry.cwd.toLowerCase() === resolved && (!sessionId || entry.sessionId === sessionId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((entry) => publicEntry(entry, false));
    },
    detail: async ({ id }) => {
      await queue;
      return publicEntry(await read(id));
    },
    remove: ({ id }) =>
      serial(async () => {
        const entry = await read(id);
        if (active.has(id)) throw new Error(t('无法删除正在记录的检查点。'));
        await fs.unlink(location(id));
        return { removed: id };
      }),
    restore: ({ id, paths }) =>
      serial(async () => {
        const entry = await read(id);
        if (entry.status !== 'ready' || !Array.isArray(paths) || !paths.length)
          throw new Error(t('请从已完成的检查点中选择文件。'));
        const selected = [...new Set(paths)].map((name) => {
          const file = entry.files.find((item) => item.path === name);
          if (!file) throw new Error(t('文件不在此检查点中：{path}', { path: name }));
          return file;
        });
        const conflicts = [];
        for (const file of selected) {
          try {
            if (!equal(await current(entry.cwd, file.path), file.after)) conflicts.push(file.path);
          } catch {
            conflicts.push(file.path);
          }
        }
        if (conflicts.length)
          throw Object.assign(
            new Error(t('这些文件在本轮之后已变更：{paths}', { paths: conflicts.join(', ') })),
            {
              code: 'CHECKPOINT_CONFLICT',
              paths: conflicts,
            },
          );
        const backup = {
          id: randomUUID(),
          cwd: entry.cwd,
          sessionId: entry.sessionId,
          turnId: `restore:${entry.turnId}`,
          createdAt: new Date().toISOString(),
          status: 'ready',
          skipped: [],
          files: selected.map((file) => ({
            ...file,
            before: file.after,
            after: file.before,
            status:
              file.status === 'created'
                ? 'deleted'
                : file.status === 'deleted'
                  ? 'created'
                  : 'modified',
          })),
        };
        await save(backup);
        const restored = [];
        try {
          for (const file of selected) {
            const absolute = path.join(entry.cwd, file.path);
            if (file.before === null) await fs.unlink(absolute);
            else {
              await fs.mkdir(path.dirname(absolute), { recursive: true });
              const temporary = `${absolute}.${backup.id}.tmp`;
              try {
                await fs.writeFile(temporary, file.before.content);
                await fs.chmod(temporary, file.before.mode);
                await fs.rename(temporary, absolute);
              } finally {
                await fs.rm(temporary, { force: true }).catch(() => {});
              }
            }
            restored.push(file.path);
          }
        } catch (error) {
          // Atomic replacement leaves the failing file intact; undo only completed replacements.
          backup.files = backup.files.filter((file) => restored.includes(file.path));
          await save(backup);
          throw Object.assign(error, { backupId: backup.id, restored });
        }
        return { restored, backupId: backup.id };
      }),
  };
}

module.exports = { createCheckpointStore };
