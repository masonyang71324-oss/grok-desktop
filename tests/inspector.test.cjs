const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');

let browser, bundle;
before(async () => {
  bundle = buildSync({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Inspector from './src/Inspector';
        const root=createRoot(document.getElementById('root'));
        window.showInspector=(cwd,extra={})=>root.render(<Inspector cwd={cwd} plan={[]} revision={0} onClose={()=>root.render(null)} notify={text=>window.notices.push(text)} {...extra}/>);`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  }).outputFiles[0].text;
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});

async function fixture(t) {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  t.after(() => page.close());
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.notices = [];
    window.pending = [];
    window.held = [];
    window.calls = [];
    window.files = { 'C:/a/note.txt': { text: 'original', mtimeMs: 1 } };
    window.desktop = {
      request: async (command, payload) => {
        window.calls.push({ command, payload });
        const key = `${payload.cwd}/${payload.path || ''}`;
        const execute = () => {
          if (command === 'workspace.list')
            return payload.path
              ? [
                  {
                    name: payload.cwd === 'C:/a' ? 'old-child.txt' : 'new-child.txt',
                    path: `src/${payload.cwd === 'C:/a' ? 'old-child.txt' : 'new-child.txt'}`,
                    isDirectory: false,
                  },
                ]
              : [
                  { name: 'note.txt', path: 'note.txt', isDirectory: false },
                  { name: 'src', path: 'src', isDirectory: true },
                  ...(payload.showHidden
                    ? [{ name: 'dist', path: 'dist', isDirectory: true }]
                    : []),
                ];
          if (command === 'workspace.read') {
            const text = window.files[key]?.text || `${payload.cwd} content`;
            return {
              path: payload.path,
              text,
              eol: text.includes('\r\n') ? 'crlf' : 'lf',
              mtimeMs: window.files[key]?.mtimeMs || 1,
              truncated: false,
            };
          }
          if (command === 'workspace.save') {
            window.files[key] = { text: payload.text, mtimeMs: 2 };
            return { mtimeMs: 2 };
          }
          if (command === 'workspace.changes')
            return window.gitUnavailable
              ? { isGit: false, branch: '', changes: [], unavailable: 'git-not-found' }
              : {
                  isGit: true,
                  branch: 'main',
                  changes: [{ path: 'note.txt', status: 'M', staged: false }],
                };
          if (command === 'workspace.diff')
            return { text: window.diffText || `+${payload.cwd} changed` };
          if (command === 'system.open') return null;
          throw Error(`Unexpected request: ${command}`);
        };
        if (window.held.includes(command) || window.held.includes(`${command}:${payload.path}`)) {
          return new Promise((resolve) =>
            window.pending.push({
              command,
              payload,
              finish: () => resolve({ ok: true, data: execute() }),
            }),
          );
        }
        return { ok: true, data: execute() };
      },
    };
  });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.showInspector('C:/a'));
  await page.locator('.file-row').first().waitFor();
  return page;
}

async function hold(page, command) {
  await page.evaluate((command) => window.held.push(command), command);
}
async function release(page, command) {
  await page.waitForFunction(
    (command) => window.pending.some((item) => item.command === command),
    command,
  );
  await page.evaluate((command) => {
    const index = window.pending.findIndex((item) => item.command === command);
    window.pending.splice(index, 1)[0].finish();
  }, command);
}

test('unsaved edits and in-flight saves block unload until saved or explicitly discarded', async (t) => {
  const page = await fixture(t);
  const unloadPrevented = () =>
    page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  await page.locator('.file-row[title="note.txt"]').click();
  const editor = page.getByRole('textbox', { name: '文件内容' });
  assert.equal(await unloadPrevented(), false);
  await editor.fill('unsaved edit');
  assert.equal(await unloadPrevented(), true);
  await hold(page, 'workspace.save');
  await page.getByRole('button', { name: '保存文件' }).click();
  await editor.fill('original');
  assert.equal(await unloadPrevented(), true, 'the outstanding write still needs protection');
  await release(page, 'workspace.save');
  await page.waitForFunction(() => window.notices.includes('文件已保存'));
  await editor.fill('unsaved edit');
  assert.equal(await unloadPrevented(), false, 'the saved baseline no longer needs protection');
  await editor.fill('discard this edit');
  await page.getByRole('button', { name: '关闭 · Esc' }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  assert.equal(await unloadPrevented(), false);
});

test('saving preserves text typed after clicking Save and advances the saved baseline', async (t) => {
  const page = await fixture(t);
  await page.locator('.file-row[title="note.txt"]').click();
  const editor = page.getByRole('textbox', { name: '文件内容' });
  await editor.fill('first edit');
  await hold(page, 'workspace.save');
  await page.getByRole('button', { name: '保存文件' }).click();
  await editor.fill('second edit typed while saving');
  await release(page, 'workspace.save');
  await page.waitForFunction(() => window.notices.includes('文件已保存'));
  assert.equal(await editor.inputValue(), 'second edit typed while saving');
  assert.equal(await page.getByRole('button', { name: '保存文件' }).isEnabled(), true);
  assert.equal(await page.evaluate(() => window.files['C:/a/note.txt'].text), 'first edit');
  await page.getByRole('button', { name: '保存文件' }).click();
  await page.waitForFunction(() =>
    window.pending.some((item) => item.command === 'workspace.save'),
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.pending.find((item) => item.command === 'workspace.save').payload.expectedMtimeMs,
    ),
    2,
  );
  await release(page, 'workspace.save');
  assert.equal(
    await page.evaluate(() => window.files['C:/a/note.txt'].text),
    'second edit typed while saving',
  );
});

test('a file read started in the previous project cannot open a stale editor', async (t) => {
  const page = await fixture(t);
  await hold(page, 'workspace.read');
  await page.locator('.file-row[title="note.txt"]').click();
  await page.evaluate(() => window.showInspector('C:/b'));
  await page.waitForFunction(
    () => document.querySelector('.inspector-footer .ellipsis')?.title === 'C:/b',
  );
  await release(page, 'workspace.read');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.getByRole('textbox', { name: '文件内容' }).count(), 0);
});

test('directory expansion responses cannot populate a different project', async (t) => {
  const page = await fixture(t);
  await hold(page, 'workspace.list:src');
  await page.locator('.file-row[title="src"]').click();
  await page.evaluate(() => window.showInspector('C:/b'));
  await page.waitForFunction(
    () => document.querySelector('.inspector-footer .ellipsis')?.title === 'C:/b',
  );
  await release(page, 'workspace.list');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.locator('.file-row[title="src/old-child.txt"]').count(), 0);
});

test('diff responses cannot open a modal in a different project', async (t) => {
  const page = await fixture(t);
  await page.getByRole('button', { name: '变更', exact: true }).click();
  await hold(page, 'workspace.diff');
  await page.locator('.change-row').click();
  await page.evaluate(() => window.showInspector('C:/c'));
  await page.waitForFunction(
    () => document.querySelector('.inspector-footer .ellipsis')?.title === 'C:/c',
  );
  await release(page, 'workspace.diff');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await page.getByRole('dialog').count(), 0);
});

test('CRLF editor text compares normalized content and passes the original line ending on save', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.files['C:/a/note.txt'].text = 'alpha\r\nbeta\r\n';
  });
  await page.locator('.file-row[title="note.txt"]').click();
  const editor = page.getByRole('textbox', { name: '文件内容' });
  await editor.fill('alpha\nchanged\n');
  await editor.fill('alpha\nbeta\n');
  assert.equal(await page.getByRole('button', { name: '保存文件' }).isDisabled(), true);
  await editor.fill('alpha\nchanged\n');
  await page.getByRole('button', { name: '保存文件' }).click();
  await page.waitForFunction(() => window.notices.includes('文件已保存'));
  const payload = await page.evaluate(
    () => window.calls.find((call) => call.command === 'workspace.save').payload,
  );
  assert.equal(payload.eol, 'crlf');
  assert.equal(payload.text, 'alpha\nchanged\n');
});

test('hidden build folders are browsable and file actions use the current workspace target', async (t) => {
  const page = await fixture(t);
  await page.getByRole('checkbox', { name: '显示构建与隐藏目录' }).check();
  await page.locator('.file-row[title="dist"]').waitFor();
  await page.getByRole('button', { name: '用默认程序打开 note.txt', exact: true }).click();
  await page.getByRole('button', { name: '在资源管理器显示 note.txt', exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() =>
      window.calls.filter((call) => call.command === 'system.open').map((call) => call.payload),
    ),
    [
      { target: 'workspace-file', cwd: 'C:/a', path: 'note.txt' },
      { target: 'workspace-reveal', cwd: 'C:/a', path: 'note.txt' },
    ],
  );
});

test('missing Git has an explanatory empty state without a repeated error banner', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.gitUnavailable = true;
  });
  await page.getByRole('button', { name: '变更', exact: true }).click();
  await page.getByRole('heading', { name: '尚未安装 Git' }).waitFor();
  assert.equal(await page.locator('.inline-error').count(), 0);
});

test('a requested file location opens its line and reports the active tab', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.files['C:/a/note.txt'].text = 'one\ntwo\nthree\n';
    window.showInspector('C:/a', {
      tab: 'changes',
      openFile: { path: 'note.txt', line: 2, requestId: 1 },
      onTabChange: (tab) => (window.lastTab = tab),
    });
  });
  const editor = page.getByRole('textbox', { name: '文件内容' });
  await editor.waitFor();
  assert.equal(
    await editor.evaluate((element) =>
      element.value.slice(element.selectionStart, element.selectionEnd),
    ),
    'two',
  );
  assert.equal(await page.evaluate(() => window.lastTab), 'files');
});

test('editor selection becomes labeled inline context without saving edits', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() =>
    window.showInspector('C:/a', { onAddContext: (file) => (window.addedContext = file) }),
  );
  await page.getByRole('button', { name: 'note.txt', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '文件内容' });
  await editor.fill('first\nselected\nlast');
  await editor.evaluate((element) => element.setSelectionRange(6, 14));
  await page.getByRole('button', { name: '添加选中文本' }).click();
  assert.deepEqual(await page.evaluate(() => window.addedContext), {
    name: 'note.txt:2',
    path: '',
    kind: 'text',
    text: 'selected',
  });
  assert.equal(
    await page.evaluate(() => window.calls.some((call) => call.command === 'workspace.save')),
    false,
  );
  assert.equal(await editor.inputValue(), 'first\nselected\nlast');
});

test('diff line numbers distinguish removed and added lines and restart at each hunk', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.diffText =
      '--- a/note.txt\n+++ b/note.txt\n@@ -10,2 +10,2 @@\n same\n-old\n+new\n@@ -40 +42 @@\n-last\n+next\n';
  });
  await page.getByRole('button', { name: '变更', exact: true }).click();
  await page.locator('.change-row').click();
  await page.getByRole('dialog').waitFor();
  const rows = await page
    .locator('.diff-view > div')
    .evaluateAll((elements) =>
      elements
        .filter((element) =>
          [' same', '-old', '+new', '-last', '+next'].includes(
            element.querySelector('.diff-line-content')?.textContent,
          ),
        )
        .map((element) =>
          Array.from(element.querySelectorAll('.diff-line-number')).map((cell) => cell.textContent),
        ),
    );
  assert.deepEqual(rows, [
    ['10', '10'],
    ['11', ''],
    ['', '11'],
    ['40', ''],
    ['', '42'],
  ]);
});
