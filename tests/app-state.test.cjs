'use strict';
// Fast state-machine harness with simulated hooks and ACP; it does not reproduce
// React scheduling/layout. Keep hooks in a consistent order within each render.
// The separate test:e2e suite covers the real React/Electron main/preload boundary.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const root = path.join(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
const { GrokClient } = require(path.join(root, 'electron/acp.cjs'));
const cwd = 'C:\\fake-project';
const models = { currentModelId: 'grok', availableModels: [{ modelId: 'grok', name: 'Grok' }] };
const settings = {
  grokPath: '',
  theme: 'dark',
  modelId: '',
  effort: '',
  permissionMode: 'ask',
  recentProjects: [cwd],
  lastProject: cwd,
};
const summaries = ['session-a', 'session-b'].map((sessionId) => ({
  sessionId,
  cwd,
  title: sessionId,
}));
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() {
  for (let i = 0; i < 15; i++) await tick();
}
const storageFixture = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
};

async function fixture(
  storage = storageFixture(),
  { filterEmptySessions = false, lastProject = cwd } = {},
) {
  let listener,
    index = 0,
    renderQueued = false,
    view,
    App,
    stopped = false,
    sendFailure,
    loadOverride;
  let currentFakeSession = '',
    createdSessions = 0;
  const fakeSummaries = summaries.map((item) => ({ ...item }));
  const hookSlots = [],
    effectSlots = [],
    effects = [],
    requests = [],
    rpc = [],
    children = [];
  function schedule() {
    if (!renderQueued && !stopped) {
      renderQueued = true;
      queueMicrotask(render);
    }
  }
  const react = {
    lazy: () => () => null,
    useState(initial) {
      const slot = index++;
      if (!(slot in hookSlots)) hookSlots[slot] = initial;
      return [
        hookSlots[slot],
        (value) => {
          hookSlots[slot] = typeof value === 'function' ? value(hookSlots[slot]) : value;
          schedule();
        },
      ];
    },
    useRef(initial) {
      const slot = index++;
      return (hookSlots[slot] ||= { current: initial });
    },
    useCallback(callback) {
      index++;
      return callback;
    },
    useEffect(callback, deps) {
      const slot = index++;
      const prior = effectSlots[slot];
      if (!prior || deps.some((value, i) => !Object.is(prior[i], value))) {
        effectSlots[slot] = deps;
        effects.push(callback);
      }
    },
  };
  function render() {
    if (stopped) return;
    renderQueued = false;
    index = 0;
    view = App();
    for (const effect of effects.splice(0)) effect();
  }
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    child.deliver = (message) => child.stdout.write(JSON.stringify(message) + '\n');
    child.reply = (req, result) => child.deliver({ jsonrpc: '2.0', id: req.id, result });
    child.stdin = new Writable({
      write(data, enc, done) {
        for (const line of data.toString().trim().split('\n')) {
          const req = JSON.parse(line);
          rpc.push(req);
          queueMicrotask(() => {
            if (!req.method || !req.id) return;
            if (req.method === 'initialize')
              child.reply(req, {
                protocolVersion: 1,
                agentCapabilities: { promptCapabilities: { embeddedContext: true } },
                _meta: { modelState: models },
              });
            else if (req.method === '_x.ai/commands/list') child.reply(req, { commands: [] });
            else if (req.method === 'session/list')
              child.reply(req, {
                sessions: filterEmptySessions
                  ? fakeSummaries.filter((item) => item.sessionId === currentFakeSession)
                  : fakeSummaries,
              });
            else if (req.method === 'session/new') {
              currentFakeSession = filterEmptySessions
                ? summaries[createdSessions++].sessionId
                : 'session-a';
              child.reply(req, { sessionId: currentFakeSession, models });
            } else if (req.method === 'session/load') {
              currentFakeSession = req.params.sessionId;
              child.reply(req, { models });
            } else if (req.method === '_x.ai/session/rename') {
              fakeSummaries.find((item) => item.sessionId === req.params.sessionId).title =
                req.params.title;
              child.reply(req, { success: true });
            } else if (req.method === '_x.ai/session/delete') {
              const index = fakeSummaries.findIndex(
                (item) => item.sessionId === req.params.sessionId,
              );
              if (index >= 0) fakeSummaries.splice(index, 1);
              child.reply(req, { success: true });
            } else if (req.method === 'session/prompt') child.prompt = req;
            else child.reply(req, {});
          });
        }
        done();
      },
    });
    children.push(child);
    return child;
  };
  const client = new GrokClient({
    getExecutable: () => 'fake.exe',
    spawnFn,
    emit(event) {
      queueMicrotask(() => listener?.(event));
    },
  });
  const request = async (command, payload) => {
    requests.push({ command, payload });
    await Promise.resolve();
    if (command === 'bootstrap') {
      await client.ensure();
      return {
        settings: { ...settings, lastProject },
        version: '1.4.1',
        update: { mode: 'development', status: 'unsupported', currentVersion: '1.4.1' },
        cli: { connected: true },
        models: client.models,
        commands: [],
      };
    }
    if (command === 'project.open')
      return { cwd: payload.cwd, sessions: await client.listSessions(payload) };
    if (command === 'sessions.list') return client.listSessions(payload);
    if (command === 'tasks.list') return [];
    if (command === 'session.enqueue') return { queueId: 'queued-1' };
    if (command === 'session.load')
      return loadOverride ? loadOverride(payload) : client.loadSession(payload);
    if (command === 'session.new') return client.newSession(payload);
    if (command === 'session.send') {
      if (sendFailure) return sendFailure();
      return client.send(payload);
    }
    if (command === 'session.permissions') return client.setPermissionMode(payload);
    if (command === 'session.rename') return client.rename(payload);
    if (command === 'session.delete') return client.deleteSession(payload);
    if (command === 'settings.save') return { ...settings, ...payload };
    if (command === 'update.download')
      return { mode: 'installer', status: 'downloading', currentVersion: '1.4.1', percent: 42 };
    throw new Error('Unexpected bridge command: ' + command);
  };
  const modules = {
    react,
    './i18n': {
      useI18n: () => ({
        t: (key, params) => key.replace(/\{(\w+)\}/g, (match, name) => params?.[name] ?? match),
      }),
      setLocale() {},
    },
    './lib': {
      request,
      errorText: (error) => error.message,
      baseName: (value) => value,
      readableDate: (value) => value,
    },
    './drafts.mjs': await import(pathToFileURL(path.join(root, 'src/drafts.mjs')).href),
    './timeline.mjs': {
      fromReplay: () => [],
      finalizeTurn: (rows) => rows,
      appendUpdate: (rows) => rows,
      createFrameBuffer: () => ({ flush() {}, dispose() {}, push() {} }),
    },
  };
  const original = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const sourceFile = ts.createSourceFile(
    'App.tsx',
    original,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const appFunction = sourceFile.statements.find(
    (item) => ts.isFunctionDeclaration(item) && item.name?.text === 'App',
  );
  const returnStatement = appFunction.body.statements.find(ts.isReturnStatement);
  const source =
    original.slice(0, returnStatement.getStart(sourceFile)) +
    '\nreturn { cwd, draft, attachments, session, sessions, rows, connection, turnError, busy, run, permissions, tasks, appUpdate, runUpdateAction, enqueue, setDraft, setAttachments, loadConversation, newConversation, openProject, send, setRename, setRenameTitle, renameSession, setDeleteTarget, deleteSession };\n}';
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const windowEvents = new Map();
  const context = {
    exports: {},
    require: (id) => modules[id] || {},
    crypto: require('node:crypto').webcrypto,
    window: {
      localStorage: storage,
      desktop: {
        onEvent(fn) {
          listener = fn;
          return () => (listener = null);
        },
      },
      setTimeout: () => 0,
      clearTimeout() {},
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
      addEventListener(name, callback) {
        windowEvents.set(name, callback);
      },
      removeEventListener(name) {
        windowEvents.delete(name);
      },
    },
    document: { documentElement: { dataset: {} } },
  };
  vm.runInNewContext(compiled, context, { filename: 'App.review.transpiled.cjs' });
  App = context.exports.default;
  render();
  await settle();
  return {
    get view() {
      return view;
    },
    client,
    requests,
    rpc,
    children,
    setSendFailure: (fn) => (sendFailure = fn),
    setLoadOverride: (fn) => (loadOverride = fn),
    emit: (event) => listener?.(event),
    close() {
      windowEvents.get('beforeunload')?.();
      stopped = true;
      listener = null;
      client.dispose();
    },
  };
}

