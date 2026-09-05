const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWorktree } = require('../electron/worktree.cjs');

test('worktree creating response is not treated as completion; wait for matching created event', async () => {
  const events = new EventEmitter();
  let finished = false;
  const client = {
    extension: async (method, params) => {
      assert.equal(method, '_x.ai/git/worktree/create');
      assert.equal(params.worktreeType, 'git');
      return { result: { status: 'creating', sessionId: 'current', worktreePath: 'E:/new' } };
    },
  };
  const promise = createWorktree({
    client,
    subscribe: (cb) => {
      events.on('event', cb);
      return () => events.off('event', cb);
    },
    sessionId: 'current',
    cwd: 'E:/source',
    worktreePath: 'E:/new',
    copyMode: 'clean',
  }).then((value) => {
    finished = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  events.emit('event', {
    type: 'notification',
    kind: 'worktree-status',
    payload: { status: 'created', sessionId: 'other', worktreePath: 'E:/wrong' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  events.emit('event', {
    type: 'notification',
    kind: 'worktree-status',
    payload: { status: 'created', sessionId: 'current', worktreePath: 'E:/new' },
  });
  assert.equal((await promise).path, 'E:/new');
  assert.equal(events.listenerCount('event'), 0);
});

test('worktree failure preserves server message and removes progress listener', async () => {
  const events = new EventEmitter();
  const promise = createWorktree({
    client: { extension: async () => ({ result: { status: 'creating' } }) },
    subscribe: (cb) => {
      events.on('event', cb);
      return () => events.off('event', cb);
    },
    sessionId: 'current',
    cwd: 'E:/source',
    worktreePath: 'E:/new',
  });
  events.emit('event', {
    type: 'notification',
    kind: 'worktree-status',
    payload: { status: 'error', sessionId: 'current', message: 'git reference not found' },
  });
  await assert.rejects(promise, /git reference not found/);
  assert.equal(events.listenerCount('event'), 0);
});

for (const state of ['error', 'disconnected']) {
  test(`worktree wait rejects immediately when the ACP connection becomes ${state}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const events = new EventEmitter();
    let result;
    const promise = createWorktree({
      client: { extension: async () => ({ result: { status: 'creating' } }) },
      subscribe: (cb) => {
        events.on('event', cb);
        return () => events.off('event', cb);
      },
      sessionId: 'current',
      cwd: 'E:/source',
      worktreePath: 'E:/new',
    });
    promise.then(
      () => {
        result = 'resolved';
      },
      (error) => {
        result = error;
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    events.emit('event', {
      type: 'connection',
      state,
      message: 'agent disconnected during Git creation',
    });
    await new Promise((resolve) => setImmediate(resolve));
    // Finish the old timeout path as cleanup, while preserving the immediate observation.
    const immediate = result;
    t.mock.timers.tick(120001);
    await promise.catch(() => {});
    assert.ok(
      immediate instanceof Error,
      'connection failure must settle without the 120-second timer',
    );
    assert.match(immediate.message, /agent disconnected/);
    assert.equal(events.listenerCount('event'), 0);
  });
}
