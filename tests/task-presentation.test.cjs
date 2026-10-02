const { test } = require('node:test');
const assert = require('node:assert/strict');

test('cold replay uses persisted verification counts without inventing command details', async () => {
  const { buildTaskOutcome } = await import('../src/task-presentation.mjs');
  const result = {
    turnId: 'real',
    status: 'completed',
    facts: {
      toolCount: 2,
      completedToolCount: 2,
      failedToolCount: 0,
      unfinishedToolCount: 0,
      verification: { count: 1, passed: 0, failed: 1, unknown: 0 },
    },
  };
  const outcome = buildTaskOutcome(result, []);
  assert.equal(outcome.toolCount, 2);
  assert.equal(outcome.verification.failed, 1);
  assert.deepEqual(outcome.verification.items, []);
});
const load = async () => {
  try {
    return await import('../src/task-presentation.mjs');
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') assert.fail('Task presentation helpers are missing');
    throw error;
  }
};
const tool = (values = {}) => ({
  id: 'tool-1',
  kind: 'tool',
  turnId: 'current',
  text: '',
  streaming: false,
  status: 'in_progress',
  toolKind: 'execute',
  input: '{"cmd":"npm test"}',
  ...values,
});
const result = (values = {}) => ({ turnId: 'current', status: 'completed', ...values });

test('activity uses the current active tool kind and recognizes real validation commands', async () => {
  const { deriveTaskActivity } = await load();
  assert.equal(deriveTaskActivity({ rows: [tool()], turnId: 'current' }).phase, 'verifying');
  assert.equal(
    deriveTaskActivity({ rows: [tool({ input: '{"cmd":"echo npm test"}' })], turnId: 'current' })
      .phase,
    'executing',
  );
  assert.equal(
    deriveTaskActivity({ rows: [tool({ toolKind: 'read', title: 'npm test' })], turnId: 'current' })
      .phase,
    'reading',
  );
  assert.equal(
    deriveTaskActivity({ rows: [tool({ toolKind: 'edit' })], turnId: 'current' }).phase,
    'editing',
  );
  assert.equal(
    deriveTaskActivity({ rows: [tool({ toolKind: 'search' })], turnId: 'current' }).phase,
    'searching',
  );
});

test('quoted command content does not become a validation command', async () => {
  const { deriveTaskActivity } = await load();
  assert.equal(
    deriveTaskActivity({
      rows: [tool({ input: 'node -e "console.log(\'text; npm test would run\')"' })],
      turnId: 'current',
    }).phase,
    'executing',
  );
  assert.equal(
    deriveTaskActivity({
      rows: [tool({ input: 'cd project && & npm run build' })],
      turnId: 'current',
    }).phase,
    'verifying',
  );
});

test('approval and cancellation override activity without using historical rows', async () => {
  const { deriveTaskActivity } = await load();
  const rows = [tool({ turnId: 'old' })];
  assert.equal(deriveTaskActivity({ rows, turnId: 'current' }).phase, 'working');
  assert.equal(
    deriveTaskActivity({ rows: [tool()], turnId: 'current', waitingApproval: true }).phase,
    'waiting',
  );
  assert.equal(
    deriveTaskActivity({
      rows: [tool()],
      turnId: 'current',
      waitingApproval: true,
      cancelling: true,
    }).phase,
    'cancelling',
  );
  assert.equal(deriveTaskActivity({ rows, turnId: 'current', pending: true }).phase, 'preparing');
});

test('thought and answer phases come from current-turn activity, not a synthetic sequence', async () => {
  const { deriveTaskActivity } = await load();
  const thought = {
    id: 'thought',
    kind: 'thought',
    turnId: 'current',
    text: 'considering',
    streaming: true,
  };
  const answer = { ...thought, id: 'answer', kind: 'assistant', text: 'answer' };
  assert.equal(deriveTaskActivity({ rows: [thought], turnId: 'current' }).phase, 'thinking');
  assert.equal(
    deriveTaskActivity({ rows: [thought, answer], turnId: 'current' }).phase,
    'answering',
  );
  assert.equal(
    deriveTaskActivity({
      rows: [tool({ status: 'completed' })],
      turnId: 'current',
      background: true,
    }).phase,
    'background',
  );
  assert.equal(
    deriveTaskActivity({
      rows: [{ ...answer, streaming: false }],
      turnId: 'current',
      background: true,
    }).phase,
    'background',
  );
});

test('a successful shell fallback cannot prove that its validation passed', async () => {
  const { buildTaskOutcome } = await load();
  const masked = buildTaskOutcome(result(), [
    tool({ status: 'completed', input: 'npm test || true', rawOutput: { exitCode: 0 } }),
  ]);
  assert.equal(masked.verification.passed, 0);
  assert.equal(masked.verification.unknown, 1);
  const safe = buildTaskOutcome(result(), [
    tool({ status: 'completed', input: 'cd project && npm test', rawOutput: { exitCode: 0 } }),
  ]);
  assert.equal(safe.verification.passed, 1);
});

