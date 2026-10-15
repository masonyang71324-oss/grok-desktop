'use strict';
// Exercise the real renderer, IPC, workers and attachment storage with only
// synthetic documents and mock-grok. The official reader is covered separately
// by scripts/verify-cli-large-documents.cjs, without repeating that probe here.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const JSZip = require('jszip');
const XLSX = require('xlsx');

const root = path.resolve(__dirname, '..');
const MB = 1024 * 1024;
const docStart = 'LARGE_DOCX_BEGIN_20261015';
const docEnd = 'LARGE_DOCX_END_20261015_完整正文末尾';
const sheetMarker = 'LARGE_XLSX_SYNTHETIC_36800';
const evidence = path.join(
  root,
  'test-results',
  process.env.GROK_DESKTOP_TEST_EXE ? 'large-attachments-packaged' : 'large-attachments',
);

async function withLargeMedia(bytes, prefix, destination, change) {
  const zip = await JSZip.loadAsync(bytes);
  if (change) await change(zip);
  zip.file(`${prefix}/media/synthetic-large-media.bin`, Buffer.alloc(12 * MB, 128), {
    compression: 'STORE',
  });
  const types = await zip.file('[Content_Types].xml').async('string');
  if (!types.includes('Extension="bin"'))
    zip.file(
      '[Content_Types].xml',
      types.replace(
        '</Types>',
        '<Default Extension="bin" ContentType="application/octet-stream"/></Types>',
      ),
    );
  await fs.writeFile(
    destination,
    await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );
  assert.ok(
    (await fs.stat(destination)).size > 10 * MB,
    `${path.basename(destination)} exceeds the former 10 MiB limit`,
  );
}

