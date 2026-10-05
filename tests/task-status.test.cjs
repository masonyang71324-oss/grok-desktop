const test = require('node:test');
const assert = require('node:assert/strict');

const task = (sessionId, extra = {}) => ({
  sessionId,
  cwd: 'C:/project',
  title: sessionId,
  status: 'idle',
  permissions: [],
  queued: [],
  ...extra,
});
const load = async () => {
  try {
    return await import('../src/task-status.mjs');
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') assert.fail('Task status derivation is missing');
    throw error;
  }
};

test('approval wins over finishing and running while queued work and a draft remain visible', async () => {
  const { sessionStatusChips } = await load();
  const approval = task('approval', {
    status: 'running',
    finishing: true,
    permissions: [{ requestId: 1, sessionId: 'approval', params: {} }],
    queued: [{ id: 'q1' }, { id: 'q2' }],
  });
  assert.deepEqual(sessionStatusChips(approval, true), [
    { kind: 'approval', label: '等待审批' },
    { kind: 'queued', label: '排队 {count}', count: 2 },
    { kind: 'draft', label: '草稿' },
  ]);
  assert.deepEqual(sessionStatusChips(task('idle')), []);
  assert.deepEqual(sessionStatusChips(undefined, true), [{ kind: 'draft', label: '草稿' }]);
});

test('live states override the last outcome and completed sessions are never pending work', async () => {
  const { deriveTaskStatus, sessionStatusChips } = await load();
  const lastTurn = { turnId: 'old', status: 'completed' };
  for (const [extra, expected] of [
    [{ status: 'running', finishing: true, lastTurn }, 'finishing'],
    [{ status: 'running', lastTurn }, 'running'],
    [{ status: 'background', lastTurn }, 'background'],
    [{ status: 'waiting', lastTurn }, 'waiting'],
    [{ status: 'paused', lastTurn: { status: 'cancelled' } }, 'stopped'],
    [{ status: 'error', lastTurn }, 'error'],
    [{ status: 'interrupted', lastTurn }, 'interrupted'],
    [{ lastTurn }, 'completed'],
    [{}, 'idle'],
  ]) {
    assert.equal(deriveTaskStatus(task('one', extra)).kind, expected);
  }
  assert.deepEqual(sessionStatusChips(task('complete', { lastTurn })), []);
  assert.equal(
    deriveTaskStatus(
      task('queue', { status: 'paused', queued: [{ id: 'q' }], lastTurn: { status: 'cancelled' } }),
    ).kind,
    'paused',
  );
});

test('task groups put approval and recoverable work first while all view includes honest history', async () => {
  const { groupTasks } = await load();
  const tasks = [
    task('idle'),
    task('running', { status: 'running' }),
    task('stopped', { status: 'paused', lastTurn: { status: 'cancelled' } }),
    task('paused', { status: 'paused', queued: [{ id: 'q' }] }),
    task('approval', { status: 'waiting', permissions: [{ requestId: 1 }] }),
    task('error', { status: 'error', error: 'connection lost' }),
    task('completed', { lastTurn: { status: 'completed' } }),
    task('background', { status: 'background' }),
  ];
  const ids = (groups) =>
    groups.map((group) => [group.kind, group.tasks.map((item) => item.sessionId)]);
  assert.deepEqual(ids(groupTasks(tasks)), [
    ['attention', ['approval', 'paused', 'error']],
    ['active', ['running', 'background']],
  ]);
  assert.deepEqual(ids(groupTasks(tasks, true)), [
    ['attention', ['approval', 'paused', 'error']],
    ['active', ['running', 'background']],
    ['history', ['idle', 'stopped', 'completed']],
  ]);
});

test('draft metadata is project and session scoped and clears after send or removal without cloning content', async (t) => {
  const { createDraftStore } = await import('../src/drafts.mjs');
  const store = createDraftStore();
  assert.equal(typeof store.hasDraft, 'function');
  store.save('C:/project', 'one', { text: 'unsent', attachments: [] });
  store.save('C:/project', 'two', { text: '', attachments: [{ path: 'C:/file', name: 'file' }] });
  assert.equal(store.hasDraft('c:\\PROJECT\\', 'one'), true);
  assert.equal(store.hasDraft('C:/other', 'one'), false);
  assert.equal(store.hasDraft('C:/project', 'other'), false);
  store.save('C:/project', 'one', { text: '', attachments: [] });
  assert.equal(store.hasDraft('C:/project', 'one'), false);
  assert.equal(store.hasDraft('C:/project', 'two'), true);
  store.remove('C:/project', 'two');
  assert.equal(store.hasDraft('C:/project', 'two'), false);
  store.save('C:/project', 'large', {
    text: 'large prompt',
    attachments: [{ path: 'C:/file', text: 'large file' }],
  });
  t.mock.method(globalThis, 'structuredClone', () =>
    assert.fail('Metadata read must not clone prompt or attachments'),
  );
  assert.equal(store.hasDraft('C:/project', 'large'), true);
});
