const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let runEngineUpdate;
try {
  ({ runEngineUpdate } = require('../electron/engine-update.cjs'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}
const exe = path.resolve('owned-grok', 'grok.exe');
function fixture(changes = {}) {
  const calls = [];
  let version = '1.0.52';
  const options = {
    executable: exe,
    expectedVersion: '1.0.70',
    stop: async () => calls.push('stop'),
    update: async () => {
      calls.push('update');
      version = '1.0.70';
      return { exitCode: 0, text: 'updated' };
    },
    repair: async (input) => {
      calls.push(['repair', input]);
      version = '1.0.70';
      return { status: 'installed', path: exe, version };
    },
    probe: async (filename) => {
      calls.push(['probe', filename]);
      return { exitCode: 0, stdout: `grok ${version} (fixture)` };
    },
    reconnect: async (result) => calls.push(['reconnect', result]),
    ...changes,
  };
  return {
    calls,
    options,
    setVersion: (next) => {
      version = next;
    },
  };
}
const run = (options) => {
  assert.equal(typeof runEngineUpdate, 'function', 'the verified update controller must exist');
  return runEngineUpdate(options);
};

test('verified update waits for owned engines to stop before any file-changing action', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({
    stop: async () => {
      f.calls.push('stop');
      await gate;
    },
  });
  const started = run(f.options);
  await Promise.resolve();
  assert.deepEqual(f.calls, ['stop']);
  release();
  const result = await started;
  assert.equal(result.path, exe);
  assert.equal(result.version, '1.0.70');
  assert.equal(result.repaired, false);
  assert.deepEqual(f.calls.slice(0, 3), ['stop', 'update', ['probe', exe]]);
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === 'repair').length, 0);
  assert.equal(f.calls.at(-1)[0], 'reconnect');
});

test('a failed self-update repairs once in the configured executable directory then verifies it', async () => {
  const original = new Error('replacing grok.exe: os error 2');
  const f = fixture({
    update: async () => {
      f.calls.push('update');
      throw original;
    },
  });
  const result = await run(f.options);
  assert.equal(result.repaired, true);
  assert.deepEqual(f.calls.find((call) => Array.isArray(call) && call[0] === 'repair')[1], {
    executable: exe,
    binDir: path.dirname(exe),
    version: '1.0.70',
  });
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === 'repair').length, 1);
  assert.deepEqual(f.calls.at(-2), ['probe', exe]);
  assert.equal(f.calls.at(-1)[1].version, '1.0.70');
});

test('zero exit with the old version is not success and invokes the repair path', async () => {
  const f = fixture({ update: async () => ({ exitCode: 0, text: 'nothing changed' }) });
  assert.equal((await run(f.options)).repaired, true);
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === 'repair').length, 1);
});

test('nonzero update results are repaired even if the command returned without throwing', async () => {
  const f = fixture({ update: async () => ({ exitCode: 1, text: 'failed' }) });
  assert.equal((await run(f.options)).repaired, true);
});

test('repair must actually install the target version, not just report installed', async () => {
  const f = fixture({
    update: async () => {
      throw new Error('original updater failed');
    },
    repair: async () => ({ status: 'installed', path: exe, version: '1.0.70' }),
  });
  await assert.rejects(run(f.options), (error) => {
    assert.equal(error.code, 'ENGINE_UPDATE_FAILED');
    assert.equal(error.engineVersion, '1.0.52');
    assert.match(error.message, /1\.0\.52/);
    assert.match(error.message, /original updater failed/);
    return true;
  });
  assert.equal(f.calls.at(-1)[0], 'reconnect');
  assert.equal(f.calls.at(-1)[1].recovery, true);
});

test('failed repair preserves both failures and reconnects only a verified surviving old engine', async () => {
  const updateError = new Error('self updater error');
  const repairError = new Error('official download failed');
  const f = fixture({
    update: async () => {
      throw updateError;
    },
    repair: async () => {
      throw repairError;
    },
  });
  await assert.rejects(run(f.options), (error) => {
    assert.equal(error.cause, updateError);
    assert.equal(error.repairError, repairError);
    assert.equal(error.engineVersion, '1.0.52');
    assert.match(error.message, /self updater error/);
    assert.match(error.message, /official download failed/);
    return true;
  });
  assert.equal(f.calls.at(-1)[1].recovery, true);
});

test('installer error states are failures, not installed results', async () => {
  const f = fixture({
    update: async () => {
      throw new Error('update error');
    },
    repair: async () => ({ status: 'error', error: 'installer stopped' }),
  });
  await assert.rejects(run(f.options), /installer stopped/);
});

test('an unavailable old engine is restored once and verified before reconnecting', async () => {
  let restored = false,
    restoreCalls = 0;
  const f = fixture({
    update: async () => {
      throw new Error('original update');
    },
    repair: async () => {
      throw new Error('repair failed');
    },
    probe: async () =>
      restored ? { exitCode: 0, stdout: 'grok 1.0.52' } : { exitCode: 1, stdout: '' },
    restore: async () => {
      restoreCalls++;
      restored = true;
    },
  });
  await assert.rejects(run(f.options), (error) => error.engineVersion === '1.0.52');
  assert.equal(restoreCalls, 1);
  assert.equal(f.calls.at(-1)[1].recovery, true);
});

test('missing or broken old binary never reconnects without successful verification', async () => {
  let reconnects = 0;
  const f = fixture({
    update: async () => {
      throw new Error('update failed');
    },
    repair: async () => {
      throw new Error('repair failed');
    },
    probe: async () => {
      throw new Error('missing');
    },
    reconnect: async () => {
      reconnects++;
    },
  });
  await assert.rejects(run(f.options), (error) => {
    assert.equal(error.engineVersion, undefined);
    assert.match(error.message, /无法确认引擎可用/);
    return true;
  });
  assert.equal(reconnects, 0);
});

test('a stop failure prevents update, repair and reconnect', async () => {
  const states = [];
  const f = fixture({
    onState: (state) => states.push(state.phase),
    stop: async () => {
      throw new Error('owned process still running');
    },
  });
  await assert.rejects(run(f.options), /owned process still running/);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(states, ['stopping', 'failed']);
});

test('a new engine reconnect failure does not re-run installation or restore the old binary', async () => {
  let repairs = 0,
    restores = 0;
  const f = fixture({
    repair: async () => {
      repairs++;
    },
    restore: async () => {
      restores++;
    },
    reconnect: async () => {
      throw new Error('ACP initialization failed');
    },
  });
  await assert.rejects(
    run(f.options),
    (error) => error.code === 'ENGINE_RECONNECT_FAILED' && error.engineVersion === '1.0.70',
  );
  assert.equal(repairs, 0);
  assert.equal(restores, 0);
});

test('invalid target versions are rejected before stopping any owned process', async () => {
  const f = fixture({ expectedVersion: 'latest; something' });
  await assert.rejects(run(f.options), /版本/);
  assert.deepEqual(f.calls, []);
});

test('stages expose actual update, repair, verification and reconnection progress', async () => {
  const states = [];
  const f = fixture({
    update: async () => {
      throw new Error('updater');
    },
    onState: (state) => states.push(state.phase),
  });
  await run(f.options);
  assert.deepEqual(states, [
    'stopping',
    'updating',
    'repairing',
    'verifying',
    'reconnecting',
    'ready',
  ]);
});
