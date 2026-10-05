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

test('approval exposes structured edits with real line numbers and explicit command cwd', async () => {
  const { permissionOverview } = await load();
  const { parseDiff } = await import('../src/diff-model.mjs');
  const result = permissionOverview(
    {
      rawInput: { cwd: 'C:/tool-project', path: 'src/设置.txt' },
      content: [
        {
          type: 'diff',
          path: 'src/设置.txt',
          oldText: 'same\nold\nlast\n',
          newText: 'same\nnew\nlast\n',
        },
        { type: 'diff', path: 'created.txt', oldText: null, newText: 'first\nsecond\n' },
      ],
    },
    'C:/owning-session',
  );
  assert.equal(result.cwd, 'C:/tool-project');
  assert.deepEqual(
    result.diffs.map((diff) => diff.path),
    ['src/设置.txt', 'created.txt'],
  );
  const changed = parseDiff(result.diffs[0].text).rows.filter((row) =>
    ['remove', 'add'].includes(row.kind),
  );
  assert.deepEqual(
    changed.map(({ kind, text, before, after }) => ({ kind, text, before, after })),
    [
      { kind: 'remove', text: 'old', before: 2, after: undefined },
      { kind: 'add', text: 'new', before: undefined, after: 2 },
    ],
  );
  assert.deepEqual(
    parseDiff(result.diffs[1].text)
      .rows.filter((row) => row.kind === 'add')
      .map((row) => row.after),
    [1, 2],
  );
});

test('approval working directory uses explicit supported parameters then its owning session', async () => {
  const { permissionOverview } = await load();
  for (const key of ['cwd', 'workdir', 'working_directory', 'workingDirectory']) {
    assert.equal(
      permissionOverview({ rawInput: { [key]: 'E:/command' } }, 'C:/session').cwd,
      'E:/command',
    );
  }
  assert.equal(
    permissionOverview({ rawInput: { command: 'pwd' } }, 'C:/session').cwd,
    'C:/session',
  );
  assert.equal(permissionOverview({}).cwd, '');
});

test('recognized destructive commands explain deletion, hard resets and forced pushes', async () => {
  const { permissionOverview } = await load();
  const cases = [
    ['rm -rf ./cache', 'delete'],
    ['Remove-Item -LiteralPath .\\cache -Recurse -Force', 'delete'],
    ['powershell.exe -NoProfile -Command "Remove-Item .\\cache -Recurse"', 'delete'],
    ['cmd /c del /q output.txt', 'delete'],
    ['git clean -fd', 'delete'],
    ['git reset --hard HEAD~1', 'reset'],
    ['git -C ./project push --force-with-lease origin main', 'force-push'],
    ['git push origin +HEAD:main', 'force-push'],
  ];
  for (const [command, risk] of cases) {
    const result = permissionOverview({ rawInput: { command } });
    assert.ok(
      result.risks.some((item) => item.kind === risk),
      command,
    );
    assert.equal(result.sections.find((section) => section.label === '完整命令').text, command);
  }
});

test('ordinary commands and quoted command text do not receive destructive warnings', async () => {
  const { permissionOverview } = await load();
  for (const command of [
    'npm test',
    'Get-Content README.md',
    'git reset --soft HEAD~1',
    'git push origin main',
    'git show reset --hard',
    'git -C clean status --short',
    'git clean -nd',
    'git push --force --dry-run',
    'echo "rm -rf .; git reset --hard"',
  ]) {
    assert.deepEqual(permissionOverview({ rawInput: { command } }).risks, [], command);
  }
});

test('unknown tool input and content preserve every original field for inspection', async () => {
  const { permissionOverview } = await load();
  const toolCall = {
    title: 'Unrecognized tool',
    rawInput: {
      text: 'short display',
      nested: { complete: 'must remain visible' },
      enabled: false,
    },
    content: [{ type: 'custom', text: 'readable', metadata: { important: 'keep this too' } }],
    extension: { original: 42 },
  };
  const result = permissionOverview(toolCall);
  assert.deepEqual(JSON.parse(result.raw), toolCall);
  assert.deepEqual(
    JSON.parse(result.sections.find((section) => section.label === '操作参数').text),
    toolCall.rawInput,
  );
  assert.deepEqual(result.diffs, []);
});
