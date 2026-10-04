const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { SessionHub } = require('../electron/session-hub.cjs');
test('empty owned sessions retain their project identity across restart without persisting replay bodies', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'grok owned session '));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const storageFile = path.join(cwd, 'queue.json');
  const options = {
    storageFile,
    emit() {},
    createClient: () => ({ connected: false, dispose() {} }),
  };
  const first = new SessionHub(options);
  const entry = first._entry('empty-owned-session', cwd);
  entry.snapshot = { updates: [{ content: { text: 'REPLAY_BODY_MUST_NOT_PERSIST' } }] };
  await first.dispose();
  const text = await fs.readFile(storageFile, 'utf8');
  assert.doesNotMatch(text, /REPLAY_BODY_MUST_NOT_PERSIST/);
  const restored = new SessionHub(options);
  assert.equal(restored.sessions.get('empty-owned-session').cwd, cwd);
  assert.equal(restored.sessions.get('empty-owned-session').queue.length, 0);
  await restored.dispose();
});
