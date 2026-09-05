const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCapabilities, runCapability } = require('../electron/capabilities.cjs');

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-capabilities-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('a missing memory root is an empty inventory and is not created by browsing', async (t) => {
  const directory = await temporaryDirectory(t);
  const root = path.join(directory, 'memory');
  const service = createCapabilities({ memoryRoot: root });
  const result = await service.listMemory();
  assert.deepEqual(result.data, { root, exists: false, files: [] });
  await assert.rejects(fs.stat(root), { code: 'ENOENT' });
});

test('memory inventory exposes Markdown metadata without returning private note contents', async (t) => {
  const root = await temporaryDirectory(t);
  const nested = path.join(root, 'project-abcd1234', 'sessions');
  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(root, 'MEMORY.md'), 'private global note');
  await fs.writeFile(path.join(nested, '2026-09-05.md'), 'private session note');
  await fs.writeFile(path.join(nested, 'index.sqlite'), 'not a markdown file');
  await fs.writeFile(path.join(root, 'README.txt'), 'not a markdown file');
  const result = await createCapabilities({ memoryRoot: root }).listMemory();
  assert.equal(result.data.exists, true);
  assert.equal(result.data.files.length, 2);
  const byName = new Map(result.data.files.map((file) => [file.name, file]));
  assert.equal(byName.get('MEMORY.md').size, 19);
  assert.equal(
    byName.get('2026-09-05.md').relativePath,
    path.join('project-abcd1234', 'sessions', '2026-09-05.md'),
  );
  for (const file of result.data.files) {
    assert.equal(path.isAbsolute(file.path), true);
    assert.equal(Number.isNaN(Date.parse(file.updatedAt)), false);
    assert.deepEqual(Object.keys(file).sort(), [
      'name',
      'path',
      'relativePath',
      'size',
      'updatedAt',
    ]);
  }
  assert.doesNotMatch(JSON.stringify(result), /private global note|private session note/);
});

test('capability inventories use the documented session-scoped method and unwrap their data once', async () => {
  const fixtures = [
    [
      'workflow-list',
      '_x.ai/workflows/list',
      { workflows: [{ name: 'review-changes', description: 'Review changes', source: 'builtin' }] },
      'workflows',
    ],
    [
      'task-list',
      '_x.ai/task/list',
      { tasks: [{ task_id: 'command-1', status: 'running', command: 'npm run build' }] },
      'tasks',
    ],
    [
      'subagent-list',
      '_x.ai/subagent/list_running',
      { subagents: [{ subagentId: 'agent-1', description: 'Review changes', status: 'running' }] },
      'subagents',
    ],
  ];
  for (const [action, method, payload, key] of fixtures) {
    const client = {
      async extension(actualMethod, params) {
        assert.equal(actualMethod, method);
        assert.deepEqual(params, { sessionId: 'session-1' });
        return { result: payload };
      },
    };
    const result = await runCapability(client, action, {
      sessionId: 'session-1',
      cwd: 'C:\\project',
    });
    assert.deepEqual(result.data[key], payload[key]);
    assert.equal(result.data.result, undefined);
    assert.ok(result.text.length > 0);
  }
});

test('an extension domain error is rejected even when JSON-RPC succeeded or contains partial data', async () => {
  for (const error of [
    'session not found',
    { code: 'unavailable', message: 'session not found' },
  ]) {
    const client = {
      async extension() {
        return { result: { tasks: [] }, error };
      },
    };
    await assert.rejects(
      runCapability(client, 'task-list', { sessionId: 'session-1' }),
      /session not found/,
    );
  }
});

test('a null or malformed inventory is not mislabeled as an empty successful list', async () => {
  for (const response of [{ result: null }, { result: {} }, { result: { tasks: 'invalid' } }]) {
    await assert.rejects(
      runCapability({ extension: async () => response }, 'task-list', { sessionId: 'session-1' }),
    );
  }
});

test('stop and delete actions send exact target fields without forwarding unrelated values', async () => {
  const cases = [
    [
      'task-stop',
      '_x.ai/task/kill',
      { sessionId: 'session-1', taskId: 'task-1' },
      { taskId: 'task-1', outcome: 'killed' },
    ],
    [
      'subagent-stop',
      '_x.ai/subagent/cancel',
      { subagentId: 'agent-1' },
      { subagentId: 'agent-1', cancelled: true, outcome: { kind: 'cancelled' } },
    ],
    [
      'schedule-delete',
      '_x.ai/scheduler/delete',
      { sessionId: 'session-1', taskId: 'task-1' },
      { taskId: 'task-1', deleted: true },
    ],
  ];
  for (const [action, method, expected, payload] of cases) {
    const client = {
      async extension(actualMethod, params) {
        assert.equal(actualMethod, method);
        assert.deepEqual(params, expected);
        return { result: payload };
      },
    };
    const result = await runCapability(client, action, {
      sessionId: 'session-1',
      taskId: 'task-1',
      subagentId: 'agent-1',
      cwd: 'C:\\project',
    });
    assert.deepEqual(result.data, payload);
  }
});

test('a missing scheduled task does not claim deletion succeeded', async () => {
  const client = { extension: async () => ({ result: { taskId: 'missing', deleted: false } }) };
  const result = await runCapability(client, 'schedule-delete', {
    sessionId: 'session-1',
    taskId: 'missing',
  });
  assert.equal(result.data.deleted, false);
  assert.doesNotMatch(result.text, /已删除|删除成功|操作已完成/);
});

test('missing action targets fail before reaching the backend', async () => {
  const client = {
    extension: async () => {
      assert.fail('must not send an incomplete request');
    },
  };
  await assert.rejects(runCapability(client, 'task-list', {}), /会话/);
  await assert.rejects(runCapability(client, 'task-stop', { sessionId: 'session-1' }), /任务/);
  await assert.rejects(
    runCapability(client, 'subagent-stop', { sessionId: 'session-1' }),
    /子任务/,
  );
  await assert.rejects(runCapability(client, 'unknown', {}), /不支持/);
});
