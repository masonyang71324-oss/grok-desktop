const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');

test(
  'Electron npm startup resolves Node from absolute PATH entries, ignoring cwd and relative entries',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'node path security '));
    t.after(() => fs.rm(base, { recursive: true, force: true }));
    const cwd = path.join(base, 'project');
    const installed = path.join(base, 'installed node');
    await fs.mkdir(cwd);
    await fs.mkdir(path.join(installed, 'node_modules/npm/bin'), { recursive: true });
    await fs.writeFile(
      path.join(cwd, 'package.json'),
      JSON.stringify({ scripts: { dev: 'echo safe' } }),
    );
    await fs.writeFile(path.join(cwd, 'node.exe'), 'must never launch');
    await fs.writeFile(path.join(installed, 'node.exe'), 'installed node');
    await fs.writeFile(path.join(installed, 'node_modules/npm/bin/npm-cli.js'), '');
    const launches = [];
    const filename = require.resolve('../electron/project-runner.cjs');
    const localRequire = createRequire(filename);
    const context = {
      module: { exports: {} },
      process: {
        ...process,
        versions: { ...process.versions, electron: '44.3.0' },
        env: { PATH: `.;relative;;"${installed}"`, SystemRoot: process.env.SystemRoot },
        execPath: path.join(base, 'app/electron.exe'),
      },
      require(name) {
        if (name === 'node:child_process')
          return {
            spawn(executable, args, options) {
              launches.push({ executable, args, options });
              const child = new EventEmitter();
              child.stdout = new EventEmitter();
              child.stderr = new EventEmitter();
              child.stdout.setEncoding = child.stderr.setEncoding = () => {};
              queueMicrotask(() => child.emit('close', 0));
              return child;
            },
          };
        return localRequire(name);
      },
      setTimeout,
      clearTimeout,
    };
    vm.runInNewContext(await fs.readFile(filename, 'utf8'), context, { filename });
    const runner = context.module.exports.createProjectRunner();
    await runner.start({ cwd, script: 'dev' });
    assert.equal(launches[0].executable, path.join(installed, 'node.exe'));
    assert.equal(launches[0].args[0], path.join(installed, 'node_modules/npm/bin/npm-cli.js'));
    assert.equal(launches[0].options.cwd, cwd);
    assert.equal(launches[0].options.shell, false);
  },
);

test('Windows system executable paths stay absolute even if SystemRoot is relative', () => {
  const {
    windowsPowerShellPath,
    windowsSystemExecutable,
  } = require('../electron/system-launch.cjs');
  assert.equal(
    windowsPowerShellPath({ SystemRoot: 'D:\\Windows' }),
    'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
  assert.equal(
    windowsPowerShellPath({ SystemRoot: '.' }),
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
  assert.equal(
    windowsSystemExecutable('taskkill.exe', { SystemRoot: 'D:\\Windows' }),
    'D:\\Windows\\System32\\taskkill.exe',
  );
});

test('system-open classifies executable and script file targets without blocking ordinary documents', () => {
  const { isExecutableOpenTarget } = require('../electron/system-launch.cjs');
  for (const extension of [
    'exe',
    'com',
    'bat',
    'cmd',
    'ps1',
    'vbs',
    'js',
    'jse',
    'wsf',
    'wsh',
    'msi',
    'msp',
    'scr',
    'hta',
    'lnk',
    'url',
  ])
    assert.equal(
      isExecutableOpenTarget(`C:\\project\\report.${extension.toUpperCase()}`),
      true,
      extension,
    );
  for (const filename of [
    'README.md',
    'report.pdf',
    'notes.txt',
    'table.csv',
    'picture.png',
    'script.js.txt',
  ])
    assert.equal(isExecutableOpenTarget(`C:\\project\\${filename}`), false, filename);
});
