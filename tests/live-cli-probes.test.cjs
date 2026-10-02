const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('live verification disposes its owned CLI when temporary session deletion fails', async () => {
  let disposed = false,
    removed = false;
  class ProbeClient {
    constructor() {
      this._proc = null;
      this._request = async () => ({});
    }
    async newSession() {
      return { sessionId: 'owned-probe-session', models: { availableModels: [] } };
    }
    async rename() {
      throw new Error('primary verification failed');
    }
    async deleteSession() {
      throw new Error('temporary deletion failed');
    }
    dispose() {
      disposed = true;
    }
  }
  const contextModule = { exports: {} };
  const isolatedRequire = (name) => {
    if (name === '../electron/acp.cjs') return { GrokClient: ProbeClient };
    if (name === '../electron/settings.cjs')
      return {
        resolveGrok: () => {
          throw new Error('Must not inspect a real CLI');
        },
      };
    if (name === 'node:fs/promises')
      return {
        mkdtemp: async () => path.join(require('node:os').tmpdir(), 'owned-probe-fixture'),
        rm: async () => {
          removed = true;
        },
      };
    return require(name);
  };
  isolatedRequire.main = {};
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../scripts/verify-live-session.cjs'), 'utf8'),
    {
      module: contextModule,
      require: isolatedRequire,
      __dirname: path.join(__dirname, '../scripts'),
      process,
      console,
      setTimeout,
      clearTimeout,
      Buffer,
    },
  );
  await assert.rejects(contextModule.exports.verifyLiveSession(), /temporary deletion failed/);
  assert.equal(
    disposed,
    true,
    'The verifier must dispose its owned client even when deleting the temporary session rejects.',
  );
  assert.equal(removed, false, 'Keep the failed-deletion workspace available for recovery.');
});
