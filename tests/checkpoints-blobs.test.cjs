const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createCheckpointStore } = require('../electron/checkpoints.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint blobs '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'project');
  const directory = path.join(root, 'store');
  await fs.mkdir(cwd);
  return { cwd: await fs.realpath(cwd), directory, store: createCheckpointStore({ directory }) };
}

async function change(store, cwd, before, after) {
  await fs.writeFile(path.join(cwd, 'file.txt'), before);
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await fs.writeFile(path.join(cwd, 'file.txt'), after);
  await store.finish(id);
  return id;
}

async function manifest(directory, id) {
  return JSON.parse(await fs.readFile(path.join(directory, `${id}.json`), 'utf8'));
}

test('repeated content uses shared physical storage and still exposes before/after strings', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  const before = 'before\r\n'.repeat(20000),
    after = 'after!\r\n'.repeat(20000);
  const first = await change(store, cwd, before, after);
  const second = await change(store, cwd, before, after);
  const saved = await manifest(directory, first);
  assert.equal(saved.version, 2);
  assert.equal(saved.files[0].before.content, undefined);
  assert.equal((await fs.readdir(path.join(directory, 'blobs'))).length, 2);
  assert.equal((await store.detail({ id: second })).files[0].before, before);
  const storage = await store.storage();
  assert.equal(storage.blobBytes, Buffer.byteLength(before) + Buffer.byteLength(after));
  assert.equal(storage.bytes, storage.manifestBytes + storage.blobBytes);
  assert.equal(storage.logicalBytes, 2 * (Buffer.byteLength(before) + Buffer.byteLength(after)));
  assert.ok(storage.bytes < storage.logicalBytes * 0.6);
  for (const record of storage.records) assert.equal(record.reclaimableBytes, record.bytes);
});

test('same length and same timestamp edits are read and restored', async (t) => {
  const { cwd, store } = await fixture(t);
  const file = path.join(cwd, 'file.txt');
  await fs.writeFile(file, 'before');
  const original = await fs.stat(file);
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await fs.writeFile(file, 'AFTER!');
  await fs.utimes(file, original.atime, original.mtime);
  assert.deepEqual((await store.finish(id)).files, [
    { path: 'file.txt', status: 'modified', before: 'before', after: 'AFTER!' },
  ]);
  await store.restore({ id, paths: ['file.txt'] });
  assert.equal(await fs.readFile(file, 'utf8'), 'before');
});

test('legacy inline checkpoints and their old undo records remain restorable without migration', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  await fs.mkdir(directory);
  await fs.writeFile(path.join(cwd, 'file.txt'), 'after\r\n');
  const mode = (await fs.stat(path.join(cwd, 'file.txt'))).mode & 0o777;
  for (const turnId of ['legacy', 'restore:legacy']) {
    const id = randomUUID();
    const entry = {
      id,
      cwd,
      sessionId: 's',
      turnId,
      status: 'ready',
      createdAt: new Date().toISOString(),
      skipped: [],
      files: [
        {
          path: 'file.txt',
          status: 'modified',
          before: { content: 'before\r\n', mode },
          after: { content: 'after\r\n', mode },
        },
      ],
    };
    const raw = JSON.stringify(entry);
    await fs.writeFile(path.join(directory, `${id}.json`), raw);
    const { backupId } = await store.restore({ id, paths: ['file.txt'] });
    assert.equal(await fs.readFile(path.join(cwd, 'file.txt'), 'utf8'), 'before\r\n');
    assert.equal(await fs.readFile(path.join(directory, `${id}.json`), 'utf8'), raw);
    assert.equal((await manifest(directory, backupId)).version, 2);
    await createCheckpointStore({ directory }).restore({ id: backupId, paths: ['file.txt'] });
    assert.equal(await fs.readFile(path.join(cwd, 'file.txt'), 'utf8'), 'after\r\n');
  }
});

test('deleting shared snapshots preserves surviving and undo references then reclaims unreferenced blobs', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  const first = await change(store, cwd, 'before', 'after');
  const second = await change(store, cwd, 'before', 'after');
  await store.removeMany({ ids: [first] });
  const { backupId } = await store.restore({ id: second, paths: ['file.txt'] });
  await store.removeMany({ ids: [second] });
  await store.restore({ id: backupId, paths: ['file.txt'] });
  assert.equal(await fs.readFile(path.join(cwd, 'file.txt'), 'utf8'), 'after');
  await store.removeMany({ ids: (await store.storage()).records.map((record) => record.id) });
  assert.equal((await fs.readdir(path.join(directory, 'blobs'))).length, 0);
  assert.equal((await store.storage()).bytes, 0);
});

test('active and interrupted baseline blobs survive collection by another deletion', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  const old = await change(store, cwd, 'old', 'middle');
  await fs.writeFile(path.join(cwd, 'file.txt'), 'baseline');
  const active = await store.begin({ cwd, sessionId: 's', turnId: 'active' });
  await store.removeMany({ ids: [old] });
  const restarted = createCheckpointStore({ directory });
  const empty = await restarted.begin({ cwd, sessionId: 's', turnId: 'empty' });
  await restarted.finish(empty);
  await restarted.removeMany({ ids: [empty] });
  await fs.writeFile(path.join(cwd, 'file.txt'), 'final');
  assert.equal((await restarted.finish(active)).files[0].before, 'baseline');
});

