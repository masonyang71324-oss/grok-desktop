const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createCheckpointStore } = require('../electron/checkpoints.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint review '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'project');
  const directory = path.join(root, 'store');
  await fs.mkdir(cwd);
  return { cwd: await fs.realpath(cwd), directory, store: createCheckpointStore({ directory }) };
}

async function manyFiles(cwd, prefix = 'file', total = 2200) {
  for (let offset = 0; offset < total; offset += 100)
    await Promise.all(
      Array.from({ length: Math.min(100, total - offset) }, (_, index) =>
        fs.writeFile(
          path.join(cwd, `${prefix}-${String(offset + index).padStart(4, '0')}.txt`),
          'before',
        ),
      ),
    );
}

test('bounded scans keep captured changes restorable in a project with thousands of files', async (t) => {
  const { cwd, store } = await fixture(t);
  await manyFiles(cwd);
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await fs.writeFile(path.join(cwd, 'file-0000.txt'), 'after');
  const result = await store.finish(id);
  assert.equal(result.files.find((file) => file.path === 'file-0000.txt')?.status, 'modified');
  assert.ok(result.skipped.length);
  await store.restore({ id, paths: ['file-0000.txt'] });
  assert.equal(await fs.readFile(path.join(cwd, 'file-0000.txt'), 'utf8'), 'before');
});

test('a truncated directory still records additions and deletions inside its scanned range', async (t) => {
  const { cwd, store } = await fixture(t);
  await manyFiles(cwd);
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await fs.unlink(path.join(cwd, 'file-0000.txt'));
  await fs.writeFile(path.join(cwd, 'aaa-created.txt'), 'new');
  await fs.writeFile(path.join(cwd, 'file-0001.txt'), 'after');
  const result = await store.finish(id);
  assert.deepEqual(
    result.files
      .map(({ path, status }) => ({ path, status }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: 'aaa-created.txt', status: 'created' },
      { path: 'file-0000.txt', status: 'deleted' },
      { path: 'file-0001.txt', status: 'modified' },
    ],
  );
  await store.restore({ id, paths: result.files.map((file) => file.path) });
  await assert.rejects(fs.stat(path.join(cwd, 'aaa-created.txt')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(cwd, 'file-0000.txt'), 'utf8'), 'before');
  assert.equal(await fs.readFile(path.join(cwd, 'file-0001.txt'), 'utf8'), 'before');
});

test('scan coverage changes never turn unscanned files into additions or deletions', async (t) => {
  const { cwd, store } = await fixture(t);
  await fs.writeFile(path.join(cwd, 'z-original.txt'), 'before');
  const id = await store.begin({ cwd, sessionId: 's', turnId: 'one' });
  await manyFiles(cwd, 'a');
  const after = await store.finish(id);
  assert.ok(!after.files.some((file) => file.path === 'z-original.txt'));
  const second = await store.begin({ cwd, sessionId: 's', turnId: 'two' });
  for (let index = 0; index < 2200; index++)
    await fs.unlink(path.join(cwd, `a-${String(index).padStart(4, '0')}.txt`));
  const final = await store.finish(second);
  assert.ok(!final.files.some((file) => file.path === 'z-original.txt'));
  assert.ok(final.files.some((file) => file.path === 'a-0000.txt' && file.status === 'deleted'));
});

test('a directory boundary keeps fully scanned root files covered and nested files unknown', async (t) => {
  const { cwd, store } = await fixture(t);
  await manyFiles(cwd, 'file', 1999);
  for (const name of ['a-dir', 'b-dir']) await fs.mkdir(path.join(cwd, name));
  await fs.writeFile(path.join(cwd, 'b-dir', 'unknown.txt'), 'before');
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await fs.unlink(path.join(cwd, 'file-0000.txt'));
  await fs.writeFile(path.join(cwd, 'zzz-created.txt'), 'new');
  await fs.writeFile(path.join(cwd, 'b-dir', 'unknown.txt'), 'after');
  const result = await store.finish(id);
  assert.deepEqual(
    result.files
      .map(({ path, status }) => ({ path, status }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: 'file-0000.txt', status: 'deleted' },
      { path: 'zzz-created.txt', status: 'created' },
    ],
  );
});

