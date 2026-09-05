const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createEventDelivery } = require('../electron/event-delivery.cjs');
const { createNotifications } = require('../electron/notifications.cjs');
const { createLogger } = require('../electron/logger.cjs');
const { normalizeSettings, resolveGrok } = require('../electron/settings.cjs');

test('stream batches preserve chunk order and flush before permission/completion', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const received = [];
  const delivery = createEventDelivery((event) => received.push(event));
  const chunk = (text) => ({
    type: 'update',
    update: { sessionUpdate: 'agent_message_chunk', content: { text } },
  });
  delivery.push(chunk('A'));
  delivery.push(chunk('B'));
  assert.equal(received.length, 0);
  delivery.push({ type: 'permission', requestId: 'p' });
  assert.deepEqual(
    received.map((event) => event.type),
    ['event-batch', 'permission'],
  );
  assert.deepEqual(
    received[0].events.map((event) => event.update.content.text),
    ['A', 'B'],
  );
  delivery.push(chunk('C'));
  t.mock.timers.tick(16);
  assert.equal(received[2].events[0].update.content.text, 'C');
  delivery.push(chunk('D'));
  delivery.push({ type: 'turn-end' });
  assert.equal(received.at(-2).events[0].update.content.text, 'D');
  assert.equal(received.at(-1).type, 'turn-end');
  delivery.dispose();
  t.mock.timers.tick(100);
  assert.equal(received.length, 5);
});

test('notifications only alert in the background and clear on focus without task content', () => {
  let focused = true,
    enabled = true;
  const flashes = [],
    shown = [];
  const win = {
    isDestroyed: () => false,
    isFocused: () => focused,
    flashFrame: (value) => flashes.push(value),
    isMinimized: () => false,
    show() {},
    focus() {
      focused = true;
    },
  };
  class Notification extends EventEmitter {
    static isSupported() {
      return true;
    }
    constructor(options) {
      super();
      this.options = options;
    }
    show() {
      shown.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  const notifications = createNotifications({
    getWindow: () => win,
    enabled: () => enabled,
    Notification,
  });
  notifications.receive({ type: 'permission' });
  assert.equal(shown.length, 0);
  focused = false;
  notifications.receive({ type: 'permission', params: { rawInput: 'PRIVATE TASK' } });
  assert.equal(shown[0].options.body, 'Grok 需要你批准一项操作');
  assert.equal(JSON.stringify(shown[0].options).includes('PRIVATE'), false);
  assert.equal(flashes.at(-1), true);
  shown[0].emit('click');
  assert.equal(focused, true);
  assert.equal(flashes.at(-1), false);
  assert.equal(shown[0].closed, true);
  focused = false;
  enabled = false;
  notifications.receive({ type: 'turn-end' });
  assert.equal(shown.length, 1);
  enabled = true;
  notifications.receive({ type: 'turn-error', message: 'SECRET' });
  assert.equal(shown[1].options.body, '任务遇到问题，请返回查看');
  notifications.clear();
});

test('operational logs rotate and omit unapproved content fields', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-logs-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const logger = createLogger(directory, 200);
  for (let i = 0; i < 8; i++)
    logger.log('request-failed', {
      command: 'session.send',
      code: 'Error',
      prompt: 'PRIVATE PROMPT',
      path: 'PRIVATE PATH',
      error: 'PRIVATE ERROR',
      durationMs: i,
    });
  await logger.flush();
  const files = await fs.readdir(directory);
  assert.ok(files.includes('desktop.log.2'));
  assert.equal(files.length, 3);
  for (const file of files) {
    const text = await fs.readFile(path.join(directory, file), 'utf8');
    assert.doesNotMatch(text, /PRIVATE/);
    for (const line of text.trim().split('\n'))
      assert.equal(JSON.parse(line).command, 'session.send');
  }
});

test('settings retain UI/window preferences and resolve GROK_HOME without a personal drive', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-path-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'bin'));
  const executable = path.join(directory, 'bin', 'grok.exe');
  await fs.writeFile(executable, 'fixture');
  const before = process.env.GROK_HOME;
  process.env.GROK_HOME = directory;
  t.after(() => {
    if (before === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = before;
  });
  assert.equal(resolveGrok(''), executable);
  assert.throws(() => resolveGrok(directory), /路径/);
  const settings = normalizeSettings({
    notifications: false,
    ui: { sidebar: false, inspector: false, inspectorTab: 'changes' },
    window: { x: -1200, y: 20, width: 1000, height: 750, maximized: true },
  });
  assert.equal(settings.notifications, false);
  assert.equal(settings.ui.inspectorTab, 'changes');
  assert.equal(settings.window.x, -1200);
  assert.equal(settings.window.maximized, true);
});

test('draft keystrokes debounce disk serialization while flush and session switches save immediately', async (t) => {
  const { createDraftStore } = await import('../src/drafts.mjs');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = [];
  const storage = { getItem: () => null, setItem: (key, value) => writes.push(JSON.parse(value)) };
  const store = createDraftStore(storage);
  for (const text of ['a', 'ab', 'abc'])
    store.save('C:/project', 'a', { text, attachments: [] }, true);
  assert.equal(writes.length, 0);
  assert.equal(store.read('C:/project', 'a').text, 'abc');
  t.mock.timers.tick(299);
  assert.equal(writes.length, 0);
  t.mock.timers.tick(1);
  assert.equal(writes.length, 1);
  store.save('C:/project', 'a', { text: 'latest', attachments: [] }, true);
  store.flush();
  assert.equal(writes.length, 2);
  assert.equal(Object.values(writes[1].drafts)[0].text, 'latest');
  store.save('C:/project', 'b', { text: 'other', attachments: [] }, true);
  store.select('C:/project', 'b');
  assert.equal(writes.length, 3);
  t.mock.timers.tick(300);
  assert.equal(writes.length, 3);
});