async function until(predicate, label, timeout = 15000) {
  const start = Date.now();
  while (!(await predicate())) {
    assert.ok(Date.now() - start < timeout, `Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function main() {
  const tempRoot = await fs.realpath(os.tmpdir());
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(tempRoot, 'grok-large-attachments-')),
  );
  const userData = path.join(directory, 'userdata');
  const project = path.join(directory, 'project');
  const grokHome = path.join(directory, 'grok-home');
  const mockLog = path.join(directory, 'mock-events.jsonl');
  let app,
    page,
    passed = false;
  const errors = [];
  const report = { syntheticOnly: true, packaged: Boolean(process.env.GROK_DESKTOP_TEST_EXE) };
  try {
    await Promise.all(
      [userData, project, grokHome, evidence].map((folder) =>
        fs.mkdir(folder, { recursive: true }),
      ),
    );
    const files = ['大课件.pptx', '大表格.xlsx', '长正文.docx'].map((name) =>
      path.join(project, name),
    );
    await withLargeMedia(
      await fs.readFile(path.join(root, 'tests/fixtures/documents/native/sample.pptx')),
      'ppt',
      files[0],
    );
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([
        ['项目', '金额'],
        [sheetMarker, 36800],
      ]),
      '报价明细',
    );
    await withLargeMedia(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'xl', files[1]);
    const documentText = `${docStart}\n${'合成大文档正文，用于验证完整附件读取。'.repeat(32000)}\n${docEnd}`;
    assert.ok(
      Buffer.byteLength(documentText) > MB,
      'Extracted DOCX text exceeds the inline 1 MiB budget',
    );
    await withLargeMedia(
      await fs.readFile(path.join(root, 'tests/fixtures/word/chinese.docx')),
      'word',
      files[2],
      async (zip) => {
        zip.file(
          'word/document.xml',
          `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${documentText}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
        );
      },
    );
    report.fileSizes = Object.fromEntries(
      await Promise.all(
        files.map(async (file) => [path.basename(file), (await fs.stat(file)).size]),
      ),
    );
    await fs.writeFile(
      path.join(userData, 'settings.json'),
      JSON.stringify({
        grokPath: process.execPath,
        language: 'zh-CN',
        lastProject: project,
        recentProjects: [project],
        notifications: false,
      }),
    );
    const env = {
      ...process.env,
      GROK_DESKTOP_DATA_DIR: userData,
      GROK_HOME: grokHome,
      GROK_DESKTOP_TEST_GROK_SCRIPT: path.join(root, 'scripts/mock-grok.cjs'),
      GROK_DESKTOP_MOCK_STATE: path.join(directory, 'mock-state.json'),
      GROK_DESKTOP_MOCK_LOG: mockLog,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.GROK_DESKTOP_DEV_URL;
    const executable = process.env.GROK_DESKTOP_TEST_EXE;
    app = await electron.launch({
      executablePath: executable || require('electron'),
      args: executable ? [] : [root],
      env,
      timeout: 30000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
    const request = async (command, payload = {}) =>
      page.evaluate(({ command, payload }) => window.desktop.request(command, payload), {
        command,
        payload,
      });
    const storageBefore = await request('attachments.storage');
    assert.equal(storageBefore.ok, true, storageBefore.error);
    assert.deepEqual(storageBefore.data.files, []);
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selected });
    }, files);
    await page.getByRole('button', { name: '添加文件或图片', exact: true }).click();
    const names = page.locator('.attachment-list .attachment-name');
    await names.nth(2).waitFor();
    assert.equal(await names.count(), 3);
    await names.nth(2).click();
    const preview = page.getByRole('dialog', { name: '长正文.docx', exact: true });
    await preview
      .locator('.attachment-notice')
      .filter({ hasText: '当前仅显示预览摘录；发送使用完整内容，不会截掉其余部分。' })
      .waitFor();
    await preview
      .locator('.attachment-notice')
      .filter({ hasText: '大文件暂不生成排版预览' })
      .waitFor();
    const excerpt = await preview.locator('.attachment-preview').innerText();
    assert.ok(excerpt.includes(docStart));
    assert.ok(
      !excerpt.includes(docEnd),
      'The preview must stay bounded instead of rendering the entire document',
    );
    assert.ok(excerpt.length <= 65536);
    const previewStorage = await request('attachments.storage');
    assert.equal(previewStorage.ok, true, previewStorage.error);
    assert.deepEqual(
      previewStorage.data.files,
      [],
      'Opening a preview must not create Extracted files',
    );
    await page.screenshot({ path: path.join(evidence, 'large-docx-preview.png') });
    await page.keyboard.press('Escape');
    await preview.waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      window.largeAttachmentUpdates = [];
      window.largeAttachmentEnds = [];
      window.largeAttachmentFinished = [];
      window.desktop.onEvent((event) => {
        if (event.type === 'update') window.largeAttachmentUpdates.push(event.update);
        if (event.type === 'turn-end') window.largeAttachmentEnds.push(event);
        if (event.type === 'task-finished') window.largeAttachmentFinished.push(event);
      });
    });
    // Hold only the deterministic mock turn, so storage protection is examined
    // during actual use rather than racing a very short synthetic response.
    await page.locator('.composer > textarea').fill('MOCK_CANCEL 请读取这三个合成大附件。');
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await page.waitForFunction(() =>
      window.largeAttachmentUpdates.some(
        (update) =>
          update.sessionUpdate === 'agent_message_chunk' &&
          update.content?.text === '正在等待停止。',
      ),
    );
    const events = (await fs.readFile(mockLog, 'utf8')).trim().split('\n').map(JSON.parse);
    const prompts = events.filter((event) => event.type === 'prompt');
    assert.equal(prompts.length, 1, 'Mixed attachments produce a single request');
    const prompt = prompts[0].status;
    assert.ok(
      prompt.includes(JSON.stringify(files[0])),
      'PPTX goes to the native reader by exact original path',
    );
    assert.ok(prompt.includes(sheetMarker), 'XLSX text reaches the prompt');
    assert.match(prompt, /36800/);
    const storage = await request('attachments.storage');
    assert.equal(storage.ok, true, storage.error);
    const extracted = storage.data.files.filter((file) => /^Extracted-.*\.txt$/.test(file.name));
    assert.equal(extracted.length, 1, 'Only the large DOCX text needs a derived file');
    const derived = extracted[0];
    assert.ok(
      prompt.includes(JSON.stringify(derived.path)),
      'The full large DOCX is referenced by its exact derived path',
    );
    assert.match(prompt, /offset\/limit/);
    assert.equal(
      derived.protected,
      true,
      'Main-process references protect the generated file without caller-supplied protectedPaths',
    );
    assert.ok(derived.bytes > MB);
    const fullText = await fs.readFile(derived.path, 'utf8');
    assert.ok(fullText.includes(docStart));
    assert.ok(
      fullText.includes(docEnd),
      'Full text must retain the end beyond the preview and former inline limits',
    );
    const removal = await request('attachments.removeMany', { names: [derived.name] });
    assert.equal(removal.ok, false, 'IPC must refuse deletion of the in-use generated file');
    assert.match(removal.error, /附件仍在草稿、队列或运行任务中使用，无法删除/);
    // IPC intentionally exposes only a translated error; the structured main
    // log retains its stable code. Check both sides without changing the API.
    await until(async () => {
      const logs = await fs
        .readFile(path.join(userData, 'logs/desktop.log'), 'utf8')
        .catch(() => '');
      return logs
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse)
        .some(
          (event) =>
            event.event === 'request-failed' &&
            event.command === 'attachments.removeMany' &&
            event.code === 'ATTACHMENT_IN_USE',
        );
    }, 'ATTACHMENT_IN_USE logged by the real IPC handler');
    assert.equal(
      (await fs.stat(derived.path)).size,
      derived.bytes,
      'Rejected deletion leaves the complete file in place',
    );
    await page.getByRole('button', { name: '停止生成', exact: true }).click();
    await page.waitForFunction(() => window.largeAttachmentEnds.length > 0);
    await page.waitForFunction(() => {
      const turn = window.largeAttachmentEnds[0];
      return window.largeAttachmentFinished.some(
        (event) => event.sessionId === turn.sessionId && event.turnId === turn.turnId,
      );
    });
    assert.deepEqual(errors, []);
    report.previewBounded = true;
    report.previewCreatedFiles = false;
    report.fullTextBytes = derived.bytes;
    report.tailMarkerPreserved = true;
    report.storageProtected = true;
    report.removalErrorCode = 'ATTACHMENT_IN_USE';
    report.rendererErrors = errors;
    passed = true;
    console.log(
      'PASS mixed >10 MiB PPTX/XLSX/DOCX: bounded preview, full-text send, native path, protected generated file and UI cancellation',
    );
  } catch (error) {
    report.error = `${error.name}: ${error.message}`;
    if (page) await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await app
      ?.evaluate(({ app, dialog }) => {
        dialog.showMessageBox = async () => ({ response: 1 });
        app.quit();
      })
      .catch(() => {});
    await app?.close().catch(() => {});
    await fs.mkdir(evidence, { recursive: true });
    for (const [source, target] of [
      [mockLog, 'mock-events.jsonl'],
      [path.join(userData, 'logs/desktop.log'), 'desktop.log'],
    ])
      await fs.copyFile(source, path.join(evidence, target)).catch(() => {});
    // The resolved target must stay within this script's mkdtemp parent.
    assert.equal(path.dirname(directory).toLowerCase(), tempRoot.toLowerCase());
    assert.ok(path.basename(directory).startsWith('grok-large-attachments-'));
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    report.passed = passed;
    report.fixtureDirectoryRemoved = true;
    await fs.writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Artifacts: ${evidence}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
