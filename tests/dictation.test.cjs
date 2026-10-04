const { test } = require('node:test');
const assert = require('node:assert/strict');
const { launchDictation } = require('../electron/dictation.cjs');
test('dictation launches only the Windows helper, waits for its result and propagates failure', async () => {
  const calls = [];
  const result = await launchDictation({
    platform: 'win32',
    run: async (executable, args, options) => {
      calls.push({ executable, args, options });
      return { exitCode: 0, stderr: '' };
    },
  });
  assert.equal(result.method, 'windows-voice-typing');
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].executable,
    /^[A-Z]:\\.*\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i,
  );
  assert.ok(calls[0].args.includes('-File'));
  assert.ok(calls[0].args.at(-1).endsWith('voice-typing.ps1'));
  await assert.rejects(
    launchDictation({
      platform: 'linux',
      run: async () => {
        throw Error('must not run');
      },
    }),
    /Windows/,
  );
  await assert.rejects(
    launchDictation({ platform: 'win32', run: async () => ({ exitCode: 1, stderr: 'denied' }) }),
    /denied/,
  );
});
