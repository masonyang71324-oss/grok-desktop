const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SessionHub } = require('../electron/session-hub.cjs');
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('workspace mutation reserves the directory before await and drains queued sends afterward', async () => {
  const { hub, clients } = fixture();
  const a = await hub.newSession({ cwd: '/same' });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const operation = hub.runWorkspaceMutation('/same', () => gate);
  await assert.rejects(
    hub.runWorkspaceMutation('/same', async () => {}),
    /目录/,
  );
  assert.equal(hub.activeTurn, null);
  assert.ok((await hub.send({ ...a, text: 'after restore' })).queueId);
  assert.deepEqual(clients[1].sent, []);
  release();
  await operation;
  await tick();
  assert.deepEqual(clients[1].sent, ['after restore']);
  await assert.rejects(
    hub.runWorkspaceMutation('/same', async () => {}),
    /目录/,
  );
});

test(
  'real ACP child processes survive session switching with isolated cancellation',
  { timeout: 15000 },
  async () => {
    const { spawn } = require('node:child_process');
    const children = [];
    const hub = new SessionHub({
      emit: () => {},
      getExecutable: () => process.execPath,
      spawnFn: (executable, args, options) => {
        const env = { ...process.env };
        delete env.GROK_DESKTOP_MOCK_STATE;
        delete env.GROK_DESKTOP_MOCK_LOG;
        const child = spawn(
          executable,
          [path.resolve(__dirname, '../scripts/mock-grok.cjs'), ...args],
          { ...options, env },
        );
        children.push(child);
        return child;
      },
    });
    try {
      const a = await hub.newSession({ cwd: os.tmpdir() });
      const b = await hub.newSession({ cwd: __dirname });
      await hub.send({ sessionId: a.sessionId, cwd: a.cwd, text: 'MOCK_CANCEL' });
      await hub.send({ sessionId: b.sessionId, cwd: b.cwd, text: 'MOCK_CANCEL' });
      assert.equal(children.length, 2);
      assert.notEqual(children[0].pid, children[1].pid);
      assert.ok((await hub.loadSession(a)).runtime.turnId);
      await hub.cancel(a);
      assert.ok((await hub.loadSession(b)).runtime.turnId);
      await hub.cancel(b);
      await tick();
      assert.equal(hub.activeTurn, null);
    } finally {
      hub.dispose();
    }
  },
);

function fixture(options = {}) {
  const clients = [],
    events = [];
  const hub = new SessionHub({
    ...options,
    emit: (event) => events.push(event),
    createClient: (emit) => {
      const client = {
        connected: true,
        capabilities: {},
        sent: [],
        replies: [],
        loads: 0,
        async newSession({ cwd }) {
          this.id = `session-${clients.indexOf(this)}`;
          return { sessionId: this.id, cwd, updates: [], models: {}, commands: [] };
        },
        async loadSession({ sessionId, cwd }) {
          this.loads++;
          this.id = sessionId;
          this.connected = true;
          return { sessionId, cwd, updates: [], models: {}, commands: [] };
        },
        async send(payload) {
          this.sent.push(payload.text);
          if (payload.text === 'connection-failure') {
            this.connected = false;
            emit({ type: 'connection', state: 'error', message: 'failed before prompt' });
            throw new Error('failed before prompt');
          }
          if (payload.text === 'reject') throw new Error('rejected');
          this.activeTurn = {};
          emit({ type: 'turn-start', sessionId: this.id, turnId: 'raw' });
          return { turnId: 'raw' };
        },
        publish(event) {
          emit(event);
        },
        permission() {
          emit({
            type: 'permission',
            turnId: 'raw',
            sessionId: this.id,
            requestId: 1,
            params: { options: [{ optionId: 'yes' }] },
          });
        },
        respondPermission(payload) {
          this.replies.push(payload);
          emit({ type: 'permission-resolved', requestId: 1 });
        },
        update(text) {
          emit({
            type: 'update',
            turnId: 'raw',
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
          });
        },
        background(active) {
          emit({
            type: 'notification',
            kind: active ? 'task_backgrounded' : 'task_completed',
            payload: { task_id: 'background-1' },
          });
        },
        workflow(status) {
          emit({
            type: 'notification',
            kind: 'workflow_updated',
            payload: { run_id: 'workflow-1', status },
          });
        },
        finish(error) {
          this.activeTurn = null;
          emit(error ? { type: 'turn-error', message: error } : { type: 'turn-end', result: {} });
        },
        disconnect() {
          this.connected = false;
          this.finish('process exited');
          emit({ type: 'connection', state: 'error', message: 'process exited' });
        },
        async cancel() {
          this.cancelled = true;
          this.finish();
        },
        dispose() {
          this.connected = false;
        },
      };
      clients.push(client);
      return client;
    },
  });
  return { hub, clients, events };
}

