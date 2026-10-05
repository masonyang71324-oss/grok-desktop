const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');

let browser, bundle;
before(async () => {
  bundle = buildSync({
    stdin: {
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {PermissionDialog} from './src/Dialogs';
        import {setLocale} from './src/i18n';
        const root = createRoot(document.getElementById('root'));
        window.setLocale = setLocale;
        window.showApproval = (item, cwd) => root.render(<PermissionDialog key={item.requestId}
          item={item} cwd={cwd} onReply={async (...args) => {
            window.replies.push(args);
            if (window.holdReply) await new Promise(resolve => window.finishReply = resolve);
            if (window.rejectReply) throw Error('original transport failure');
          }} />);
      `,
      resolveDir: path.join(__dirname, '..'),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    loader: { '.css': 'empty' },
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  }).outputFiles[0].text;
  browser = await launchBrowser();
});
after(async () => browser?.close());

async function fixture(t) {
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  t.after(() => page.close());
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.replies = [];
  });
  await page.addScriptTag({ content: bundle });
  return page;
}

const options = [
  { optionId: 'opaque/once', kind: 'allow_once', name: 'Yes, proceed' },
  { optionId: 'opaque/always', kind: 'allow_always', name: 'Allow this command' },
  { optionId: 'opaque/no', kind: 'reject_once', name: 'No, stop' },
  { optionId: 'opaque/never', kind: 'reject_always', name: 'Reject this command' },
  { optionId: 'opaque/custom', kind: 'custom', name: 'Custom official decision' },
];

test('approval renders the actual structured edit and full original input without translating paths', async (t) => {
  const page = await fixture(t);
  const toolCall = {
    title: 'Edit configuration',
    rawInput: { path: 'src/设置.txt', cwd: 'E:/实际目录', opaque: { original: '原始参数' } },
    content: [
      { type: 'diff', path: 'src/设置.txt', oldText: 'same\nold\n', newText: 'same\nnew\n' },
    ],
  };
  await page.evaluate(
    ({ toolCall, options }) =>
      window.showApproval({ requestId: 'diff', params: { toolCall, options } }, 'C:/owner'),
    { toolCall, options },
  );
  await page.locator('.permission-file-diff .structured-diff').waitFor();
  assert.equal(await page.locator('.permission-working-directory dd').textContent(), 'E:/实际目录');
  assert.equal(await page.locator('.permission-file-diff h4').textContent(), 'src/设置.txt');
  assert.equal(await page.locator('.diff-remove .diff-line-content').textContent(), '-old');
  assert.equal(await page.locator('.diff-add .diff-line-content').textContent(), '+new');
  await page.getByRole('button', { name: '并排', exact: true }).click();
  assert.ok(await page.locator('.diff-split-row').count());
  await page.locator('.permission-review-details > summary').click();
  await page.locator('.permission-raw-details > summary').click();
  assert.deepEqual(
    JSON.parse(await page.locator('.permission-raw-details pre').textContent()),
    toolCall,
  );
  assert.deepEqual(await page.evaluate(() => window.replies), []);
});

test('risk explanations keep all official permission choices and return each exact server ID', async (t) => {
  const page = await fixture(t);
  for (let index = 0; index < options.length; index++) {
    await page.evaluate(
      ({ options, index }) =>
        window.showApproval(
          {
            requestId: `risk-${index}`,
            params: { toolCall: { rawInput: { command: 'git reset --hard HEAD~1' } }, options },
          },
          'C:/owner-session',
        ),
      { options, index },
    );
    await page.locator('.permission-risk-notice').waitFor();
    assert.equal(await page.locator('.permission-choice').count(), options.length);
    assert.equal(
      await page.locator('.permission-working-directory dd').textContent(),
      'C:/owner-session',
    );
    await page.locator('.permission-choice').nth(index).click();
  }
  assert.deepEqual(
    await page.evaluate(() => window.replies),
    options.map((option) => [option.optionId, false]),
  );
});

test('unknown tool details remain inspectable and busy approval keeps Escape from cancelling', async (t) => {
  const page = await fixture(t);
  await page.evaluate(
    ({ options }) => {
      window.holdReply = true;
      window.showApproval({
        requestId: 'unknown',
        params: {
          toolCall: {
            rawInput: { text: 'short', extra: { important: 17 } },
            content: [{ type: 'other', text: 'display', hidden: 'retained' }],
          },
          options,
        },
      });
    },
    { options },
  );
  await page.locator('.permission-choice').first().waitFor();
  assert.equal(await page.locator('.permission-risk-notice').count(), 0);
  await page.locator('.permission-review-details > summary').click();
  await page.locator('.permission-raw-details > summary').click();
  assert.match(await page.locator('.permission-raw-details pre').textContent(), /retained/);
  await page.locator('.permission-choice').first().click();
  assert.equal(await page.locator('.permission-choice:disabled').count(), options.length);
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => window.replies), [['opaque/once', false]]);
  await page.evaluate(() => {
    window.rejectReply = true;
    window.finishReply();
  });
  await page.getByText('original transport failure', { exact: true }).waitFor();
  assert.equal(await page.locator('.permission-choice:disabled').count(), 0);
  await page.evaluate(() => {
    window.holdReply = false;
    window.rejectReply = false;
  });
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => window.replies), [
    ['opaque/once', false],
    [undefined, true],
  ]);
});

test('approval impact and directory labels switch languages while original commands stay intact', async (t) => {
  const page = await fixture(t);
  await page.evaluate(
    ({ options }) =>
      window.showApproval({
        requestId: 'bilingual',
        params: { toolCall: { rawInput: { command: 'rm -rf ./缓存', cwd: 'E:/项目' } }, options },
      }),
    { options },
  );
  await page.getByText('删除文件或目录', { exact: true }).waitFor();
  await page.evaluate(() => window.setLocale('en'));
  await page.getByText('Deletes files or folders', { exact: true }).waitFor();
  assert.equal(
    await page.locator('.permission-working-directory dt').textContent(),
    'Working directory',
  );
  assert.equal(await page.locator('.permission-working-directory dd').textContent(), 'E:/项目');
  assert.equal(await page.locator('.permission-command-preview').textContent(), 'rm -rf ./缓存');
  await page.getByRole('button', { name: 'Allow once', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.replies), [['opaque/once', false]]);
});
