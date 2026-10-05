const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createCheckpointStore } = require('../electron/checkpoints.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'storage completion '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'project'),
    directory = path.join(root, 'checkpoints');
  await fs.mkdir(cwd);
  await fs.mkdir(directory);
  return { root, cwd: await fs.realpath(cwd), directory };
}

test('legacy checkpoint metadata is indexed once, reused after restart and rebuilt if damaged', async (t) => {
  const { cwd, directory } = await fixture(t);
  const id = randomUUID();
  const entry = {
    id,
    cwd,
    sessionId: 's',
    turnId: 't',
    status: 'ready',
    createdAt: new Date().toISOString(),
    summary: 'Fix source',
    skipped: [],
    files: [
      {
        path: 'source.txt',
        status: 'modified',
        before: { content: 'private-before', mode: 438 },
        after: { content: 'private-after', mode: 438 },
      },
    ],
  };
  const filename = path.join(directory, `${id}.json`);
  await fs.writeFile(filename, JSON.stringify(entry));
  const sourceBytes = (await fs.stat(filename)).size;
  const readFile = fs.readFile;
  let bodyReads = 0;
  t.mock.method(fs, 'readFile', async (name, ...args) => {
    if (String(name) === filename) bodyReads++;
    return readFile(name, ...args);
  });
  const store = createCheckpointStore({ directory });
  const first = await store.list({ cwd });
  assert.equal(first[0].summary, 'Fix source');
  assert.equal(first[0].files[0].before, undefined);
  assert.equal(bodyReads, 1);
  await store.list({ cwd });
  assert.equal(bodyReads, 1, 'warm lists must not read checkpoint bodies');
  assert.equal((await store.storage()).bytes, sourceBytes);
  assert.equal(bodyReads, 2, 'reclaimable storage accounting reads complete surviving manifests');
  await createCheckpointStore({ directory }).list({ cwd });
  assert.equal(bodyReads, 2, 'restart must reuse the persisted metadata');
  await fs.writeFile(path.join(directory, 'metadata-index'), '{');
  await createCheckpointStore({ directory }).list({ cwd });
  assert.equal(bodyReads, 3);
  assert.equal((await store.detail({ id })).files[0].before, 'private-before');
});

test('metadata notices external record changes and never fabricates zero for corrupted content', async (t) => {
  const { cwd, directory } = await fixture(t);
  const store = createCheckpointStore({ directory });
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await store.finish(id);
  await store.list({ cwd });
  await fs.writeFile(path.join(directory, `${id}.json`), '{broken');
  const storage = await store.storage();
  assert.equal(storage.records[0].fileCount, null);
  assert.equal(storage.records[0].status, 'unreadable');
  assert.equal((await store.list({ cwd })).length, 0);
  await store.removeMany({ ids: [id] });
  assert.equal((await store.storage()).records.length, 0);
});

test('attachment cleanup stays inside owned storage and preflights fresh active references', async (t) => {
  const { root } = await fixture(t);
  const { createAttachmentStorage } = require('../electron/attachment-storage.cjs');
  const directory = path.join(root, 'attachments');
  await fs.mkdir(directory);
  const outside = path.join(root, 'original.png');
  await fs.writeFile(outside, 'original');
  await fs.writeFile(path.join(directory, 'old.png'), 'old');
  await fs.writeFile(path.join(directory, 'draft.png'), 'draft');
  await fs.writeFile(path.join(directory, 'queued.png'), 'queued');
  let references = [path.join(directory, 'queued.png')];
  const storage = createAttachmentStorage({ directory, referencedPaths: () => references });
  const protectedPaths = [path.join(directory, 'draft.png')];
  const listed = await storage.list({ protectedPaths });
  assert.equal(listed.bytes, 14);
  assert.equal(listed.files.find((file) => file.name === 'draft.png').protected, true);
  await assert.rejects(storage.removeMany({ names: ['old.png', 'draft.png'], protectedPaths }), {
    code: 'ATTACHMENT_IN_USE',
  });
  assert.equal(await fs.readFile(path.join(directory, 'old.png'), 'utf8'), 'old');
  references = [...references, path.join(directory, 'old.png')];
  await assert.rejects(storage.removeMany({ names: ['old.png'] }), { code: 'ATTACHMENT_IN_USE' });
  await assert.rejects(storage.removeMany({ names: ['../original.png'] }));
  references = [];
  assert.deepEqual(await storage.removeMany({ names: ['old.png'] }), { removed: ['old.png'] });
  assert.equal(await fs.readFile(outside, 'utf8'), 'original');
});

test('rename retries only temporary Windows occupancy and preserves the original final error', async (t) => {
  const { renameWithRetry } = require('../electron/file-retry.cjs');
  const rename = fs.rename;
  const { root } = await fixture(t);
  const source = path.join(root, 'source'),
    target = path.join(root, 'target');
  await fs.writeFile(source, 'new');
  await fs.writeFile(target, 'old');
  let attempts = 0;
  const blocked = Object.assign(new Error('busy original reason'), { code: 'EPERM' });
  t.mock.method(fs, 'rename', async (...args) => {
    attempts++;
    if (attempts < 3) throw blocked;
    return rename(...args);
  });
  if (process.platform === 'win32') {
    await renameWithRetry(source, target);
    assert.equal(attempts, 3);
    assert.equal(await fs.readFile(target, 'utf8'), 'new');
  } else {
    await assert.rejects(renameWithRetry(source, target), (error) => error === blocked);
    assert.equal(attempts, 1);
  }
  attempts = 0;
  t.mock.method(fs, 'rename', async () => {
    attempts++;
    throw blocked;
  });
  await assert.rejects(renameWithRetry(source, target), (error) => error === blocked);
  assert.equal(attempts, process.platform === 'win32' ? 4 : 1);
  attempts = 0;
  const permanent = Object.assign(new Error('access denied'), { code: 'EACCES' });
  t.mock.method(fs, 'rename', async () => {
    attempts++;
    throw permanent;
  });
  await assert.rejects(renameWithRetry(source, target), (error) => error === permanent);
  assert.equal(attempts, 1);
});

test('workspace save aborts a rename retry if an external edit arrives while waiting', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows occupancy retry');
  const { saveFile } = require('../electron/workspace.cjs');
  const { cwd } = await fixture(t);
  const filename = path.join(cwd, 'file.txt');
  await fs.writeFile(filename, 'old');
  const before = await fs.stat(filename);
  let attempts = 0;
  t.mock.method(fs, 'rename', async () => {
    attempts++;
    await fs.writeFile(filename, 'external');
    await fs.utimes(filename, new Date(), new Date(Date.now() + 2000));
    throw Object.assign(new Error('busy'), { code: 'EBUSY' });
  });
  await assert.rejects(
    saveFile({ cwd, path: 'file.txt', text: 'mine', expectedMtimeMs: before.mtimeMs }),
    /修改/,
  );
  assert.equal(attempts, 1);
  assert.equal(await fs.readFile(filename, 'utf8'), 'external');
});
