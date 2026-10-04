const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadSettings, writeSettings } = require('../electron/settings.cjs');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-settings-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'settings.json');
}

for (const bad of ['{"language":', 'null', '[]']) {
  test(`settings preserve malformed data before saving defaults: ${bad}`, async (t) => {
    const filename = temporary(t),
      warnings = [];
    fs.writeFileSync(filename, bad);
    const defaults = loadSettings(filename, (warning) => warnings.push(warning));
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].kind, 'settings');
    assert.match(warnings[0].backupPath, /corrupt/);
    assert.equal(fs.readFileSync(warnings[0].backupPath, 'utf8'), bad);
    await writeSettings(filename, { ...defaults, theme: 'light' });
    assert.equal(loadSettings(filename).theme, 'light');
    assert.equal(fs.readFileSync(warnings[0].backupPath, 'utf8'), bad);
  });
}

test('a failed corrupt-settings backup blocks overwrite and preserves the original bytes', async (t) => {
  const filename = temporary(t),
    warnings = [],
    bad = Buffer.from('{broken\r\n');
  fs.writeFileSync(filename, bad);
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (source === filename) throw Object.assign(new Error('backup denied'), { code: 'EACCES' });
    return rename(source, target);
  });
  const defaults = loadSettings(filename, (warning) => warnings.push(warning));
  assert.equal(warnings[0]?.recoveryFailed, true);
  await assert.rejects(writeSettings(filename, defaults), /备份|backup/);
  assert.deepEqual(fs.readFileSync(filename), bad);
});

test('settings flush temporary contents before atomic replacement', async (t) => {
  const filename = temporary(t);
  const writeFile = fsp.writeFile,
    rename = fsp.rename;
  let flushed = false;
  t.mock.method(fsp, 'writeFile', async (target, data, options) => {
    if (target === `${filename}.tmp`) flushed = options?.flush === true;
    return writeFile(target, data, options);
  });
  t.mock.method(fsp, 'rename', async (source, target) => {
    if (target === filename) assert.equal(flushed, true);
    return rename(source, target);
  });
  await writeSettings(filename, { language: 'en' });
  assert.equal(loadSettings(filename).language, 'en');
});