test('a corrupted or missing blob rejects restoration before touching any project file', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  await fs.writeFile(path.join(cwd, 'a.txt'), 'first-before');
  await fs.writeFile(path.join(cwd, 'z.txt'), 'last-before');
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await fs.writeFile(path.join(cwd, 'a.txt'), 'first-after');
  await fs.writeFile(path.join(cwd, 'z.txt'), 'last-after');
  await store.finish(id);
  const saved = await manifest(directory, id);
  const blob = path.join(
    directory,
    'blobs',
    saved.files.find((file) => file.path === 'z.txt').before.blob,
  );
  await fs.writeFile(blob, 'broken');
  await assert.rejects(store.restore({ id, paths: ['a.txt', 'z.txt'] }), {
    code: 'CHECKPOINT_CORRUPT',
  });
  assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'first-after');
  assert.equal(await fs.readFile(path.join(cwd, 'z.txt'), 'utf8'), 'last-after');
  await fs.unlink(blob);
  await assert.rejects(store.restore({ id, paths: ['a.txt', 'z.txt'] }), {
    code: 'CHECKPOINT_CORRUPT',
  });
  assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'first-after');
  assert.equal(await fs.readFile(path.join(cwd, 'z.txt'), 'utf8'), 'last-after');
});

test('unreadable surviving manifests prevent collection even with a warm metadata index', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  const first = await change(store, cwd, 'before', 'after');
  const damaged = await change(store, cwd, 'unrelated', 'content');
  await store.storage();
  const original = await fs.stat(path.join(directory, `${damaged}.json`));
  await fs.writeFile(path.join(directory, `${damaged}.json`), ' '.repeat(original.size));
  await fs.utimes(path.join(directory, `${damaged}.json`), original.atime, original.mtime);
  await store.removeMany({ ids: [first] });
  assert.equal((await fs.readdir(path.join(directory, 'blobs'))).length, 4);
  assert.equal((await store.storage()).records[0].reclaimableBytes, null);
  await store.removeMany({ ids: [damaged] });
  assert.equal((await fs.readdir(path.join(directory, 'blobs'))).length, 0);
});

test('a manifest that disappears during collection stops blob deletion', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  const first = await change(store, cwd, 'before', 'after');
  const survivor = await change(store, cwd, 'other', 'next');
  const readFile = fs.readFile;
  t.mock.method(fs, 'readFile', async (target, ...args) => {
    if (String(target) === path.join(directory, `${survivor}.json`))
      throw Object.assign(new Error('disappeared'), { code: 'ENOENT' });
    return readFile(target, ...args);
  });
  await store.removeMany({ ids: [first] });
  assert.equal((await fs.readdir(path.join(directory, 'blobs'))).length, 4);
});

test('failed blob writes and manifest replacements retain the previous baseline for retry', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  await fs.writeFile(path.join(cwd, 'file.txt'), 'before');
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  const original = await fs.readFile(path.join(directory, `${id}.json`), 'utf8');
  await fs.writeFile(path.join(cwd, 'file.txt'), 'after');
  const writeFile = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (target, ...args) => {
    if (String(target).startsWith(path.join(directory, 'blobs') + path.sep))
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return writeFile(target, ...args);
  });
  await assert.rejects(store.finish(id), { code: 'ENOSPC' });
  t.mock.restoreAll();
  assert.equal(await fs.readFile(path.join(directory, `${id}.json`), 'utf8'), original);
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (source, target) => {
    if (String(target) === path.join(directory, `${id}.json`))
      throw Object.assign(new Error('replace failed'), { code: 'EIO' });
    return rename(source, target);
  });
  await assert.rejects(store.finish(id), { code: 'EIO' });
  t.mock.restoreAll();
  assert.equal(await fs.readFile(path.join(directory, `${id}.json`), 'utf8'), original);
  const reopened = createCheckpointStore({ directory });
  assert.equal((await reopened.finish(id)).files[0].before, 'before');
  await reopened.restore({ id, paths: ['file.txt'] });
  assert.equal(await fs.readFile(path.join(cwd, 'file.txt'), 'utf8'), 'before');
});

test('blob sync failure cannot publish a manifest that depends on unsynced content', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  await fs.writeFile(path.join(cwd, 'file.txt'), 'before');
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  const original = await fs.readFile(path.join(directory, `${id}.json`), 'utf8');
  await fs.writeFile(path.join(cwd, 'file.txt'), 'after');
  const open = fs.open;
  t.mock.method(fs, 'open', async (target, ...args) => {
    const handle = await open(target, ...args);
    if (String(target).startsWith(path.join(directory, 'blobs') + path.sep))
      handle.sync = async () => {
        throw Object.assign(new Error('flush failed'), { code: 'EIO' });
      };
    return handle;
  });
  await assert.rejects(store.finish(id), { code: 'EIO' });
  t.mock.restoreAll();
  assert.equal(await fs.readFile(path.join(directory, `${id}.json`), 'utf8'), original);
  assert.equal((await store.finish(id)).files[0].before, 'before');
});

test('the physical quota includes shared blobs once, including blobs already on disk', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  const id = await change(store, cwd, 'before', 'after');
  const saved = await manifest(directory, id);
  const blob = path.join(directory, 'blobs', saved.files[0].before.blob);
  const stat = fs.stat;
  t.mock.method(fs, 'stat', async (target, ...args) => {
    const result = await stat(target, ...args);
    if (String(target) === blob) result.size = 512 * 1024 * 1024;
    return result;
  });
  await assert.rejects(store.begin({ cwd, sessionId: 's', turnId: 'full' }), {
    code: 'CHECKPOINT_STORAGE_FULL',
  });
  await assert.rejects(store.restore({ id, paths: ['file.txt'] }), {
    code: 'CHECKPOINT_STORAGE_FULL',
  });
  assert.equal(await fs.readFile(path.join(cwd, 'file.txt'), 'utf8'), 'after');
});
