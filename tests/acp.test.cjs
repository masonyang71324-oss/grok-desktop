'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const { GrokClient } = require('../electron/acp.cjs');

const models = {
  currentModelId: 'grok',
  availableModels: [
    {
      modelId: 'grok',
      name: 'Grok',
      _meta: {
        supportsReasoningEffort: true,
        reasoningEfforts: [
          { id: 'high', label: 'High' },
          { id: 'low', label: 'Low' },
        ],
      },
    },
  ],
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture(t, override = () => false, options = {}) {
  const received = [],
    events = [],
    children = [];
  const spawnFn = (exe, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      child.emit('exit', null, 'SIGTERM');
      return true;
    };
    child.deliver = (message) => child.stdout.write(JSON.stringify(message) + '\n');
    child.reply = (request, result) => child.deliver({ jsonrpc: '2.0', id: request.id, result });
    child.stdin = new Writable({
      write(data, encoding, done) {
        for (const line of data.toString().trim().split('\n')) {
          const req = JSON.parse(line);
          received.push(req);
          queueMicrotask(() => {
            if (override(req, child)) return;
            if (req.id == null || !req.method) return;
            if (req.method === 'initialize')
              child.reply(req, {
                protocolVersion: 1,
                agentCapabilities: {
                  loadSession: true,
                  promptCapabilities: { image: false, audio: false, embeddedContext: true },
                },
                _meta: {
                  grokShell: true,
                  agentVersion: '1.0.13',
                  modelState: models,
                  availableCommands: [{ name: 'help' }],
                },
              });
            else if (req.method === '_x.ai/commands/list')
              child.reply(req, {
                commands: [{ name: 'review', description: 'Review', input: { hint: 'scope' } }],
              });
            else if (req.method === 'session/new')
              child.reply(req, {
                sessionId: 'session-a',
                models,
                modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }] },
                _meta: { loaded: true },
              });
            else if (req.method === 'session/set_model') child.reply(req, {});
            else if (req.method === 'session/prompt') {
              child.prompt = req;
            } else child.reply(req, {});
          });
        }
        done();
      },
    });
    children.push({ child, exe, args, options });
    return child;
  };
  const client = new GrokClient({
    getExecutable: () => 'fake-grok.exe',
    emit: (event) => events.push(event),
    spawnFn,
    ...options,
  });
  t.after(() => client.dispose());
  return { client, received, events, children, child: () => children.at(-1).child };
}

test('uses one isolated process and applies model plus effort before prompting', async (t) => {
  const f = fixture(t);
  await f.client.ensure();
  await f.client.ensure();
  const snapshot = await f.client.newSession({ cwd: 'C:\\project' });
  assert.equal(f.children.length, 1);
  assert.deepEqual(f.children[0].args, ['agent', '--no-leader', 'stdio']);
  assert.equal(f.client.version, '1.0.13');
  assert.equal(snapshot._meta.loaded, true);
  assert.equal(f.client.capabilities.promptCapabilities.embeddedContext, true);
  assert.equal(f.client.commands[0].name, 'review');
  const sent = await f.client.send({
    sessionId: 'session-a',
    cwd: 'C:\\project',
    text: '你好',
    modelId: 'grok',
    effort: 'high',
  });
  await tick();
  const relevant = f.received.filter((r) =>
    ['session/set_model', 'session/prompt'].includes(r.method),
  );
  assert.deepEqual(
    relevant.map((r) => r.method),
    ['session/set_model', 'session/prompt'],
  );
  assert.deepEqual(relevant[0].params, {
    sessionId: 'session-a',
    modelId: 'grok',
    _meta: { reasoningEffort: 'high' },
  });
  assert.equal(relevant[1].params.sessionId, 'session-a');
  assert.equal(f.client.activeTurn.turnId, sent.turnId);
  await assert.rejects(
    f.client.send({ sessionId: 'session-a', text: 'second' }),
    /正在|active|运行/i,
  );
  f.child().reply(f.child().prompt, { stopReason: 'end_turn' });
  await tick();
  assert.equal(f.client.activeTurn, null);
  assert.equal(f.events.filter((e) => e.type === 'turn-end').length, 1);
});

