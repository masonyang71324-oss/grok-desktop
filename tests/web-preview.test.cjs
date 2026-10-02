const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWebPreviewManager, validatePreviewUrl } = require('../electron/web-preview.cjs');
function fixture(directory) {
  let handler;
  class Contents extends EventEmitter {
    constructor() {
      super();
      this.navigationHistory = { canGoBack: () => false, canGoForward: () => false };
      this.sent = [];
      this.session = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} };
    }
    setWindowOpenHandler(fn) {
      this.popup = fn;
    }
    async loadURL(url) {
      this.url = url;
      this.emit('did-navigate', {}, url);
    }
    getURL() {
      return this.url || '';
    }
    getTitle() {
      return 'Preview test';
    }
    send(...args) {
      this.sent.push(args);
    }
    isDestroyed() {
      return false;
    }
    async capturePage() {
      return { isEmpty: () => false, toPNG: () => Buffer.from('test png bytes') };
    }
    close() {
      this.closed = true;
    }
    reload() {}
  }
  const windows = [],
    views = [],
    events = [];
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new Contents();
      this.contentView = { addChildView() {} };
      windows.push(this);
    }
    getContentSize() {
      return [900, 640];
    }
    async loadFile() {}
    show() {}
    focus() {}
    isDestroyed() {
      return !!this.closed;
    }
    close() {
      this.closed = true;
      this.emit('closed');
    }
  }
  class View {
    constructor(options) {
      this.options = options;
      this.webContents = new Contents();
      views.push(this);
    }
    setBounds(bounds) {
      this.bounds = bounds;
    }
  }
  const manager = createWebPreviewManager({
    BrowserWindow: Window,
    WebContentsView: View,
    ipcMain: {
      handle(_name, fn) {
        handler = fn;
      },
    },
    getParent: () => undefined,
    emit: (e) => events.push(e),
    attachmentsDirectory: directory,
    openExternal: async () => {},
  });
  return {
    manager,
    windows,
    views,
    events,
    request: (sender, payload) => handler({ sender }, payload),
  };
}
test('web preview rejects local files and scripts but supports local development URLs', () => {
  assert.equal(validatePreviewUrl('http://localhost:5173'), 'http://localhost:5173/');
  for (const input of [
    'file:///C:/secret',
    'javascript:alert(1)',
    'gopher://example.com',
    'not a URL',
  ])
    assert.throws(() => validatePreviewUrl(input));
});
test('capture preserves original draft identity and untrusted web content cannot invoke desktop actions', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const f = fixture(directory);
  t.after(() => f.manager.dispose());
  const owner = { sessionId: 's-a', cwd: 'C:/a', draftKey: 'session:s-a' };
  const opened = await f.manager.open({ url: 'http://localhost:5173', owner });
  owner.sessionId = 's-b';
  const refused = await f.request(f.views[0].webContents, { action: 'capture' });
  assert.equal(refused.ok, false);
  const result = await f.request(f.windows[0].webContents, { action: 'capture' });
  assert.equal(result.ok, true);
  assert.equal(f.events[0].type, 'preview-captured');
  assert.equal(f.events[0].owner.sessionId, 's-a');
  assert.equal(f.events[0].owner.draftKey, 'session:s-a');
  assert.equal(await fs.readFile(f.events[0].attachment.path, 'utf8'), 'test png bytes');
  assert.equal(f.views[0].options.webPreferences.nodeIntegration, false);
  assert.equal(f.views[0].options.webPreferences.sandbox, true);
  assert.equal(f.views[0].options.webPreferences.preload, undefined);
  assert.equal(f.manager.state({ id: opened.id }).url, 'http://localhost:5173/');
});
test('invalid navigation is blocked and closing preview closes the remote web contents', async (t) => {
  const f = fixture(os.tmpdir());
  t.after(() => f.manager.dispose());
  const opened = await f.manager.open({
    url: 'https://example.org',
    owner: { cwd: 'C:/a', draftKey: 'p-a' },
  });
  let blocked = false;
  f.views[0].webContents.emit(
    'will-navigate',
    {
      preventDefault() {
        blocked = true;
      },
    },
    'file:///C:/config',
  );
  assert.equal(blocked, true);
  await assert.rejects(f.manager.navigate({ id: opened.id, url: 'javascript:1' }));
  await f.manager.close({ id: opened.id });
  assert.equal(f.views[0].webContents.closed, true);
  assert.equal(f.manager.list().length, 0);
});

test('capture cancels before saving if the page navigates or closes while pixels are pending', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-race-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const f = fixture(directory);
  t.after(() => f.manager.dispose());
  const opened = await f.manager.open({
    url: 'https://example.org/old',
    owner: { cwd: 'C:/a', draftKey: 's-a' },
  });
  let pixels;
  f.views[0].webContents.capturePage = () =>
    new Promise((resolve) => {
      pixels = () => resolve({ isEmpty: () => false, toPNG: () => Buffer.from('image') });
    });
  const first = f.manager.capture({ id: opened.id });
  await assert.rejects(f.manager.capture({ id: opened.id }));
  await f.manager.navigate({ id: opened.id, url: 'https://example.org/new' });
  pixels();
  await assert.rejects(first);
  assert.deepEqual(await fs.readdir(directory), []);
  assert.equal(f.events.length, 0);
  const next = f.manager.capture({ id: opened.id });
  f.manager.close({ id: opened.id });
  pixels();
  await assert.rejects(next);
  assert.deepEqual(await fs.readdir(directory), []);
  assert.equal(f.events.length, 0);
});
