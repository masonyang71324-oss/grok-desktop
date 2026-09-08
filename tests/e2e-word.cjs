'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');

async function run(english) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'grok word ')));
  const userData = path.join(directory, 'userdata');
  const project = path.join(directory, 'project');
  await fs.mkdir(userData);
  await fs.mkdir(project);
  const name = english ? 'sample.docx' : '样例文档.doc';
  const file = path.join(project, name);
  const original = await fs.readFile(
    path.join(root, 'tests/fixtures/word', english ? 'sample.docx' : 'sample.doc'),
  );
  await fs.writeFile(file, original);
  await fs.writeFile(
    path.join(userData, 'settings.json'),
    JSON.stringify({
      grokPath: process.execPath,
      language: english ? 'en' : 'zh-CN',
      lastProject: project,
      recentProjects: [project],
      notifications: false,
    }),
  );
  const env = {
    ...process.env,
    GROK_DESKTOP_DATA_DIR: userData,
    GROK_DESKTOP_TEST_GROK_SCRIPT: path.join(root, 'scripts/mock-grok.cjs'),
    GROK_DESKTOP_MOCK_STATE: path.join(directory, 'state.json'),
    GROK_DESKTOP_MOCK_LOG: path.join(directory, 'events.jsonl'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.GROK_DESKTOP_DEV_URL;
  const exe = process.env.GROK_DESKTOP_TEST_EXE;
  const app = await electron.launch({
    executablePath: exe || require('electron'),
    args: exe ? [] : [root],
    env,
  });
  let page;
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page
      .locator('.sidebar-status')
      .filter({ hasText: english ? 'Grok connected' : 'Grok 已连接' })
      .waitFor();
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, file);
    const attach = () =>
      page
        .getByRole('button', {
          name: english ? 'Attach files or images' : '添加文件或图片',
          exact: true,
        })
        .click();
    const send = () =>
      page
        .getByRole('button', { name: english ? 'Send message' : '发送消息', exact: true })
        .click();
    await attach();
    await page.locator('.attachment-name').click();
    const preview = page.getByRole('dialog', { name, exact: true });
    await preview.locator('.attachment-preview').filter({ hasText: 'Header test file' }).waitFor();
    await preview
      .locator('.attachment-notice')
      .filter({ hasText: english ? 'text that will be sent' : '发送给 Grok 的文字' })
      .waitFor();
    assert.match(
      await preview.locator('.attachment-preview').innerText(),
      /Section 3 – first page footer/,
    );
    await page.screenshot({
      path: path.join(
        root,
        'test-results',
        english ? 'word-preview-en.png' : 'word-preview-zh.png',
      ),
    });
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      window.wordTurns = [];
      window.desktop.onEvent((e) => {
        if (e.type === 'turn-end') window.wordTurns.push(e);
      });
    });
    await send();
    await page.waitForFunction(() => window.wordTurns.length > 0);
    assert.equal(await page.locator('.attachment-list > span').count(), 0);
    const events = (await fs.readFile(path.join(directory, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.match(events.find((e) => e.type === 'prompt').status, /Header test file/);
    assert.deepEqual(await fs.readFile(file), original);
    // A conversion error must not submit a second prompt or discard the draft.
    await fs.writeFile(file, 'not a Word document');
    await attach();
    const input = page.locator('.composer > textarea');
    await input.fill('Keep document draft');
    await send();
    await page
      .getByRole('status')
      .filter({ hasText: english ? 'Could not read Word' : '无法读取 Word' })
      .waitFor();
    assert.equal(await input.inputValue(), 'Keep document draft');
    assert.equal(await page.locator('.attachment-list > span').count(), 1);
    const after = (await fs.readFile(path.join(directory, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.equal(after.filter((e) => e.type === 'prompt').length, 1);
    await page.locator('.attachment-name').click();
    await page.getByRole('dialog', { name, exact: true }).getByRole('alert').waitFor();
    assert.deepEqual(errors, []);
    console.log(
      `PASS Word ${english ? 'DOCX English' : 'DOC Chinese'} attach, preview, worker extraction, send and failure draft retention`,
    );
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await app
      .evaluate(({ app, dialog }) => {
        dialog.showMessageBox = async () => ({ response: 1 });
        app.quit();
      })
      .catch(() => {});
    await app.close().catch(() => {});
    console.log(`Artifacts: ${directory}`);
  }
}
(async () => {
  await run(false);
  await run(true);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