test('initialize identifies the supplied desktop application version', async (t) => {
  const f = fixture(t, () => false, { clientVersion: '9.8.7' });
  await f.client.ensure();
  assert.equal(
    f.received.find((req) => req.method === 'initialize').params.clientInfo.version,
    '9.8.7',
  );
});

test('history load gets 120 seconds but an unresolved load still invalidates transport state', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let loadingRequest;
  const f = fixture(t, (req) => {
    if (req.method !== 'session/load') return false;
    loadingRequest = req;
    return true;
  });
  await f.client.newSession({ cwd: 'C:\\project' });
  const load = f.client.loadSession({ cwd: 'C:\\project', sessionId: 'large-history' });
  load.catch(() => {});
  await tick();
  t.mock.timers.tick(90000);
  await tick();
  assert.equal(f.client.connected, true);
  f.child().reply(loadingRequest, { models });
  assert.equal((await load).sessionId, 'large-history');
  const stuck = f.client.loadSession({ cwd: 'C:\\project', sessionId: 'stuck-history' });
  const rejected = assert.rejects(stuck, /session\/load/);
  await tick();
  t.mock.timers.tick(120001);
  await rejected;
  assert.equal(f.client.connected, false);
  assert.equal(f.client.activeSessionId, null);
  assert.equal(f.client._sessions.size, 0);
});

test('returned replay and emitted model snapshots cannot mutate internal session history or settings', async (t) => {
  const f = fixture(t, (req, child) => {
    if (req.method !== 'session/load') return false;
    child.deliver({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: req.params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'original history' },
        },
      },
    });
    child.reply(req, { models, _meta: { nested: { original: true } } });
    return true;
  });
  const snapshot = await f.client.loadSession({ cwd: 'C:\\project', sessionId: 'history' });
  snapshot.updates[0].content.text = 'caller mutation';
  snapshot.models.availableModels[0].name = 'caller model';
  snapshot._meta.nested.original = false;
  f.events.findLast((event) => event.type === 'models').models.currentModelId = 'event mutation';
  const internal = f.client._session('history');
  assert.equal(internal.updates[0].content.text, 'original history');
  assert.equal(internal.models.availableModels[0].name, 'Grok');
  assert.equal(internal._meta.nested.original, true);
  assert.equal(f.client.models.currentModelId, 'grok');
});

test('failed history load discards replay and preserves the session used by later prompts', async (t) => {
  const f = fixture(t, (req, child) => {
    if (req.method !== 'session/load') return false;
    child.deliver({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'missing',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'partial history' },
        },
      },
    });
    child.deliver({
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32602, message: 'Session missing' },
    });
    return true;
  });
  await f.client.newSession({ cwd: 'C:\\project' });
  await assert.rejects(
    f.client.loadSession({ cwd: 'C:\\project', sessionId: 'missing' }),
    /Session missing/,
  );
  assert.equal(f.client.activeSessionId, 'session-a');
  assert.equal(f.events.filter((e) => e.type === 'update').length, 0);
  await f.client.send({ sessionId: 'session-a', text: 'continue' });
  await tick();
  assert.equal(f.child().prompt.params.sessionId, 'session-a');
});

