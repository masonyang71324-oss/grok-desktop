const test = require('node:test');
const assert = require('node:assert/strict');

test('a live frame batch updates only changed rows and copies the timeline once', async () => {
  const { appendUpdates } = await import('../src/timeline.mjs');
  const previous = Array.from({ length: 1000 }, (_, index) => ({
    id: `old-${index}`,
    kind: 'assistant',
    text: 'old',
    turnId: `old-${index}`,
    streaming: false,
  }));
  const items = Array.from({ length: 100 }, () => ({
    update: { sessionUpdate: 'agent_message_chunk', content: { text: 'part ' } },
    turnId: 'live',
  }));
  const result = appendUpdates(previous, items);
  assert.equal(result.length, 1001);
  assert.equal(result[0], previous[0]);
  assert.equal(previous.length, 1000);
  assert.equal(result.at(-1).text, 'part '.repeat(100));
  const next = appendUpdates(result, [
    {
      update: { sessionUpdate: 'tool_call', toolCallId: 'same', status: 'pending' },
      turnId: 'live',
    },
    {
      update: { sessionUpdate: 'tool_call', toolCallId: 'same', status: 'pending' },
      turnId: 'control',
    },
    {
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'same', status: 'completed' },
      turnId: 'control',
    },
  ]);
  assert.equal(next.at(-2).status, 'pending');
  assert.equal(next.at(-1).status, 'completed');
  assert.equal(result.length, 1001);
  assert.equal(appendUpdates(result, [{ update: { sessionUpdate: 'plan' } }]), result);
});

test('history replay builds each row once instead of rescanning and copying the accumulated timeline', async () => {
  const { fromReplay } = await import('../src/timeline.mjs');
  const updates = [];
  for (let turn = 0; turn < 100; turn++) {
    updates.push({ sessionUpdate: 'user_message_chunk', content: { text: `question ${turn}` } });
    updates.push({ sessionUpdate: 'tool_call', toolCallId: 'reused', status: 'pending' });
    for (let chunk = 0; chunk < 30; chunk++)
      updates.push({ sessionUpdate: 'agent_message_chunk', content: { text: 'answer ' } });
    updates.push({ sessionUpdate: 'tool_call_update', toolCallId: 'reused', status: 'completed' });
  }
  let visits = 0;
  const originals = Object.fromEntries(
    ['map', 'slice', 'findIndex'].map((key) => [key, Array.prototype[key]]),
  );
  let rows;
  try {
    for (const key of Object.keys(originals))
      Array.prototype[key] = function (...args) {
        visits += this.length;
        return originals[key].apply(this, args);
      };
    rows = fromReplay(updates, 'session');
  } finally {
    for (const key of Object.keys(originals)) Array.prototype[key] = originals[key];
  }
  assert.equal(rows.length, 300);
  assert.ok(rows.filter((row) => row.kind === 'tool').every((row) => row.status === 'completed'));
  assert.ok(
    visits < updates.length * 4,
    `timeline array visits ${visits} for ${updates.length} updates`,
  );
});

test('authoritative control-turn tags are not overwritten by a parent active replay range', async () => {
  const { fromReplay } = await import('../src/timeline.mjs');
  const rows = fromReplay(
    [
      {
        sessionUpdate: 'user_message_chunk',
        content: { text: 'parent' },
        _desktopTurnId: 'parent',
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'same',
        title: 'parent tool',
        _desktopTurnId: 'parent',
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'same',
        title: 'control tool',
        _desktopTurnId: 'control',
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'same',
        status: 'completed',
        _desktopTurnId: 'control',
      },
    ],
    'session',
    { turnId: 'parent', activeTurnStartIndex: 0 },
  );
  assert.equal(rows.filter((row) => row.kind === 'tool').length, 2);
  assert.equal(rows.find((row) => row.title === 'parent tool').turnId, 'parent');
  assert.equal(rows.find((row) => row.title === 'control tool').status, 'completed');
});

test('replay preserves chunked user attachments, tool ID scope and active authoritative turn ownership', async () => {
  const { fromReplay } = await import('../src/timeline.mjs');
  const attachment = { path: '/project/a.txt', name: 'a.txt' };
  const updates = [
    { sessionUpdate: 'user_message_chunk', content: { text: 'first ' }, _desktopTurnId: 'old' },
    {
      sessionUpdate: 'user_message_chunk',
      content: { text: 'request' },
      _desktopAttachments: [attachment],
      _desktopTurnId: 'old',
    },
    {
      sessionUpdate: 'tool_call',
      toolCallId: 'same',
      title: 'old',
      status: 'pending',
      _desktopTurnId: 'old',
    },
    { sessionUpdate: 'user_message_chunk', content: { text: 'next' }, _desktopTurnId: 'active' },
    {
      sessionUpdate: 'tool_call',
      toolCallId: 'same',
      title: 'new',
      status: 'pending',
      _desktopTurnId: 'active',
    },
    {
      sessionUpdate: 'agent_message_chunk',
      content: { text: 'partial' },
      _desktopTurnId: 'active',
    },
  ];
  const copy = structuredClone(updates);
  const rows = fromReplay(updates, 'session', { turnId: 'active', activeTurnStartIndex: 3 });
  assert.deepEqual(updates, copy);
  assert.equal(rows[0].text, 'first request');
  assert.deepEqual(rows[0].attachments, [attachment]);
  assert.equal(rows.find((row) => row.title === 'old').status, 'finished');
  assert.equal(rows.find((row) => row.title === 'new').status, 'pending');
  assert.equal(rows.at(-1).streaming, true);
  assert.equal(rows.at(-1).turnId, 'active');
});