test('update download progress remains in application state after the banner action starts', async () => {
  const f = await fixture();
  try {
    f.emit({
      type: 'app-update',
      state: {
        mode: 'installer',
        status: 'available',
        currentVersion: '1.4.1',
        availableVersion: '1.4.2',
      },
    });
    await settle();
    assert.equal(f.view.appUpdate.status, 'available');
    await f.view.runUpdateAction('update.download');
    await settle();
    assert.equal(f.view.appUpdate.status, 'downloading');
    assert.equal(f.view.appUpdate.percent, 42);
    assert.equal(f.requests.at(-1).command, 'update.download');
  } finally {
    f.close();
  }
});

test('active task switching retains runtime and isolates background connection and approvals', async () => {
  const f = await fixture();
  try {
    const snapshots = Object.fromEntries(
      summaries.map((item) => [
        item.sessionId,
        {
          ...item,
          models,
          commands: [],
          updates: [],
          permissionMode: 'ask',
          runtime: {
            turnId: item.sessionId === 'session-a' ? 'turn-a' : undefined,
            connection: 'ready',
            queued: [],
            permissions: [],
          },
        },
      ]),
    );
    f.setLoadOverride((payload) => snapshots[payload.sessionId]);
    await f.view.loadConversation(summaries[0]);
    await settle();
    assert.equal(f.view.run.turnId, 'turn-a');
    f.emit({
      type: 'permission',
      sessionId: 'session-a',
      requestId: 7,
      params: { sessionId: 'session-a', options: [] },
    });
    f.emit({
      type: 'permission',
      sessionId: 'session-b',
      requestId: 7,
      params: { sessionId: 'session-b', options: [] },
    });
    await settle();
    assert.equal(f.view.permissions.length, 2);
    await f.view.loadConversation(summaries[1]);
    await settle();
    assert.equal(f.view.busy, false);
    assert.equal(f.view.permissions[0].sessionId, 'session-a');
    f.emit({
      type: 'connection',
      sessionId: 'session-a',
      state: 'error',
      message: 'background failure',
    });
    f.emit({ type: 'turn-start', sessionId: 'session-a', turnId: 'other' });
    await settle();
    assert.equal(f.view.connection, 'ready');
    assert.equal(f.view.run, null);
    await f.view.loadConversation(summaries[0]);
    await settle();
    assert.equal(f.view.run.turnId, 'turn-a');
    assert.equal(
      f.requests.some((item) => item.command === 'session.cancel'),
      false,
    );
  } finally {
    f.close();
  }
});

