const test = require('node:test');
const assert = require('node:assert/strict');
const { RuntimeActivity } = require('../electron/background.cjs');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};

test('nested task completion clears its background task without clearing other agents', () => {
  const activity = new RuntimeActivity({ isForegroundBusy: () => false });
  activity.onEvent({
    type: 'notification',
    kind: 'task_backgrounded',
    payload: { task_id: 'task-a' },
  });
  activity.onEvent({
    type: 'notification',
    kind: 'subagent_spawned',
    payload: { subagent_id: 'agent-b' },
  });
  activity.onEvent({
    type: 'notification',
    kind: 'task_completed',
    payload: { task_snapshot: { task_id: 'task-a', status: 'completed' } },
  });
  assert.equal(activity.background.size, 1);
  activity.onEvent({
    type: 'notification',
    kind: 'subagent_finished',
    payload: { subagent_id: 'agent-b' },
  });
  assert.equal(activity.busy, false);
});

test('workflow run statuses track active and terminal runs independently', () => {
  const activity = new RuntimeActivity({ isForegroundBusy: () => false });
  const update = (run_id, status) =>
    activity.onEvent({
      type: 'notification',
      kind: 'workflow_updated',
      payload: { run_id, status },
    });
  update('run-a', 'active');
  update('run-b', 'user_paused');
  assert.equal(activity.background.size, 2);
  update('run-a', 'complete');
  assert.equal(activity.busy, true);
  update('run-b', 'failed');
  assert.equal(activity.busy, false);
  update('run-c', 'active');
  update('run-c', 'cancelled');
  assert.equal(activity.busy, false);
  update('run-d', 'back_off_paused');
  update('run-d', 'interrupted');
  assert.equal(activity.busy, false);
});

test('management lock covers both CLI mutation and restart and releases after completion', async () => {
  const activity = new RuntimeActivity({ isForegroundBusy: () => false });
  const cli = deferred(),
    restart = deferred();
  let called = 0;
  const mutation = activity.runMutation(async () => {
    await cli.promise;
    await restart.promise;
    return 'done';
  });
  await assert.rejects(
    activity.runSession(async () => {
      called++;
    }),
    /正在.*管理|配置|更新/,
  );
  await assert.rejects(
    activity.runMutation(async () => {
      called++;
    }),
    /正在|运行/,
  );
  cli.resolve();
  await Promise.resolve();
  await assert.rejects(
    activity.runSession(async () => {
      called++;
    }),
    /正在.*管理|配置|更新/,
  );
  assert.equal(called, 0);
  restart.resolve();
  assert.equal(await mutation, 'done');
  await activity.runSession(async () => {
    called++;
  });
  assert.equal(called, 1);
  assert.equal(activity.busy, false);
});

test('pending session validation excludes a competing management mutation and failures release locks', async () => {
  const activity = new RuntimeActivity({ isForegroundBusy: () => false });
  const validation = deferred();
  const opening = activity.runSession(() => validation.promise);
  await assert.rejects(
    activity.runMutation(async () => {}),
    /运行|切换/,
  );
  validation.resolve();
  await opening;
  await assert.rejects(
    activity.runMutation(async () => {
      throw new Error('CLI failed');
    }),
    /CLI failed/,
  );
  assert.equal(activity.busy, false);
  await activity.runSession(async () => {});
});
