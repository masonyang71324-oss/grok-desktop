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