test('queues permission requests with exact string and numeric IDs; auto approval is opt-in', async (t) => {
  const f = fixture(t);
  await f.client.newSession({ cwd: 'C:\\project' });
  await f.client.send({ sessionId: 'session-a', text: 'do work' });
  await tick();
  const params = {
    sessionId: 'session-a',
    toolCall: { title: 'Write' },
    options: [
      { optionId: 'yes', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' },
    ],
  };
  f.child().deliver({
    jsonrpc: '2.0',
    id: 'permission-1',
    method: 'session/request_permission',
    params,
  });
  f.child().deliver({ jsonrpc: '2.0', id: 9, method: 'session/request_permission', params });
  await tick();
  assert.deepEqual(
    f.events.filter((e) => e.type === 'permission').map((e) => e.requestId),
    ['permission-1', 9],
  );
  assert.equal(f.received.filter((r) => !r.method && r.result?.outcome).length, 0);
  await f.client.respondPermission({ requestId: 'permission-1', optionId: 'yes' });
  await f.client.respondPermission({ requestId: 9, cancelled: true });
  assert.deepEqual(
    f.received.filter((r) => !r.method && r.result?.outcome).map((r) => [r.id, r.result.outcome]),
    [
      ['permission-1', { outcome: 'selected', optionId: 'yes' }],
      [9, { outcome: 'cancelled' }],
    ],
  );
});

test('cancel keeps the turn active until server completion and settles permission UI', async (t) => {
  const f = fixture(t);
  await f.client.newSession({ cwd: 'C:\\project' });
  await f.client.send({ sessionId: 'session-a', text: 'work' });
  await tick();
  f.child().deliver({
    jsonrpc: '2.0',
    id: 'p',
    method: 'session/request_permission',
    params: { sessionId: 'session-a', options: [] },
  });
  await tick();
  const cancelled = f.client.cancel({ sessionId: 'session-a' });
  await tick();
  assert.ok(f.client.activeTurn);
  assert.equal(f.received.filter((r) => r.method === 'session/cancel').length, 1);
  assert.equal(f.events.filter((e) => e.type === 'turn-end').length, 0);
  f.child().reply(f.child().prompt, { stopReason: 'cancelled' });
  await cancelled;
  assert.equal(f.client.activeTurn, null);
  assert.ok(f.events.some((e) => e.type === 'permission-resolved' && e.requestId === 'p'));
});

test('split UTF8 chunks stay intact; malformed protocol terminates the affected foreground turn', async (t) => {
  const f = fixture(t);
  await f.client.newSession({ cwd: 'C:\\project' });
  await f.client.send({ sessionId: 'session-a', text: 'work' });
  await tick();
  const bytes = Buffer.from(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'session-a',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '你好' } },
      },
    }) + '\n',
  );
  const split = bytes.indexOf(Buffer.from('你')) + 1;
  f.child().stdout.write(bytes.subarray(0, split));
  f.child().stdout.write(bytes.subarray(split));
  await tick();
  assert.equal(f.events.find((e) => e.type === 'update').update.content.text, '你好');
  f.child().stdout.write('{broken-json}\n');
  await tick();
  assert.equal(f.client.connected, false);
  assert.equal(f.client.activeTurn, null);
  assert.equal(f.events.filter((e) => e.type === 'turn-error').length, 1);
});

test('accepts the official model Result and applies model_changed notifications to effort selection', async (t) => {
  const f = fixture(t, (req, child) => {
    if (req.method !== 'session/set_model') return false;
    child.reply(req, { _meta: { model: { Ok: 'grok' } } });
    return true;
  });
  await f.client.newSession({ cwd: 'C:\\project' });
  const configured = await f.client.configure({
    sessionId: 'session-a',
    modelId: 'grok',
    effort: 'high',
  });
  assert.equal(configured.models.currentModelId, 'grok');
  assert.equal(configured.models.availableModels[0]._meta.reasoningEffort, 'high');
  f.child().deliver({
    jsonrpc: '2.0',
    method: '_x.ai/session_notification',
    params: {
      sessionId: 'session-a',
      update: { sessionUpdate: 'model_changed', model_id: 'grok', reasoning_effort: 'low' },
    },
  });
  await tick();
  assert.equal(f.client.models.availableModels[0]._meta.reasoningEffort, 'low');
  assert.ok(
    f.events.some(
      (e) =>
        e.type === 'models' &&
        e.sessionId === 'session-a' &&
        e.models.availableModels[0]._meta.reasoningEffort === 'low',
    ),
  );
  assert.ok(
    f.events.some(
      (e) =>
        e.type === 'notification' &&
        e.kind === 'model_changed' &&
        e.payload.reasoning_effort === 'low',
    ),
  );
});

