const test = require('node:test');
const assert = require('node:assert/strict');
test('quick settings use only advertised effort values and the advertised recommendation', async () => {
  const { effortPresets } = await import('../src/effort-presets.mjs');
  const values = effortPresets({
    _meta: {
      reasoningEfforts: [
        { id: 'xhigh' },
        { id: 'high', default: true },
        { id: 'medium' },
        { id: 'low' },
      ],
    },
  });
  assert.deepEqual(
    values.map((x) => [x.id, x.value]),
    [
      ['quick', 'low'],
      ['standard', 'high'],
      ['deep', 'xhigh'],
    ],
  );
});
test('a model without extra-high effort never receives an invented quick-setting value', async () => {
  const { effortPresets } = await import('../src/effort-presets.mjs');
  assert.deepEqual(
    effortPresets({
      _meta: { reasoningEfforts: [{ id: 'high', default: true }, { id: 'medium' }, { id: 'low' }] },
    }).map((x) => x.value),
    ['low', 'high'],
  );
  assert.deepEqual(effortPresets({ _meta: { supportsReasoningEffort: false } }), []);
});