test('two sessions isolate permission IDs, cancellation and live reload snapshots', async () => {
  const { hub, clients } = fixture();
  const a = await hub.newSession({ cwd: '/a' }),
    b = await hub.newSession({ cwd: '/b' });
  const first = await hub.send({ ...a, text: 'hello' });
  await hub.send({ ...b, text: 'world' });
  clients[1].permission();
  clients[2].permission();
  clients[1].update('answer');
  assert.throws(() => hub.respondPermission({ requestId: 1, optionId: 'yes' }));
  hub.respondPermission({ sessionId: a.sessionId, requestId: 1, optionId: 'yes' });
  assert.equal(clients[1].replies.length, 1);
  assert.equal(clients[2].replies.length, 0);
  const snapshot = await hub.loadSession(a);
  assert.equal(clients[1].loads, 0);
  assert.equal(snapshot.runtime.turnId, first.turnId);
  assert.equal(snapshot.updates.at(-1).content.text, 'answer');
  assert.equal((await hub.loadSession(b)).runtime.permissions.length, 1);
  await hub.cancel(a);
  await tick();
  assert.equal(clients[2].cancelled, undefined);
  assert.equal(hub.listTasks()[1].status, 'waiting');
});

test('switching conversations preserves live mode and configuration updates in the cached snapshot', async () => {
  const { hub, clients } = fixture();
  const a = await hub.newSession({ cwd: '/a' });
  const modes = {
    currentModeId: 'code',
    availableModes: [
      { id: 'code', name: 'Code' },
      { id: 'plan', name: 'Plan' },
    ],
  };
  clients[1].publish({ type: 'session', session: { ...a, modes, configOptions: [] } });
  await hub.newSession({ cwd: '/b' });
  clients[1].publish({
    type: 'update',
    update: { sessionUpdate: 'current_mode_update', currentModeId: 'plan' },
  });
  const configOptions = [
    {
      id: 'reasoning_effort',
      category: 'thought_level',
      type: 'select',
      currentValue: 'high',
      options: [{ value: 'high', name: 'High' }],
    },
  ];
  clients[1].publish({
    type: 'update',
    update: { sessionUpdate: 'config_option_update', configOptions },
  });
  clients[1].publish({
    type: 'notification',
    kind: 'model_changed',
    payload: {
      sessionUpdate: 'model_changed',
      model_id: 'grok-4.7',
      reasoning_effort: 'high',
      context_window_selection: 500000,
    },
  });
  const reopened = await hub.loadSession(a);
  assert.equal(reopened.modes.currentModeId, 'plan');
  assert.deepEqual(reopened.configOptions, configOptions);
  assert.equal(reopened.contextWindow, 500000);
  assert.equal(clients[1].loads, 0);
});

test('same directory serializes turns and completion hooks, queues are FIFO and removable', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let finishes = 0;
  const { hub, clients } = fixture({
    afterTurn: async () => {
      if (++finishes === 1) await gate;
    },
  });
  const a = await hub.newSession({ cwd: '/same' }),
    b = await hub.newSession({ cwd: '/same' });
  await hub.send({ ...a, text: 'one' });
  const queued = await hub.send({ ...b, text: 'two' });
  assert.ok(queued.queueId);
  const removed = hub.enqueue({ ...b, text: 'remove' });
  hub.enqueue({ ...b, text: 'three' });
  hub.remove({ ...b, queueId: removed.queueId });
  clients[1].finish();
  await tick();
  assert.deepEqual(clients[2].sent, []);
  release();
  await tick();
  assert.deepEqual(clients[2].sent, ['two']);
  clients[2].finish();
  await tick();
  assert.deepEqual(clients[2].sent, ['two', 'three']);
});

test('stopping ACP preparation prevents submission and keeps queued work paused until resume', async () => {
  const { GrokClient } = require('../electron/acp.cjs');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const prompts = [];
  const hub = new SessionHub({
    emit: () => {},
    createClient: (emit) => {
      const client = new GrokClient({ emit, getExecutable: () => assert.fail('must not spawn') });
      client.connected = true;
      client.newSession = async ({ cwd }) => structuredClone(client._snapshot('prepared', cwd, {}));
      const prepare = client._promptContent.bind(client);
      client._promptContent = async (...args) => {
        await gate;
        return prepare(...args);
      };
      client._request = (method, params) => {
        assert.equal(method, 'session/prompt');
        prompts.push(params.prompt[0].text);
        return new Promise(() => {});
      };
      return client;
    },
  });
  try {
    const session = await hub.newSession({ cwd: '/preparing' });
    hub.enqueue({ ...session, text: 'first' });
    hub.enqueue({ ...session, text: 'later' });
    await tick();
    assert.equal(hub.listTasks()[0].status, 'running');
    await hub.cancel(session);
    release();
    await Promise.allSettled([...hub.pending]);
    assert.deepEqual(prompts, []);
    const stopped = hub.listTasks()[0];
    assert.equal(stopped.lastTurn.status, 'cancelled');
    assert.equal(stopped.turnId, undefined);
    assert.deepEqual(
      stopped.queued.map((item) => item.text),
      ['first', 'later'],
    );
    hub.resume(session);
    await Promise.allSettled([...hub.pending]);
    assert.deepEqual(prompts, ['first']);
    assert.deepEqual(
      hub.listTasks()[0].queued.map((item) => item.text),
      ['later'],
    );
  } finally {
    release();
    await hub.dispose();
  }
});

