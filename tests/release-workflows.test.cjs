const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { windowsPowerShellPath } = require('../electron/system-launch.cjs');

async function runStep(workflow, stepName, variables, { existing = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok workflow fixture '));
  try {
    const document = yaml.load(
      await fs.readFile(path.resolve(__dirname, '../.github/workflows', workflow), 'utf8'),
    );
    const step = Object.values(document.jobs)
      .flatMap((job) => job.steps)
      .find((item) => item.name === stepName);
    assert.ok(step?.run);
    await fs.mkdir(path.join(directory, 'scripts'));
    await fs.copyFile(
      path.resolve(__dirname, '../scripts/stage-release.cjs'),
      path.join(directory, 'scripts/stage-release.cjs'),
    );
    const driver = path.join(directory, 'driver.ps1');
    await fs.writeFile(
      driver,
      `
$ErrorActionPreference = 'Stop'
$script:RecordedCalls = [System.Collections.Generic.List[object]]::new()
function gh {
  $script:RecordedCalls.Add([string[]]@($args | ForEach-Object { $_ }))
  $global:LASTEXITCODE = 0
  switch ($args[1]) {
    'view' {
      if ($env:EXISTING_RELEASE -eq 'false') { $global:LASTEXITCODE = 1; return }
      ConvertTo-Json -Compress @{ tagName=$env:RELEASE_TAG; isPrerelease=($env:RELEASE_PRERELEASE -eq 'true') }
    }
    'download' {
      $null = New-Item -ItemType Directory -Path rollout
      [System.IO.File]::WriteAllText((Join-Path $pwd "rollout/$env:RELEASE_MANIFEST"), "version: $env:RELEASE_VERSION\nfiles:\n  - url: original.exe\n    sha512: original-integrity==\n    size: 123\n")
    }
    { $_ -in 'upload','edit','create' } { }
    default { throw 'Unexpected GitHub operation' }
  }
}
try {
${step.run}
} finally {
  [System.IO.File]::WriteAllText($env:RECORDED_CALLS, (ConvertTo-Json -InputObject $script:RecordedCalls.ToArray() -Depth 5))
}
`,
    );
    const callsPath = path.join(directory, 'calls.json');
    const result = spawnSync(
      windowsPowerShellPath(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', driver],
      {
        cwd: directory,
        encoding: 'utf8',
        windowsHide: true,
        env: {
          ...process.env,
          ...variables,
          EXISTING_RELEASE: String(existing),
          RECORDED_CALLS: callsPath,
          GITHUB_REPOSITORY: 'fixture/fixture',
          GITHUB_STEP_SUMMARY: path.join(directory, 'summary'),
        },
      },
    );
    const calls = JSON.parse(await fs.readFile(callsPath, 'utf8'));
    const manifest = await fs
      .readFile(path.join(directory, 'rollout', variables.RELEASE_MANIFEST), 'utf8')
      .catch(() => null);
    return { ...result, calls, manifest };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test(
  'staged workflow uploads only the selected beta manifest and never recreates a release',
  { skip: process.platform !== 'win32' },
  async () => {
    const result = await runStep(
      'staged-rollout.yml',
      'Update only the existing channel manifest',
      {
        RELEASE_TAG: 'v1.11.0-beta.2',
        RELEASE_VERSION: '1.11.0-beta.2',
        RELEASE_MANIFEST: 'beta.yml',
        RELEASE_PRERELEASE: 'true',
        STAGING_PERCENTAGE: '10',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.calls.map((call) => call.slice(0, 2)),
      [
        ['release', 'view'],
        ['release', 'download'],
        ['release', 'upload'],
      ],
    );
    assert.deepEqual(result.calls[2], [
      'release',
      'upload',
      'v1.11.0-beta.2',
      'rollout\\beta.yml',
      '--clobber',
      '--repo',
      'fixture/fixture',
    ]);
    assert.equal(
      result.manifest,
      'version: 1.11.0-beta.2\nfiles:\n  - url: original.exe\n    sha512: original-integrity==\n    size: 123\nstagingPercentage: 10\n',
    );
  },
);

test(
  'invalid rollout input prevents the workflow from uploading anything',
  { skip: process.platform !== 'win32' },
  async () => {
    const result = await runStep(
      'staged-rollout.yml',
      'Update only the existing channel manifest',
      {
        RELEASE_TAG: 'v1.10.0',
        RELEASE_VERSION: '1.10.0',
        RELEASE_MANIFEST: 'latest.yml',
        RELEASE_PRERELEASE: 'false',
        STAGING_PERCENTAGE: '101',
      },
    );
    assert.equal(result.status, 1);
    assert.equal(
      result.calls.some((call) => call[1] === 'upload'),
      false,
    );
  },
);

for (const prerelease of [false, true])
  for (const existing of [false, true])
    test(
      `${existing ? 'existing' : 'new'} publication flags select ${prerelease ? 'beta prerelease' : 'stable latest'}`,
      { skip: process.platform !== 'win32' },
      async () => {
        const version = prerelease ? '1.11.0-beta.2' : '1.10.0';
        const result = await runStep(
          'release.yml',
          'Publish release',
          {
            GITHUB_REF_NAME: `v${version}`,
            RELEASE_TAG: `v${version}`,
            RELEASE_VERSION: version,
            RELEASE_MANIFEST: prerelease ? 'beta.yml' : 'latest.yml',
            RELEASE_PRERELEASE: String(prerelease),
          },
          { existing },
        );
        assert.equal(result.status, 0, result.stderr);
        const edit = result.calls.find((call) => call[1] === (existing ? 'edit' : 'create'));
        assert.ok(edit.includes(prerelease ? '--prerelease' : '--prerelease=false'));
        assert.ok(edit.includes(prerelease ? '--latest=false' : '--latest'));
        const upload = result.calls.find((call) => call[1] === (existing ? 'upload' : 'create'));
        assert.ok(upload.includes(prerelease ? 'release/beta.yml' : 'release/latest.yml'));
      },
    );
