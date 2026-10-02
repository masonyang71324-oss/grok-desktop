const { test } = require('node:test');
const assert = require('node:assert/strict');

test('search finds every Chinese occurrence across messages, thoughts, tools and retained error', async () => {
  const { searchConversation } = await import('../src/conversation-navigation.mjs');
  const rows = [
    { id: 'u', kind: 'user', text: '查看配置，修改配置' },
    { id: 'a', kind: 'assistant', text: '配置已更新' },
    { id: 't', kind: 'thought', text: '先检查配置' },
    {
      id: 'tool',
      kind: 'tool',
      title: 'read',
      input: '配置.json',
      text: '配置成功',
      toolContent: [{ type: 'text', text: '配置成功' }],
    },
  ];
  const hits = searchConversation(rows, '配置', '配置失败');
  assert.deepEqual(
    hits.map((hit) => hit.target),
    [
      { kind: 'row', rowId: 'u' },
      { kind: 'row', rowId: 'u' },
      { kind: 'row', rowId: 'a' },
      { kind: 'row', rowId: 't' },
      { kind: 'row', rowId: 'tool' },
      { kind: 'row', rowId: 'tool' },
      { kind: 'error' },
    ],
  );
  assert.ok(hits.every((hit) => hit.snippet.includes('配置')));
  assert.equal(searchConversation(rows, '   ', '配置失败').length, 0);
});

test('outline uses user text or attachment names and keeps shared row anchors', async () => {
  const { questionOutline } = await import('../src/conversation-navigation.mjs');
  assert.deepEqual(
    questionOutline([
      { id: 'u1', kind: 'user', text: '  第一题\n下一行  ' },
      { id: 'a', kind: 'assistant', text: 'answer' },
      {
        id: 'u2',
        kind: 'user',
        text: '',
        attachments: [{ name: '设计.docx' }, { name: '图.png' }],
      },
    ]),
    [
      { title: '第一题 下一行', target: { kind: 'row', rowId: 'u1' } },
      { title: '设计.docx、图.png', target: { kind: 'row', rowId: 'u2' } },
    ],
  );
});
