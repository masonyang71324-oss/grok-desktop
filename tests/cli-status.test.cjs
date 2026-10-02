const test = require('node:test');
const assert = require('node:assert/strict');

test('CLI diagnostics distinguish successful cached catalogs from an authenticated account', async () => {
  const { readCliStatus } = require('../electron/cli-status.cjs');
  const run = async (_exe, args) => ({
    exitCode: 0,
    stdout:
      args[0] === '--version'
        ? 'grok 1.0.46 (test)'
        : 'You are not authenticated.\nDefault model: grok-4.6\nAvailable models:\n  * grok-4.6',
    stderr: 'refresh token secret should never be exposed',
  });
  const result = await readCliStatus('configured.exe', { run });
  assert.equal(result.version, '1.0.46');
  assert.equal(result.authStatus, 'required');
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('CLI diagnostics only report authenticated when the CLI confirms sign-in', async () => {
  const { readCliStatus } = require('../electron/cli-status.cjs');
  const run = async (_exe, args) => ({
    exitCode: 0,
    stdout:
      args[0] === '--version'
        ? 'grok 1.0.46 (test)'
        : 'You are logged in with grok.com.\nDefault model: grok-4.7',
    stderr: '',
  });
  assert.equal((await readCliStatus('configured.exe', { run })).authStatus, 'authenticated');
});

test('unknown CLI output never becomes a signed-in status', async () => {
  const { readCliStatus } = require('../electron/cli-status.cjs');
  const run = async (_exe, args) => ({
    exitCode: 0,
    stdout: args[0] === '--version' ? 'grok 1.0.46' : 'Available models: grok-4.7',
    stderr: '',
  });
  assert.equal((await readCliStatus('configured.exe', { run })).authStatus, 'unknown');
});

test('a rejected token overrides a cached signed-in banner', async () => {
  const { readCliStatus } = require('../electron/cli-status.cjs');
  const run = async (_exe, args) => ({
    exitCode: 0,
    stdout: args[0] === '--version' ? 'grok 1.0.46' : 'You are logged in with grok.com.',
    stderr: args[0] === 'models' ? 'OIDC refresh failed: invalid_grant' : '',
  });
  assert.equal((await readCliStatus('configured.exe', { run })).authStatus, 'required');
});

test('official update service errors are reported rather than shown as up to date', async () => {
  const { readCliStatus } = require('../electron/cli-status.cjs');
  const run = async (_exe, args) => ({
    exitCode: 0,
    stdout:
      args[0] === '--version'
        ? 'grok 1.0.46'
        : args[0] === 'models'
          ? 'You are logged in with grok.com.'
          : JSON.stringify({
              latestVersion: '1.0.46',
              updateAvailable: false,
              error: 'Service unavailable',
            }),
    stderr: '',
  });
  const result = await readCliStatus('configured.exe', { run, checkUpdate: true });
  assert.equal(result.updateAvailable, undefined);
  assert.ok(result.error);
});

test('engine update checks preserve auth status and honor official errors', async () => {
  const { readCliStatus } = require('../electron/cli-status.cjs');
  const run = async (_exe, args) => ({
    exitCode: 0,
    stdout:
      args[0] === '--version'
        ? 'grok 1.0.13'
        : args[0] === 'models'
          ? 'You are logged in with grok.com.'
          : JSON.stringify({
              currentVersion: '1.0.13',
              latestVersion: '1.0.46',
              updateAvailable: true,
              error: null,
            }),
    stderr: '',
  });
  const result = await readCliStatus('configured.exe', { run, checkUpdate: true });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestVersion, '1.0.46');
  assert.equal(result.authStatus, 'authenticated');
});

test('a network failure cannot erase a successful sign-in or leak CLI diagnostics', async () => {
  const { readCliStatus } = require('../electron/cli-status.cjs');
  const run = async (_exe, args) =>
    args[0] === 'update'
      ? { exitCode: 1, stdout: '', stderr: 'Authorization: secret' }
      : {
          exitCode: 0,
          stdout: args[0] === '--version' ? 'grok 1.0.46' : 'You are logged in with grok.com.',
          stderr: '',
        };
  const result = await readCliStatus('configured.exe', { run, checkUpdate: true });
  assert.equal(result.authStatus, 'authenticated');
  assert.equal(result.updateAvailable, undefined);
  assert.ok(result.error);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('redirected official updates select the new binary and reject an unchanged old binary', async () => {
  const { selectUpdatedCli } = require('../electron/cli-status.cjs');
  const versions = new Map([
    ['old.exe', '1.0.13'],
    ['official.exe', '1.0.46'],
  ]);
  const run = async (exe) => ({ exitCode: 0, stdout: 'grok ' + versions.get(exe), stderr: '' });
  assert.equal(
    await selectUpdatedCli('old.exe', 'official.exe', '1.0.46', { run }),
    'official.exe',
  );
  assert.equal(
    await selectUpdatedCli('official.exe', 'old.exe', '1.0.46', { run }),
    'official.exe',
  );
  await assert.rejects(selectUpdatedCli('old.exe', 'old.exe', '1.0.46', { run }));
});
