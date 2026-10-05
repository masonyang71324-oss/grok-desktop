const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('native folder drops require confirmation and never become attachments', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grok native drop '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'project');
  const file = path.join(root, 'note.txt');
  await fs.mkdir(folder);
  await fs.writeFile(file, 'owned fixture');
  const { resolveNativeDrop } = require('../electron/native-drop.cjs');
  let answer = null;
  const selected = [],
    registered = [];
  const options = {
    selectProject: async (directory) => {
      selected.push(directory);
      return answer;
    },
    registerFiles: async (files) => {
      registered.push(...files);
      return files;
    },
  };
  const directory = { path: folder, name: 'project' };
  assert.deepEqual(await resolveNativeDrop([directory], options), { files: [] });
  assert.deepEqual(registered, []);
  answer = await fs.realpath(folder);
  assert.deepEqual(await resolveNativeDrop([directory], options), {
    files: [],
    projectPath: answer,
  });
  assert.equal(selected.length, 2);
  assert.deepEqual(await resolveNativeDrop([{ path: file, name: 'note.txt' }], options), {
    files: [{ path: file, name: 'note.txt' }],
  });
  assert.equal(registered.length, 1);
  await assert.rejects(
    resolveNativeDrop([directory, { path: file, name: 'note.txt' }], options),
    /单独|separately/,
  );
  await assert.rejects(resolveNativeDrop([directory, directory], options), /单独|separately/);
  assert.equal(selected.length, 2, 'mixed drops cannot silently select a project');
  assert.equal(registered.length, 1, 'mixed drops cannot partially attach files');
});

test('notification clicks preserve the origin even when permission IDs match', () => {
  const { EventEmitter } = require('node:events');
  const { createNotifications } = require('../electron/notifications.cjs');
  const shown = [],
    targets = [];
  const win = {
    isDestroyed: () => false,
    isFocused: () => false,
    isMinimized: () => true,
    flashFrame() {},
    restore() {},
    show() {},
    focus() {},
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
    close() {}
  }
  const notifications = createNotifications({
    getWindow: () => win,
    enabled: () => true,
    Notification,
    onNavigate: (target) => targets.push(target),
  });
  notifications.receive({
    type: 'permission',
    sessionId: 'alpha',
    requestId: 1,
    params: { rawInput: 'PRIVATE' },
  });
  const alpha = shown[0];
  notifications.receive({ type: 'permission', sessionId: 'beta', requestId: 1 });
  shown[1].emit('click');
  alpha.emit('click');
  assert.deepEqual(targets, [
    { sessionId: 'beta', requestId: 1 },
    { sessionId: 'alpha', requestId: 1 },
  ]);
  assert.doesNotMatch(JSON.stringify(shown.map((n) => n.options)), /PRIVATE|alpha|beta/);
  notifications.receive({ type: 'task-finished', sessionId: 'gamma', status: 'completed' });
  shown.at(-1).emit('click');
  assert.deepEqual(targets.at(-1), { sessionId: 'gamma' });
  notifications.receive({
    type: 'app-update',
    state: { status: 'available', availableVersion: '1.9.0' },
  });
  shown.at(-1).emit('click');
  assert.equal(
    targets.length,
    3,
    'update notifications do not navigate to an unrelated conversation',
  );
});

test('native project confirmation preserves cancellation and existing read-only trust', async (t) => {
  const { createAccessPolicy, projectKey } = require('../electron/access-policy.cjs');
  const vm = require('node:vm');
  const ts = require('typescript');
  const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8');
  const ast = ts.createSourceFile(
    'main.cjs',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const declaration = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'selectDroppedProject',
  );
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok dropped trust '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const other = path.join(directory, 'other');
  await fs.mkdir(other);
  const access = createAccessPolicy();
  let response = 2;
  const saves = [];
  const context = {
    access,
    projectKey,
    win: null,
    settings: { projectTrust: {} },
    t: (x) => x,
    dialog: { showMessageBox: async () => ({ response }) },
    saveSettings: async (patch) => {
      saves.push(patch);
      context.settings = { ...context.settings, ...patch };
    },
  };
  vm.createContext(context);
  vm.runInContext(declaration.getText(ast), context);
  assert.equal(await context.selectDroppedProject(directory), null);
  assert.throws(() => access.project(directory));
  assert.equal(saves.length, 0);
  response = 0;
  const selected = await context.selectDroppedProject(directory);
  assert.equal(access.project(selected).trusted, false);
  response = 1;
  assert.equal(await context.selectDroppedProject(directory), null);
  assert.equal(access.project(selected).trusted, false);
  assert.equal(saves.length, 1);
  const trusted = await context.selectDroppedProject(other);
  assert.equal(access.project(trusted).trusted, true);
  assert.equal(context.settings.projectTrust[projectKey(trusted)], true);
});