test('generated directories do not consume source coverage; bin and ignored env files remain supported', async (t) => {
  const { cwd, store } = await fixture(t);
  for (const name of ['.venv', '__pycache__', 'obj', 'target', 'bin'])
    await fs.mkdir(path.join(cwd, name));
  await manyFiles(path.join(cwd, '.venv'));
  for (const name of ['.env', '.gitignore', 'z-source.ts', 'bin/tool.sh'])
    await fs.writeFile(path.join(cwd, name), name === '.gitignore' ? '.env\n' : 'before');
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  for (const name of ['.env', 'z-source.ts', 'bin/tool.sh'])
    await fs.writeFile(path.join(cwd, name), 'after');
  const result = await store.finish(id);
  assert.deepEqual(result.files.map((file) => file.path).sort(), [
    '.env',
    'bin/tool.sh',
    'z-source.ts',
  ]);
});

test('capacity has a structured code, and restore cannot overwrite files without room for undo', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  await fs.writeFile(path.join(cwd, 'source.txt'), 'before');
  const id = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await fs.writeFile(path.join(cwd, 'source.txt'), 'after');
  await store.finish(id);
  const stat = fs.stat;
  t.mock.method(fs, 'stat', async (target, ...args) => {
    const result = await stat(target, ...args);
    if (String(target) === path.join(directory, `${id}.json`)) result.size = 512 * 1024 * 1024;
    return result;
  });
  await assert.rejects(store.begin({ cwd, sessionId: 's', turnId: 'full' }), {
    code: 'CHECKPOINT_STORAGE_FULL',
  });
  await assert.rejects(store.restore({ id, paths: ['source.txt'] }), {
    code: 'CHECKPOINT_STORAGE_FULL',
  });
  assert.equal(await fs.readFile(path.join(cwd, 'source.txt'), 'utf8'), 'after');
  t.mock.restoreAll();
  await store.restore({ id, paths: ['source.txt'] });
  assert.equal(await fs.readFile(path.join(cwd, 'source.txt'), 'utf8'), 'before');
  assert.equal(
    (await store.storage()).records.filter((record) => record.kind === 'restore').length,
    1,
  );
});

test('storage lists cross-project, empty, active, undo and corrupt records and batch deletion preflights active records', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  const id = await store.begin({ cwd, sessionId: 's', turnId: 'empty' });
  await store.finish(id);
  const other = path.join(path.dirname(cwd), 'other');
  await fs.mkdir(other);
  const active = await store.begin({ cwd: other, sessionId: 'other', turnId: 'active' });
  const corrupt = randomUUID();
  await fs.writeFile(path.join(directory, `${corrupt}.json`), '{');
  const storage = await store.storage();
  assert.equal(storage.records.length, 3);
  assert.equal(storage.records.find((record) => record.id === corrupt).status, 'unreadable');
  assert.equal(storage.records.find((record) => record.id === id).fileCount, 0);
  assert.equal(storage.records.find((record) => record.id === active).status, 'recording');
  assert.equal(
    storage.bytes,
    storage.records.reduce((sum, record) => sum + record.bytes, 0),
  );
  assert.equal(storage.limitBytes, 512 * 1024 * 1024);
  assert.equal((await store.list({ cwd })).length, 1);
  await assert.rejects(store.removeMany({ ids: [id, active] }));
  assert.ok(await store.detail({ id }));
  assert.deepEqual(await store.removeMany({ ids: [id, corrupt] }), { removed: [id, corrupt] });
  assert.deepEqual(
    (await store.storage()).records.map((record) => record.id),
    [active],
  );
});

