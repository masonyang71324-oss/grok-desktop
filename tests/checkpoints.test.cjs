const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCheckpointStore } = require('../electron/checkpoints.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint test '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'project');
  await fs.mkdir(cwd);
  return { cwd: await fs.realpath(cwd), directory: path.join(root, 'store') };
}

test('restores dirty text, additions and deletions byte-for-byte with an undo record', async (t) => {
  const { cwd, directory } = await fixture(t);
  const store = createCheckpointStore({ directory });
  await fs.writeFile(path.join(cwd, 'dirty.txt'), 'unsaved baseline\r\n');
  await fs.writeFile(path.join(cwd, 'deleted.txt'), 'keep\n');
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await fs.writeFile(path.join(cwd, 'dirty.txt'), 'agent\n');
  await fs.unlink(path.join(cwd, 'deleted.txt'));
  await fs.writeFile(path.join(cwd, 'new.txt'), 'new\n');
  const entry = await store.finish(id);
  assert.equal(entry.files.length, 3);
  const { backupId } = await store.restore({ id, paths: entry.files.map((f) => f.path) });
  assert.equal(await fs.readFile(path.join(cwd, 'dirty.txt'), 'utf8'), 'unsaved baseline\r\n');
  assert.equal(await fs.readFile(path.join(cwd, 'deleted.txt'), 'utf8'), 'keep\n');
  await assert.rejects(fs.stat(path.join(cwd, 'new.txt')), { code: 'ENOENT' });
  const reopened = createCheckpointStore({ directory });
  await reopened.restore({ id: backupId, paths: entry.files.map((f) => f.path) });
  assert.equal(await fs.readFile(path.join(cwd, 'dirty.txt'), 'utf8'), 'agent\n');
  assert.equal((await reopened.list({ cwd, sessionId: 's' })).length, 3);
});

test('preflights all conflicts before changing any file and reports omissions', async (t) => {
  const { cwd, directory } = await fixture(t);
  const store = createCheckpointStore({ directory });
  await fs.writeFile(path.join(cwd, 'a.txt'), 'a');
  await fs.writeFile(path.join(cwd, 'z.txt'), 'z');
  await fs.writeFile(path.join(cwd, 'binary'), Buffer.from([0, 255]));
  await fs.mkdir(path.join(cwd, 'node_modules'));
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await fs.writeFile(path.join(cwd, 'a.txt'), 'changed');
  await fs.writeFile(path.join(cwd, 'z.txt'), 'changed');
  const entry = await store.finish(id);
  assert.ok(entry.skipped.some((f) => f.path === 'binary'));
  assert.ok(entry.skipped.some((f) => f.path === 'node_modules'));
  await fs.writeFile(path.join(cwd, 'z.txt'), 'user edit');
  await assert.rejects(store.restore({ id, paths: ['a.txt', 'z.txt'] }), {
    code: 'CHECKPOINT_CONFLICT',
  });
  assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'changed');
});

test('oversized after-state is omitted rather than treated as deletion; modes survive restoration', async (t) => {
  const { cwd, directory } = await fixture(t);
  const store = createCheckpointStore({ directory });
  await fs.writeFile(path.join(cwd, 'large.txt'), 'baseline');
  await fs.writeFile(path.join(cwd, 'mode.txt'), 'before');
  const beforeMode = (await fs.stat(path.join(cwd, 'mode.txt'))).mode & 0o777;
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await fs.writeFile(path.join(cwd, 'large.txt'), 'x'.repeat(1024 * 1024 + 1));
  await fs.writeFile(path.join(cwd, 'mode.txt'), 'after');
  const entry = await store.finish(id);
  assert.deepEqual(
    entry.files.map((f) => f.path),
    ['mode.txt'],
  );
  assert.ok(entry.skipped.some((f) => f.path === 'large.txt'));
  await store.restore({ id, paths: ['mode.txt'] });
  assert.equal((await fs.stat(path.join(cwd, 'mode.txt'))).mode & 0o777, beforeMode);
  assert.equal((await fs.stat(path.join(cwd, 'large.txt'))).size, 1024 * 1024 + 1);
});