test('explicit queue preserves inline context and image submission reaches the main process without native capability', async () => {
  const f = await fixture();
  try {
    await f.view.loadConversation(summaries[0]);
    await settle();
    const attachment = { name: 'code.ts:2', path: '', kind: 'text', text: 'selected code' };
    f.view.setDraft('next task');
    f.view.setAttachments([attachment]);
    await settle();
    await f.view.enqueue();
    await settle();
    assert.equal(
      f.requests.find((item) => item.command === 'session.enqueue').payload.attachments[0].text,
      'selected code',
    );
    assert.equal(f.view.draft, '');
    f.emit({
      type: 'turn-start',
      sessionId: 'session-a',
      turnId: 'queued-turn',
      queueId: 'queued-1',
      text: 'next task',
      attachments: [attachment],
    });
    await settle();
    assert.equal(f.view.rows[0].text, 'next task');
    f.emit({
      type: 'turn-end',
      sessionId: 'session-a',
      turnId: 'queued-turn',
      result: { stopReason: 'end_turn' },
    });
    await settle();
    f.view.setDraft('image request');
    f.view.setAttachments([{ name: 'shot.png', path: 'C:/shot.png', kind: 'image' }]);
    await settle();
    await f.view.send();
    await settle();
    assert.equal(f.view.draft, 'image request');
    assert.equal(f.view.attachments.length, 1);
    const sends = f.requests.filter((item) => item.command === 'session.send');
    assert.equal(sends.length, 1);
    assert.equal(sends[0].payload.attachments[0].path, 'C:/shot.png');
  } finally {
    f.close();
  }
});

