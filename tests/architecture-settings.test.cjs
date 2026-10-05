const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeSettings } = require('../electron/settings.cjs');
const { createAccessPolicy } = require('../electron/access-policy.cjs');

test('architecture preferences retain conservative defaults and explicit selections', () => {
  const defaults = normalizeSettings();
  assert.equal(defaults.permissionMode, 'ask');
  assert.equal(defaults.updateChannel, 'stable');
  assert.equal(defaults.autoReconnect, true);
  const chosen = normalizeSettings({
    permissionMode: 'read',
    updateChannel: 'beta',
    autoReconnect: false,
  });
  assert.equal(chosen.permissionMode, 'read');
  assert.equal(chosen.updateChannel, 'beta');
  assert.equal(chosen.autoReconnect, false);
});

test('automatic read scope is the current trusted project or explicitly selected files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-read-scope-'));
  try {
    const current = path.join(root, 'current'),
      other = path.join(root, 'other');
    await fs.mkdir(current);
    await fs.mkdir(other);
    const local = path.join(current, 'a.txt'),
      foreign = path.join(other, 'b.txt');
    await fs.writeFile(local, 'a');
    await fs.writeFile(foreign, 'b');
    const policy = createAccessPolicy();
    await policy.grantProject(current, true);
    await policy.grantProject(other, true);
    assert.equal(await policy.authorizeRead({ cwd: current, paths: [local] }), true);
    assert.equal(await policy.authorizeRead({ cwd: current, paths: [foreign] }), false);
    await policy.grantFile(foreign);
    assert.equal(await policy.authorizeRead({ cwd: current, paths: [foreign] }), true);
    policy.setProjectTrust(current, false);
    assert.equal(await policy.authorizeRead({ cwd: current, paths: [local] }), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
