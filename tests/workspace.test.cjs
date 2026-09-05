const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const {
  listFiles,
  readFile,
  saveFile,
  gitChanges,
  gitDiff,
  resolveWorkspacePath,
} = require('../electron/workspace.cjs');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-desktop-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function workspaceWith(overrides) {
  const filename = path.join(__dirname, '../electron/workspace.cjs');
  const localRequire = createRequire(filename);
  const context = {
    module: { exports: {} },
    require: (name) => overrides[name] || localRequire(name),
    Buffer,
    process,
  };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), context, { filename });
  return context.module.exports;
}

test('project browser stays within the selected project and hides build noise', async (t) => {
  const cwd = await fixture(t);
  await fs.mkdir(path.join(cwd, 'src'));
  await fs.mkdir(path.join(cwd, 'node_modules'));
  await fs.writeFile(path.join(cwd, 'README.md'), 'hello');
  const files = await listFiles({ cwd });
  assert.deepEqual(
    files.map((x) => x.name),
    ['src', 'README.md'],
  );
  assert.equal(files[0].path, 'src');
  assert.throws(() => resolveWorkspacePath(cwd, '../outside'), /项目/);
});

test('saving an editor buffer refuses to overwrite a file changed externally', async (t) => {
  const cwd = await fixture(t);
  const file = path.join(cwd, 'hello.txt');
  await fs.writeFile(file, 'original');
  const opened = await readFile({ cwd, path: 'hello.txt' });
  await fs.writeFile(file, 'agent edit');
  const later = new Date(Date.now() + 5000);
  await fs.utimes(file, later, later);
  await assert.rejects(
    saveFile({ cwd, path: 'hello.txt', text: 'user edit', expectedMtimeMs: opened.mtimeMs }),
    /已.*修改/,
  );
  assert.equal(await fs.readFile(file, 'utf8'), 'agent edit');
});

test('file preview rejects binary content rather than showing corrupted text', async (t) => {
  const cwd = await fixture(t);
  await fs.writeFile(path.join(cwd, 'binary.dat'), Buffer.from([0, 1, 2, 3]));
  await assert.rejects(readFile({ cwd, path: 'binary.dat' }), /二进制/);
});

test('saving normalized editor text preserves the original CRLF convention', async (t) => {
  const cwd = await fixture(t);
  const filename = path.join(cwd, 'windows.txt');
  await fs.writeFile(filename, 'alpha\r\nbeta\r\n');
  const opened = await readFile({ cwd, path: 'windows.txt' });
  await saveFile({
    cwd,
    path: 'windows.txt',
    text: 'alpha\nchanged\n',
    eol: opened.eol || 'crlf',
    expectedMtimeMs: opened.mtimeMs,
  });
  assert.equal(await fs.readFile(filename, 'utf8'), 'alpha\r\nchanged\r\n');
  assert.equal(opened.eol, 'crlf');
});

test('a partial file-write failure leaves the original file intact and removes its temporary file', async (t) => {
  const cwd = await fixture(t);
  const filename = path.join(cwd, 'source.txt');
  await fs.writeFile(filename, 'original complete content');
  const workspace = await workspaceWith({
    'node:fs/promises': {
      ...fs,
      writeFile: async (target, text, options) => {
        await fs.writeFile(target, String(text).slice(0, 3), options);
        throw new Error('simulated disk full');
      },
    },
  });
  await assert.rejects(
    workspace.saveFile({ cwd, path: 'source.txt', text: 'replacement content' }),
    /simulated disk full/,
  );
  assert.equal(await fs.readFile(filename, 'utf8'), 'original complete content');
  assert.deepEqual(await fs.readdir(cwd), ['source.txt']);
});

test('a failed atomic replacement preserves original content and cleans up the staged file', async (t) => {
  const cwd = await fixture(t);
  const filename = path.join(cwd, 'source.txt');
  await fs.writeFile(filename, 'original complete content');
  const workspace = await workspaceWith({
    'node:fs/promises': {
      ...fs,
      rename: async () => {
        throw new Error('simulated file in use');
      },
    },
  });
  await assert.rejects(
    workspace.saveFile({ cwd, path: 'source.txt', text: 'replacement content' }),
    /simulated file in use/,
  );
  assert.equal(await fs.readFile(filename, 'utf8'), 'original complete content');
  assert.deepEqual(await fs.readdir(cwd), ['source.txt']);
});

test('successful file replacement retains the original permission mode', async (t) => {
  const cwd = await fixture(t);
  const filename = path.join(cwd, 'script.sh');
  await fs.writeFile(filename, 'old\n');
  await fs.chmod(filename, 0o750);
  const mode = (await fs.stat(filename)).mode & 0o777;
  await saveFile({ cwd, path: 'script.sh', text: 'new\n' });
  assert.equal(await fs.readFile(filename, 'utf8'), 'new\n');
  assert.equal((await fs.stat(filename)).mode & 0o777, mode);
});

test('build directories can be shown on demand and matching ordinary filenames stay visible', async (t) => {
  const cwd = await fixture(t);
  await fs.mkdir(path.join(cwd, 'dist'));
  await fs.mkdir(path.join(cwd, 'node_modules'));
  await fs.writeFile(path.join(cwd, 'release'), 'an ordinary project file');
  assert.deepEqual(
    (await listFiles({ cwd })).map((item) => item.name),
    ['release'],
  );
  assert.deepEqual(
    (await listFiles({ cwd, showHidden: true })).map((item) => item.name),
    ['dist', 'node_modules', 'release'],
  );
});