test('elapsed duration requires valid actual timestamps', async () => {
  const { elapsedMilliseconds, formatElapsed } = await load();
  assert.equal(elapsedMilliseconds(undefined, Date.parse('2026-10-02T00:00:10Z')), null);
  assert.equal(elapsedMilliseconds('invalid', Date.now()), null);
  assert.equal(
    elapsedMilliseconds('2026-10-02T00:00:20Z', Date.parse('2026-10-02T00:00:10Z')),
    null,
  );
  assert.equal(
    elapsedMilliseconds('2026-10-02T00:00:00Z', Date.parse('2026-10-02T00:01:05Z')),
    65000,
  );
  assert.equal(formatElapsed(65000), '1:05');
  assert.equal(formatElapsed(3723000), '1:02:03');
});

test('only numeric structured exit codes establish verification outcomes', async () => {
  const { buildTaskOutcome } = await load();
  const rows = [
    tool({ id: 'passed', status: 'completed', rawOutput: { exitCode: 0 } }),
    tool({
      id: 'failed',
      status: 'completed',
      input: '{"command":"npm run lint"}',
      rawOutput: { result: { exit_code: 2 } },
    }),
    tool({ id: 'unknown', status: 'completed', text: 'All tests passed. Exit code: 0' }),
    tool({ id: 'string-code', status: 'completed', rawOutput: { exitCode: '0' } }),
    tool({
      id: 'ordinary',
      status: 'completed',
      input: '{"cmd":"echo npm test"}',
      rawOutput: { exitCode: 0 },
    }),
    tool({ id: 'history', turnId: 'old', status: 'completed', rawOutput: { exitCode: 0 } }),
  ];
  const outcome = buildTaskOutcome(result(), rows);
  assert.deepEqual(outcome.verification, {
    count: 4,
    passed: 1,
    failed: 1,
    unknown: 2,
    items: [
      { id: 'passed', command: 'npm test', exitCode: 0, status: 'passed' },
      { id: 'failed', command: 'npm run lint', exitCode: 2, status: 'failed' },
      { id: 'unknown', command: 'npm test', exitCode: null, status: 'unknown' },
      { id: 'string-code', command: 'npm test', exitCode: null, status: 'unknown' },
    ],
  });
  assert.equal(outcome.toolCount, 5);
});

test('failed and incomplete outcomes keep their authoritative status and tool failures', async () => {
  const { buildTaskOutcome } = await load();
  const rows = [
    tool({ status: 'failed' }),
    tool({ id: 'stopped', status: 'interrupted', input: 'node app.js' }),
  ];
  const failed = buildTaskOutcome(result({ status: 'failed', error: 'connection lost' }), rows);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failedToolCount, 1);
  assert.equal(failed.unfinishedToolCount, 1);
  assert.equal(failed.verification.items[0].status, 'unknown');
  assert.equal(buildTaskOutcome(result({ status: 'interrupted' }), []).status, 'interrupted');
  assert.equal(buildTaskOutcome(result({ status: 'cancelled' }), []).status, 'cancelled');
});

test('checkpoint summary bounds its file list and keeps omitted files separate', async () => {
  const { buildTaskOutcome } = await load();
  const files = Array.from({ length: 8 }, (_, index) => ({
    path: `folder/file-${index}.ts`,
    status: index === 0 ? 'deleted' : 'created',
  }));
  const checkpoint = {
    id: 'checkpoint',
    turnId: 'current',
    status: 'ready',
    cwd: 'C:/project',
    files,
    skipped: [{ path: 'result.docx', reason: 'binary' }],
  };
  const outcome = buildTaskOutcome(result({ checkpointId: 'checkpoint' }), [], checkpoint);
  assert.equal(outcome.checkpoint.ready, true);
  assert.equal(outcome.checkpoint.fileCount, 8);
  assert.deepEqual(outcome.checkpoint.visibleFiles, files.slice(0, 6));
  assert.equal(outcome.checkpoint.hiddenFileCount, 2);
  assert.equal(outcome.checkpoint.skippedCount, 1);
  assert.equal(outcome.checkpoint.createdCount, 7);
  assert.equal(outcome.checkpoint.deletedCount, 1);
  assert.equal(outcome.checkpoint.visibleFiles[0].path, 'folder/file-0.ts');
});

test('missing or mismatched checkpoints never claim zero changed files or enable actions', async () => {
  const { buildTaskOutcome } = await load();
  assert.equal(buildTaskOutcome(result(), []).checkpoint.fileCount, null);
  assert.equal(buildTaskOutcome(result(), []).checkpoint.ready, false);
  const old = {
    id: 'old',
    turnId: 'old',
    status: 'ready',
    files: [{ path: 'old.ts', status: 'modified' }],
  };
  assert.equal(buildTaskOutcome(result(), [], old).checkpoint.fileCount, null);
  const recording = { ...old, turnId: 'current', status: 'recording', files: [] };
  assert.equal(buildTaskOutcome(result(), [], recording).checkpoint.fileCount, null);
});
