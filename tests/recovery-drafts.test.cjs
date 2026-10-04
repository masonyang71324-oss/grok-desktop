const test = require('node:test');
const assert = require('node:assert/strict');

function storageFixture() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('continuous typing persists the latest draft within one second and then trailing edits', async (t) => {
  const { createDraftStore } = await import('../src/drafts.mjs');
  const storage = storageFixture(),
    persisted = [];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = createDraftStore(
    storage,
    () => assert.fail('unexpected storage error'),
    () => {
      persisted.push(createDraftStore(storage).read('C:/project', 's').text);
    },
  );
  for (let i = 0; i < 5; i++) {
    store.save('C:/project', 's', { text: `edit ${i}`, attachments: [] }, true);
    t.mock.timers.tick(200);
  }
  assert.deepEqual(persisted, ['edit 4']);
  store.save('C:/project', 's', { text: 'last', attachments: [] }, true);
  t.mock.timers.tick(299);
  assert.deepEqual(persisted, ['edit 4']);
  t.mock.timers.tick(1);
  assert.deepEqual(persisted, ['edit 4', 'last']);
});

test('explicit flush saves a pending draft before requesting disk persistence', async (t) => {
  const { createDraftStore } = await import('../src/drafts.mjs');
  const storage = storageFixture(),
    persisted = [];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = createDraftStore(storage, undefined, () =>
    persisted.push(createDraftStore(storage).read('C:/project', 's').text),
  );
  store.save('C:/project', 's', { text: 'switching session', attachments: [] }, true);
  assert.equal(storage.getItem('grok-desktop-drafts'), null);
  store.flush();
  assert.deepEqual(persisted, ['switching session']);
  t.mock.timers.tick(1500);
  assert.deepEqual(persisted, ['switching session']);
});

test('failed storage writes never report persistence success', async () => {
  const { createDraftStore } = await import('../src/drafts.mjs');
  let errors = 0,
    persisted = 0;
  const store = createDraftStore(
    {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    },
    () => errors++,
    () => persisted++,
  );
  store.save('C:/project', 's', { text: 'keep in memory', attachments: [] });
  assert.equal(errors, 1);
  assert.equal(persisted, 0);
  assert.equal(store.read('C:/project', 's').text, 'keep in memory');
});
