'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');

async function run(native) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'grok images ')));
  const userData = path.join(directory, 'userdata');
  const project = path.join(directory, 'project');
  await fs.mkdir(userData);
  await fs.mkdir(project);
  await fs.writeFile(
    path.join(userData, 'settings.json'),
    JSON.stringify({
      grokPath: process.execPath,
      language: native ? 'en' : 'zh-CN',
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
    GROK_DESKTOP_MOCK_IMAGE: String(native),
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
      .filter({ hasText: native ? 'Grok connected' : 'Grok 已连接' })
      .waitFor();
    await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
      const previous = await clipboard.read();
      globalThis.imageTestClipboard = await Promise.all(
        previous.map(
          async (item) =>
            new ClipboardItem(
              Object.fromEntries(
                await Promise.all(item.types.map(async (type) => [type, await item.getType(type)])),
              ),
            ),
        ),
      );
      const image = nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), {
        width: 1,
        height: 1,
      });
      await clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) }),
      ]);
    });
    const input = page.locator('.composer > textarea');
    await page.evaluate(() => {
      window.imageTurns = [];
      window.desktop.onEvent((event) => {
        if (event.type === 'turn-end') window.imageTurns.push(event);
      });
    });
    await input.evaluate((element) => {
      const data = new DataTransfer();
      data.items.add(new File(['trigger'], 'clipboard.png', { type: 'image/png' }));
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    const thumb = page.locator('.attachment-thumbnail');
    await thumb.waitFor();
    assert.ok(await thumb.evaluate((image) => image.complete && image.naturalWidth > 0));
    const imagePath = await page.locator('.attachment-list > span').getAttribute('title');
    assert.ok((await fs.stat(imagePath)).isFile());
    await page.locator('.attachment-name').click();
    await page.locator('.attachment-image').waitFor();
    await page.keyboard.press('Escape');
    if (!native)
      await page.getByText('发送时会让 Grok 读取所附图片文件。', { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(root, 'test-results', native ? 'image-native-en.png' : 'image-local-zh.png'),
    });
    // Attachment-only send must get through both UI preflight and the real main-process adapter.
    await page
      .getByRole('button', { name: native ? 'Send message' : '发送消息', exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll('.attachment-list > span').length === 0,
    );
    let events = [];
    for (let i = 0; i < 100; i++) {
      events = (await fs.readFile(path.join(directory, 'events.jsonl'), 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse);
      if (events.some((e) => e.type === 'prompt')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (native)
      assert.ok(events.some((e) => e.type === 'image-prompt' && e.mimeTypes.includes('image/png')));
    else {
      const prompt = events.find((e) => e.type === 'prompt');
      assert.ok(prompt, 'Fallback image must reach ACP');
      assert.match(prompt.status, /read_file/);
      assert.ok(prompt.status.includes(JSON.stringify(imagePath)));
      assert.ok(!events.some((e) => e.type === 'image-prompt'));
    }
    await page.waitForFunction(() => window.imageTurns.length > 0);
    if (!native) {
      await input.evaluate((element) => {
        const data = new DataTransfer();
        data.items.add(new File(['trigger'], 'clipboard.png', { type: 'image/png' }));
        element.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      });
      await thumb.waitFor();
      await input.fill('Keep my screenshot draft');
      const deletedPath = await page.locator('.attachment-list > span').getAttribute('title');
      await page.reload();
      await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
      await thumb.waitFor();
      assert.equal(await input.inputValue(), 'Keep my screenshot draft');
      await fs.unlink(deletedPath);
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      await page
        .getByRole('status')
        .getByText(/ENOENT/)
        .waitFor();
      assert.equal(await input.inputValue(), 'Keep my screenshot draft');
      assert.equal(await page.locator('.attachment-list > span').count(), 1);
      console.log('PASS screenshot draft survives reload and missing-file send failure');
    }
    assert.deepEqual(errors, []);
    console.log(
      `PASS image paste, thumbnail, preview and ${native ? 'native image (English)' : 'local read_file (Chinese)'} sending`,
    );
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    console.log('Restoring test clipboard');
    await app
      .evaluate(async ({ app, clipboard, dialog }) => {
        if (globalThis.imageTestClipboard) await clipboard.write(globalThis.imageTestClipboard);
        dialog.showMessageBox = async () => ({ response: 1 });
        app.quit();
      })
      .catch(() => {});
    console.log('Closing test application');
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
