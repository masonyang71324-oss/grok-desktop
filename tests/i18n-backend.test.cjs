const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { normalizeSettings, writeSettings, loadSettings } = require('../electron/settings.cjs');
const { createNotifications } = require('../electron/notifications.cjs');

test('settings default to Chinese, normalize unsupported languages, and persist English', async (t) => {
  assert.equal(normalizeSettings({}).language, 'zh-CN');
  assert.equal(normalizeSettings({ language: 'fr' }).language, 'zh-CN');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-language-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'settings.json');
  await writeSettings(filename, { language: 'en' });
  assert.equal(loadSettings(filename).language, 'en');
});

test('native notifications use the current language without translating task content', () => {
  const { setLocale } = require('../electron/i18n.cjs');
  const shown = [];
  class Notification extends EventEmitter {
    static isSupported() {
      return true;
    }
    constructor(options) {
      super();
      this.options = options;
    }
    show() {
      shown.push(this.options);
    }
    close() {}
  }
  const notifications = createNotifications({
    getWindow: () => ({ isDestroyed: () => false, isFocused: () => false, flashFrame() {} }),
    enabled: () => true,
    Notification,
  });
  try {
    setLocale('en');
    notifications.receive({ type: 'permission', params: { content: '用户原文' } });
    assert.equal(shown.at(-1).body, 'Grok needs your approval');
    notifications.receive({ type: 'turn-end' });
    assert.equal(shown.at(-1).body, 'Task completed');
    setLocale('zh-CN');
    notifications.receive({ type: 'turn-end', result: { stopReason: 'cancelled' } });
    assert.equal(shown.at(-1).body, '任务已停止');
    assert.doesNotMatch(JSON.stringify(shown), /用户原文/);
  } finally {
    setLocale('zh-CN');
  }
});

test('application errors and capability summaries translate while file names and server output remain unchanged', async () => {
  const { setLocale, translate } = require('../electron/i18n.cjs');
  const { resolveGrok } = require('../electron/settings.cjs');
  const { runCapability } = require('../electron/capabilities.cjs');
  try {
    setLocale('en');
    assert.throws(
      () => resolveGrok(path.join(os.tmpdir(), 'missing-grok-language.exe')),
      /Check its path in Settings/,
    );
    assert.equal(
      translate('工作树已创建：{path}', { path: 'D:/项目' }),
      'Worktree created: D:/项目',
    );
    const empty = await runCapability(
      { extension: async () => ({ result: { workflows: [] } }) },
      'workflow-list',
      { sessionId: 's' },
    );
    assert.equal(empty.text, 'This session has no workflows.');
    const populated = await runCapability(
      { extension: async () => ({ result: { workflows: [{ name: '中文用户工作流' }] } }) },
      'workflow-list',
      { sessionId: 's' },
    );
    assert.equal(populated.text, '中文用户工作流');
  } finally {
    setLocale('zh-CN');
  }
});