test('failed and cancelled turns pause queued inputs until explicit resume', async () => {
  const { hub, clients } = fixture();
  const a = await hub.newSession({ cwd: '/a' });
  await hub.send({ ...a, text: 'one' });
  hub.enqueue({ ...a, text: 'two' });
  clients[1].finish('network error');
  await tick();
  assert.deepEqual(clients[1].sent, ['one']);
  assert.equal(hub.listTasks()[0].status, 'error');
  hub.resume(a);
  await tick();
  assert.deepEqual(clients[1].sent, ['one', 'two']);
  hub.enqueue({ ...a, text: 'three' });
  await hub.cancel(a);
  await tick();
  assert.equal(hub.listTasks()[0].queued.length, 1);
  assert.equal(hub.listTasks()[0].status, 'paused');
});

test('restart restores active input and attachments paused without replay', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-hub-'));
  try {
    const storageFile = path.join(directory, 'queues.json');
    const first = fixture({ storageFile });
    const a = await first.hub.newSession({ cwd: directory });
    await first.hub.send({
      ...a,
      text: 'interrupted',
      attachments: [{ kind: 'text', text: 'context', name: 'selection', path: '' }],
    });
    first.hub.enqueue({ ...a, text: 'next' });
    first.hub.dispose();
    const second = fixture({ storageFile });
    await tick();
    assert.equal(second.hub.listTasks()[0].status, 'interrupted');
    assert.deepEqual(
      second.hub.listTasks()[0].queued.map((item) => item.text),
      ['interrupted', 'next'],
    );
    assert.deepEqual(second.clients[1].sent, []);
    assert.equal(
      second.hub.sessions.get(a.sessionId).queue[0].payload.attachments[0].text,
      'context',
    );
    second.hub.resume(a);
    await tick();
    assert.deepEqual(second.clients[1].sent, ['interrupted']);
    second.hub.dispose();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejected direct submission stays in renderer draft without adding a duplicate paused queue item', async () => {
  const { hub, clients } = fixture();
  const a = await hub.newSession({ cwd: '/same' }),
    b = await hub.newSession({ cwd: '/same' });
  await assert.rejects(hub.send({ ...a, text: 'reject' }), /rejected/);
  assert.equal(hub.listTasks()[0].queued.length, 0);
  await hub.send({ ...a, text: 'corrected' });
  assert.deepEqual(clients[1].sent, ['reject', 'corrected']);
  clients[1].finish();
  await tick();
  await hub.send({ ...b, text: 'works' });
  assert.deepEqual(clients[2].sent, ['works']);
});

test('shutdown waits for a pending checkpoint baseline and its final capture', async () => {
  let releaseBegin,
    releaseFinish,
    finished = false;
  const hubFixture = fixture({
    beforeTurn: () =>
      new Promise((resolve) => {
        releaseBegin = resolve;
      }),
    afterTurn: () =>
      new Promise((resolve) => {
        releaseFinish = () => {
          finished = true;
          resolve();
        };
      }),
  });
  const a = await hubFixture.hub.newSession({ cwd: '/project' });
  const sending = hubFixture.hub.send({ ...a, text: 'pending' }).catch(() => {});
  await tick();
  let disposed = false;
  const disposal = Promise.resolve(hubFixture.hub.dispose()).then(() => {
    disposed = true;
  });
  await tick();
  assert.equal(disposed, false);
  releaseBegin();
  await tick();
  assert.equal(typeof releaseFinish, 'function');
  assert.equal(disposed, false);
  releaseFinish();
  await Promise.all([disposal, sending]);
  assert.equal(finished, true);
});

test('background work retains directory lock and checkpoint until its completion', async () => {
  let finished = 0;
  const { hub, clients } = fixture({
    afterTurn: async () => {
      finished++;
    },
  });
  const a = await hub.newSession({ cwd: '/same' });
  const b = await hub.newSession({ cwd: '/same' });
  await hub.send({ ...a, text: 'start background task' });
  clients[1].background(true);
  clients[1].finish();
  await tick();
  assert.ok((await hub.send({ ...b, text: 'next' })).queueId);
  await tick();
  assert.equal(finished, 0);
  assert.equal(clients[2].sent.length, 0);
  await assert.rejects(hub.runWorkspaceMutation('/same', async () => {}));
  clients[1].background(false);
  await tick();
  assert.equal(finished, 1);
  assert.deepEqual(clients[2].sent, ['next']);
  await hub.dispose();
});

test('CLI death retains interrupted input and pauses later queue messages', async () => {
  const { hub, clients } = fixture();
  const a = await hub.newSession({ cwd: '/a' });
  await hub.send({ ...a, text: 'interrupted input' });
  hub.enqueue({ ...a, text: 'later' });
  clients[1].disconnect();
  await tick();
  const task = hub.listTasks()[0];
  assert.equal(task.status, 'interrupted');
  assert.deepEqual(
    task.queued.map((item) => item.text),
    ['interrupted input', 'later'],
  );
  assert.equal(hub.activeTurn, null);
  assert.deepEqual(clients[1].sent, ['interrupted input']);
});

