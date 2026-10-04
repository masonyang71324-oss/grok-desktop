const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

function home(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-runtime-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function fakeProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 12345;
  return child;
}

test('provider public view omits secrets and edits preserve unknown keys and comments', (t) => {
  const { ProviderStore } = require('../electron/providers.cjs');
  const configFile = path.join(home(t), 'config.toml');
  const original =
    '# top\n[model."alias.with.dot"] # alias\nmodel = "old" # model note\napi_key = "TOP_SECRET"\nname = "Demo"\nextra_headers = { Authorization = "OTHER_SECRET" }\nunknown = 42\n[ui]\ntheme = "system"\n';
  fs.writeFileSync(configFile, original);
  const store = new ProviderStore({ configFile, env: { DEMO_KEY: 'ENV_SECRET' } });
  const view = store.list();
  assert.equal(view.models[0].hasKey, true);
  assert.doesNotMatch(JSON.stringify(view), /SECRET|Authorization|unknown|api_key/);
  store.save({
    baseline: view.baseline,
    id: 'alias.with.dot',
    fields: { model: 'new', env_key: 'DEMO_KEY' },
  });
  const result = fs.readFileSync(configFile, 'utf8');
  assert.match(result, /model = "new" # model note/);
  assert.match(result, /api_key = "TOP_SECRET"/);
  assert.match(result, /extra_headers = \{ Authorization = "OTHER_SECRET" \}/);
  assert.match(result, /unknown = 42/);
  assert.match(result, /\[ui\]\ntheme = "system"/);
});

test('provider rejects conflicts and unsupported fields without overwriting configuration', (t) => {
  const { ProviderStore } = require('../electron/providers.cjs');
  const configFile = path.join(home(t), 'config.toml');
  fs.writeFileSync(configFile, '[model.demo]\nmodel="demo"\n');
  const store = new ProviderStore({ configFile });
  const view = store.list();
  assert.throws(
    () => store.save({ baseline: view.baseline, id: 'demo', fields: { api_key: 'bad' } }),
    /字段|field/i,
  );
  fs.appendFileSync(configFile, '# external edit\n');
  assert.throws(
    () => store.save({ baseline: view.baseline, id: 'demo', fields: { name: 'changed' } }),
    /外部|changed/i,
  );
  assert.match(fs.readFileSync(configFile, 'utf8'), /# external edit/);
});

test('enable and disable use official models.disabled_models preserving other entries', (t) => {
  const { ProviderStore } = require('../electron/providers.cjs');
  const configFile = path.join(home(t), 'config.toml');
  fs.writeFileSync(
    configFile,
    '[models]\ndisabled_models = ["other"] # retained\n[model.demo]\nmodel="demo"\n',
  );
  const store = new ProviderStore({ configFile });
  let view = store.setEnabled({ baseline: store.list().baseline, id: 'demo', enabled: false });
  assert.equal(view.models[0].enabled, false);
  assert.match(
    fs.readFileSync(configFile, 'utf8'),
    /disabled_models = \["other", "demo"\] # retained/,
  );
  view = store.setEnabled({ baseline: view.baseline, id: 'demo', enabled: true });
  assert.equal(view.models[0].enabled, true);
  assert.match(fs.readFileSync(configFile, 'utf8'), /disabled_models = \["other"\s*\]/);
});

test('enable and disable preserve comments inside the official multiline disabled list', (t) => {
  const { ProviderStore } = require('../electron/providers.cjs');
  const configFile = path.join(home(t), 'config.toml');
  fs.writeFileSync(
    configFile,
    '[models]\ndisabled_models = [\n "other", # keep other\n "demo", # keep demo note\n]\n[model.demo]\nmodel="demo"\n',
  );
  const store = new ProviderStore({ configFile });
  let view = store.setEnabled({ baseline: store.list().baseline, id: 'demo', enabled: true });
  assert.equal(view.models[0].enabled, true);
  assert.match(fs.readFileSync(configFile, 'utf8'), /# keep other/);
  assert.match(fs.readFileSync(configFile, 'utf8'), /# keep demo note/);
  view = store.setEnabled({ baseline: view.baseline, id: 'demo', enabled: false });
  assert.equal(view.models[0].enabled, false);
  assert.match(fs.readFileSync(configFile, 'utf8'), /# keep other/);
  assert.match(fs.readFileSync(configFile, 'utf8'), /# keep demo note/);
});

test('ambiguous inline model editing is rejected and parser errors never expose secrets', (t) => {
  const { ProviderStore } = require('../electron/providers.cjs');
  const configFile = path.join(home(t), 'config.toml');
  fs.writeFileSync(configFile, 'model = { demo = { model = "x" } }\n');
  const store = new ProviderStore({ configFile });
  const view = store.list();
  assert.throws(
    () => store.save({ baseline: view.baseline, id: 'demo', fields: { model: 'y' } }),
    /布局|layout/i,
  );
  fs.writeFileSync(configFile, '[model.demo]\napi_key="SECRET_PARSE');
  assert.throws(
    () => store.list(),
    (e) => !e.message.includes('SECRET_PARSE'),
  );
});

test('explicit optional context-window removal deletes its key and retains its comment', (t) => {
  const { ProviderStore } = require('../electron/providers.cjs');
  const configFile = path.join(home(t), 'config.toml');
  fs.writeFileSync(
    configFile,
    '[model.demo]\nmodel="demo"\ncontext_window = 32000 # context note\nunknown="keep"\n',
  );
  const store = new ProviderStore({ configFile });
  const view = store.save({
    baseline: store.list().baseline,
    id: 'demo',
    fields: { context_window: null },
  });
  assert.equal(view.models[0].context_window, undefined);
  const result = fs.readFileSync(configFile, 'utf8');
  assert.doesNotMatch(result, /context_window/);
  assert.match(result, /# context note/);
  assert.match(result, /unknown="keep"/);
});

test('official installation requires zero exit and verified executable version', async (t) => {
  const { CliInstaller } = require('../electron/cli-installer.cjs');
  const children = [],
    calls = [];
  const installer = new CliInstaller({
    binDir: home(t),
    emit: () => {},
    spawnFn: (exe, args, options) => {
      calls.push({ exe, args, options });
      const child = fakeProcess();
      children.push(child);
      setImmediate(() => {
        child.stdout.write(children.length === 1 ? 'Downloading binary\n' : 'grok 1.0.46\n');
        child.emit('close', 0);
      });
      return child;
    },
  });
  const state = await installer.start();
  assert.equal(state.status, 'installed');
  assert.equal(state.version, '1.0.46');
  assert.match(calls[0].exe, /^[A-Z]:\\.*\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
  assert.equal(calls[0].options.env.GROK_CHANNEL, 'stable');
  assert.equal(calls[0].options.env.GROK_BIN_DIR, path.dirname(state.path));
  assert.equal(calls[0].options.windowsHide, true);
  assert.ok(calls[0].args.some((arg) => arg.includes('https://x.ai/cli/install.ps1')));
  assert.deepEqual(calls[1].args, ['--version']);
});

test('installation cancellation kills the owned tree and ignores late success', async (t) => {
  const { CliInstaller } = require('../electron/cli-installer.cjs');
  const child = fakeProcess();
  const killed = [];
  const installer = new CliInstaller({
    binDir: home(t),
    emit: () => {},
    spawnFn: () => child,
    killTree: async (process) => {
      killed.push(process.pid);
    },
  });
  const started = installer.start();
  await installer.cancel();
  child.emit('close', 0);
  assert.equal((await started).status, 'cancelled');
  assert.deepEqual(killed, [12345]);
});

test('installation timeout and failed version verification cannot report installed', async (t) => {
  const { CliInstaller } = require('../electron/cli-installer.cjs');
  let killed = 0;
  const installer = new CliInstaller({
    timeout: 10,
    binDir: home(t),
    emit: () => {},
    spawnFn: () => fakeProcess(),
    killTree: async () => {
      killed++;
    },
  });
  assert.equal((await installer.start()).status, 'error');
  assert.equal(killed, 1);
  const invalid = new CliInstaller({
    binDir: home(t),
    emit: () => {},
    spawnFn: () => {
      const child = fakeProcess();
      setImmediate(() => {
        child.stdout.write('not grok');
        child.emit('close', 0);
      });
      return child;
    },
  });
  assert.equal((await invalid.start()).status, 'error');
});

test('idle collection sleeps oldest connection without errors and reuses original session identity', async () => {
  const { SessionHub } = require('../electron/session-hub.cjs');
  const events = [],
    clients = [];
  const hub = new SessionHub({
    emit: (event) => events.push(event),
    createClient: (emit) => {
      const client = {
        connected: true,
        capabilities: {},
        loads: [],
        async newSession({ cwd }) {
          return {
            sessionId: `s${clients.indexOf(this)}`,
            cwd,
            updates: [],
            models: {},
            commands: [],
          };
        },
        async loadSession(payload) {
          this.loads.push(payload);
          this.connected = true;
          return { ...payload, updates: [], models: {}, commands: [] };
        },
        dispose() {
          this.connected = false;
          emit({ type: 'connection', state: 'disconnected', message: 'connection closed' });
        },
        async configure() {
          return { models: {} };
        },
      };
      clients.push(client);
      return client;
    },
  });
  const a = await hub.newSession({ cwd: 'C:/a' });
  const b = await hub.newSession({ cwd: 'C:/b' });
  hub.setActiveSession(b.sessionId);
  assert.deepEqual(hub.collectIdle({ maxIdleConnections: 0 }), [a.sessionId]);
  const task = hub.listTasks().find((task) => task.sessionId === a.sessionId);
  assert.equal(task.connection, 'sleeping');
  assert.equal(task.status, 'idle');
  assert.equal(task.error, undefined);
  assert.equal(
    events.some((event) => event.type === 'connection' && event.state === 'disconnected'),
    false,
  );
  await hub.configure({ sessionId: a.sessionId });
  assert.equal(clients[1].loads[0].sessionId, a.sessionId);
  assert.equal(clients[1].loads[0].cwd, 'C:/a');
});

test('idle collection excludes each real protected activity', async () => {
  const { isIdleEntry } = require('../electron/session-hub.cjs');
  const entry = () => ({
    status: 'idle',
    client: { connected: true },
    queue: [],
    permissions: new Map(),
    activity: { busy: false, background: new Set() },
    snapshot: {},
  });
  assert.equal(isIdleEntry(entry()), true);
  for (const field of ['running', 'control', 'loading', 'backgroundDone', 'reactivating']) {
    const e = entry();
    e[field] = {};
    assert.equal(isIdleEntry(e), false, field);
  }
  for (const field of ['activeTurn', '_operation', '_loading', '_connecting']) {
    const e = entry();
    e.client[field] = {};
    assert.equal(isIdleEntry(e), false, field);
  }
  const pending = entry();
  pending.client._pending = new Map([[1, {}]]);
  assert.equal(isIdleEntry(pending), false);
  const permission = entry();
  permission.permissions.set(1, {});
  assert.equal(isIdleEntry(permission), false);
  const queued = entry();
  queued.queue.push({});
  assert.equal(isIdleEntry(queued), false);
  const background = entry();
  background.activity.background.add('task');
  assert.equal(isIdleEntry(background), false);
});

test('sleep reactivation restores saved permission mode before configuration', async () => {
  const { SessionHub } = require('../electron/session-hub.cjs');
  const modes = [];
  const hub = new SessionHub({
    emit: () => {},
    createClient: () => ({
      connected: true,
      capabilities: {},
      async newSession({ cwd }) {
        return { sessionId: 'permission-session', cwd, permissionMode: 'auto', updates: [] };
      },
      dispose() {
        this.connected = false;
      },
      async loadSession(payload) {
        this.connected = true;
        return { ...payload, permissionMode: 'ask', updates: [] };
      },
      setPermissionMode(payload) {
        modes.push(payload.permissionMode);
        return payload;
      },
      async configure() {
        return {};
      },
    }),
  });
  const session = await hub.newSession({ cwd: 'C:/project' });
  hub.collectIdle({ maxIdleConnections: 0 });
  const restored = await hub.loadSession(session);
  assert.equal(restored.permissionMode, 'auto');
  assert.deepEqual(modes, ['auto']);
});

test('repeated cancel stops owned process only once even while tree stop is pending', async (t) => {
  const { CliInstaller } = require('../electron/cli-installer.cjs');
  let killed = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const installer = new CliInstaller({
    binDir: home(t),
    emit: () => {},
    spawnFn: () => fakeProcess(),
    killTree: async () => {
      killed++;
      await gate;
    },
  });
  const started = installer.start();
  const a = installer.cancel();
  const b = installer.cancel();
  release();
  await Promise.all([started, a, b]);
  assert.equal(killed, 1);
  assert.equal(installer.state().status, 'cancelled');
});

test('installer cannot verify after a timed-out process emits a late zero exit', async (t) => {
  const { CliInstaller } = require('../electron/cli-installer.cjs');
  const child = fakeProcess();
  let spawned = 0;
  const installer = new CliInstaller({
    timeout: 5,
    binDir: home(t),
    emit: () => {},
    spawnFn: () => {
      spawned++;
      return child;
    },
    killTree: async () => {
      child.emit('close', 0);
    },
  });
  const result = await installer.start();
  assert.equal(result.status, 'error');
  assert.equal(spawned, 1);
  assert.match(result.error, /超时|timed out/i);
});

test('installer verifies actual isolated fixture processes with no real installation', async (t) => {
  const { spawn } = require('node:child_process');
  const { CliInstaller } = require('../electron/cli-installer.cjs');
  const isolated = home(t),
    fixture = path.join(__dirname, 'fixtures/mock-cli-installer.cjs');
  const installer = new CliInstaller({
    binDir: isolated,
    emit: () => {},
    spawnFn: (_executable, args, options) =>
      spawn(process.execPath, [fixture, args[0] === '--version' ? 'version' : 'install'], {
        ...options,
        env: { ...process.env, USERPROFILE: isolated, GROK_HOME: isolated },
      }),
  });
  const result = await installer.start();
  assert.equal(result.status, 'installed');
  assert.equal(result.version, '1.0.46');
  assert.deepEqual(fs.readdirSync(isolated), []);
});

test(
  'Windows native installer cancellation terminates fixture descendants',
  { skip: process.platform !== 'win32', timeout: 10_000 },
  async (t) => {
    const { spawn } = require('node:child_process');
    const { CliInstaller, killOwnedTree } = require('../electron/cli-installer.cjs');
    const isolated = home(t),
      fixture = path.join(__dirname, 'fixtures/mock-cli-installer.cjs');
    let child, descendant, ready;
    const gate = new Promise((resolve) => {
      ready = resolve;
    });
    const installer = new CliInstaller({
      binDir: isolated,
      emit: (event) => {
        const id = event.state.log.match(/fixture descendant (\d+)/)?.[1];
        if (id) {
          descendant = Number(id);
          ready();
        }
      },
      spawnFn: (_executable, _args, options) => {
        child = spawn(process.execPath, [fixture, 'tree'], {
          ...options,
          env: { ...process.env, USERPROFILE: isolated, GROK_HOME: isolated },
        });
        return child;
      },
    });
    t.after(async () => {
      if (child && child.exitCode === null) await killOwnedTree(child);
    });
    const result = installer.start();
    await gate;
    await installer.cancel();
    assert.equal((await result).status, 'cancelled');
    assert.throws(() => process.kill(descendant, 0), /ESRCH/);
  },
);

test('actual idle ACP transports are reduced from three to one and restore identical session', async (t) => {
  const { spawn } = require('node:child_process');
  const { SessionHub } = require('../electron/session-hub.cjs');
  const isolated = home(t);
  const hub = new SessionHub({
    emit: () => {},
    getExecutable: () => process.execPath,
    spawnFn: (executable, args, options) =>
      spawn(executable, [path.join(__dirname, '../scripts/mock-grok.cjs'), ...args], {
        ...options,
        env: {
          ...process.env,
          GROK_DESKTOP_MOCK_STATE: path.join(isolated, 'sessions.json'),
          GROK_DESKTOP_MOCK_LOG: '',
          GROK_HOME: isolated,
          USERPROFILE: isolated,
        },
      }),
  });
  t.after(() => hub.dispose());
  const a = await hub.newSession({ cwd: isolated });
  await hub.newSession({ cwd: isolated });
  const c = await hub.newSession({ cwd: isolated });
  hub.setActiveSession(c.sessionId);
  assert.equal([...hub.sessions.values()].filter((entry) => entry.client.connected).length, 3);
  assert.equal(hub.collectIdle({ maxIdleConnections: 1 }).length, 2);
  assert.equal([...hub.sessions.values()].filter((entry) => entry.client.connected).length, 1);
  const originalPid = hub.sessions.get(a.sessionId).client._proc;
  await hub.rename({ sessionId: a.sessionId, cwd: isolated, title: 'Restored original session' });
  await hub.configure({ sessionId: a.sessionId, modelId: 'mock-grok' });
  const restored = await hub.loadSession({ sessionId: a.sessionId, cwd: isolated });
  assert.equal(restored.sessionId, a.sessionId);
  assert.equal(restored.cwd, isolated);
  assert.notEqual(hub.sessions.get(a.sessionId).client._proc, originalPid);
});

test('upstream fixture comparison reports metadata changes with no rewrite', async () => {
  const { checkUpstream } = require('../scripts/check-upstream.cjs');
  const baseline = {
    cliVersion: '1.0.46',
    protocolVersion: 1,
    protocolMethods: ['initialize', 'session/load', 'session/new', 'session/prompt'],
  };
  const fetchText = async (url) =>
    url.endsWith('/stable')
      ? '1.0.47\n'
      : '<h1>Schema</h1><h4 id="initialize-request">InitializeRequest</h4> initialize session/load session/new session/prompt session/new_extension';
  const report = await checkUpstream({ baseline, fetchText });
  assert.equal(report.cliVersion, '1.0.47');
  assert.equal(report.changed, true);
  assert.ok(report.changes.some((change) => change.includes('1.0.46')));
  assert.equal(baseline.cliVersion, '1.0.46');
});

test('official h4 schema definition headings contribute to type-change comparison', async () => {
  const { checkUpstream } = require('../scripts/check-upstream.cjs');
  const baseline = {
    cliVersion: '1.0.46',
    protocolVersion: 1,
    protocolMethods: ['initialize', 'session/new', 'session/prompt'],
    protocolTypes: ['InitializeRequest'],
  };
  const report = await checkUpstream({
    baseline,
    fetchText: async (url) =>
      url.endsWith('/stable')
        ? '1.0.46'
        : '<h3 class="sidebar-title">Libraries</h3><h2 id="agent">Agent</h2><h4 id="initialize-request"><a>\u200b</a><span>InitializeRequest</span></h4><h4 id="new-type"><span>AddedRequest</span></h4> initialize session/new session/prompt',
  });
  assert.deepEqual(report.protocolTypes, ['AddedRequest', 'Agent', 'InitializeRequest']);
  assert.ok(report.changes.some((change) => change === 'protocolTypes added: AddedRequest, Agent'));
});

test('schema checks explicitly fail when expected definition headings are missing', () => {
  const { schemaMetadata } = require('../scripts/check-upstream.cjs');
  assert.throws(
    () => schemaMetadata('<h2>Agent</h2> initialize session/new session/prompt'),
    /schema definition/i,
  );
});
