const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { renameWithRetry } = require('./file-retry.cjs');
const { translate: t } = require('./i18n.cjs');

const RECORD = /^[a-f0-9-]{36}\.json$/;
const BLOB = /^[a-f0-9]{64}$/;
const digest = (data) => createHash('sha256').update(data).digest('hex');
const corrupt = () =>
  Object.assign(new Error(t('检查点内容损坏或缺失，无法读取。')), { code: 'CHECKPOINT_CORRUPT' });

async function names(directory) {
  try {
    return await fs.readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function atomicWrite(file, data) {
  const temporary = `${file}.tmp`;
  try {
    await fs.writeFile(temporary, data);
    const handle = await fs.open(temporary, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

// Only formats whose complete content references are understood may participate in GC.
function inspect(entry) {
  if (
    !entry ||
    ![undefined, 1, 2].includes(entry.version) ||
    typeof entry.id !== 'string' ||
    typeof entry.cwd !== 'string' ||
    typeof entry.createdAt !== 'string' ||
    !['recording', 'ready'].includes(entry.status) ||
    !Array.isArray(entry.files) ||
    (entry.skipped !== undefined && !Array.isArray(entry.skipped))
  )
    throw corrupt();
  const references = new Map();
  let logicalBytes = 0;
  const check = (side) => {
    if (side === null) return;
    if (!side || !Number.isInteger(side.mode)) throw corrupt();
    if (entry.version === 2) {
      if (!BLOB.test(side.blob) || !Number.isSafeInteger(side.bytes) || side.bytes < 0)
        throw corrupt();
      if (references.has(side.blob) && references.get(side.blob) !== side.bytes) throw corrupt();
      references.set(side.blob, side.bytes);
      logicalBytes += side.bytes;
    } else {
      if (typeof side.content !== 'string') throw corrupt();
      logicalBytes += Buffer.byteLength(side.content);
    }
  };
  for (const file of entry.files) {
    if (!file || typeof file.path !== 'string' || typeof file.status !== 'string') throw corrupt();
    check(file.before);
    check(file.after);
  }
  if (entry.baseline !== undefined || entry.status === 'recording') {
    if (
      !entry.baseline ||
      !entry.baseline.files ||
      typeof entry.baseline.files !== 'object' ||
      Array.isArray(entry.baseline.files) ||
      !Array.isArray(entry.baseline.skipped)
    )
      throw corrupt();
    for (const side of Object.values(entry.baseline.files)) {
      if (!side) throw corrupt();
      check(side);
    }
  }
  return { references, logicalBytes };
}

function encode(entry) {
  const blobs = new Map();
  const pack = (side) => {
    if (side === null) return null;
    const data = Buffer.from(side.content, 'utf8');
    // This address actually replaces repeated content writes and disk allocation.
    const blob = digest(data);
    blobs.set(blob, data);
    return { blob, bytes: data.length, mode: side.mode };
  };
  const manifest = {
    ...entry,
    version: 2,
    files: entry.files.map((file) => ({
      ...file,
      before: pack(file.before),
      after: pack(file.after),
    })),
  };
  if (entry.baseline)
    manifest.baseline = {
      ...entry.baseline,
      files: Object.fromEntries(
        Object.entries(entry.baseline.files).map(([name, side]) => [name, pack(side)]),
      ),
    };
  inspect(manifest);
  return { manifest, blobs };
}

function createCheckpointStorage(directory) {
  const blobDirectory = path.join(directory, 'blobs');
  async function readManifest(id) {
    const entry = JSON.parse(await fs.readFile(path.join(directory, `${id}.json`), 'utf8'));
    if (entry.id !== id) throw corrupt();
    inspect(entry);
    return entry;
  }
  async function read(id) {
    const entry = await readManifest(id);
    if (entry.version !== 2) return entry;
    const content = new Map();
    for (const [blob, bytes] of inspect(entry).references) {
      let data;
      try {
        data = await fs.readFile(path.join(blobDirectory, blob));
      } catch {
        throw corrupt();
      }
      const text = data.toString('utf8');
      if (data.length !== bytes || digest(data) !== blob || !Buffer.from(text).equals(data))
        throw corrupt();
      content.set(blob, text);
    }
    const unpack = (side) =>
      side === null ? null : { content: content.get(side.blob), mode: side.mode };
    entry.files = entry.files.map((file) => ({
      ...file,
      before: unpack(file.before),
      after: unpack(file.after),
    }));
    if (entry.baseline)
      entry.baseline.files = Object.fromEntries(
        Object.entries(entry.baseline.files).map(([name, side]) => [name, unpack(side)]),
      );
    return entry;
  }
  async function inventory() {
    const manifests = new Map(),
      blobs = new Map();
    for (const name of await names(directory)) {
      if (name.endsWith('.json')) manifests.set(name, await fs.stat(path.join(directory, name)));
    }
    for (const name of await names(blobDirectory)) {
      if (BLOB.test(name)) blobs.set(name, await fs.stat(path.join(blobDirectory, name)));
    }
    return { manifests, blobs };
  }
  async function scan() {
    const files = await inventory();
    const records = [],
      references = new Map();
    let understood = true,
      logicalBytes = 0;
    // Do not use the disposable metadata index here, even when size and mtime match.
    for (const [name, stat] of files.manifests) {
      const id = name.slice(0, -5);
      try {
        if (!RECORD.test(name)) throw corrupt();
        const entry = await readManifest(id),
          details = inspect(entry);
        for (const [blob, bytes] of details.references) {
          if (files.blobs.get(blob)?.size !== bytes) throw corrupt();
        }
        for (const blob of details.references.keys())
          references.set(blob, (references.get(blob) || 0) + 1);
        logicalBytes += details.logicalBytes;
        records.push({
          id,
          bytes: stat.size,
          mtimeMs: stat.mtimeMs,
          entry,
          createdAt: entry.createdAt,
          ...details,
        });
      } catch {
        understood = false;
        records.push({
          id,
          bytes: stat.size,
          mtimeMs: stat.mtimeMs,
          entry: null,
          references: new Map(),
          logicalBytes: null,
          createdAt: stat.mtime.toISOString(),
        });
      }
    }
    const manifestBytes = [...files.manifests.values()].reduce((sum, stat) => sum + stat.size, 0);
    const blobBytes = [...files.blobs.values()].reduce((sum, stat) => sum + stat.size, 0);
    return {
      records: records.map((record) => ({
        ...record,
        reclaimableBytes: understood
          ? record.bytes +
            [...record.references.keys()].reduce(
              (sum, blob) => sum + (references.get(blob) === 1 ? files.blobs.get(blob).size : 0),
              0,
            )
          : null,
      })),
      references,
      understood,
      files,
      manifestBytes,
      blobBytes,
      logicalBytes: understood ? logicalBytes : null,
      bytes: manifestBytes + blobBytes,
    };
  }
  async function collect() {
    try {
      const state = await scan();
      if (!state.understood) return;
      for (const blob of state.files.blobs.keys()) {
        if (!state.references.has(blob)) await fs.unlink(path.join(blobDirectory, blob));
      }
    } catch {
      // An inaccessible/disappearing manifest prevents collection, never record retention.
    }
  }
  async function save(entry, limitBytes) {
    const { manifest, blobs } = encode(entry);
    const data = JSON.stringify(manifest),
      files = await inventory();
    let bytes = [...files.manifests.values(), ...files.blobs.values()].reduce(
      (sum, stat) => sum + stat.size,
      0,
    );
    bytes -= files.manifests.get(`${entry.id}.json`)?.size || 0;
    const additions = new Map();
    for (const [blob, content] of blobs) {
      if (files.blobs.has(blob)) {
        // Never publish a new reference to an already damaged shared object.
        if (!(await fs.readFile(path.join(blobDirectory, blob))).equals(content)) throw corrupt();
      } else additions.set(blob, content);
    }
    const required =
      Buffer.byteLength(data) +
      [...additions.values()].reduce((sum, value) => sum + value.length, 0);
    if (bytes + required > limitBytes)
      throw Object.assign(
        new Error(t('检查点存储已达到 512 MB 上限，请删除旧检查点记录后重试。')),
        { code: 'CHECKPOINT_STORAGE_FULL', bytes, limitBytes },
      );
    await fs.mkdir(blobDirectory, { recursive: true });
    for (const [blob, content] of additions)
      await atomicWrite(path.join(blobDirectory, blob), content);
    // Each blob has been synced and atomically installed before the manifest can refer to it.
    await atomicWrite(path.join(directory, `${entry.id}.json`), data);
    // A new record cannot drop references. Replacements can discard a recorded baseline.
    if (files.manifests.has(`${entry.id}.json`)) await collect();
    return manifest;
  }
  return { read, readManifest, save, scan, collect };
}

module.exports = { createCheckpointStorage };