test('pre-send connection failure retains queued input but does not duplicate a direct draft', async () => {
  const { hub } = fixture();
  const a = await hub.newSession({ cwd: '/a' });
  await assert.rejects(hub.send({ ...a, text: 'connection-failure' }), /before prompt/);
  assert.deepEqual(hub.listTasks()[0].queued, []);
  hub.enqueue({ ...a, text: 'connection-failure' });
  hub.resume(a);
  await tick();
  assert.equal(hub.listTasks()[0].queued.length, 1);
  assert.equal(hub.listTasks()[0].queued[0].text, 'connection-failure');
});

test('advertised workflow controls run on the owning transport while ordinary sends keep waiting', async () => {
  const captured = [];
  const { hub, clients, events } = fixture({
    afterTurn: async (turn) => captured.push(turn.turnId),
  });
  const a = await hub.newSession({ cwd: '/same' });
  const b = await hub.newSession({ cwd: '/same' });
  hub.sessions.get(a.sessionId).snapshot.commands = [{ name: 'workflow' }];
  const original = await hub.send({ ...a, text: 'start workflow' });
  clients[1].workflow('active');
  clients[1].finish();
  await tick();
  const ordinary = await hub.send({ ...a, text: 'ordinary input' });
  await hub.send({ ...b, text: 'other session' });
  for (const operation of ['pause', 'resume']) {
    const control = await hub.send({ ...a, text: `/workflow ${operation} example` });
    assert.ok(control.turnId);
    assert.notEqual(control.turnId, original.turnId);
    const snapshot = await hub.loadSession(a);
    assert.equal(snapshot.runtime.turnId, control.turnId);
    assert.equal(
      snapshot.updates[snapshot.runtime.activeTurnStartIndex].content.text,
      `/workflow ${operation} example`,
    );
    clients[1].permission();
    assert.equal((await hub.loadSession(a)).runtime.permissions[0].turnId, control.turnId);
    hub.respondPermission({ ...a, requestId: 1, optionId: 'yes' });
    clients[1].workflow(operation === 'pause' ? 'user_paused' : 'active');
    clients[1].finish();
    await tick();
    assert.equal(captured.length, 0);
  }
  hub.remove({ ...a, queueId: ordinary.queueId });
  const control = await hub.send({ ...a, text: '/workflow stop example' });
  assert.equal(clients.length, 3, 'controls reuse the owned ACP connection');
  clients[1].workflow('cancelled');
  await tick();
  assert.equal(captured.length, 0, 'checkpoint waits for the control foreground reply too');
  assert.deepEqual(clients[2].sent, []);
  clients[1].update('stopped');
  assert.equal(events.filter((event) => event.type === 'update').at(-1).turnId, control.turnId);
  clients[1].finish();
  await tick();
  assert.deepEqual(captured, [original.turnId]);
  assert.deepEqual(clients[2].sent, ['other session']);
  await hub.dispose();
});

test('unadvertised, ordinary and attached workflow prompts cannot bypass a background directory lock', async () => {
  const { hub, clients } = fixture();
  const a = await hub.newSession({ cwd: '/a' });
  await hub.send({ ...a, text: 'start' });
  clients[1].workflow('active');
  clients[1].finish();
  await tick();
  assert.ok((await hub.send({ ...a, text: '/workflow stop example' })).queueId);
  hub.sessions.get(a.sessionId).snapshot.commands = [{ name: 'workflow' }];
  assert.ok((await hub.send({ ...a, text: '/workflow run example' })).queueId);
  assert.ok(
    (await hub.send({ ...a, text: '/workflow stop example\nthen edit', attachments: [] })).queueId,
  );
  assert.ok(
    (
      await hub.send({
        ...a,
        text: '/workflow stop example',
        attachments: [{ name: 'extra', path: '' }],
      })
    ).queueId,
  );
  assert.deepEqual(clients[1].sent, ['start']);
  await hub.dispose();
});

