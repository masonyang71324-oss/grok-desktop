const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { gitChanges, gitDiff } = require('../electron/workspace.cjs');

test('background Git status and diff disable repository fsmonitor and leave the index untouched', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'git inspector safety '));
  const keys = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM'];
  const prior = keys.map((key) => process.env[key]);
  const emptyConfig = path.join(cwd, 'empty-config');
  await fs.writeFile(emptyConfig, '');
  process.env.GIT_CONFIG_GLOBAL = emptyConfig;
  process.env.GIT_CONFIG_SYSTEM = emptyConfig;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  t.after(async () => {
    keys.forEach((key, index) =>
      prior[index] === undefined ? delete process.env[key] : (process.env[key] = prior[index]),
    );
    await fs.rm(cwd, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', ['-C', cwd, ...args], { windowsHide: true });
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  await fs.writeFile(path.join(cwd, 'tracked.txt'), 'original\n');
  git('add', 'tracked.txt');
  git(
    '-c',
    'user.name=Desktop test',
    '-c',
    'user.email=test@localhost',
    'commit',
    '-qm',
    'fixture',
  );
  await fs.writeFile(path.join(cwd, 'tracked.txt'), 'changed\n');
  const marker = path.join(cwd, '.git/fsmonitor-called');
  const hook = path.join(cwd, '.git/fsmonitor-test.sh');
  await fs.writeFile(
    hook,
    `#!/bin/sh\nprintf called > '${marker.replaceAll('\\', '/').replaceAll("'", "'\\''")}'\nprintf "token\\000"\n`,
    { mode: 0o755 },
  );
  git('config', 'core.fsmonitor', `"${hook.replaceAll('\\', '/')}"`);
  git('status', '--short');
  assert.equal(
    await fs.readFile(marker, 'utf8'),
    'called',
    'fixture must execute its harmless fsmonitor hook without the fix',
  );
  await fs.unlink(marker);
  // A different mtime with identical content makes ordinary Git status refresh the index.
  await fs.writeFile(path.join(cwd, 'tracked.txt'), 'original\n');
  const future = new Date(Date.now() + 5000);
  await fs.utimes(path.join(cwd, 'tracked.txt'), future, future);
  const before = await fs.readFile(path.join(cwd, '.git/index'));
  assert.equal((await gitChanges({ cwd })).isGit, true);
  assert.equal(
    (await fs.readFile(path.join(cwd, '.git/index'))).equals(before),
    true,
    'background status must not refresh the index',
  );
  await gitDiff({ cwd, path: 'tracked.txt' });
  assert.equal(
    await fs.access(marker).then(
      () => true,
      () => false,
    ),
    false,
    'background inspection must never execute the repository fsmonitor hook',
  );
  assert.equal(
    (await fs.readFile(path.join(cwd, '.git/index'))).equals(before),
    true,
    'background reads must not refresh the index',
  );
  await fs.writeFile(path.join(cwd, 'tracked.txt'), 'changed\n');
  assert.match((await gitDiff({ cwd, path: 'tracked.txt' })).text, /\+changed/);
});
