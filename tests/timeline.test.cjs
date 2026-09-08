const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/timeline.mjs');

test('active snapshot resumes existing tool and message rows with the live turn id', async () => {
  const { fromReplay, appendUpdate } = await load();
  const updates = [
    { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'old' } },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old answer' } },
    { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'new' } },
    { sessionUpdate: 'tool_call', toolCallId: 'tool', status: 'in_progress' },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'part' } },
  ];
  let rows = fromReplay(updates, 's1', { turnId: 'live', activeTurnStartIndex: 2 });
  rows = appendUpdate(
    rows,
    { sessionUpdate: 'tool_call_update', toolCallId: 'tool', status: 'completed' },
    'live',
  );
  rows = appendUpdate(
    rows,
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' rest' } },
    'live',
  );
  assert.equal(rows.filter((row) => row.kind === 'tool').length, 1);
  assert.equal(rows.find((row) => row.kind === 'tool').status, 'completed');
  assert.equal(rows.at(-1).text, 'part rest');
  assert.notEqual(rows[0].turnId, 'live');
  assert.equal(
    fromReplay(updates, 's1', { turnId: 'preparing' }).some((row) => row.turnId === 'preparing'),
    false,
  );
});

test('stream keeps thought, tool and answer chronology and joins only adjacent chunks', async () => {
  const { appendUpdate } = await load();
  let rows = [];
  for (const update of [
    { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '先' } },
    { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '检查' } },
    { sessionUpdate: 'tool_call', toolCallId: 't1', title: '读取文件', status: 'pending' },
    { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '已读取' } },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '结论' } },
  ])
    rows = appendUpdate(rows, update, 'turn1');
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['thought', 'tool', 'thought', 'assistant'],
  );
  assert.equal(rows[0].text, '先检查');
});

test('tool update extracts nested protocol content without object strings', async () => {
  const { appendUpdate } = await load();
  let rows = appendUpdate(
    [],
    { sessionUpdate: 'tool_call', toolCallId: 't1', title: '读取文件' },
    't',
  );
  rows = appendUpdate(
    rows,
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
      content: [
        { type: 'content', content: { type: 'text', text: '文件内容' } },
        { type: 'diff', path: 'a.ts', oldText: '旧', newText: '新' },
      ],
    },
    't',
  );
  assert.match(rows[0].text, /文件内容/);
  assert.match(rows[0].text, /a.ts/);
  assert.doesNotMatch(rows[0].text, /\[object Object\]/);
  assert.equal(rows[0].status, 'completed');
});

test('tool diffs preserve old/new text and file locations across status updates and replay', async () => {
  const { appendUpdate, fromReplay } = await load();
  const content = [
    { type: 'content', content: { type: 'text', text: '已修改配置' } },
    {
      type: 'diff',
      path: '/project/config.json',
      oldText: '{\n  "debug": false\n}',
      newText: '{\n  "debug": true\n}',
    },
    { type: 'diff', path: '/project/new.txt', oldText: null, newText: '新文件\n' },
  ];
  const updates = [
    {
      sessionUpdate: 'tool_call',
      toolCallId: 'edit',
      content,
      locations: [{ path: '/project/config.json', line: 2 }],
    },
    { sessionUpdate: 'tool_call_update', toolCallId: 'edit', status: 'completed' },
  ];
  const rows = updates.reduce((items, update) => appendUpdate(items, update, 'turn'), []);
  const expected = [{ type: 'text', text: '已修改配置' }, ...content.slice(1)];
  assert.deepEqual(rows[0].toolContent, expected);
  assert.deepEqual(rows[0].locations, [{ path: '/project/config.json', line: 2 }]);
  assert.deepEqual(fromReplay(updates, 'session')[0].toolContent, expected);
  const cleared = appendUpdate(
    rows,
    { sessionUpdate: 'tool_call_update', toolCallId: 'edit', content: [] },
    'turn',
  );
  assert.deepEqual(cleared[0].toolContent, []);
  assert.equal(cleared[0].text, '');
});

test('replay ends a historical response before the next live turn', async () => {
  const { fromReplay, appendUpdate, finalizeTurn } = await load();
  let rows = fromReplay(
    [{ sessionUpdate: 'agent_message_chunk', content: { text: '旧回答' } }],
    'session',
  );
  rows = appendUpdate(
    rows,
    { sessionUpdate: 'agent_message_chunk', content: { text: '新回答' } },
    'new-turn',
  );
  assert.equal(rows.length, 2);
  rows = finalizeTurn(rows, 'new-turn');
  assert.equal(
    rows.every((r) => !r.streaming),
    true,
  );
});

test('replay joins chunked user content into one historical message', async () => {
  const { fromReplay } = await load();
  const rows = fromReplay(
    [
      { sessionUpdate: 'user_message_chunk', content: { text: '检查' } },
      { sessionUpdate: 'user_message_chunk', content: { text: '项目' } },
    ],
    'session',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, '检查项目');
  assert.equal(rows[0].streaming, false);
});

test('ending an interrupted turn never marks pending tools successful', async () => {
  const { appendUpdate, finalizeTurn } = await load();
  const rows = appendUpdate(
    [],
    { sessionUpdate: 'tool_call', toolCallId: 'unfinished', status: 'in_progress' },
    'turn',
  );
  assert.equal(finalizeTurn(rows, 'turn', true)[0].status, 'interrupted');
  assert.equal(finalizeTurn(rows, 'turn')[0].status, 'finished');
});

test('frame buffer publishes continuing streams before they finish without rescheduling', async () => {
  const { createFrameBuffer } = await load();
  const frames = [];
  const delivered = [];
  const buffer = createFrameBuffer(
    (items) => delivered.push(items),
    (fn) => (frames.push(fn), frames.length),
    () => {},
  );
  buffer.push('first');
  buffer.push('second');
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.deepEqual(delivered, [['first', 'second']]);
  buffer.push('third');
  assert.equal(frames.length, 1);
  buffer.flush();
  assert.deepEqual(delivered[1], ['third']);
  buffer.dispose();
});

test('goal and workflow forms construct only advertised slash commands and omit empty flags', async () => {
  const { buildCommand } = await import('../src/commands.mjs');
  assert.equal(
    buildCommand({ name: 'goal' }, { operation: 'set', objective: '修复加载错误', budget: '4000' }),
    '/goal 修复加载错误 --budget 4000',
  );
  assert.equal(buildCommand({ name: 'goal' }, { operation: 'pause' }), '/goal pause');
  assert.equal(
    buildCommand(
      { name: 'workflow' },
      { operation: 'run', name: 'review', agentBudget: '3', effort: 'deep', argument: '检查界面' },
    ),
    '/workflow review --agent-budget 3 --effort deep 检查界面',
  );
  assert.equal(buildCommand({ name: 'workflow' }, { operation: 'runs' }), '/workflow runs');
  assert.equal(
    buildCommand({ name: 'bundled:imagine' }, { argument: '极简图标' }),
    '/bundled:imagine 极简图标',
  );
});