test('successful replay is returned once with dynamic commands and cannot become a live turn', async (t) => {
  const f = fixture(t, (req, child) => {
    if (req.method !== 'session/load') return false;
    child.deliver({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'session-b',
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'Earlier question' },
        },
      },
    });
    child.deliver({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'session-b',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Earlier answer' },
        },
      },
    });
    child.reply(req, {
      models,
      modes: { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }] },
      _meta: { history: true },
    });
    return true;
  });
  await f.client.newSession({ cwd: 'C:\\project' });
  const loaded = await f.client.loadSession({ cwd: 'C:\\project', sessionId: 'session-b' });
  assert.deepEqual(f.received.find((req) => req.method === 'session/load').params._meta, {
    yoloMode: false,
    autoMode: false,
  });
  assert.equal(loaded.updates.length, 2);
  assert.equal(loaded._meta.history, true);
  assert.equal(f.events.filter((e) => e.type === 'update').length, 0);
  assert.equal(f.client.activeSessionId, 'session-b');
  f.child().deliver({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'session-b',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'new-skill' }],
      },
    },
  });
  await tick();
  assert.deepEqual(f.client.commands, [{ name: 'new-skill' }]);
  await assert.rejects(f.client.send({ sessionId: 'session-a', text: 'wrong session' }), /载入/);
});

test('explicit auto approval selects an advertised allow option and process exit resolves foreground state', async (t) => {
  const f = fixture(t);
  await f.client.newSession({ cwd: 'C:\\project', permissionMode: 'auto' });
  await f.client.send({ sessionId: 'session-a', text: 'work' });
  await tick();
  f.child().deliver({
    jsonrpc: '2.0',
    id: 'auto',
    method: 'session/request_permission',
    params: {
      sessionId: 'session-a',
      options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow' }],
    },
  });
  await tick();
  assert.equal(
    f.received.find((r) => r.id === 'auto' && !r.method).result.outcome.optionId,
    'allow',
  );
  f.child().emit('exit', 1, null);
  await tick();
  assert.equal(f.client.activeTurn, null);
  assert.equal(f.client.connected, false);
  assert.equal(f.events.filter((e) => e.type === 'turn-error').length, 1);
  await f.client.ensure();
  assert.equal(f.children.length, 2);
  assert.equal(f.client.connected, true);
});

test('cancel timeout interrupts only the owned child and next action can reconnect', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  await f.client.newSession({ cwd: 'C:\\project' });
  await f.client.send({ sessionId: 'session-a', text: 'work' });
  await tick();
  const stopped = f.client.cancel({ sessionId: 'session-a' });
  t.mock.timers.tick(12001);
  await stopped;
  assert.equal(f.client.activeTurn, null);
  assert.equal(f.client.connected, false);
  assert.equal(f.events.filter((e) => e.type === 'turn-error').length, 1);
  assert.match(f.events.find((e) => e.type === 'turn-error').message, /中断/);
  await f.client.ensure();
  assert.equal(f.children.length, 2);
});

test('a timed-out history query does not abort the independent foreground prompt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, (req) => req.method === 'session/list');
  await f.client.newSession({ cwd: 'C:\\project' });
  await f.client.send({ sessionId: 'session-a', text: 'work' });
  await tick();
  const query = f.client.listSessions({ cwd: 'C:\\project' });
  const rejected = assert.rejects(query, /超时/);
  await tick();
  t.mock.timers.tick(30001);
  await rejected;
  assert.equal(f.client.connected, true);
  assert.equal(f.client.activeTurn.sessionId, 'session-a');
  assert.equal(f.events.filter((e) => e.type === 'turn-error').length, 0);
  f.child().reply(f.child().prompt, { stopReason: 'end_turn' });
  await tick();
  assert.equal(f.client.activeTurn, null);
});

test('model domain errors reject before recording a successful effort or sending the prompt', async (t) => {
  const f = fixture(t, (req, child) => {
    if (req.method !== 'session/set_model') return false;
    child.reply(req, {
      _meta: { model: { Err: { code: -32603, message: 'session has no sampling config' } } },
    });
    return true;
  });
  await f.client.newSession({ cwd: 'C:\\project' });
  await assert.rejects(
    f.client.send({ sessionId: 'session-a', text: 'work', effort: 'high' }),
    /no sampling config/,
  );
  assert.equal(f.client.models.availableModels[0]._meta.reasoningEffort, undefined);
  assert.equal(f.received.filter((req) => req.method === 'session/prompt').length, 0);
  assert.equal(f.client.activeTurn, null);
});