test('session/project switches and app restart retain each draft and selected session', async () => {
  const storage = storageFixture();
  const f = await fixture(storage);
  try {
    f.view.setDraft('未建立会话时的草稿');
    await settle();
    await f.view.newConversation();
    await settle();
    assert.equal(f.view.draft, '未建立会话时的草稿');
    await f.view.loadConversation(summaries[0]);
    await settle();
    f.view.setDraft('A 中尚未发送的重要请求');
    f.view.setAttachments([{ name: 'context.ts', path: 'C:\\fake-context.ts' }]);
    await settle();
    await f.view.loadConversation(summaries[1]);
    await settle();
    await f.view.loadConversation(summaries[0]);
    await settle();
    assert.equal(f.view.draft, 'A 中尚未发送的重要请求');
    assert.equal(f.view.attachments.length, 1);
    await f.view.openProject('C:\\other-project');
    await settle();
    f.view.setDraft('另一个项目的草稿');
    await settle();
    await f.view.openProject(cwd);
    await settle();
    assert.equal(f.view.session.sessionId, 'session-a');
    assert.equal(f.view.draft, 'A 中尚未发送的重要请求');
  } finally {
    f.close();
  }
  const restored = await fixture(storage);
  try {
    assert.equal(restored.view.session.sessionId, 'session-a');
    assert.equal(restored.view.draft, 'A 中尚未发送的重要请求');
    assert.equal(restored.view.attachments.length, 1);
  } finally {
    restored.close();
  }
});

test('process exit restores current session once before reporting ready and accepting continuation', async () => {
  const f = await fixture();
  try {
    await f.view.loadConversation(summaries[0]);
    await settle();
    f.view.setDraft('fake prompt');
    await settle();
    await f.view.send();
    await settle();
    assert.ok(f.client.activeTurn);
    f.children[0].emit('exit', 1, null);
    await settle();
    assert.equal(f.view.connection, 'ready');
    assert.equal(f.view.session.sessionId, 'session-a');
    assert.equal(f.client.activeSessionId, 'session-a');
    const beforeLoadCount = f.requests.filter((req) => req.command === 'session.load').length;
    await f.view.loadConversation(summaries[0]);
    await settle();
    assert.equal(
      f.requests.filter((req) => req.command === 'session.load').length,
      beforeLoadCount,
    );
    f.view.setDraft('continue after process exit');
    await settle();
    await f.view.send();
    await settle();
    assert.equal(f.view.turnError, '');
    assert.equal(beforeLoadCount, 2);
    assert.equal(f.rpc.filter((req) => req.method === 'session/prompt').length, 2);
  } finally {
    f.close();
  }
});

test('preflight failures retain edits made while sending and remove unsent timeline rows', async () => {
  const g = await fixture();
  try {
    await g.view.loadConversation(summaries[0]);
    await settle();
    let rejectSend;
    g.setSendFailure(
      () =>
        new Promise((resolve, reject) => {
          rejectSend = reject;
        }),
    );
    g.view.setDraft('original request');
    await settle();
    const sending = g.view.send();
    await settle();
    g.view.setDraft('next request entered while preparing');
    g.view.setAttachments([{ name: 'next.ts', path: 'C:\\next.ts' }]);
    await settle();
    rejectSend(new Error('simulated preflight error'));
    await sending;
    await settle();
    assert.equal(g.view.draft, 'next request entered while preparing');
    assert.equal(g.view.attachments.length, 1);
    assert.equal(g.view.rows.filter((row) => row.kind === 'user').length, 0);
    g.setSendFailure(async () => {
      throw new Error('simulated preflight error');
    });
    await g.view.send();
    await settle();
    assert.equal(g.view.rows.filter((row) => row.kind === 'user').length, 0);
    assert.equal(g.rpc.filter((req) => req.method === 'session/prompt').length, 0);
  } finally {
    g.close();
  }
});

