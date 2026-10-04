const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { SessionHub } = require('../electron/session-hub.cjs');
const { RuntimeActivity } = require('../electron/background.cjs');
const { isExecutableOpenTarget } = require('../electron/system-launch.cjs');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const ast = ts.createSourceFile('main.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function handler(name) {
  const variable = ast.statements
    .flatMap((node) => node.declarationList?.declarations || [])
    .find((node) => node.name?.text === 'handlers');
  return variable.initializer.properties
    .find((property) => property.name?.text === name)
    .initializer.getText(ast);
}
test('both system file routes confirm executable targets before opening them', async () => {
  const calls = [];
  let decision = 0;
  const context = {
    path,
    isExecutableOpenTarget,
    validCwd: async (cwd) => cwd,
    access: {
      project: (cwd) => ({ cwd, trusted: true }),
      file: async (filename) => filename,
      execution: () => ({ trusted: true }),
    },
    workspace: { resolveWorkspacePath: (cwd, file) => path.resolve(cwd, file) },
    fs: { stat: async () => ({ isFile: () => true }) },
    win: null,
    t: (value) => value,
    shell: {
      openPath: async (file) => {
        calls.push({ type: 'open', file });
        return '';
      },
    },
    dialog: {
      showMessageBox: async () => {
        calls.push({ type: 'confirm' });
        return { response: decision };
      },
    },
  };
  vm.createContext(context);
  for (const name of ['openLocalPath', 'openSystem']) {
    const declaration = ast.statements.find(
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
    );
    if (declaration) vm.runInContext(declaration.getText(ast), context);
  }
  for (const payload of [
    { target: 'file', path: path.resolve('inert.cmd') },
    { target: 'workspace-file', cwd: path.resolve('.'), path: 'inert.cmd' },
  ]) {
    calls.length = 0;
    await context.openSystem(payload);
    assert.deepEqual(
      calls.map((c) => c.type),
      ['confirm'],
    );
    decision = 1;
    calls.length = 0;
    await context.openSystem(payload);
    assert.deepEqual(
      calls.map((c) => c.type),
      ['confirm', 'open'],
    );
    decision = 0;
  }
});

test('project preparation prevents trust downgrade until its owned operation settles', async () => {
  const { projectKey } = require('../electron/access-policy.cjs');
  const cwd = path.resolve('.');
  let trusted = true,
    prompts = 0,
    release;
  const context = {
    projectKey,
    pendingProjectOperations: new Map(),
    externalProjectTerminals: new Set(),
    access: {
      project: () => ({ cwd, trusted }),
      setProjectTrust: (_, next) => ({ cwd, trusted: (trusted = next) }),
    },
    client: { listTasks: () => [], sessions: new Map() },
    terminals: { state: () => ({ status: 'exited' }) },
    runner: { state: () => ({ status: 'stopped' }) },
    dialog: {
      showMessageBox: async () => {
        prompts++;
        return { response: 0 };
      },
    },
    win: null,
    t: (value) => value,
    settings: { projectTrust: {} },
    saveSettings: async () => {},
    emit() {},
  };
  vm.createContext(context);
  for (const name of ['projectOperation', 'selectProjectTrust'])
    vm.runInContext(
      ast.statements
        .find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)
        .getText(ast),
      context,
    );
  const preparing = context.projectOperation(
    cwd,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(context.selectProjectTrust(cwd), /停止/);
  assert.equal(trusted, true);
  assert.equal(prompts, 0);
  release();
  await preparing;
  assert.equal((await context.selectProjectTrust(cwd)).trusted, false);
});

test('a live owned external project terminal blocks trust downgrade until its exit', async () => {
  const { EventEmitter } = require('node:events');
  const { projectKey } = require('../electron/access-policy.cjs');
  const cwd = path.resolve('.');
  let trusted = true;
  const child = new EventEmitter();
  Object.assign(child, { exitCode: null, signalCode: null, unref() {} });
  const context = {
    path,
    Buffer,
    projectKey,
    pendingProjectOperations: new Map(),
    externalProjectTerminals: new Set(),
    access: {
      project: () => ({ cwd, trusted }),
      setProjectTrust: (_, next) => ({ cwd, trusted: (trusted = next) }),
    },
    settings: { lastProject: cwd, grokPath: 'mock.exe', projectTrust: {} },
    client: { listTasks: () => [], sessions: new Map() },
    terminals: { state: () => ({ status: 'exited' }) },
    runner: { state: () => ({ status: 'stopped' }) },
    resolveGrok: () => 'mock.exe',
    windowsPowerShellPath: () => 'powershell.exe',
    spawn: () => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    win: null,
    t: (value) => value,
    saveSettings: async () => {},
    emit() {},
  };
  vm.createContext(context);
  for (const name of ['openSystem', 'selectProjectTrust'])
    vm.runInContext(
      ast.statements
        .find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)
        .getText(ast),
      context,
    );
  await context.openSystem({ target: 'terminal', cwd });
  await assert.rejects(context.selectProjectTrust(cwd), /停止/);
  assert.equal(trusted, true);
  child.exitCode = 0;
  child.emit('exit', 0);
  assert.equal((await context.selectProjectTrust(cwd)).trusted, false);
});
test('main send registers session ownership before asynchronous preparation so early cancellation cannot be lost', async () => {
  let releaseValidation,
    releasePreparation,
    sent = 0;
  const validation = new Promise((resolve) => {
    releaseValidation = resolve;
  });
  const preparation = new Promise((resolve) => {
    releasePreparation = resolve;
  });
  const hub = new SessionHub({
    emit() {},
    beforeTurn: () => preparation,
    createClient: () => ({
      connected: true,
      send: async () => {
        sent++;
      },
      dispose() {},
    }),
  });
  const entry = hub._entry('owned-session', path.resolve('.'));
  entry.snapshot = { sessionId: entry.sessionId, cwd: entry.cwd, updates: [] };
  const activity = new RuntimeActivity({ isForegroundBusy: () => !!hub.activeTurn });
  const send = vm.runInNewContext(handler('session.send'), {
    sessionAccess: (sessionId) => {
      assert.equal(sessionId, entry.sessionId);
      return entry;
    },
    activity,
    client: hub,
    validCwd: () => validation,
  });
  const outcome = send({
    sessionId: entry.sessionId,
    cwd: entry.cwd,
    text: 'must stay unsent',
  }).catch((error) => error);
  try {
    assert.ok(hub.activeTurn, 'the hub must own the pending send before yielding');
    await hub.cancel({ sessionId: entry.sessionId });
    releaseValidation(entry.cwd);
    releasePreparation();
    const result = await outcome;
    assert.match(result.message, /取消/);
    assert.equal(sent, 0);
  } finally {
    releaseValidation(entry.cwd);
    releasePreparation();
    await outcome;
    await hub.dispose();
  }
});
