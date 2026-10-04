const test = require('node:test');
const assert = require('node:assert/strict');
test('failed engine updates preserve the original failure and report a locally verified surviving version', async () => {
  const { withUpdateHealth } = require('../electron/update-health.cjs');
  const error = Object.assign(new Error('download interrupted'), { code: 'ETIMEDOUT' });
  await assert.rejects(
    withUpdateHealth(
      'grok.exe',
      async () => {
        throw error;
      },
      async () => ({ exitCode: 0, stdout: '1.0.46 (local)' }),
    ),
    (result) =>
      result.code === 'ETIMEDOUT' &&
      /1.0.46/.test(result.message) &&
      /download interrupted/.test(result.message),
  );
});
test('failed engine probes direct the user to reinstall without retrying an update', async () => {
  const { withUpdateHealth } = require('../electron/update-health.cjs');
  let updates = 0;
  await assert.rejects(
    withUpdateHealth(
      'grok.exe',
      async () => {
        updates++;
        throw new Error('original failure');
      },
      async () => {
        throw new Error('missing executable');
      },
    ),
    /重新安装|reinstall/i,
  );
  assert.equal(updates, 1);
});