test('idle reconnection keeps new input during history restoration and merges duplicate restore notifications', async () => {
  const f = await fixture();
  try {
    await f.view.loadConversation(summaries[0]);
    await settle();
    f.view.setDraft('draft before disconnect');
    await settle();
    let releaseLoad;
    f.setLoadOverride(
      (payload) =>
        new Promise((resolve) => {
          releaseLoad = () => resolve(f.client.loadSession(payload));
        }),
    );
    f.children[0].emit('exit', 1, null);
    await settle();
    await f.client.listSessions({ cwd });
    await settle();
    assert.equal(f.view.connection, 'restoring');
    assert.ok(releaseLoad);
    f.emit({ type: 'notification', kind: 'settings-reloaded' });
    f.view.setDraft('new input during restoration');
    f.view.setAttachments([{ name: 'new.ts', path: 'C:\\new.ts' }]);
    await settle();
    releaseLoad();
    await settle();
    assert.equal(f.view.connection, 'ready');
    assert.equal(f.client.activeSessionId, 'session-a');
    assert.equal(f.view.draft, 'new input during restoration');
    assert.equal(f.view.attachments.length, 1);
    assert.equal(f.requests.filter((req) => req.command === 'session.load').length, 2);
  } finally {
    f.close();
  }
});

test('attachment-only context can be sent and clears only after acceptance', async () => {
  const f = await fixture();
  try {
    await f.view.newConversation();
    await settle();
    f.view.setAttachments([
      { name: 'selected.ts', path: '', kind: 'text', text: 'const value = 1;' },
    ]);
    await settle();
    await f.view.send();
    await settle();
    assert.equal(f.requests.filter((req) => req.command === 'session.send').length, 1);
    assert.equal(f.view.attachments.length, 0);
  } finally {
    f.close();
  }
});

test('successful submission clears only its original draft including automatic session creation', async () => {
  const f = await fixture();
  try {
    f.view.setDraft('first request without a session');
    await settle();
    await f.view.send();
    await settle();
    assert.equal(f.view.session.sessionId, 'session-a');
    assert.equal(f.view.draft, '');
    f.children[0].reply(f.children[0].prompt, { stopReason: 'end_turn' });
    await settle();
    let accept;
    f.setSendFailure(
      () =>
        new Promise((resolve) => {
          accept = () => resolve({ turnId: 'accepted-second' });
        }),
    );
    f.view.setDraft('second request');
    await settle();
    const sending = f.view.send();
    await settle();
    f.view.setDraft('next draft while waiting');
    f.view.setAttachments([{ name: 'later.ts', path: 'C:\\later.ts' }]);
    await settle();
    accept();
    await sending;
    await settle();
    assert.equal(f.view.draft, 'next draft while waiting');
    assert.equal(f.view.attachments.length, 1);
    assert.equal(f.view.rows.filter((row) => row.kind === 'user').length, 2);
  } finally {
    f.close();
  }
});