test('owned start time survives live session reloads and permission waits', async () => {
  const { hub, clients, events } = fixture();
  const a = await hub.newSession({ cwd: '/a' });
  const sent = await hub.send({ ...a, text: 'work' });
  const started = events.find((event) => event.type === 'turn-start');
  assert.match(started.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(started.turnId, sent.turnId);
  clients[1].permission();
  const reopened = await hub.loadSession(a);
  assert.equal(reopened.runtime.status, 'waiting');
  assert.equal(reopened.runtime.startedAt, started.startedAt);
  assert.equal(hub.listTasks()[0].startedAt, started.startedAt);
  hub.respondPermission({ ...a, requestId: 1, optionId: 'yes' });
  clients[1].finish();
  await tick();
  const completed = (await hub.loadSession(a)).runtime;
  assert.equal(completed.startedAt, undefined);
  assert.equal(completed.lastTurn.startedAt, started.startedAt);
  assert.equal(completed.lastTurn.status, 'completed');
  assert.ok(Date.parse(completed.lastTurn.finishedAt) >= Date.parse(started.startedAt));
  await hub.dispose();
});

test('completion summary is published once after the final checkpoint hook settles', async () => {
  let release;
  const { hub, clients, events } = fixture({
    afterTurn: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const a = await hub.newSession({ cwd: '/a' });
  const sent = await hub.send({ ...a, text: 'work' });
  const startedAt = hub.listTasks()[0].startedAt;
  assert.ok(startedAt);
  clients[1].publish({ type: 'turn-end', result: { stopReason: 'end_turn' } });
  await tick();
  const finishing = hub.listTasks()[0];
  assert.equal(finishing.startedAt, startedAt);
  assert.equal(finishing.lastTurn, undefined);
  assert.equal(finishing.turnId, undefined);
  assert.equal(finishing.finishing, true);
  assert.equal(events.filter((event) => event.type === 'task-finished').length, 0);
  clients[1].finish();
  release({ checkpointId: 'checkpoint-1' });
  await tick();
  const completed = hub.listTasks()[0];
  assert.equal(completed.finishing, false);
  assert.deepEqual(completed.lastTurn, {
    turnId: sent.turnId,
    startedAt,
    finishedAt: completed.lastTurn.finishedAt,
    status: 'completed',
    facts: {
      toolCount: 0,
      completedToolCount: 0,
      failedToolCount: 0,
      unfinishedToolCount: 0,
      verification: { count: 0, passed: 0, failed: 0, unknown: 0 },
    },
    stopReason: 'end_turn',
    checkpointId: 'checkpoint-1',
  });
  const lastTurn = completed.lastTurn;
  clients[1].finish('late duplicate');
  await tick();
  assert.deepEqual(hub.listTasks()[0].lastTurn, lastTurn);
  assert.deepEqual(
    events.filter((event) => event.type === 'task-finished'),
    [
      {
        type: 'task-finished',
        sessionId: a.sessionId,
        turnId: sent.turnId,
        status: 'completed',
      },
    ],
  );
  await hub.dispose();
});

test('foreground completion keeps the parent clock and waits for background work', async () => {
  const { hub, clients, events } = fixture({
    afterTurn: async () => ({ checkpointId: 'background-checkpoint' }),
  });
  const a = await hub.newSession({ cwd: '/a' });
  const sent = await hub.send({ ...a, text: 'background work' });
  const startedAt = hub.listTasks()[0].startedAt;
  assert.ok(startedAt);
  clients[1].background(true);
  clients[1].finish();
  await tick();
  assert.equal(hub.listTasks()[0].status, 'background');
  assert.equal((await hub.loadSession(a)).runtime.startedAt, startedAt);
  assert.equal(hub.listTasks()[0].lastTurn, undefined);
  assert.equal(events.filter((event) => event.type === 'task-finished').length, 0);
  clients[1].background(false);
  await tick();
  assert.equal(hub.listTasks()[0].lastTurn.turnId, sent.turnId);
  assert.equal(hub.listTasks()[0].lastTurn.startedAt, startedAt);
  assert.equal(hub.listTasks()[0].lastTurn.checkpointId, 'background-checkpoint');
  assert.equal(events.filter((event) => event.type === 'task-finished').length, 1);
  await hub.dispose();
});

test('final summaries distinguish cancellation, failure, interruption and checkpoint failure', async () => {
  for (const [outcome, finish] of [
    ['cancelled', (hub, client, session) => hub.cancel(session)],
    ['failed', (_hub, client) => client.finish('network error')],
    ['interrupted', (_hub, client) => client.disconnect()],
  ]) {
    const { hub, clients } = fixture();
    const a = await hub.newSession({ cwd: '/a' });
    const sent = await hub.send({ ...a, text: 'work' });
    await finish(hub, clients[1], a);
    await tick();
    const task = hub.listTasks()[0];
    assert.equal(task.lastTurn?.status, outcome);
    assert.equal(task.lastTurn.turnId, sent.turnId);
    if (outcome === 'failed') assert.equal(task.lastTurn.error, 'network error');
    if (outcome === 'interrupted') assert.equal(task.lastTurn.error, 'process exited');
    await hub.dispose();
  }
  const { hub, clients } = fixture({
    afterTurn: async () => {
      throw new Error('capture failed');
    },
  });
  const a = await hub.newSession({ cwd: '/a' });
  await hub.send({ ...a, text: 'work' });
  clients[1].finish();
  await tick();
  assert.equal(hub.listTasks()[0].lastTurn?.status, 'failed');
  assert.equal(hub.listTasks()[0].lastTurn.error, 'capture failed');
  await hub.dispose();
});

test('ACP stop reasons distinguish normal completion from cancelled or interrupted results', async () => {
  for (const [stopReason, status] of [
    ['end_turn', 'completed'],
    ['cancelled', 'cancelled'],
    ['max_tokens', 'interrupted'],
    ['refusal', 'interrupted'],
  ]) {
    const { hub, clients } = fixture();
    const a = await hub.newSession({ cwd: '/a' });
    await hub.send({ ...a, text: 'work' });
    clients[1].publish({ type: 'turn-end', result: { stopReason } });
    await tick();
    assert.equal(hub.listTasks()[0].lastTurn?.status, status);
    assert.equal(hub.listTasks()[0].lastTurn.stopReason, stopReason);
    await hub.dispose();
  }
});

test('idle completion summaries survive storage reload without pausing or storing conversation content', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-hub-summary-'));
  try {
    const storageFile = path.join(directory, 'queues.json');
    const first = fixture({
      storageFile,
      afterTurn: async () => ({ checkpointId: 'saved-checkpoint' }),
    });
    const a = await first.hub.newSession({ cwd: directory });
    await first.hub.send({ ...a, text: 'private prompt' });
    first.clients[1].update('private tool output');
    first.clients[1].finish();
    await tick();
    const lastTurn = first.hub.listTasks()[0].lastTurn;
    assert.ok(lastTurn);
    const stored = fs.readFileSync(storageFile, 'utf8');
    assert.equal(stored.includes('private prompt'), false);
    assert.equal(stored.includes('private tool output'), false);
    assert.equal(JSON.parse(stored).length, 1);
    await first.hub.dispose();
    const second = fixture({ storageFile });
    const reopened = await second.hub.loadSession(a);
    assert.equal(reopened.runtime.status, 'idle');
    assert.equal(reopened.runtime.startedAt, undefined);
    assert.deepEqual(reopened.runtime.lastTurn, lastTurn);
    assert.deepEqual(second.hub.listTasks()[0].lastTurn, lastTurn);
    assert.equal(second.hub.sessions.get(a.sessionId).paused, false);
    await second.hub.dispose();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('stored summaries preserve paused and interrupted queue recovery', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-hub-recovery-'));
  try {
    for (const [outcome, status, finish] of [
      ['cancelled', 'paused', (hub, client, session) => hub.cancel(session)],
      ['failed', 'paused', (_hub, client) => client.finish('network error')],
      ['interrupted', 'interrupted', (_hub, client) => client.disconnect()],
    ]) {
      const storageFile = path.join(directory, `${outcome}.json`);
      const first = fixture({ storageFile });
      const a = await first.hub.newSession({ cwd: directory });
      await first.hub.send({ ...a, text: 'work' });
      first.hub.enqueue({ ...a, text: 'next' });
      await finish(first.hub, first.clients[1], a);
      await tick();
      const previous = first.hub.listTasks()[0];
      assert.equal(previous.lastTurn.status, outcome);
      await first.hub.dispose();
      const second = fixture({ storageFile });
      const restored = (await second.hub.loadSession(a)).runtime;
      assert.equal(restored.status, status);
      assert.deepEqual(restored.lastTurn, previous.lastTurn);
      assert.deepEqual(restored.queued, previous.queued);
      assert.deepEqual(second.clients[1].sent, []);
      await second.hub.dispose();
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('two sessions retain independent clocks and completion summaries', async () => {
  const { hub, clients } = fixture();
  const a = await hub.newSession({ cwd: '/a' });
  const b = await hub.newSession({ cwd: '/b' });
  const first = await hub.send({ ...a, text: 'first' });
  const second = await hub.send({ ...b, text: 'second' });
  const before = hub.listTasks();
  assert.ok(before[0].startedAt);
  assert.ok(before[1].startedAt);
  clients[1].finish();
  await tick();
  const tasks = hub.listTasks();
  assert.equal(tasks[0].lastTurn.turnId, first.turnId);
  assert.equal(tasks[0].lastTurn.startedAt, before[0].startedAt);
  assert.equal(tasks[1].turnId, second.turnId);
  assert.equal(tasks[1].startedAt, before[1].startedAt);
  assert.equal(tasks[1].lastTurn, undefined);
  clients[2].finish('second failed');
  await tick();
  assert.equal(hub.listTasks()[1].lastTurn.turnId, second.turnId);
  assert.equal(hub.listTasks()[1].lastTurn.status, 'failed');
  assert.equal(hub.listTasks()[0].lastTurn.status, 'completed');
  await hub.dispose();
});

test('workflow control timestamps preserve the owning task clock and result', async () => {
  const { hub, clients, events } = fixture();
  const a = await hub.newSession({ cwd: '/a' });
  hub.sessions.get(a.sessionId).snapshot.commands = [{ name: 'workflow' }];
  const owner = await hub.send({ ...a, text: 'start workflow' });
  const startedAt = hub.listTasks()[0].startedAt;
  assert.ok(startedAt);
  clients[1].workflow('active');
  clients[1].finish();
  await tick();
  const control = await hub.send({ ...a, text: '/workflow pause example' });
  const controlStart = events.filter((event) => event.type === 'turn-start').at(-1);
  assert.equal(controlStart.turnId, control.turnId);
  assert.match(controlStart.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(hub.listTasks()[0].startedAt, startedAt);
  clients[1].finish();
  await tick();
  assert.equal(hub.listTasks()[0].lastTurn, undefined);
  assert.equal(hub.listTasks()[0].startedAt, startedAt);
  clients[1].workflow('complete');
  await tick();
  assert.equal(hub.listTasks()[0].lastTurn.turnId, owner.turnId);
  assert.equal(hub.listTasks()[0].lastTurn.startedAt, startedAt);
  assert.equal(hub.listTasks()[0].lastTurn.status, 'completed');
  await hub.dispose();
});

test('owned tool facts merge partial updates and survive cold reload as counts without command output', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-hub-facts-'));
  try {
    const storageFile = path.join(directory, 'queues.json');
    const first = fixture({ storageFile });
    const a = await first.hub.newSession({ cwd: directory });
    await first.hub.send({ ...a, text: 'private prompt' });
    const publish = (update) => first.clients[1].publish({ type: 'update', turnId: 'raw', update });
    publish({
      sessionUpdate: 'tool_call',
      toolCallId: 'verify',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'npm test' },
    });
    publish({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'verify',
      status: 'completed',
      rawOutput: { exitCode: 1, stdout: 'PRIVATE OUTPUT' },
    });
    publish({ sessionUpdate: 'tool_call_update', toolCallId: 'verify', title: 'Finished checks' });
    publish({ sessionUpdate: 'tool_call', toolCallId: 'read', kind: 'read', status: 'completed' });
    publish({ sessionUpdate: 'tool_call', toolCallId: 'edit', kind: 'edit', status: 'failed' });
    publish({
      sessionUpdate: 'tool_call',
      toolCallId: 'masked',
      kind: 'execute',
      status: 'completed',
      rawInput: { command: 'npm test || true' },
      rawOutput: { exitCode: 0 },
    });
    publish({
      sessionUpdate: 'tool_call',
      toolCallId: 'semicolon',
      kind: 'execute',
      status: 'completed',
      rawInput: { command: 'npm test; echo done' },
      rawOutput: { exitCode: 0 },
    });
    publish({
      sessionUpdate: 'tool_call',
      toolCallId: 'unfinished',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'npm run build' },
    });
    first.clients[1].finish();
    await tick();
    const expected = {
      toolCount: 6,
      completedToolCount: 4,
      failedToolCount: 1,
      unfinishedToolCount: 1,
      verification: { count: 4, passed: 0, failed: 1, unknown: 3 },
    };
    assert.deepEqual(first.hub.listTasks()[0].lastTurn.facts, expected);
    await first.hub.dispose();
    const stored = fs.readFileSync(storageFile, 'utf8');
    assert.equal(stored.includes('npm test'), false);
    assert.equal(stored.includes('PRIVATE OUTPUT'), false);
    assert.equal(stored.includes('private prompt'), false);
    const second = fixture({ storageFile });
    const reopened = await second.hub.loadSession(a);
    assert.deepEqual(reopened.runtime.lastTurn.facts, expected);
    assert.equal(reopened.runtime.finishing, false);
    assert.deepEqual(reopened.updates, []);
    await second.hub.dispose();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cached live rows retain authoritative owner IDs and workflow control tools do not replace parent facts', async () => {
  const { hub, clients } = fixture();
  const a = await hub.newSession({ cwd: '/a' });
  hub.sessions.get(a.sessionId).snapshot.commands = [{ name: 'workflow' }];
  const owner = await hub.send({ ...a, text: 'start workflow' });
  clients[1].update('owner answer');
  clients[1].publish({
    type: 'update',
    turnId: 'raw',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'shared-id',
      kind: 'read',
      status: 'completed',
    },
  });
  clients[1].workflow('active');
  clients[1].finish();
  await tick();
  const control = await hub.send({ ...a, text: '/workflow stop example' });
  clients[1].publish({
    type: 'update',
    turnId: 'raw',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'shared-id',
      kind: 'execute',
      status: 'completed',
      rawInput: { command: 'npm test' },
      rawOutput: { exitCode: 0 },
    },
  });
  const reopened = await hub.loadSession(a);
  assert.deepEqual(
    reopened.updates.map((update) => update._desktopTurnId),
    [owner.turnId, owner.turnId, owner.turnId, control.turnId, control.turnId],
  );
  clients[1].workflow('cancelled');
  clients[1].finish();
  await tick();
  assert.equal(hub.listTasks()[0].lastTurn.turnId, owner.turnId);
  assert.deepEqual(hub.listTasks()[0].lastTurn.facts, {
    toolCount: 1,
    completedToolCount: 1,
    failedToolCount: 0,
    unfinishedToolCount: 0,
    verification: { count: 0, passed: 0, failed: 0, unknown: 0 },
  });
  await hub.dispose();
});

for (const bad of [
  '[{"sessionId":',
  '{}',
  '[{"sessionId":"s","cwd":"/project","queue":{}}]',
  '[{"sessionId":"s","cwd":"/project","queue":[{"id":"q","payload":null}]}]',
]) {
  test(`queue corruption is backed up and its warning remains readable: ${bad}`, async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-queue-recovery-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const storageFile = path.join(directory, 'queue.json');
    fs.writeFileSync(storageFile, bad);
    const { hub } = fixture({ storageFile });
    t.after(() => hub.dispose());
    assert.equal(hub.recoveryWarnings?.length, 1);
    assert.equal(hub.recoveryWarnings[0].kind, 'queue');
    const backup = hub.recoveryWarnings[0].backupPath;
    assert.match(backup, /corrupt/);
    assert.equal(fs.readFileSync(backup, 'utf8'), bad);
    await hub.newSession({ cwd: directory });
    assert.deepEqual(JSON.parse(fs.readFileSync(storageFile, 'utf8')), []);
    assert.equal(fs.readFileSync(backup, 'utf8'), bad);
    assert.equal(hub.recoveryWarnings.length, 1);
  });
}

test('failed queue recovery backup never overwrites corrupt data on later state changes', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-queue-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storageFile = path.join(directory, 'queue.json'),
    bad = Buffer.from('[broken\r\n');
  fs.writeFileSync(storageFile, bad);
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, target) => {
    if (source === storageFile) throw Object.assign(new Error('backup denied'), { code: 'EACCES' });
    return rename(source, target);
  });
  const { hub } = fixture({ storageFile });
  assert.equal(hub.recoveryWarnings?.[0]?.recoveryFailed, true);
  const session = await hub.newSession({ cwd: directory });
  await hub.send({ ...session, text: 'new task' });
  await hub.dispose();
  assert.deepEqual(fs.readFileSync(storageFile), bad);
});

test('queue persistence flushes changed state before send and skips identical notification snapshots', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-queue-write-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storageFile = path.join(directory, 'queue.json');
  const writes = [],
    write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (filename, data, options) => {
    if (filename === `${storageFile}.tmp`)
      writes.push({ data: JSON.parse(data), flush: options?.flush });
    return write(filename, data, options);
  });
  const { hub, clients } = fixture({ storageFile });
  const session = await hub.newSession({ cwd: directory });
  const send = clients[1].send.bind(clients[1]);
  clients[1].send = async (payload) => {
    const saved = JSON.parse(fs.readFileSync(storageFile, 'utf8'));
    assert.equal(saved[0].active.payload.text, payload.text);
    assert.equal(writes.at(-1).flush, true);
    return send(payload);
  };
  await hub.send({ ...session, text: 'persist before sending' });
  const before = writes.length;
  for (let i = 0; i < 3; i++)
    clients[1].publish({ type: 'notification', kind: 'progress', payload: { progress: i } });
  assert.equal(writes.length, before);
  hub.enqueue({ ...session, text: 'next' });
  assert.equal(writes.length, before + 1);
  assert.equal(writes.at(-1).data[0].queue[0].payload.text, 'next');
  assert.ok(writes.every((item) => item.flush === true));
  await hub.dispose();
});

