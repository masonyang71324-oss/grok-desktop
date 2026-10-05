const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { windowsPowerShellPath } = require('../electron/system-launch.cjs');

for (const phase of ['ready', 'startup'])
  test(
    `owned processes terminate when Electron main crashes (${phase})`,
    {
      skip: process.platform !== 'win32',
      timeout: 65000,
    },
    async (t) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok crash lifetime '));
      const repo = path.resolve(__dirname, '..');
      const childFixture = path.join(__dirname, 'fixtures/crash-lifecycle-child.cjs');
      await fs.writeFile(
        path.join(directory, 'package.json'),
        JSON.stringify({
          scripts: { dev: `node "${childFixture}" runner "${directory}"` },
        }),
      );
      await fs.mkdir(path.join(directory, 'user-data'));
      const env = {
        ...process.env,
        GROK_CRASH_PROBE_DIR: directory,
        GROK_CRASH_PROBE_NODE: process.execPath,
        GROK_CRASH_PROBE_PHASE: phase,
      };
      delete env.ELECTRON_RUN_AS_NODE;
      try {
        const probe = spawn(
          windowsPowerShellPath(),
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(__dirname, 'fixtures/crash-lifecycle-probe.ps1'),
            '-ElectronPath',
            require('electron'),
            '-FixturePath',
            path.join(__dirname, 'fixtures/crash-lifecycle-app.cjs'),
            '-DirectoryPath',
            directory,
            '-RepoPath',
            repo,
          ],
          { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let output = '',
          diagnostic = '';
        probe.stdout.on('data', (chunk) => {
          output += chunk;
        });
        probe.stderr.on('data', (chunk) => {
          diagnostic += chunk;
        });
        const code = await new Promise((resolve, reject) => {
          probe.once('error', reject);
          probe.once('close', resolve);
        });
        const fixtureError = await fs
          .readFile(path.join(directory, 'error.txt'), 'utf8')
          .catch(() => '');
        assert.equal(code, 0, `${diagnostic}\n${fixtureError}\n${output}`);
        const report = JSON.parse(output.trim());
        t.diagnostic(JSON.stringify(report));
        assert.deepEqual(
          report.survivors,
          [],
          'owned terminal/runner processes survived Electron main crash',
        );
        if (phase === 'ready')
          assert.equal(
            report.externalSurvived,
            true,
            'an explicitly independent process must remain alive',
          );
      } finally {
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  );