test('context domain errors are reported even when the extension also returns partial data', async (t) => {
  const f = fixture(t, (req, child) => {
    if (req.method !== '_x.ai/session/info') return false;
    child.reply(req, {
      result: { sessionId: 'session-a' },
      error: { code: 'SESSION_UNAVAILABLE', message: 'context state unavailable' },
    });
    return true;
  });
  await f.client.ensure();
  await assert.rejects(f.client.usage({ sessionId: 'session-a' }), /context state unavailable/);
});

test('changing permission mode during a turn affects only future requests and never auto-resolves existing prompts', async (t) => {
  const f = fixture(t);
  await f.client.newSession({ cwd: 'C:\\project' });
  const turn = await f.client.send({ sessionId: 'session-a', text: 'work' });
  await tick();
  const params = {
    sessionId: 'session-a',
    options: [{ optionId: 'once', kind: 'allow_once', name: 'Allow once' }],
  };
  const request = (id) =>
    f.child().deliver({ jsonrpc: '2.0', id, method: 'session/request_permission', params });
  const response = (id) => f.received.find((item) => item.id === id && !item.method);
  request('pending-before-switch');
  await tick();
  const rpcCount = f.received.length;
  assert.deepEqual(f.client.setPermissionMode({ sessionId: 'session-a', permissionMode: 'auto' }), {
    sessionId: 'session-a',
    permissionMode: 'auto',
  });
  assert.equal(f.received.length, rpcCount);
  assert.equal(response('pending-before-switch'), undefined);
  request('new-auto-request');
  await tick();
  assert.deepEqual(response('new-auto-request').result.outcome, {
    outcome: 'selected',
    optionId: 'once',
  });
  assert.equal(response('pending-before-switch'), undefined);
  f.client.setPermissionMode({ sessionId: 'session-a', permissionMode: 'ask' });
  request('new-ask-request');
  await tick();
  assert.equal(response('new-ask-request'), undefined);
  assert.equal(f.client.activeTurn.turnId, turn.turnId);
  assert.equal(f.children.length, 1);
  assert.equal(f.received.filter((item) => item.method === 'session/prompt').length, 1);
  f.client.respondPermission({ requestId: 'pending-before-switch', optionId: 'once' });
  f.client.respondPermission({ requestId: 'new-ask-request', cancelled: true });
  f.child().reply(f.child().prompt, { stopReason: 'end_turn' });
  await tick();
});

test('auto permission mode keeps asking when only a persistent allow option is advertised', async (t) => {
  const f = fixture(t);
  await f.client.newSession({ cwd: 'C:\\project', permissionMode: 'auto' });
  await f.client.send({ sessionId: 'session-a', text: 'work' });
  await tick();
  f.child().deliver({
    jsonrpc: '2.0',
    id: 'persistent-only',
    method: 'session/request_permission',
    params: {
      sessionId: 'session-a',
      options: [
        { optionId: 'always', kind: 'allow_always', name: 'Always allow' },
        { optionId: 'reject', kind: 'reject_once', name: 'Reject' },
      ],
    },
  });
  await tick();
  assert.equal(
    f.received.find((item) => item.id === 'persistent-only' && !item.method),
    undefined,
  );
  assert.ok(
    f.events.some((event) => event.type === 'permission' && event.requestId === 'persistent-only'),
  );
  f.client.respondPermission({ requestId: 'persistent-only', cancelled: true });
});