test('recovered active requests retain the interrupted marker across another restart until manually resumed', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-queue-interrupted-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const storageFile = path.join(directory, 'queue.json');
  const first = fixture({ storageFile });
  const session = await first.hub.newSession({ cwd: directory });
  await first.hub.send({ ...session, text: 'partially executed' });
  first.hub.enqueue({ ...session, text: 'not started' });
  await first.hub.dispose();
  const second = fixture({ storageFile });
  assert.equal(second.hub.listTasks()[0].queued[0].interrupted, true);
  assert.equal(second.hub.listTasks()[0].queued[1].interrupted, undefined);
  await second.hub.dispose();
  const third = fixture({ storageFile });
  assert.equal(third.hub.listTasks()[0].queued[0].interrupted, true);
  await third.hub.loadSession(session);
  await tick();
  assert.deepEqual(third.clients[1].sent, []);
  third.hub.resume(session);
  await tick();
  assert.deepEqual(third.clients[1].sent, ['partially executed']);
  await third.hub.dispose();
});

test('connection loss labels the returned request interrupted without labelling later queued input', async () => {
  const { hub, clients } = fixture();
  const session = await hub.newSession({ cwd: '/project' });
  await hub.send({ ...session, text: 'partially executed' });
  hub.enqueue({ ...session, text: 'not started' });
  clients[1].disconnect();
  await tick();
  assert.equal(hub.listTasks()[0].queued[0].interrupted, true);
  assert.equal(hub.listTasks()[0].queued[1].interrupted, undefined);
  assert.deepEqual(clients[1].sent, ['partially executed']);
  await hub.dispose();
});