test('capacity accepts the exact storage boundary and rejects one byte beyond it', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  const first = await store.begin({ cwd, sessionId: 's', turnId: 'a' });
  const entryBytes = (await fs.stat(path.join(directory, `${first}.json`))).size;
  let reportedSize = 512 * 1024 * 1024 - entryBytes + 1;
  const stat = fs.stat;
  t.mock.method(fs, 'stat', async (target, ...args) => {
    const result = await stat(target, ...args);
    if (String(target) === path.join(directory, `${first}.json`)) result.size = reportedSize;
    return result;
  });
  await assert.rejects(store.begin({ cwd, sessionId: 's', turnId: 'b' }), {
    code: 'CHECKPOINT_STORAGE_FULL',
  });
  reportedSize--;
  const second = await store.begin({ cwd, sessionId: 's', turnId: 'c' });
  assert.ok(second);
  assert.equal((await store.storage()).bytes, 512 * 1024 * 1024);
});

test('a damaged record with valid JSON cannot break either checkpoint list', async (t) => {
  const { cwd, directory, store } = await fixture(t);
  const good = await store.begin({ cwd, sessionId: 's', turnId: 't' });
  await store.finish(good);
  const damaged = randomUUID();
  await fs.writeFile(
    path.join(directory, `${damaged}.json`),
    JSON.stringify({
      id: damaged,
      cwd,
      createdAt: new Date().toISOString(),
      status: 'ready',
      files: [],
      skipped: {},
    }),
  );
  assert.deepEqual(
    (await store.list({ cwd })).map((record) => record.id),
    [good],
  );
  assert.equal(
    (await store.storage()).records.find((record) => record.id === damaged).status,
    'unreadable',
  );
});

test('turn hooks let only explicitly accepted capacity failures continue and keep skips tied to the turn', async () => {
  const { createCheckpointTurnHooks } = require('../electron/checkpoint-turns.cjs');
  const capacity = Object.assign(new Error('full'), { code: 'CHECKPOINT_STORAGE_FULL' });
  const events = [],
    choices = [];
  const hooks = createCheckpointTurnHooks({
    store: {
      begin: async ({ turnId }) => {
        if (turnId === 'skip') throw capacity;
        return 'record';
      },
      finish: async () => {},
    },
    chooseWithoutCheckpoint: async (input) => {
      choices.push(input);
      return true;
    },
    emit: (event) => events.push(event),
  });
  await hooks.beforeTurn({ cwd: 'project', sessionId: 's', turnId: 'skip' });
  await hooks.beforeTurn({ cwd: 'project', sessionId: 's', turnId: 'normal' });
  assert.deepEqual(await hooks.afterTurn({ cwd: 'project', sessionId: 's', turnId: 'normal' }), {
    checkpointId: 'record',
  });
  assert.deepEqual(await hooks.afterTurn({ cwd: 'project', sessionId: 's', turnId: 'skip' }), {
    checkpointSkipped: true,
  });
  assert.equal(choices[0].error, capacity);
  assert.equal(choices[0].turnId, 'skip');
  assert.equal(events.length, 2);
  assert.equal(
    await hooks.afterTurn({ cwd: 'project', sessionId: 's', turnId: 'skip' }),
    undefined,
  );
});

test('turn hooks do not swallow I/O errors or continue after capacity is declined', async () => {
  const { createCheckpointTurnHooks } = require('../electron/checkpoint-turns.cjs');
  let error = Object.assign(new Error('disk error'), { code: 'EIO' });
  let prompted = 0;
  const hooks = createCheckpointTurnHooks({
    store: {
      begin: async () => {
        throw error;
      },
    },
    chooseWithoutCheckpoint: async () => {
      prompted++;
      return false;
    },
  });
  const input = { cwd: 'project', sessionId: 's', turnId: 't' };
  await assert.rejects(hooks.beforeTurn(input), { code: 'EIO' });
  assert.equal(prompted, 0);
  error = Object.assign(new Error('full'), { code: 'CHECKPOINT_STORAGE_FULL' });
  await assert.rejects(hooks.beforeTurn(input), { code: 'CHECKPOINT_CANCELLED' });
  assert.equal(await hooks.afterTurn(input), undefined);
});
