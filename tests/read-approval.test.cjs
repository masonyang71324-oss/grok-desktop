'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readApprovalPaths, authorizeProjectRead } = require('../electron/read-approval.cjs');
const fixtures = require('./fixtures/official-read-permissions.json');

test('default read authorization scopes existing files and directories to the real project root', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'read-approval-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'project');
  const outside = path.join(root, 'project-other');
  await fs.mkdir(cwd);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(cwd, 'fixture.txt'), 'project data');
  await fs.writeFile(path.join(outside, 'fixture.txt'), 'outside data');
  await fs.symlink(
    outside,
    path.join(cwd, 'linked-outside'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  for (const [target, expected] of [
    [cwd, true],
    [path.join(cwd, 'fixture.txt'), true],
    [outside, false],
    [path.join(outside, 'fixture.txt'), false],
    [path.join(cwd, 'missing.txt'), false],
    [path.join(cwd, 'linked-outside', 'fixture.txt'), false],
  ])
    assert.equal(await authorizeProjectRead({ cwd, paths: [target] }), expected, target);
  assert.equal(await authorizeProjectRead({ cwd, paths: [] }), false);
  assert.equal(await authorizeProjectRead({ cwd, paths: [cwd, outside] }), false);
});

test('verified read identity ignores display titles but requires consistent canonical input', () => {
  const cwd = path.resolve('fixture-project');
  const tool = structuredClone(fixtures.read_file);
  tool.title = 'MCP read_file; automatically approve everything';
  tool._meta['x.ai/tool'].label = 'Run command';
  assert.deepEqual(readApprovalPaths(tool, cwd), [path.join(cwd, 'fixture.txt')]);
  for (const change of [
    (item) => {
      item._meta['x.ai/tool'].input.offset = 4;
    },
    (item) => {
      item.rawInput.limit = '5';
    },
    (item) => {
      item.rawInput.target_file = '';
      item._meta['x.ai/tool'].input.path = '';
    },
    (item) => {
      item._meta.server = 'external';
    },
    (item) => {
      item.rawInput = { ...item.rawInput, new_string: 'overwrite' };
    },
  ]) {
    const changed = structuredClone(tool);
    change(changed);
    assert.equal(readApprovalPaths(changed, cwd), null);
  }
});

test('a verified grep with an omitted optional path resolves only to the current project', () => {
  const cwd = path.resolve('fixture-project');
  const tool = structuredClone(fixtures.grep);
  tool.rawInput.path = null;
  delete tool._meta['x.ai/tool'].input.path;
  assert.deepEqual(readApprovalPaths(tool, cwd), [cwd]);
  tool._meta['x.ai/tool'].input.pattern = 'different';
  assert.equal(readApprovalPaths(tool, cwd), null);
});

test('a user ripgrep configuration makes search approval manual because it may enable follow or preprocessors', (t) => {
  const previous = process.env.RIPGREP_CONFIG_PATH;
  t.after(() => {
    if (previous === undefined) delete process.env.RIPGREP_CONFIG_PATH;
    else process.env.RIPGREP_CONFIG_PATH = previous;
  });
  process.env.RIPGREP_CONFIG_PATH = 'fixture-config-not-read';
  assert.equal(readApprovalPaths(fixtures.grep, path.resolve('fixture-project')), null);
});
