const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { releaseInfo, setStagingPercentage } = require('../scripts/stage-release.cjs');

const manifest = (version = '1.10.0') =>
  `version: ${version}\nfiles:\n  - url: Grok-Desktop-${version}-Setup.exe\n    sha512: test-integrity-data==\n    size: 12345\npath: Grok-Desktop-${version}-Setup.exe\nsha512: test-integrity-data==\nreleaseDate: '2026-10-05T00:00:00.000Z'\n`;

test('release tags select stable/latest or beta and must match the built package', () => {
  assert.deepEqual(releaseInfo('v1.10.0', '1.10.0'), {
    version: '1.10.0',
    channel: 'latest',
    manifest: 'latest.yml',
    prerelease: false,
  });
  assert.deepEqual(releaseInfo('v1.11.0-beta.2', '1.11.0-beta.2'), {
    version: '1.11.0-beta.2',
    channel: 'beta',
    manifest: 'beta.yml',
    prerelease: true,
  });
  assert.throws(() => releaseInfo('v1.10.0', '1.9.0'), /package version/i);
  for (const tag of [
    '1.10.0',
    'v01.10.0',
    'v1.10',
    'v1.10.0-alpha.1',
    'v1.10.0-beta',
    'v1.10.0-beta.01',
    'v1.10.0;other',
  ]) {
    assert.throws(() => releaseInfo(tag), /tag/i);
  }
});

for (const percentage of [0, 10, 100]) {
  test(`rollout ${percentage} changes only the rollout scalar and preserves installer metadata bytes`, () => {
    const source = manifest() + 'stagingPercentage: 50 # retain operator note\n';
    const result = setStagingPercentage(source, 'v1.10.0', 'latest.yml', percentage);
    assert.equal(result, manifest() + `stagingPercentage: ${percentage} # retain operator note\n`);
    assert.equal(
      setStagingPercentage(manifest(), 'v1.10.0', 'latest.yml', String(percentage)),
      manifest() + `stagingPercentage: ${percentage}\n`,
    );
  });
}

test('beta manifest and Windows newlines are preserved while updating rollout', () => {
  const source = manifest('1.11.0-beta.2').replaceAll('\n', '\r\n');
  assert.equal(
    setStagingPercentage(source, 'v1.11.0-beta.2', 'beta.yml', 10),
    source + 'stagingPercentage: 10\r\n',
  );
});

test('rollout refuses invalid percentages, different versions/channels and ambiguous metadata', () => {
  for (const value of [-1, 101, 0.5, '', '10\n100', 'garbage', NaN, Infinity]) {
    assert.throws(
      () => setStagingPercentage(manifest(), 'v1.10.0', 'latest.yml', value),
      /percentage/i,
    );
  }
  assert.throws(() => setStagingPercentage(manifest(), 'v1.11.0', 'latest.yml', 10), /version/i);
  assert.throws(() => setStagingPercentage(manifest(), 'v1.10.0', 'beta.yml', 10), /channel/i);
  assert.throws(
    () => setStagingPercentage(manifest('1.11.0-beta.2'), 'v1.11.0-beta.2', 'latest.yml', 10),
    /channel/i,
  );
  assert.throws(
    () => setStagingPercentage(manifest() + 'version: 1.10.0\n', 'v1.10.0', 'latest.yml', 10),
    /version/i,
  );
  assert.throws(
    () =>
      setStagingPercentage(
        manifest() + 'stagingPercentage: 10\nstagingPercentage: 20\n',
        'v1.10.0',
        'latest.yml',
        10,
      ),
    /stagingPercentage/,
  );
  assert.throws(
    () =>
      setStagingPercentage(
        manifest() + 'stagingPercentage: |\n  10\n',
        'v1.10.0',
        'latest.yml',
        10,
      ),
    /stagingPercentage/,
  );
});

test('CLI edits only the selected manifest and rejects mismatches before writing', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok release metadata '));
  try {
    const filename = path.join(directory, 'latest.yml');
    const installer = path.join(directory, 'Grok-Desktop-1.10.0-Setup.exe');
    await fs.writeFile(filename, manifest());
    await fs.writeFile(installer, Buffer.from([0, 255, 11, 42]));
    const script = path.resolve(__dirname, '../scripts/stage-release.cjs');
    const changed = spawnSync(process.execPath, [script, 'set', filename, 'v1.10.0', '10'], {
      encoding: 'utf8',
    });
    assert.equal(changed.status, 0, changed.stderr);
    const expected = manifest() + 'stagingPercentage: 10\n';
    assert.equal(await fs.readFile(filename, 'utf8'), expected);
    assert.deepEqual(await fs.readFile(installer), Buffer.from([0, 255, 11, 42]));
    const refused = spawnSync(process.execPath, [script, 'set', filename, 'v1.11.0', '100'], {
      encoding: 'utf8',
    });
    assert.equal(refused.status, 1);
    assert.equal(await fs.readFile(filename, 'utf8'), expected);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
