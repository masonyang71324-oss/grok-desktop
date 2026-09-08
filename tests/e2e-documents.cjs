const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const root = path.resolve(__dirname, '..');

async function run(english) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'grok documents ')));
  const userData = path.join(directory, 'userdata'),
    project = path.join(directory, 'project');
  await fs.mkdir(userData);
  await fs.mkdir(project);
  const files = ['扫描合同.pdf', '报价.xlsx', '电子发票.ofd'].map((name) =>
    path.join(project, name),
  );
  await fs.copyFile(path.join(root, 'tests/fixtures/documents/native/sample.pdf'), files[0]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['项目', '金额'],
      ['维护费', 36800],
    ]),
    '报价明细',
  );
  await fs.writeFile(files[1], XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  const zip = new JSZip();
  zip.file(
    'OFD.xml',
    '<ofd:OFD xmlns:ofd="http://www.ofdspec.org/2016"><ofd:DocBody><ofd:DocRoot>Doc/Document.xml</ofd:DocRoot></ofd:DocBody></ofd:OFD>',
  );
  zip.file(
    'Doc/Document.xml',
    '<ofd:Document xmlns:ofd="http://www.ofdspec.org/2016"><ofd:Pages><ofd:Page ID="1" BaseLoc="Page.xml"/></ofd:Pages></ofd:Document>',
  );
  zip.file(
    'Doc/Page.xml',
    '<ofd:Page xmlns:ofd="http://www.ofdspec.org/2016"><ofd:Content><ofd:Layer><ofd:TextObject><ofd:TextCode>发票合计 12800元</ofd:TextCode></ofd:TextObject></ofd:Layer></ofd:Content></ofd:Page>',
  );
  await fs.writeFile(files[2], await zip.generateAsync({ type: 'nodebuffer' }));
  const originals = await Promise.all(files.map((f) => fs.readFile(f)));
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
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page
      .locator('.sidebar-status')
      .filter({ hasText: english ? 'Grok connected' : 'Grok 已连接' })
      .waitFor();
    if (!english) {
      // Exercise each worker's packaged dependency graph through the real IPC.
      const rtf = path.join(project, 'body.rtf');
      await fs.writeFile(rtf, '{\\rtf1 packaged reader 46800}');
      const ppt = path.join(root, 'tests/fixtures/documents/structured-legacy/54880_chinese.ppt');
      const epub = new JSZip();
      epub.file('mimetype', 'application/epub+zip');
      epub.file(
        'META-INF/container.xml',
        '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      );
      epub.file(
        'book.opf',
        '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
      );
      epub.file(
        'chapter.xhtml',
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><body><p>电子书&nbsp;57800</p></body></html>',
      );
      const ebook = path.join(project, 'book.epub');
      await fs.writeFile(ebook, await epub.generateAsync({ type: 'nodebuffer' }));
      for (const [filename, expected] of [
        [rtf, '46800'],
        [ppt, '表Mix'],
        [ebook, '57800'],
      ]) {
        const response = await page.evaluate(
          (p) => window.desktop.request('attachment.preview', { path: p }),
          filename,
        );
        assert.equal(response.ok, true, response.error);
        assert.ok(
          response.data.text.includes(expected),
          `${path.basename(filename)}: ${response.data.text.slice(0, 180)}`,
        );
      }
    }
    await app.evaluate(({ dialog, shell }, files) => {
      global.documentOpened = [];
      shell.openPath = async (p) => {
        global.documentOpened.push(p);
        return '';
      };
      dialog.showOpenDialog = async (win, options) => {
        global.documentFilters = options.filters;
        return { canceled: false, filePaths: files };
      };
    }, files);
    await page
      .getByRole('button', {
        name: english ? 'Attach files or images' : '添加文件或图片',
        exact: true,
      })
      .click();
    const filters = await app.evaluate(() => global.documentFilters);
    for (const ext of ['pdf', 'xls', 'et', 'dps', 'ofd', 'eml'])
      assert.ok(filters[0].extensions.includes(ext));
    const names = page.locator('.attachment-name');
    await names.nth(0).click();
    let preview = page.getByRole('dialog', { name: '扫描合同.pdf', exact: true });
    await preview
      .locator('.attachment-notice')
      .filter({ hasText: english ? 'natively' : '原生读取' })
      .waitFor();
    await preview
      .getByRole('button', {
        name: english ? 'Open original in default app' : '用默认程序打开原文件',
      })
      .click();
    assert.deepEqual(await app.evaluate(() => global.documentOpened), [files[0]]);
    await page.screenshot({
      path: path.join(root, 'test-results', `documents-native-${english ? 'en' : 'zh'}.png`),
    });
    await page.keyboard.press('Escape');
    for (const [index, expected] of [
      [1, '36800'],
      [2, '12800'],
    ]) {
      await names.nth(index).click();
      preview = page.getByRole('dialog', { name: path.basename(files[index]), exact: true });
      await preview.locator('.attachment-preview').filter({ hasText: expected }).waitFor();
      await preview
        .locator('.attachment-notice')
        .filter({ hasText: english ? 'text that will be sent' : '发送给 Grok 的文字' })
        .waitFor();
      if (index === 1)
        await page.screenshot({
          path: path.join(root, 'test-results', `documents-sheet-${english ? 'en' : 'zh'}.png`),
        });
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => {
      window.documentTurns = [];
      window.desktop.onEvent((e) => {
        if (e.type === 'turn-end') window.documentTurns.push(e);
      });
    });
    await page
      .getByRole('button', { name: english ? 'Send message' : '发送消息', exact: true })
      .click();
    await page.waitForFunction(() => window.documentTurns.length > 0);
    const events = () =>
      fs
        .readFile(path.join(directory, 'events.jsonl'), 'utf8')
        .then((s) => s.trim().split('\n').map(JSON.parse));
    const prompt = (await events()).find((e) => e.type === 'prompt').status;
    assert.ok(prompt.includes(JSON.stringify(files[0])));
    assert.match(prompt, /read_file/);
    assert.match(prompt, /报价明细/);
    assert.match(prompt, /36800/);
    assert.match(prompt, /发票合计 12800元/);
    for (let i = 0; i < files.length; i++)
      assert.deepEqual(await fs.readFile(files[i]), originals[i]);
    const caj = path.join(project, '论文.caj');
    await fs.writeFile(caj, Buffer.from('CAJ\0fixture'));
    await app.evaluate(({ dialog }, caj) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [caj] });
    }, caj);
    await page
      .getByRole('button', {
        name: english ? 'Attach files or images' : '添加文件或图片',
        exact: true,
      })
      .click();
    await page.locator('.composer > textarea').fill('Keep document draft');
    await page
      .getByRole('button', { name: english ? 'Send message' : '发送消息', exact: true })
      .click();
    await page.getByRole('status').filter({ hasText: 'CAJViewer' }).waitFor();
    assert.equal(await page.locator('.composer > textarea').inputValue(), 'Keep document draft');
    assert.equal(await names.count(), 1);
    assert.equal((await events()).filter((e) => e.type === 'prompt').length, 1);
    await names.click();
    await page
      .getByRole('dialog', { name: '论文.caj', exact: true })
      .getByRole('alert')
      .filter({ hasText: english ? 'print to PDF' : '打印为 PDF' })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      `PASS common documents ${english ? 'English' : 'Chinese'} native preview/open, sheet/OFD extraction, mixed send, CAJ draft retention`,
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
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
