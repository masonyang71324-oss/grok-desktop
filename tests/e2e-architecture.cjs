'use strict';
// Actual Electron / preload / main / ACP transport with an owned local fixture.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
let app,
  page,
  directory,
  phase = 'setup';
const pageErrors = [];
const completedPhases = [];
const evidence = { passed: false, packaged: !!process.env.GROK_DESKTOP_TEST_EXE, completedPhases };
function beginPhase(next) {
  if (phase !== 'setup') completedPhases.push(phase);
  phase = next;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function logs() {
  return (await fs.readFile(path.join(directory, 'events.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}
async function request(command, payload) {
  const result = await page.evaluate(
    ({ command, payload }) => window.desktop.request(command, payload),
    { command, payload },
  );
  assert.equal(result.ok, true, `${command}: ${result.error || ''}`);
  return result.data;
}
async function send(text) {
  await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).fill(text);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
}
async function waitFor(predicate) {
  const deadline = Date.now() + 10000;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, `Timed out in ${phase}`);
    await delay(50);
  }
}
async function killOwnedSession(sessionId) {
  const entries = await logs();
  const owner = entries.findLast(
    (item) =>
      item.sessionId === sessionId && (item.type === 'prompt' || item.method === 'session/load'),
  );
  assert.ok(owner?.pid, 'A fixture log must identify the session child before termination');
  await app.evaluate(
    (_, { pid, script }) => {
      const child = process
        ._getActiveHandles()
        .find(
          (handle) =>
            handle.pid === pid &&
            handle.spawnargs?.includes(script) &&
            handle.exitCode === null &&
            handle.signalCode === null,
        );
      if (!child) throw Error('The original owned fixture ChildProcess is no longer alive');
      child.kill('SIGKILL');
    },
    { pid: owner.pid, script: path.join(root, 'scripts/mock-grok.cjs') },
  );
}
(async () => {
  try {
    directory = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'grok-architecture-e2e-')),
    );
    const userData = path.join(directory, 'userdata');
    const project = path.join(directory, 'project');
    const failLoad = path.join(directory, 'fail-load');
    await fs.mkdir(userData);
    await fs.mkdir(project);
    await fs.writeFile(path.join(project, 'fixture.txt'), 'fixture\n');
    await fs.writeFile(
      path.join(userData, 'settings.json'),
      JSON.stringify({
        grokPath: process.execPath,
        lastProject: project,
        recentProjects: [project],
        projectTrust: { [project]: true },
        permissionMode: 'read',
        autoReconnect: true,
        language: 'zh-CN',
        notifications: false,
      }),
    );
    const env = {
      ...process.env,
      GROK_DESKTOP_DATA_DIR: userData,
      GROK_DESKTOP_TEST_GROK_SCRIPT: path.join(root, 'scripts/mock-grok.cjs'),
      GROK_DESKTOP_MOCK_STATE: path.join(directory, 'state.json'),
      GROK_DESKTOP_MOCK_LOG: path.join(directory, 'events.jsonl'),
      GROK_DESKTOP_MOCK_FAIL_LOAD_FILE: failLoad,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.GROK_DESKTOP_DEV_URL;
    const packaged = process.env.GROK_DESKTOP_TEST_EXE;
    app = await electron.launch({
      executablePath: packaged || require('electron'),
      args: packaged ? [] : [root],
      env,
      timeout: 30000,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
    await page.locator('.new-conversation:not(:disabled)').waitFor();

    beginPhase('read-auto-approval');
    await send('MOCK_READ_POLICY');
    await page.locator('.message.assistant').filter({ hasText: '模拟操作已获准。' }).waitFor();
    await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
    assert.equal((await logs()).filter((entry) => entry.type === 'permission-response').length, 1);
    assert.equal(
      await page.getByRole('dialog', { name: 'Grok 需要你的批准', exact: true }).count(),
      0,
    );
    assert.match(await page.locator('.permission-trigger').innerText(), /自动允许读取/);

    beginPhase('shell-still-asks');
    await send('MOCK_READ_POLICY_SHELL');
    const approval = page.getByRole('dialog', { name: 'Grok 需要你的批准', exact: true });
    await approval.waitFor();
    assert.equal((await logs()).filter((entry) => entry.type === 'permission-response').length, 1);
    await approval.getByRole('button', { name: '允许本次', exact: true }).click();
    await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();

    beginPhase('interrupted-turn-restores-once');
    await send('MOCK_CANCEL');
    await page.locator('.message.assistant').filter({ hasText: '正在等待停止。' }).waitFor();
    const sessionA = (await request('tasks.list')).find((task) => task.turnId).sessionId;
    await page
      .getByRole('textbox', { name: '发送给 Grok 的消息', exact: true })
      .fill('QUEUED_MUST_NOT_RESEND');
    await page.getByRole('button', { name: '加入队列', exact: true }).click();
    await page
      .getByRole('textbox', { name: '发送给 Grok 的消息', exact: true })
      .fill('UNSENT_DRAFT_SURVIVES');
    const beforeCrash = await logs();
    const promptsBefore = beforeCrash.filter((item) => item.type === 'prompt').length;
    const loadsBefore = beforeCrash.filter(
      (item) => item.method === 'session/load' && item.sessionId === sessionA,
    ).length;
    await killOwnedSession(sessionA);
    await waitFor(
      async () =>
        (await logs()).filter(
          (item) => item.method === 'session/load' && item.sessionId === sessionA,
        ).length ===
        loadsBefore + 1,
    );
    await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
    await waitFor(async () => {
      const task = (await request('tasks.list')).find((item) => item.sessionId === sessionA);
      return task?.status === 'interrupted' && !task.finishing;
    });
    await delay(400);
    const recovered = await logs();
    assert.equal(
      recovered.filter((item) => item.type === 'prompt').length,
      promptsBefore,
      'No prompt or queue item is automatically replayed',
    );
    assert.equal(
      recovered.filter((item) => item.method === 'session/load' && item.sessionId === sessionA)
        .length,
      loadsBefore + 1,
    );
    assert.equal(
      await page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true }).inputValue(),
      'UNSENT_DRAFT_SURVIVES',
    );
    assert.match(await page.locator('.permission-trigger').innerText(), /自动允许读取/);
    const paused = (await request('tasks.list')).find((item) => item.sessionId === sessionA);
    assert.equal(paused.queued.length, 2);
    assert.ok(paused.queued.some((item) => item.interrupted));
    assert.equal(await page.getByRole('button', { name: '停止生成', exact: true }).count(), 0);

    beginPhase('failed-recovery-does-not-loop');
    await page.locator('.new-conversation').click();
    await send('MOCK_CANCEL_B');
    await page.locator('.message.assistant').filter({ hasText: '正在等待停止。' }).waitFor();
    const sessionB = (await request('tasks.list')).find((task) => task.turnId).sessionId;
    await fs.writeFile(failLoad, 'fail synthetic session load');
    await killOwnedSession(sessionB);
    await page.locator('.connection-banner').filter({ hasText: '无法恢复当前会话' }).waitFor();
    await delay(500);
    assert.equal(
      (await logs()).filter((item) => item.method === 'session/load' && item.sessionId === sessionB)
        .length,
      1,
    );
    assert.equal(
      (await logs()).filter((item) => item.type === 'prompt' && item.sessionId === sessionB).length,
      1,
    );

    beginPhase('manual-recovery');
    await fs.unlink(failLoad);
    await page
      .locator('.connection-banner')
      .getByRole('button', { name: '重新连接', exact: true })
      .click();
    await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
    assert.match(await page.locator('.permission-trigger').innerText(), /自动允许读取/);
    assert.equal(
      (await logs()).filter((item) => item.type === 'prompt' && item.sessionId === sessionB).length,
      1,
    );
    assert.equal(
      (await request('tasks.list')).find((task) => task.sessionId === sessionA).queued.length,
      2,
    );

    beginPhase('disabled-auto-recovery-retains-manual-action');
    await request('settings.save', { autoReconnect: false });
    await page.reload();
    await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
    await page.locator('.new-conversation:not(:disabled)').waitFor();
    const disabledLoads = (await logs()).filter(
      (item) => item.method === 'session/load' && item.sessionId === sessionB,
    ).length;
    await killOwnedSession(sessionB);
    await page.locator('.connection-banner').waitFor();
    await delay(500);
    assert.equal(
      (await logs()).filter((item) => item.method === 'session/load' && item.sessionId === sessionB)
        .length,
      disabledLoads,
    );
    await page
      .locator('.connection-banner')
      .getByRole('button', { name: '重新连接', exact: true })
      .click();
    await page.locator('.sidebar-status').filter({ hasText: 'Grok 已连接' }).waitFor();
    assert.equal(
      (await logs()).filter((item) => item.method === 'session/load' && item.sessionId === sessionB)
        .length,
      disabledLoads + 1,
    );
    beginPhase('waiting-cancel-resume-retains-stop');
    await page.locator('.new-conversation').click();
    await send('MOCK_WORKFLOW');
    await page.locator('.task-activity').filter({ hasText: '后台运行中' }).waitFor();
    const workflowTask = (await request('tasks.list')).find((task) => task.status === 'background');
    await page.locator('.new-conversation').click();
    await send('MOCK_CANCEL_QUEUED');
    const waitingTask = (await request('tasks.list')).find((task) => task.status === 'waiting');
    assert.ok(waitingTask);
    await page.getByRole('button', { name: '停止生成', exact: true }).click();
    await waitFor(
      async () =>
        (await request('tasks.list')).find((task) => task.sessionId === waitingTask.sessionId)
          .status === 'paused',
    );
    await request('tasks.resume', { sessionId: waitingTask.sessionId });
    await waitFor(
      async () => await page.getByRole('button', { name: '停止生成', exact: true }).isEnabled(),
    );

    beginPhase('background-workflow-control-is-sendable-and-stoppable');
    const summaries = await request('sessions.list', { cwd: project });
    const workflowTitle = summaries.find((item) => item.sessionId === workflowTask.sessionId).title;
    await page.locator('.session-select').filter({ hasText: workflowTitle }).click();
    await send('/workflow pause example');
    await page.locator('.message.assistant').filter({ hasText: '控制请求等待停止。' }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: '停止生成', exact: true }).isEnabled(),
      true,
    );
    await page.getByRole('button', { name: '停止生成', exact: true }).click();
    await waitFor(
      async () =>
        (await request('tasks.list')).find((task) => task.sessionId === workflowTask.sessionId)
          .status === 'background',
    );
    await send('/workflow stop example');
    await page.locator('.message.assistant').filter({ hasText: '模拟工作流已停止。' }).waitFor();
    await waitFor(
      async () =>
        (await request('tasks.list')).find((task) => task.sessionId === waitingTask.sessionId)
          .status === 'running',
    );
    await waitFor(async () =>
      (await logs()).some(
        (item) => item.type === 'prompt' && item.sessionId === waitingTask.sessionId,
      ),
    );
    await page.getByRole('button', { name: '任务中心', exact: true }).click();
    const center = page.getByRole('dialog', { name: '任务中心', exact: true });
    const runningCard = center.locator('.workflow-card').filter({
      has: page.getByRole('button', { name: '停止任务', exact: true }),
    });
    assert.equal(await runningCard.count(), 1);
    await runningCard.getByRole('button').first().click();
    await page.locator('.message.user').filter({ hasText: 'MOCK_CANCEL_QUEUED' }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: '停止生成', exact: true }).isEnabled(),
      true,
    );
    await page.getByRole('button', { name: '停止生成', exact: true }).click();
    assert.deepEqual(pageErrors, []);
    completedPhases.push(phase);
    evidence.passed = true;
    evidence.replayedPrompts =
      recovered.filter((item) => item.type === 'prompt').length - promptsBefore;
    evidence.automaticSessionLoads =
      recovered.filter((item) => item.method === 'session/load' && item.sessionId === sessionA)
        .length - loadsBefore;
    evidence.interruptedQueueLength = paused.queued.length;
    evidence.pageErrors = pageErrors;
    console.log(
      'PASS read approval, shell prompt, authoritative task state, one-attempt recovery, drafts and paused queues',
    );
  } catch (error) {
    evidence.failedPhase = phase;
    evidence.error = error.message;
    console.error(`FAIL ${phase}: ${error.stack || error}`);
    process.exitCode = 1;
  } finally {
    if (app) {
      await app
        .evaluate(({ app, dialog }) => {
          dialog.showMessageBox = async () => ({ response: 1 });
          app.quit();
        })
        .catch(() => {});
      await app.close().catch(() => {});
    }
    if (directory) console.log(`Artifacts: ${directory}`);
    const evidenceDirectory = path.join(
      root,
      'test-results',
      evidence.packaged ? 'architecture-packaged' : 'architecture',
    );
    await fs.mkdir(evidenceDirectory, { recursive: true });
    const evidencePath = path.join(evidenceDirectory, 'runtime-read-recovery.json');
    await fs.writeFile(evidencePath, JSON.stringify(evidence, null, 2));
    console.log(`Evidence: ${evidencePath}`);
  }
})();
