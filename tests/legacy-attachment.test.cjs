const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const { createAccessPolicy, projectKey } = require('../electron/access-policy.cjs');
const source = require('node:fs').readFileSync(
  path.join(__dirname, '../electron/main.cjs'),
  'utf8',
);
const ast = ts.createSourceFile('main.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
test('legacy attachment recovery only grants the original file after a matching native selection', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok legacy attachment '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const old = path.join(directory, 'old.txt'),
    other = path.join(directory, 'other.txt');
  await fs.writeFile(old, 'legacy');
  await fs.writeFile(other, 'other');
  const access = createAccessPolicy();
  let selected = other;
  const events = [];
  const context = {
    fs,
    path,
    projectKey,
    access,
    win: null,
    t: (value) => value,
    settings: { selectedAttachments: [] },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }) },
    saveSettings: async (patch) => Object.assign(context.settings, patch),
    emit: (event) => events.push(event),
  };
  vm.createContext(context);
  vm.runInContext(
    ast.statements
      .find(
        (node) =>
          ts.isFunctionDeclaration(node) && node.name?.text === 'reauthorizeAttachmentPaths',
      )
      .getText(ast),
    context,
  );
  await assert.rejects(context.reauthorizeAttachmentPaths([old]), /原附件/);
  await assert.rejects(access.file(old), /选择/);
  selected = old;
  assert.equal(await context.reauthorizeAttachmentPaths([old]), true);
  assert.equal(await access.file(old), await fs.realpath(old));
  assert.ok(context.settings.selectedAttachments.includes(old));
  assert.equal(events[0].type, 'attachment-authorization-changed');
});
