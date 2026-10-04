const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok access '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = path.join(directory, 'project'),
    outside = path.join(directory, 'outside');
  await fs.mkdir(project);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(project, 'source.txt'), 'inside');
  await fs.writeFile(path.join(outside, 'private.txt'), 'outside');
  const { createAccessPolicy } = require('../electron/access-policy.cjs');
  return { directory, project, outside, access: createAccessPolicy() };
}

test('only selected projects can be accessed and read-only projects cannot run or save', async (t) => {
  const { project, outside, access } = await fixture(t);
  assert.throws(() => access.project(project), /选择|selected/);
  await access.grantProject(project, false);
  assert.equal(access.project(project).trusted, false);
  assert.throws(() => access.project(project, true), /信任|trust/);
  await assert.rejects(access.file(path.join(outside, 'private.txt')), /选择|selected/);
  assert.equal(
    await access.file(path.join(project, 'source.txt')),
    await fs.realpath(path.join(project, 'source.txt')),
  );
  await access.grantProject(project, true);
  assert.equal(access.project(project, true).trusted, true);
});

test('native file grants allow attachment previews without granting their parent folder', async (t) => {
  const { outside, access } = await fixture(t);
  const selected = path.join(outside, 'private.txt'),
    sibling = path.join(outside, 'other.txt');
  await fs.writeFile(sibling, 'sibling');
  await access.grantFile(selected);
  assert.equal(await access.file(selected), await fs.realpath(selected));
  await assert.rejects(access.file(sibling), /选择|selected/);
  await assert.rejects(access.file(selected, true), /项目|project/);
});

test('a project symlink cannot silently authorize files outside the selected folder', async (t) => {
  const { project, outside, access } = await fixture(t);
  await access.grantProject(project, true);
  const link = path.join(project, 'external');
  await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(access.file(path.join(link, 'private.txt')), /选择|selected/);
  await access.grantFile(path.join(link, 'private.txt'));
  assert.equal(
    await access.file(path.join(link, 'private.txt')),
    await fs.realpath(path.join(outside, 'private.txt')),
  );
});

test('IPC payload validation rejects malformed paths, requests and controls before services run', () => {
  const { validateRequest } = require('../electron/request-validation.cjs');
  for (const [command, payload] of [
    ['workspace.read', { cwd: 3, path: 'a' }],
    ['session.send', { sessionId: 'x', text: { bad: 1 } }],
    ['terminal.input', { id: 'x', data: [] }],
    ['checkpoints.removeMany', { ids: ['good', 4] }],
    ['settings.save', { grokPath: [] }],
    ['system.open', { target: 'url', url: 'file:///private' }],
  ]) {
    assert.throws(() => validateRequest(command, payload), /参数|request|http/i, command);
  }
  assert.deepEqual(validateRequest('bootstrap', undefined), {});
  assert.deepEqual(
    validateRequest('session.send', {
      sessionId: 'x',
      text: 'hello',
      attachments: [{ name: 'note', text: 'inline' }],
    }),
    { sessionId: 'x', text: 'hello', attachments: [{ name: 'note', text: 'inline' }] },
  );
});

test('explicit read-only trust survives Windows path spelling changes', async (t) => {
  const { project } = await fixture(t);
  const { normalizeSettings } = require('../electron/settings.cjs');
  const { projectKey } = require('../electron/access-policy.cjs');
  const saved = normalizeSettings({
    projectTrust: { [project]: false },
    recentProjects: [project.toLowerCase()],
  });
  assert.equal(saved.projectTrust[projectKey(project.toLowerCase())], false);
});

test('read-only projects cannot approve executable file opens', async (t) => {
  const { project, access } = await fixture(t);
  const filename = path.join(project, 'run.cmd');
  await fs.writeFile(filename, 'rem inert');
  await access.grantProject(project, false);
  assert.throws(() => access.execution(filename), /信任|trust/);
  await access.grantProject(project, true);
  assert.equal(access.execution(filename).trusted, true);
});

test('a selected drive root authorizes its own descendants', async (t) => {
  const { directory, project, access } = await fixture(t);
  const root = path.parse(directory).root;
  await access.grantProject(root, false);
  const filename = path.join(project, 'source.txt');
  assert.equal(await access.file(filename), await fs.realpath(filename));
});
