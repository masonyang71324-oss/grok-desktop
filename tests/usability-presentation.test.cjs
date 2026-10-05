const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadLib(locale = 'zh-CN') {
  const dictionary = { exports: {} };
  const dictionaryPath = path.join(__dirname, '../src/locales/usability-presentation.ts');
  if (fs.existsSync(dictionaryPath))
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync(dictionaryPath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }).outputText,
      dictionary,
    );
  const context = {
    exports: {},
    require: () => ({
      translate: (key) =>
        locale === 'en' ? dictionary.exports.usabilityPresentation?.[key] || key : key,
      getLocale: () => locale,
    }),
  };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  return context.exports;
}

test('system errors explain the distinct causes and preserve exact diagnostic text', () => {
  const lib = loadLib();
  assert.equal(typeof lib.describeSystemError, 'function');
  const cases = [
    ['EACCES', 'permission', /无法访问/, /权限.*占用|占用.*权限/],
    ['EPERM', 'permission', /无法访问/, /权限.*占用|占用.*权限/],
    ['EBUSY', 'busy', /正在使用|占用/, /关闭.*重试/],
    ['ENOSPC', 'space', /空间不足/, /清理|空间/],
    ['ENOENT', 'missing', /找不到/, /路径|移动|删除/],
  ];
  for (const [code, kind, title, action] of cases) {
    const raw = `保存失败：${code}: operation failed, open 'C:\\项目\\原始.txt'\nmore detail`;
    const result = lib.describeSystemError(raw);
    assert.equal(result.code, code);
    assert.equal(result.kind, kind);
    assert.match(result.title, title);
    assert.match(result.description, action);
    assert.equal(result.details, raw);
    assert.equal(lib.errorText(raw), raw);
    assert.equal(lib.notificationText(raw), result.summary);
    assert.equal(lib.classifyFailure(raw).kind, kind);
    assert.equal(lib.classifyFailure(raw).action, 'retry');
  }
});

test('English explanations remain readable while unknown errors and existing recovery classes survive', () => {
  const lib = loadLib('en');
  assert.equal(typeof lib.describeSystemError, 'function');
  assert.match(lib.describeSystemError('ENOSPC: no space left on device').title, /space/i);
  assert.match(
    lib.describeSystemError('EPERM: operation not permitted').description,
    /permission/i,
  );
  const unknown = 'The project returned an unfamiliar error\nraw details';
  assert.equal(lib.describeSystemError(unknown), null);
  assert.equal(lib.notificationText(unknown), unknown);
  assert.equal(lib.describeSystemError('myENOENTfile.txt'), null);
  assert.match(lib.notificationText('spawn grok ENOENT'), /Grok/);
  assert.doesNotMatch(lib.notificationText('spawn grok ENOENT'), /移动或删除/);
  for (const [raw, kind, action] of [
    ['HTTP 401 Unauthorized', 'auth', 'login'],
    ['429 rate limit exceeded', 'usage', 'usage'],
    ['ECONNRESET', 'connection', 'reconnect'],
    ['spawn grok ENOENT', 'setup', 'settings'],
  ]) {
    assert.equal(lib.classifyFailure(raw).kind, kind);
    assert.equal(lib.classifyFailure(raw).action, action);
  }
});

test('interface zoom normalization restores a usable value and keyboard steps retain the current range', () => {
  const { normalizeZoomPercent, stepZoomPercent } = require('../electron/interface-size.cjs');
  for (const [value, expected] of [
    [undefined, 100],
    [null, 100],
    ['125', 100],
    [NaN, 100],
    [Infinity, 100],
    [0, 25],
    [-10, 25],
    [750, 500],
    [124.6, 125],
    [110, 110],
    [150, 150],
  ])
    assert.equal(normalizeZoomPercent(value), expected);
  for (const [value, direction, expected] of [
    [100, 'in', 110],
    [110, 'in', 125],
    [125, 'in', 150],
    [125, 'out', 110],
    [100, 'out', 90],
    [133, 'in', 150],
    [133, 'out', 125],
    [25, 'out', 25],
    [500, 'in', 500],
    [undefined, 'in', 110],
  ])
    assert.equal(stepZoomPercent(value, direction), expected);
});
