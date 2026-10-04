'use strict';
// One controlled Windows whole-desktop-tree forced exit after a real draft flush.
// Run after build, separately from other packaging/E2E I/O. No prompts or clipboard.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { _electron: electron } = require('playwright');
const { windowsSystemExecutable } = require('../electron/system-launch.cjs');

const root = path.resolve(__dirname, '..');
const storageKey = 'grok-desktop-drafts';
const draftText =
  '强制退出可靠性测试：保留这份尚未发送的草稿。\nOwned fixture only — no prompt is sent.';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let app,
  directory,
  phase = 'setup';

async function launch(userData, project) {
  const packaged = process.env.GROK_DESKTOP_TEST_EXE;
  const env = {
    ...process.env,
    GROK_DESKTOP_DATA_DIR: userData,
    GROK_HOME: path.join(directory, 'grok-home'),
    GROK_DESKTOP_TEST_GROK_SCRIPT: path.join(root, 'scripts/mock-grok.cjs'),
    GROK_DESKTOP_MOCK_STATE: path.join(directory, 'mock-state.json'),
    GROK_DESKTOP_MOCK_LOG: path.join(directory, 'mock-events.jsonl'),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.GROK_DESKTOP_DEV_URL;
  app = await electron.launch({
    executablePath: packaged || require('electron'),
    args: packaged ? [] : [root],
    env,
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
  await page.locator('.new-conversation:not(:disabled)').waitFor();
  assert.equal(
    await page.evaluate(
      async () => (await window.desktop.request('bootstrap')).data.settings.lastProject,
    ),
    project,
  );
  return page;
}

(async () => {
  try {
    assert.equal(
      process.platform,
      'win32',
      'This probe specifically exercises Windows taskkill /T /F',
    );
    directory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'grok-draft-force-exit-')),
    );
    const userData = path.join(directory, 'userdata');
    const project = path.join(directory, 'project');
    const attachment = path.join(project, 'owned-draft-context.txt');
    await fs.mkdir(userData);
    await fs.mkdir(project);
    await fs.writeFile(attachment, 'Synthetic attachment metadata fixture.\n');
    await fs.writeFile(
      path.join(userData, 'settings.json'),
      JSON.stringify({
        language: 'zh-CN',
        grokPath: process.execPath,
        lastProject: project,
        recentProjects: [project],
        permissionMode: 'ask',
        notifications: false,
      }),
    );
    let page = await launch(userData, project);

    phase = 'observe-original-storage-and-flush';
    await app.evaluate(({ session, dialog }, attachment) => {
      globalThis.draftForceFlushes = [];
      const target = session.defaultSession;
      const originalFlush = target.flushStorageData.bind(target);
      const wrappedFlush = (...args) => {
        const result = originalFlush(...args);
        globalThis.draftForceFlushes.push({ returnedAt: Date.now() });
        return result;
      };
      target.flushStorageData = wrappedFlush;
      const descriptor = Object.getOwnPropertyDescriptor(target, 'flushStorageData');
      globalThis.draftForcePatch = {
        installed: target.flushStorageData === wrappedFlush,
        stableSession: target === session.defaultSession,
        descriptor: descriptor && {
          writable: descriptor.writable,
          configurable: descriptor.configurable,
          accessor: !!descriptor.get,
        },
      };
      const originalDialog = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => {
        dialog.showOpenDialog = originalDialog;
        return { canceled: false, filePaths: [attachment] };
      };
    }, attachment);
    await page.evaluate(
      ({ storageKey, draftText, attachment }) => {
        window.draftForceWrittenAt = null;
        const originalWrite = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          const result = originalWrite.call(this, key, value);
          if (this === window.localStorage && key === storageKey) {
            const state = JSON.parse(value);
            if (
              Object.values(state.drafts || {}).some(
                (draft) =>
                  draft.text === draftText &&
                  draft.attachments?.some((file) => file.path === attachment),
              )
            )
              window.draftForceWrittenAt ??= Date.now();
          }
          return result;
        };
      },
      { storageKey, draftText, attachment },
    );

    phase = 'enter-draft-and-attachment';
    await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).fill(draftText);
    await page.getByRole('button', { name: '添加文件或图片', exact: true }).click();
    await page
      .locator('.attachment-list .attachment-name')
      .filter({ hasText: 'owned-draft-context.txt' })
      .waitFor();
    await page.waitForFunction(() => window.draftForceWrittenAt !== null);
    const before = await page.evaluate(
      ({ storageKey, draftText }) => ({
        writtenAt: window.draftForceWrittenAt,
        draft: Object.values(JSON.parse(localStorage.getItem(storageKey)).drafts).find(
          (draft) => draft.text === draftText,
        ),
      }),
      { storageKey, draftText },
    );
    assert.equal(before.draft.text, draftText);
    assert.equal(before.draft.attachments.length, 1);
    assert.equal(before.draft.attachments[0].path, attachment);

    phase = 'wait-for-real-flush-then-500ms';
    const deadline = Date.now() + 5000;
    let flush;
    while (!flush && Date.now() < deadline) {
      flush = await app.evaluate(
        (_electron, writtenAt) =>
          globalThis.draftForceFlushes.find((call) => call.returnedAt >= writtenAt),
        before.writtenAt,
      );
      if (!flush) await wait(20);
    }
    if (!flush)
      console.error(
        'DRAFT_FLUSH_DIAGNOSIS',
        JSON.stringify(
          {
            main: await app.evaluate(() => ({
              patch: globalThis.draftForcePatch,
              calls: globalThis.draftForceFlushes,
              now: Date.now(),
            })),
            writtenAt: before.writtenAt,
            renderer: await page.evaluate(() => document.body.innerText.slice(-1500)),
          },
          null,
          2,
        ),
      );
    assert.ok(
      flush,
      'The original flushStorageData API must have returned after the matching storage write',
    );
    await wait(500);

    phase = 'force-owned-live-desktop-tree';
    const current = app;
    const owned = current.process();
    assert.ok(
      owned.pid && owned.exitCode === null && owned.signalCode === null,
      'Owned app process must still be live',
    );
    const identity = await current.evaluate(() => ({ pid: process.pid, parentPid: process.ppid }));
    // Playwright 1.63 launches through an owned cmd.exe on Windows. Its actual
    // Electron main must be that live launcher's direct child (or the handle itself).
    assert.ok(
      identity.pid === owned.pid || identity.parentPid === owned.pid,
      'Live Electron must belong to this exact owned launcher ChildProcess',
    );
    assert.ok(
      owned.exitCode === null && owned.signalCode === null,
      'Do not signal an already-exited numeric PID',
    );
    const killedAt = Date.now();
    const closed = current.waitForEvent('close', { timeout: 10000 });
    void closed.catch(() => {});
    await promisify(execFile)(
      windowsSystemExecutable('taskkill.exe'),
      ['/PID', String(owned.pid), '/T', '/F'],
      { windowsHide: true },
    );
    await closed;
    const exit = { exitCode: owned.exitCode, signalCode: owned.signalCode };
    app = null; // Never use the old PID or old application handle for cleanup.

    phase = 'restart-and-verify-full-draft';
    page = await launch(userData, project);
    assert.equal(
      await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).inputValue(),
      draftText,
    );
    await page
      .locator('.attachment-list .attachment-name')
      .filter({ hasText: 'owned-draft-context.txt' })
      .waitFor();
    const recovered = await page.evaluate(
      ({ storageKey, draftText }) =>
        Object.values(JSON.parse(localStorage.getItem(storageKey)).drafts).find(
          (draft) => draft.text === draftText,
        ),
      { storageKey, draftText },
    );
    assert.deepEqual(recovered, before.draft);
    const events = (await fs.readFile(path.join(directory, 'mock-events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(
      events.filter((event) => event.type === 'prompt' || event.method === 'session/prompt').length,
      0,
    );
    console.log(
      JSON.stringify(
        {
          passed: true,
          scenario: 'Windows taskkill /T /F of the owned live desktop tree',
          packaged: !!process.env.GROK_DESKTOP_TEST_EXE,
          observedLocalStorageWrite: true,
          originalFlushStorageDataCalled: true,
          fixedGraceMs: 500,
          flushToKillMs: killedAt - flush.returnedAt,
          draftCharacters: recovered.text.length,
          attachmentMetadata: recovered.attachments,
          sentPrompts: 0,
          clipboardOperations: 0,
          ownership: {
            launcherPid: owned.pid,
            electronPid: identity.pid,
            electronParentPid: identity.parentPid,
          },
          exit,
          boundary:
            'Verifies already-written data after an observed real flush plus 500ms grace. Does not guarantee unwritten keystrokes, power-loss durability, or every single-main-process crash mode.',
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(`FAIL ${phase}: ${error.stack || error}`);
    process.exitCode = 1;
  } finally {
    if (app) {
      const owned = app.process();
      if (owned.exitCode === null && owned.signalCode === null) await app.close().catch(() => {});
    }
    if (directory) console.log(`Artifacts: ${directory}`);
  }
})();
