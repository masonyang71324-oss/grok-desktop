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
