const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function fixture(request) {
  const source = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, '../src/lib.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const context = {
    exports: {},
    window: { desktop: { request } },
    setTimeout,
    clearTimeout,
    require: () => ({ translate: (key) => key, getLocale: () => 'zh-CN' }),
  };
  vm.runInNewContext(source, context);
  return context.exports;
}
test('stuck renderer reads time out but human dialogs and mutations stay pending until completion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = [];
  const lib = fixture(() => new Promise((resolve) => pending.push(resolve)));
  const reading = lib.request('workspace.read', {});
  const rejected = assert.rejects(reading, /等待超时/);
  t.mock.timers.tick(60000);
  await rejected;
  let settled = false;
  const mutating = lib.request('session.send', {}).then(() => {
    settled = true;
  });
  t.mock.timers.tick(180000);
  await Promise.resolve();
  assert.equal(settled, false);
  pending.at(-1)({ ok: true, data: {} });
  await mutating;
  const dialog = lib.request('dialog.grok', {});
  t.mock.timers.tick(180000);
  pending.at(-1)({ ok: true, data: null });
  assert.equal(await dialog, null);
});

test('recovery suggests the relevant user action without invoking or resending requests', () => {
  let requests = 0;
  const lib = fixture(() => {
    requests++;
  });
  assert.equal(typeof lib.classifyFailure, 'function');
  assert.equal(lib.classifyFailure('HTTP 401 Unauthorized').action, 'login');
  assert.equal(lib.classifyFailure('429 rate limit exceeded').action, 'usage');
  assert.equal(lib.classifyFailure('ECONNRESET').action, 'reconnect');
  assert.equal(lib.classifyFailure('Grok executable not found').action, 'settings');
  assert.equal(lib.classifyFailure('unexpected failure').action, 'retry');
  assert.equal(requests, 0);
});