test('a missing Git executable returns an unavailable state while other process errors remain errors', async (t) => {
  const cwd = await fixture(t);
  const workspace = await workspaceWith({
    './process.cjs': {
      runProcess: async () => {
        throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
      },
    },
  });
  const result = await workspace.gitChanges({ cwd });
  assert.equal(result.isGit, false);
  assert.equal(result.unavailable, 'git-not-found');
  const failingWorkspace = await workspaceWith({
    './process.cjs': {
      runProcess: async () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    },
  });
  await assert.rejects(failingWorkspace.gitChanges({ cwd }), /permission denied/);
});

test('Git inspector lists staged and unstaged changes and renders untracked content', async (t) => {
  const cwd = await fixture(t);
  const git = (args) => execFileSync('git', ['-C', cwd, ...args], { windowsHide: true });
  git(['init', '-q']);
  git(['config', 'core.autocrlf', 'false']);
  await fs.writeFile(path.join(cwd, 'tracked.txt'), 'one\n');
  git(['add', '.']);
  git([
    '-c',
    'user.name=Desktop test',
    '-c',
    'user.email=test@localhost',
    'commit',
    '-qm',
    'fixture',
  ]);
  await fs.writeFile(path.join(cwd, 'tracked.txt'), 'two\n');
  git(['add', 'tracked.txt']);
  await fs.writeFile(path.join(cwd, 'tracked.txt'), 'three\n');
  await fs.writeFile(path.join(cwd, 'new file.txt'), 'untracked\n');
  await fs.mkdir(path.join(cwd, 'new folder', 'nested'), { recursive: true });
  await fs.writeFile(path.join(cwd, 'new folder', 'nested', 'new file.txt'), 'nested content\n');
  const state = await gitChanges({ cwd });
  assert.equal(state.isGit, true);
  assert.ok(state.changes.some((x) => x.path === 'tracked.txt' && x.staged));
  assert.ok(state.changes.some((x) => x.path === 'tracked.txt' && !x.staged));
  assert.ok(state.changes.some((x) => x.path === 'new file.txt'));
  assert.ok(state.changes.some((x) => x.path === 'new folder/nested/new file.txt'));
  assert.match((await gitDiff({ cwd, path: 'tracked.txt', staged: true })).text, /\+two/);
  assert.match((await gitDiff({ cwd, path: 'new file.txt' })).text, /\+untracked/);
  assert.match(
    (await gitDiff({ cwd, path: 'new folder/nested/new file.txt' })).text,
    /\+nested content/,
  );
});

test('a project inside a Git repository uses project paths and retains moves across its boundary', async (t) => {
  const root = await fixture(t);
  const cwd = path.join(root, 'app');
  const git = (args) => execFileSync('git', ['-C', root, ...args], { windowsHide: true });
  await fs.mkdir(cwd);
  await fs.mkdir(path.join(root, 'outside'));
  git(['init', '-q']);
  git(['config', 'core.autocrlf', 'false']);
  const initial = {
    'app/tracked.txt': 'original tracked\n',
    'app/deleted.txt': 'deleted content\n',
    'app/rename-before.txt': 'renamed content\n',
    'app/move-out.txt': 'outgoing content\n',
    'outside/move-in.txt': 'incoming content\n',
    'outside/changed.txt': 'outside original\n',
  };
  for (const [filename, text] of Object.entries(initial))
    await fs.writeFile(path.join(root, filename), text);
  git(['add', '.']);
  git([
    '-c',
    'user.name=Desktop test',
    '-c',
    'user.email=test@localhost',
    'commit',
    '-qm',
    'fixture',
  ]);
  await fs.writeFile(path.join(cwd, 'tracked.txt'), 'staged tracked\n');
  git(['add', 'app/tracked.txt']);
  await fs.writeFile(path.join(cwd, 'tracked.txt'), 'unstaged tracked\n');
  await fs.unlink(path.join(cwd, 'deleted.txt'));
  git(['mv', 'app/rename-before.txt', 'app/rename-after.txt']);
  git(['mv', 'app/move-out.txt', 'outside/move-out.txt']);
  git(['mv', 'outside/move-in.txt', 'app/move-in.txt']);
  await fs.writeFile(path.join(cwd, 'untracked.txt'), 'new project file\n');
  await fs.writeFile(path.join(root, 'outside/changed.txt'), 'outside changed\n');
  await fs.writeFile(path.join(root, 'outside/untracked.txt'), 'outside new\n');

  const state = await gitChanges({ cwd });
  assert.deepEqual(
    state.changes.map((change) => `${change.path}:${change.status}:${change.staged}`).sort(),
    [
      'deleted.txt:D:false',
      'move-in.txt:A:true',
      'move-out.txt:D:true',
      'rename-after.txt:R:true',
      'tracked.txt:M:false',
      'tracked.txt:M:true',
      'untracked.txt:?:false',
    ],
  );
  const expected = {
    'deleted.txt': /-deleted content/,
    'move-in.txt': /\+incoming content/,
    'move-out.txt': /-outgoing content/,
    'rename-after.txt': /\+renamed content/,
    'untracked.txt': /\+new project file/,
  };
  for (const change of state.changes) {
    const diff = await gitDiff({ cwd, ...change });
    assert.match(
      diff.text,
      expected[change.path] || (change.staged ? /\+staged tracked/ : /\+unstaged tracked/),
    );
  }
});
