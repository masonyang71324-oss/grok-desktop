const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCommand } = require('../electron/management.cjs');

test('stdio MCP fields remain separate CLI arguments including quoted paths', () => {
  const result = buildCommand('mcp-add', {
    name: 'local-server',
    transport: 'stdio',
    command: 'C:\\Program Files\\node.exe',
    args: '"C:\\server\\index.js" --tag "hello world"',
    scope: 'project',
  });
  assert.deepEqual(result.args, [
    'mcp',
    'add',
    'local-server',
    '--scope',
    'project',
    '--transport',
    'stdio',
    '--',
    'C:\\Program Files\\node.exe',
    'C:\\server\\index.js',
    '--tag',
    'hello world',
  ]);
  assert.equal(result.mutates, true);
});

test('unrecognized management action and missing name never launch a process', () => {
  assert.throws(() => buildCommand('arbitrary-shell', { command: 'anything' }), /不支持/);
  assert.throws(() => buildCommand('mcp-remove', {}), /名称/);
});

test('read-only update action only checks; installation is a separate explicit action', () => {
  const result = buildCommand('update-check', {});
  assert.deepEqual(result.args, ['update', '--check', '--json']);
  assert.equal(result.mutates, false);
});

test('MCP environment/header values cannot be mistaken for CLI flags', () => {
  const base = { name: 'server', transport: 'http', url: 'https://example.test/mcp' };
  assert.throws(() => buildCommand('mcp-add', { ...base, env: '--scope=project' }), /环境变量/);
  assert.throws(() => buildCommand('mcp-add', { ...base, headers: '--transport=stdio' }), /请求头/);
  assert.ok(
    buildCommand('mcp-add', {
      ...base,
      env: 'TOKEN=-value',
      headers: 'X-Test: -value',
    }).args.includes('TOKEN=-value'),
  );
});