test('draft sessions omitted by official empty-history filtering stay visible with real names and restore after restart', async () => {
  const storage = storageFixture();
  const f = await fixture(storage, { filterEmptySessions: true });
  try {
    await f.view.newConversation();
    await settle();
    await f.client.rename({ cwd, sessionId: 'session-a', title: '官方命名的草稿 A' });
    await settle();
    f.view.setDraft('A 尚未发送的内容');
    await settle();
    await f.view.newConversation();
    await settle();
    assert.equal(f.view.sessions.length, 2);
    assert.equal(
      f.view.sessions.find((item) => item.sessionId === 'session-a').title,
      '官方命名的草稿 A',
    );
    f.view.setRename({ cwd, sessionId: 'session-b', title: 'session-b' });
    f.view.setRenameTitle('本机命名的草稿 B');
    await settle();
    await f.view.renameSession();
    await settle();
    f.view.setAttachments([{ name: 'context.ts', path: 'C:\\context.ts' }]);
    await settle();
    await f.view.loadConversation(f.view.sessions.find((item) => item.sessionId === 'session-a'));
    await settle();
    assert.equal(f.view.draft, 'A 尚未发送的内容');
    f.emit({ type: 'sessions-changed' });
    await settle();
    assert.equal(
      f.view.sessions.find((item) => item.sessionId === 'session-b').title,
      '本机命名的草稿 B',
    );
  } finally {
    f.close();
  }
  const restarted = await fixture(storage, { filterEmptySessions: true });
  try {
    assert.equal(restarted.view.session.sessionId, 'session-a');
    assert.equal(restarted.view.draft, 'A 尚未发送的内容');
    assert.equal(restarted.view.sessions.length, 2);
    await restarted.client.rename({ cwd, sessionId: 'session-a', title: '官方更新标题' });
    await settle();
    assert.equal(
      restarted.view.sessions.find((item) => item.sessionId === 'session-a').title,
      '官方更新标题',
    );
    const pendingB = restarted.view.sessions.find((item) => item.sessionId === 'session-b');
    await restarted.view.loadConversation(pendingB);
    await settle();
    assert.equal(restarted.view.attachments.length, 1);
    restarted.view.setDeleteTarget(pendingB);
    await settle();
    await restarted.view.deleteSession();
    await settle();
    assert.equal(
      restarted.view.sessions.some((item) => item.sessionId === 'session-b'),
      false,
    );
    const saved = JSON.parse(storage.getItem('grok-desktop-drafts'));
    assert.equal(
      Object.values(saved.summaries).some((item) => item.sessionId === 'session-b'),
      false,
    );
    assert.equal(
      Object.keys(saved.drafts).some((key) => key.includes('session-b')),
      false,
    );
  } finally {
    restarted.close();
  }
});

test('input entered before selecting a project survives restart and remains visible when a project is selected', async () => {
  const storage = storageFixture();
  const f = await fixture(storage, { lastProject: '' });
  try {
    assert.equal(f.view.cwd, '');
    f.view.setDraft('先写下的新需求');
    f.view.setAttachments([{ name: 'request.md', path: 'C:\\request.md' }]);
    await settle();
  } finally {
    f.close();
  }
  const restarted = await fixture(storage);
  try {
    assert.equal(restarted.view.cwd, '');
    assert.equal(restarted.view.draft, '先写下的新需求');
    assert.equal(restarted.view.attachments.length, 1);
    await restarted.view.openProject(cwd);
    await settle();
    assert.equal(restarted.view.cwd, cwd);
    assert.equal(restarted.view.session, null);
    assert.equal(restarted.view.draft, '先写下的新需求');
    assert.equal(restarted.view.attachments.length, 1);
    const saved = JSON.parse(storage.getItem('grok-desktop-drafts'));
    assert.equal(saved.drafts[JSON.stringify(['', ''])], undefined);
  } finally {
    restarted.close();
  }
});

test('first project selection combines unsent project drafts while preserving existing session drafts', async () => {
  const storage = storageFixture();
  const { createDraftStore } = await import(pathToFileURL(path.join(root, 'src/drafts.mjs')).href);
  const store = createDraftStore(storage);
  store.save(cwd, '', {
    text: '项目里先前未发送的需求',
    attachments: [{ name: 'shared.md', path: 'C:\\shared.md' }],
  });
  store.save(cwd, 'session-a', { text: '旧会话草稿应保持原样', attachments: [] });
  store.remember(cwd, 'session-a', '原有会话');
  store.select(cwd, 'session-a');
  const f = await fixture(storage, { lastProject: '' });
  try {
    f.view.setDraft('尚未选项目的新输入');
    f.view.setAttachments([
      { name: 'shared.md', path: 'C:\\shared.md' },
      { name: 'incoming.md', path: 'C:\\incoming.md' },
    ]);
    await settle();
    await f.view.openProject(cwd);
    await settle();
    assert.equal(f.view.session, null);
    assert.equal(f.view.draft, '项目里先前未发送的需求\n\n尚未选项目的新输入');
    assert.equal(f.view.attachments.length, 2);
    assert.equal(createDraftStore(storage).read(cwd, 'session-a').text, '旧会话草稿应保持原样');
    assert.equal(f.requests.filter((req) => req.command === 'session.load').length, 0);
  } finally {
    f.close();
  }
});
