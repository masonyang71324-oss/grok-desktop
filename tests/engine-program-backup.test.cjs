const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let createEngineBackup;
try {
  ({ createEngineBackup } = require('../electron/engine-program-backup.cjs'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-program-backup-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin);
  const executable = path.join(bin, 'grok.exe');
  await fs.writeFile(executable, 'old executable');
  return { root, bin, executable, backupRoot: path.join(root, 'backups') };
}
function backup(executable, backupRoot) {
  assert.equal(typeof createEngineBackup, 'function', 'program-only backup must be implemented');
  return createEngineBackup(executable, backupRoot);
}

test('program backup restores both original binaries after a failed replacement', async (t) => {
  const f = await fixture(t);
  const agent = path.join(f.bin, 'agent.exe');
  await fs.writeFile(agent, 'old agent');
  const saved = await backup(f.executable, f.backupRoot);
  assert.equal(path.dirname(saved.directory), f.backupRoot);
  assert.deepEqual((await fs.readdir(saved.directory)).sort(), ['agent.exe', 'grok.exe']);
  await fs.writeFile(f.executable, 'partial new executable');
  await fs.writeFile(agent, 'partial new agent');
  await saved.restore();
  assert.equal(await fs.readFile(f.executable, 'utf8'), 'old executable');
  assert.equal(await fs.readFile(agent, 'utf8'), 'old agent');
  assert.equal(
    await fs.readFile(path.join(saved.directory, 'grok.exe'), 'utf8'),
    'old executable',
    'backup remains available after restoration',
  );
});

test('backup and restoration never include or change configuration, credentials, sessions or unrelated helpers', async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.bin, 'sessions'));
  const files = {
    'auth.json': 'synthetic account',
    'config.toml': 'synthetic configuration',
    'sessions/history.json': 'synthetic history',
    'grove.exe': 'unrelated helper',
  };
  for (const [name, text] of Object.entries(files))
    await fs.writeFile(path.join(f.bin, name), text);
  const saved = await backup(f.executable, f.backupRoot);
  assert.deepEqual(await fs.readdir(saved.directory), ['grok.exe']);
  await fs.writeFile(path.join(f.bin, 'later.txt'), 'created after backup');
  await fs.writeFile(f.executable, 'new exe');
  await saved.restore();
  for (const [name, text] of Object.entries(files))
    assert.equal(await fs.readFile(path.join(f.bin, name), 'utf8'), text);
  assert.equal(await fs.readFile(path.join(f.bin, 'later.txt'), 'utf8'), 'created after backup');
});

test('a custom executable name and missing optional agent still produce a usable backup', async (t) => {
  const f = await fixture(t);
  const executable = path.join(f.bin, 'custom-grok.exe');
  await fs.rename(f.executable, executable);
  const saved = await backup(executable, f.backupRoot);
  assert.deepEqual(await fs.readdir(saved.directory), ['custom-grok.exe']);
  await fs.unlink(executable);
  await saved.restore();
  assert.equal(await fs.readFile(executable, 'utf8'), 'old executable');
});

test('using agent.exe as the configured executable does not copy or restore it twice', async (t) => {
  const f = await fixture(t);
  const executable = path.join(f.bin, 'agent.exe');
  await fs.rename(f.executable, executable);
  const saved = await backup(executable, f.backupRoot);
  assert.deepEqual(await fs.readdir(saved.directory), ['agent.exe']);
  await fs.writeFile(executable, 'new agent');
  await saved.restore();
  assert.equal(await fs.readFile(executable, 'utf8'), 'old executable');
});

test('each operation keeps a separate backup snapshot', async (t) => {
  const f = await fixture(t);
  const first = await backup(f.executable, f.backupRoot);
  await fs.writeFile(f.executable, 'second executable');
  const second = await backup(f.executable, f.backupRoot);
  assert.notEqual(first.directory, second.directory);
  await first.restore();
  assert.equal(await fs.readFile(f.executable, 'utf8'), 'old executable');
  await second.restore();
  assert.equal(await fs.readFile(f.executable, 'utf8'), 'second executable');
});

test('missing required executable and copy failures cannot report a successful backup', async (t) => {
  const f = await fixture(t);
  await assert.rejects(backup(path.join(f.bin, 'missing.exe'), f.backupRoot), { code: 'ENOENT' });
  const diskError = Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  t.mock.method(fs, 'copyFile', async () => {
    throw diskError;
  });
  await assert.rejects(backup(f.executable, f.backupRoot), (error) => error === diskError);
  assert.equal(await fs.readFile(f.executable, 'utf8'), 'old executable');
});

test('restoration copy errors are surfaced without claiming success or changing unrelated files', async (t) => {
  const f = await fixture(t);
  const saved = await backup(f.executable, f.backupRoot);
  const restoreError = Object.assign(new Error('locked program'), { code: 'EPERM' });
  t.mock.method(fs, 'copyFile', async () => {
    throw restoreError;
  });
  await assert.rejects(saved.restore(), (error) => error === restoreError);
});

test('program and backup directories must be explicit absolute paths', async (t) => {
  const f = await fixture(t);
  await assert.rejects(backup('relative.exe', f.backupRoot), /absolute|绝对/i);
  await assert.rejects(backup(f.executable, 'relative'), /absolute|绝对/i);
  assert.equal(await fs.readFile(f.executable, 'utf8'), 'old executable');
});
