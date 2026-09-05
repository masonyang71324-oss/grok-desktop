const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');

test('language switching translates UI templates and preserves arbitrary content and interpolation', () => {
  const compiled = buildSync({
    entryPoints: [path.join(__dirname, '../src/i18n.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['react'],
    write: false,
  }).outputFiles[0].text;
  const storage = new Map();
  const context = {
    module: { exports: {} },
    require,
    document: { documentElement: { lang: '' } },
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
  };
  vm.runInNewContext(compiled, context);
  const { translate: t, setLocale, getLocale } = context.module.exports;
  assert.equal(getLocale(), 'zh-CN');
  assert.equal(t('设置'), '设置');
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(context.document.documentElement.lang, 'en');
  assert.equal(t('设置'), 'Settings');
  assert.equal(
    t('已导出到 {path}', { path: 'C:\\项目\\$&{name}.md' }),
    'Exported to C:\\项目\\$&{name}.md',
  );
  const original = '用户的正文：console.log("中文");';
  assert.equal(t(original), original);
  setLocale('zh-CN');
  assert.equal(t('设置'), '设置');
  assert.equal(context.document.documentElement.lang, 'zh-CN');
});
