const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { renameWithRetry } = require('./file-retry.cjs');
const { createCheckpointStorage } = require('./checkpoint-storage.cjs');
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
  '.venv',
  '__pycache__',
  'obj',
  'target',
]);
const FILE_BYTES = 1024 * 1024;
const SNAPSHOT_BYTES = 16 * 1024 * 1024;
const STORE_BYTES = 512 * 1024 * 1024;

function equal(a, b) {
  return a === b || (!!a && !!b && a.content === b.content && a.mode === b.mode);
}

/** @param {{directory: string}} options */
function createCheckpointStore({ directory }) {
  directory = path.resolve(directory);
  const contents = createCheckpointStorage(directory);
  /** @type {Promise<unknown>} */
  let queue = Promise.resolve();
  const active = new Set();
  const indexFile = path.join(directory, 'metadata-index');
  let metadataCache = null;
  /** @template T @param {() => T | Promise<T>} fn @returns {Promise<T>} */
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
    location(id);
    return contents.read(id);
  }
  async function save(entry) {
    await contents.save(entry, STORE_BYTES);
    if (metadataCache) {
      const stat = await fs.stat(location(entry.id));
      metadataCache[entry.id] = indexed(entry, stat);
      await persistIndex();
    }
  }
  async function snapshot(cwd) {
    const files = Object.create(null),
      skipped = [];
    let bytes = 0,
      count = 0;
    const pending = [''];
    while (pending.length) {
      const relative = pending.shift();
      if (count >= 2000) {
        skipped.push({ path: relative || '.', reason: 'file-count-limit' });
        continue;
      }
      let entries;
      try {
        entries = await fs.readdir(path.join(cwd, relative), { withFileTypes: true });
      } catch (error) {
        skipped.push({ path: relative || '.', reason: error.code || 'unreadable' });
        continue;
      }
      // Capture nearby source files before descending into larger directory trees.
      for (const entry of entries.sort(
        (a, b) => Number(a.isDirectory()) - Number(b.isDirectory()) || a.name.localeCompare(b.name),
      )) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        const absolute = path.join(cwd, name);
        if ((entry.isDirectory() && EXCLUDED.has(entry.name)) || absolute === directory) {
          skipped.push({ path: name, reason: 'excluded-directory' });
          continue;
        }
        if (count >= 2000) {
          skipped.push({
            path: relative || '.',
            reason: 'file-count-limit',
            from: entry.name,
            fromDirectory: entry.isDirectory(),
          });
          break;
        }
        count++;
        if (entry.isDirectory()) {
          pending.push(name);
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
    return { files, skipped };
  }
  const omitted = (name, skipped) =>
    skipped.some((item) => {
      if (item.path !== '.' && item.path !== name && !name.startsWith(`${item.path}/`))
        return false;
      if (!item.from || item.path === name) return true;
      // A count limit covers only the unvisited suffix, ordered files before directories.
      // Missing paths earlier in that order are known absent, not unknown.
      const relative = item.path === '.' ? name : name.slice(item.path.length + 1);
      const parts = relative.split('/');
      const directoryOrder = Number(parts.length > 1) - Number(item.fromDirectory);
      return directoryOrder > 0 || (directoryOrder === 0 && parts[0].localeCompare(item.from) >= 0);
    });
  function publicEntry(entry, detail = true) {
    const { baseline, version, ...result } = entry;
    return {
      ...result,
      status: entry.status === 'recording' && !active.has(entry.id) ? 'interrupted' : entry.status,
      skipped: (entry.skipped || []).map((item) => ({
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
  function indexed(entry, stat) {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      typeof entry.cwd !== 'string' ||
      typeof entry.createdAt !== 'string' ||
      typeof entry.status !== 'string' ||
      !Array.isArray(entry.files) ||
      !entry.files.every(
        (file) => file && typeof file.path === 'string' && typeof file.status === 'string',
      ) ||
      (entry.skipped !== undefined && !Array.isArray(entry.skipped))
    )
      throw new Error('Unreadable checkpoint');
    const metadata = {
      id: entry.id,
      cwd: entry.cwd,
      sessionId: entry.sessionId,
      turnId: entry.turnId,
      createdAt: entry.createdAt,
      status: entry.status,
      ...(typeof entry.summary === 'string' ? { summary: entry.summary } : {}),
      files: entry.files.map((file) => ({ path: file.path, status: file.status })),
      skipped: entry.skipped || [],
    };
    publicEntry(metadata, false);
    return { id: entry.id, bytes: stat.size, mtimeMs: stat.mtimeMs, entry: metadata };
  }
  async function persistIndex() {
    // The index is disposable: a failed cache write must not undo a saved checkpoint.
    try {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(
        `${indexFile}.tmp`,
        JSON.stringify({ version: 1, records: metadataCache }),
      );
      await renameWithRetry(`${indexFile}.tmp`, indexFile);
    } catch {}
  }
  async function records() {
    if (!metadataCache) {
      try {
        const saved = JSON.parse(await fs.readFile(indexFile, 'utf8'));
        if (
          saved.version !== 1 ||
          !saved.records ||
          typeof saved.records !== 'object' ||
          Array.isArray(saved.records)
        )
          throw new Error('Invalid checkpoint index');
        for (const [id, record] of Object.entries(saved.records)) {
          if (
            record.id !== id ||
            !Number.isFinite(record.bytes) ||
            !Number.isFinite(record.mtimeMs)
          )
            throw new Error('Invalid checkpoint index');
          if (record.entry) {
            if (record.entry.id !== id) throw new Error('Invalid checkpoint index');
            saved.records[id] = indexed(record.entry, {
              size: record.bytes,
              mtimeMs: record.mtimeMs,
            });
          } else if (typeof record.createdAt !== 'string')
            throw new Error('Invalid checkpoint index');
        }
        metadataCache = saved.records;
      } catch {
        metadataCache = {};
      }
    }
    let names;
    try {
      names = await fs.readdir(directory);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const result = [],
      seen = new Set();
    let changed = false;
    for (const name of names.filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))) {
      const id = name.slice(0, -5);
      const stat = await fs.stat(location(id));
      seen.add(id);
      const cached = metadataCache[id];
      if (cached && cached.bytes === stat.size && cached.mtimeMs === stat.mtimeMs) {
        result.push(cached);
        continue;
      }
      try {
        const entry = await contents.readManifest(id);
        if (entry.id !== id) throw new Error('Unreadable checkpoint');
        metadataCache[id] = indexed(entry, stat);
      } catch {
        metadataCache[id] = {
          id,
          bytes: stat.size,
          mtimeMs: stat.mtimeMs,
          createdAt: stat.mtime.toISOString(),
        };
      }
      changed = true;
      result.push(metadataCache[id]);
    }
    for (const id of Object.keys(metadataCache))
      if (!seen.has(id)) {
        delete metadataCache[id];
        changed = true;
      }
    if (changed) await persistIndex();
    return result;
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
          const before = entry.baseline.files[name] || null,
            next = after.files[name] || null;
          // A limit on one scan must not discard files captured by both scans.
          // Missing content is only absence when that side actually covered the path.
          if (
            (!before && omitted(name, entry.baseline.skipped)) ||
            (!next && omitted(name, after.skipped))
          )
            continue;
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
    list: ({ cwd, sessionId }) =>
      serial(async () => {
        const resolved = (await fs.realpath(cwd)).toLowerCase();
        const entries = (await records())
          .filter((record) => record.entry)
          .map((record) => record.entry);
        return entries
          .filter(
            (entry) =>
              entry.cwd.toLowerCase() === resolved && (!sessionId || entry.sessionId === sessionId),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((entry) => publicEntry(entry, false));
      }),
    detail: async ({ id }) => {
      await queue;
      return publicEntry(await read(id));
    },
    storage: () =>
      serial(async () => {
        const state = await contents.scan();
        return {
          bytes: state.bytes,
          manifestBytes: state.manifestBytes,
          blobBytes: state.blobBytes,
          logicalBytes: state.logicalBytes,
          limitBytes: STORE_BYTES,
          records: state.records
            .map(({ id, bytes, logicalBytes, reclaimableBytes, entry, createdAt }) =>
              entry
                ? {
                    id,
                    bytes,
                    logicalBytes,
                    reclaimableBytes,
                    cwd: entry.cwd,
                    sessionId: entry.sessionId,
                    createdAt: entry.createdAt,
                    ...(entry.summary ? { summary: entry.summary } : {}),
                    status:
                      entry.status === 'recording' && !active.has(id)
                        ? 'interrupted'
                        : entry.status,
                    fileCount: entry.files.length,
                    kind:
                      typeof entry.turnId === 'string' && entry.turnId.startsWith('restore:')
                        ? 'restore'
                        : 'turn',
                  }
                : {
                    id,
                    bytes,
                    logicalBytes: null,
                    reclaimableBytes,
                    cwd: '',
                    sessionId: '',
                    createdAt,
                    status: 'unreadable',
                    fileCount: null,
                    kind: 'unreadable',
                  },
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        };
      }),
    removeMany: ({ ids }) =>
      serial(async () => {
        if (!Array.isArray(ids)) throw new Error(t('检查点编号无效。'));
        const selected = [...new Set(ids)];
        for (const id of selected) {
          location(id);
          if (active.has(id)) throw new Error(t('无法删除正在记录的检查点。'));
        }
        const removed = [];
        for (const id of selected) {
          await fs.unlink(location(id));
          removed.push(id);
        }
        await contents.collect();
        return { removed };
      }),
    remove: ({ id }) =>
      serial(async () => {
        const entry = await read(id);
        if (active.has(id)) throw new Error(t('无法删除正在记录的检查点。'));
        await fs.unlink(location(id));
        await contents.collect();
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
                await renameWithRetry(temporary, absolute, {
                  beforeRetry: async () => {
                    if (!equal(await current(entry.cwd, file.path), file.after))
                      throw Object.assign(
                        new Error(t('这些文件在本轮之后已变更：{paths}', { paths: file.path })),
                        { code: 'CHECKPOINT_CONFLICT', paths: [file.path] },
                      );
                  },
                });
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
