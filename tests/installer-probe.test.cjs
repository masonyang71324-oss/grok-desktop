const { test } = require('node:test');
const assert = require('node:assert/strict');
const { waitForExit } = require('../scripts/verify-clean-cli-install.cjs');

test('installer verification trusts recorded child exit instead of a reused numeric PID', async () => {
  // The live current PID stands in for another process reusing an exited child's ID.
  await waitForExit([{ pid: process.pid, exitCode: 0, signalCode: null }]);
  await waitForExit([{ pid: process.pid, exitCode: null, signalCode: 'SIGTERM' }]);
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});