test('permission mode validation rejects invalid or unloaded targets and cancellation still takes precedence', async (t) => {
  const f = fixture(t);
  await f.client.newSession({ cwd: 'C:\\project' });
  assert.throws(
    () => f.client.setPermissionMode({ sessionId: 'session-a', permissionMode: 'always' }),
    /权限|模式/,
  );
  assert.throws(
    () => f.client.setPermissionMode({ sessionId: 'unloaded', permissionMode: 'auto' }),
    /会话|载入/,
  );
  await f.client.send({ sessionId: 'session-a', text: 'work' });
  await tick();
  const cancelled = f.client.cancel({ sessionId: 'session-a' });
  f.client.setPermissionMode({ sessionId: 'session-a', permissionMode: 'auto' });
  f.child().deliver({
    jsonrpc: '2.0',
    id: 'after-cancel',
    method: 'session/request_permission',
    params: {
      sessionId: 'session-a',
      options: [{ optionId: 'once', kind: 'allow_once', name: 'Allow once' }],
    },
  });
  await tick();
  assert.deepEqual(
    f.received.find((item) => item.id === 'after-cancel' && !item.method).result.outcome,
    { outcome: 'cancelled' },
  );
  f.child().reply(f.child().prompt, { stopReason: 'cancelled' });
  await cancelled;
});

test('snapshots expose session permission mode; reloading preserves known modes and new history defaults to ask', async (t) => {
  const f = fixture(t);
  assert.equal((await f.client.newSession({ cwd: 'C:\\project' })).permissionMode, 'ask');
  f.client.setPermissionMode({ sessionId: 'session-a', permissionMode: 'auto' });
  assert.equal(
    (await f.client.loadSession({ cwd: 'C:\\project', sessionId: 'session-a' })).permissionMode,
    'auto',
  );
  assert.equal(
    (await f.client.loadSession({ cwd: 'C:\\project', sessionId: 'history-b' })).permissionMode,
    'ask',
  );
  assert.equal(
    (await f.client.loadSession({ cwd: 'C:\\project', sessionId: 'session-a' })).permissionMode,
    'auto',
  );
});

test('after reconnect a loaded session defaults to ask and its prior mode can be explicitly restored', async (t) => {
  const f = fixture(t);
  const initial = await f.client.newSession({ cwd: 'C:\\project', permissionMode: 'auto' });
  assert.equal(initial.permissionMode, 'auto');
  await f.client.restart();
  const loaded = await f.client.loadSession({ cwd: 'C:\\project', sessionId: 'session-a' });
  assert.equal(loaded.permissionMode, 'ask');
  f.client.setPermissionMode({ sessionId: 'session-a', permissionMode: initial.permissionMode });
  await f.client.send({ sessionId: 'session-a', text: 'continue' });
  await tick();
  f.child().deliver({
    jsonrpc: '2.0',
    id: 'restored-auto',
    method: 'session/request_permission',
    params: {
      sessionId: 'session-a',
      options: [{ optionId: 'once', kind: 'allow_once', name: 'Allow once' }],
    },
  });
  await tick();
  assert.deepEqual(
    f.received.find((item) => item.id === 'restored-auto' && !item.method).result.outcome,
    { outcome: 'selected', optionId: 'once' },
  );
});

test('a permission switch while preparing a prompt supersedes the mode captured when Send was clicked', async (t) => {
  let configureRequest;
  const f = fixture(t, (req) => {
    if (req.method !== 'session/set_model') return false;
    configureRequest = req;
    return true;
  });
  await f.client.newSession({ cwd: 'C:\\project' });
  const sending = f.client.send({
    sessionId: 'session-a',
    text: 'work',
    effort: 'high',
    permissionMode: 'ask',
  });
  await tick();
  assert.ok(configureRequest);
  f.client.setPermissionMode({ sessionId: 'session-a', permissionMode: 'auto' });
  f.child().reply(configureRequest, { _meta: { model: { Ok: 'grok' } } });
  await sending;
  f.child().deliver({
    jsonrpc: '2.0',
    id: 'latest-mode',
    method: 'session/request_permission',
    params: {
      sessionId: 'session-a',
      options: [{ optionId: 'once', kind: 'allow_once', name: 'Allow once' }],
    },
  });
  await tick();
  assert.deepEqual(
    f.received.find((item) => item.id === 'latest-mode' && !item.method)?.result.outcome,
    { outcome: 'selected', optionId: 'once' },
  );
});