test('invalid UTF-8 later edits cannot match a captured replacement character', async (t) => {
  const { cwd, directory } = await fixture(t);
  const store = createCheckpointStore({ directory });
  await fs.writeFile(path.join(cwd, 'text.txt'), 'before');
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await fs.writeFile(path.join(cwd, 'text.txt'), '\ufffd');
  await store.finish(id);
  await fs.writeFile(path.join(cwd, 'text.txt'), Buffer.from([255]));
  await assert.rejects(store.restore({ id, paths: ['text.txt'] }), { code: 'CHECKPOINT_CONFLICT' });
  assert.deepEqual(await fs.readFile(path.join(cwd, 'text.txt')), Buffer.from([255]));
});

test('a partial I/O failure leaves a usable undo checkpoint for only restored files', async (t) => {
  const { cwd, directory } = await fixture(t);
  const store = createCheckpointStore({ directory });
  for (const name of ['a.txt', 'z.txt']) await fs.writeFile(path.join(cwd, name), 'before');
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  for (const name of ['a.txt', 'z.txt']) await fs.writeFile(path.join(cwd, name), 'after');
  await store.finish(id);
  const writeFile = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (target, ...args) => {
    if (String(target).startsWith(path.join(cwd, 'z.txt'))) {
      throw Object.assign(new Error('Disk write failed'), { code: 'EIO' });
    }
    return writeFile(target, ...args);
  });
  let failure;
  try {
    await store.restore({ id, paths: ['a.txt', 'z.txt'] });
  } catch (error) {
    failure = error;
  }
  t.mock.restoreAll();
  assert.equal(failure.code, 'EIO');
  assert.equal(await fs.readFile(path.join(cwd, 'z.txt'), 'utf8'), 'after');
  const backup = await store.detail({ id: failure.backupId });
  assert.deepEqual(
    backup.files.map((file) => file.path),
    ['a.txt'],
  );
  await store.restore({ id: backup.id, paths: backup.files.map((file) => file.path) });
  assert.equal(await fs.readFile(path.join(cwd, 'a.txt'), 'utf8'), 'after');
});

test('removes completed history without changing project files and refuses active checkpoints', async (t) => {
  const { cwd, directory } = await fixture(t);
  const store = createCheckpointStore({ directory });
  await fs.writeFile(path.join(cwd, 'text.txt'), 'before');
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await assert.rejects(store.remove({ id }));
  assert.equal((await store.list({ cwd })).length, 1);
  await fs.writeFile(path.join(cwd, 'text.txt'), 'after');
  await store.finish(id);
  assert.deepEqual(await store.remove({ id }), { removed: id });
  assert.deepEqual(await store.list({ cwd }), []);
  assert.equal(await fs.readFile(path.join(cwd, 'text.txt'), 'utf8'), 'after');
});

test('an unfinished checkpoint from a previous process is labelled interrupted and can be removed', async (t) => {
  const { cwd, directory } = await fixture(t);
  await fs.writeFile(path.join(cwd, 'text.txt'), 'keep');
  const first = createCheckpointStore({ directory });
  const id = await first.begin({ cwd, sessionId: 's', turnId: 't' });
  const restarted = createCheckpointStore({ directory });
  assert.equal((await restarted.detail({ id })).status, 'interrupted');
  await assert.rejects(restarted.restore({ id, paths: ['text.txt'] }));
  await restarted.remove({ id });
  assert.equal(await fs.readFile(path.join(cwd, 'text.txt'), 'utf8'), 'keep');
});

test('project path aliases list the same checkpoint records', async (t) => {
  const { cwd, directory } = await fixture(t);
  const alias = path.join(path.dirname(cwd), 'project alias');
  await fs.symlink(cwd, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const store = createCheckpointStore({ directory });
  const id = await store.begin({ cwd: alias, sessionId: 's', turnId: 't' });
  await store.finish(id);
  assert.deepEqual(
    (await store.list({ cwd: alias, sessionId: 's' })).map((entry) => entry.id),
    [id],
  );
});
