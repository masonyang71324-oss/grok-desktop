const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/permission-dialog.mjs');

test('official permission choices are Chinese and preserve command-specific scope', async () => {
  const { permissionChoice } = await load();
  const cases = [
    [{ kind: 'allow_once', name: 'Yes, proceed' }, '允许本次'],
    [
      { kind: 'allow_always', name: "Yes, and don't ask again for bash commands" },
      '允许命令工具且不再询问',
    ],
    [{ kind: 'reject_once', name: 'No, tell Grok what to do differently' }, '拒绝本次'],
    [
      { kind: 'reject_always', name: "No, don't ask again for this command" },
      '拒绝此命令且不再询问',
    ],
  ];
  for (const [option, label] of cases) {
    const original = { ...option, optionId: 'original-server-id' };
    const result = permissionChoice(original);
    assert.equal(result.label, label);
    assert.equal(result.original, option.name);
    assert.equal(original.optionId, 'original-server-id');
    assert.doesNotMatch(result.label, /所有操作|永久/);
  }
});

test('permission kind determines allow or reject even when display text differs', async () => {
  const { permissionChoice } = await load();
  assert.equal(permissionChoice({ kind: 'reject_once', name: 'Yes, proceed' }).label, '拒绝本次');
  assert.equal(permissionChoice({ kind: 'allow_once', name: "Don't ask again" }).label, '允许本次');
  assert.equal(
    permissionChoice({ kind: 'allow_always', name: "Don't ask again for this command" }).label,
    '允许此命令且不再询问',
  );
});

test('long PowerShell request has a short overview and one complete command with its other parameters', async () => {
  const { permissionOverview } = await load();
  const command =
    'powershell.exe -NoProfile -Command "' + 'Get-Content example.txt; '.repeat(30) + '"';
  const result = permissionOverview({
    title: command,
    rawInput: { command, cwd: 'C:\\project', timeout: 30000 },
  });
  assert.equal(result.title, '运行 PowerShell 命令');
  assert.ok(result.preview.length <= 140);
  assert.equal(result.sections.filter((section) => section.text.includes(command)).length, 1);
  assert.equal(result.sections.find((section) => section.label === '完整命令').text, command);
  assert.match(
    result.sections.find((section) => section.label === '其他参数').text,
    /C:\\\\project/,
  );
  assert.match(result.sections.find((section) => section.label === '其他参数').text, /30000/);
});

test('tool request without structured command preserves complete title and nested content', async () => {
  const { permissionOverview } = await load();
  const title = 'External tool operation '.repeat(10);
  const result = permissionOverview({
    title,
    content: [{ type: 'content', content: { type: 'text', text: 'exact tool detail' } }],
  });
  assert.equal(result.title, '执行工具操作');
  assert.equal(result.sections.find((section) => section.label === '工具原始标题').text, title);
  assert.ok(result.sections.some((section) => section.text === 'exact tool detail'));
});