test('successful turns keep an explicit checkpoint-skipped result', async () => {
  const { hub, clients } = fixture({ afterTurn: async () => ({ checkpointSkipped: true }) });
  const session = await hub.newSession({ cwd: '/project' });
  await hub.send({ ...session, text: 'approved without checkpoint' });
  clients[1].finish();
  await tick();
  assert.equal(hub.listTasks()[0].lastTurn.status, 'completed');
  assert.equal(hub.listTasks()[0].lastTurn.checkpointSkipped, true);
  await hub.dispose();
});

test('restart during interrupted-turn finalization does not duplicate its already-returned queue item', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-queue-finalizing-'));
  const storageFile = path.join(directory, 'queue.json');
  let release, second;
  const finishing = new Promise((resolve) => {
    release = resolve;
  });
  const first = fixture({ storageFile, afterTurn: () => finishing });
  try {
    const session = await first.hub.newSession({ cwd: directory });
    await first.hub.send({ ...session, text: 'partially executed' });
    first.hub.enqueue({ ...session, text: 'not started' });
    first.clients[1].disconnect();
    second = fixture({ storageFile });
    assert.deepEqual(
      second.hub.listTasks()[0].queued.map((item) => item.text),
      ['partially executed', 'not started'],
    );
    assert.equal(second.hub.listTasks()[0].queued[0].interrupted, true);
    assert.deepEqual(second.clients[1].sent, []);
  } finally {
    release();
    await first.hub.dispose();
    await second?.hub.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
