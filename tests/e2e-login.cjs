'use strict';
// Own temporary data and a local CLI fixture only; never opens real OAuth or reads credentials.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
let app, page, directory;
async function waitForRecord() {
  const filename = path.join(directory, 'login-record.json');
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return JSON.parse(await fs.readFile(filename, 'utf8'));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('Mock login process did not start');
}
async function prepare(mode) {
  await fs.writeFile(path.join(directory, 'login-mode'), mode);
  await fs.rm(path.join(directory, 'login-record.json'), { force: true });
  await fs.rm(path.join(directory, 'finish-login'), { force: true });
}
(async () => {
  try {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'grok-login-e2e-')));
    for (const name of ['data', 'grok-home', 'project']) await fs.mkdir(path.join(directory, name));
    const fixture = path.join(directory, 'mock-login.cjs');
    await fs.writeFile(
      fixture,
      `const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const file = name => path.join(__dirname, name);
if (args.includes('login')) {
  fs.writeFileSync(file('login-record.json'), JSON.stringify({args,pid:process.pid,cwd:process.cwd()}));
  process.stdout.write('mock-private-oauth-output');
  const mode = fs.readFileSync(file('login-mode'), 'utf8');
  if (mode === 'fail') process.exit(1);
  if (mode === 'unconfirmed') process.exit(0);
  setInterval(() => {
    if (fs.existsSync(file('finish-login'))) {
      fs.writeFileSync(file('mock-signed-in'), 'yes');
      process.exit(0);
    }
  }, 25);
} else if (args[0] === 'models') {
  console.log(fs.existsSync(file('mock-signed-in')) ? 'You are logged in with grok.com.' : 'Not logged in.');
} else require(${JSON.stringify(path.join(root, 'scripts/mock-grok.cjs'))});
`,
    );
    await fs.writeFile(
      path.join(directory, 'data/settings.json'),
      JSON.stringify({
        grokPath: process.execPath,
        language: 'zh-CN',
        lastProject: path.join(directory, 'project'),
        recentProjects: [path.join(directory, 'project')],
      }),
    );
    const env = {
      ...process.env,
      GROK_HOME: path.join(directory, 'grok-home'),
      GROK_DESKTOP_DATA_DIR: path.join(directory, 'data'),
      GROK_DESKTOP_TEST_GROK_SCRIPT: fixture,
      GROK_DESKTOP_MOCK_STATE: path.join(directory, 'sessions.json'),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.GROK_DESKTOP_DEV_URL;
    const packaged = process.env.GROK_DESKTOP_TEST_EXE;
    app = await _electron.launch({
      executablePath: packaged || require('electron'),
      args: packaged ? [] : [root],
      env,
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.home-engine-status').filter({ hasText: '需要登录' }).waitFor();
    const draft = page.getByRole('textbox', { name: '发送给 Grok 的消息', exact: true });
    await draft.fill('Draft survives the official login flow');
    await page.getByRole('button', { name: 'Grok Build 引擎详情', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Grok Build 引擎', exact: true });
    const login = dialog.getByRole('button', { name: '登录 Grok Build', exact: true });

    await prepare('wait');
    await login.click();
    const record = await waitForRecord();
    assert.deepEqual(record.args, ['--no-auto-update', 'login', '--oauth']);
    assert.equal(record.cwd.toLowerCase(), os.homedir().toLowerCase());
    assert.equal(await login.isEnabled(), false);
    await dialog.getByRole('button', { name: '取消登录', exact: true }).waitFor();
    assert.equal(await dialog.getByText('已登录', { exact: true }).count(), 0);
    assert.equal(
      (await page.locator('body').textContent()).includes('mock-private-oauth-output'),
      false,
    );
    await fs.writeFile(path.join(directory, 'finish-login'), 'complete');
    await dialog.getByText('已登录', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.engine-actions button:disabled'));
    assert.equal(await draft.inputValue(), 'Draft survives the official login flow');
    console.log('PASS official-oauth-arguments-and-confirmed-login-refresh-preserves-draft');

    await prepare('wait');
    await login.click();
    const cancelled = await waitForRecord();
    await dialog.getByRole('button', { name: '取消登录', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.engine-actions button:disabled'));
    assert.equal(await dialog.locator('[role="alert"]').count(), 0);
    assert.throws(() => process.kill(cancelled.pid, 0), /ESRCH/);
    console.log('PASS cancel-login-reaps-only-the-owned-pending-process');

    await prepare('fail');
    await login.click();
    await dialog.locator('[role="alert"]').waitFor();
    assert.equal((await dialog.textContent()).includes('mock-private-oauth-output'), false);
    assert.equal(await draft.inputValue(), 'Draft survives the official login flow');
    console.log('PASS login-failure-is-visible-without-private-cli-output');

    await prepare('unconfirmed');
    await fs.rm(path.join(directory, 'mock-signed-in'));
    await login.click();
    await dialog.getByRole('alert').filter({ hasText: '尚未确认登录成功' }).waitFor();
    console.log('PASS-zero-exit-is-not-treated-as-authentication-without-status-verification');

    await prepare('wait');
    await login.click();
    const closing = await waitForRecord();
    await app.close();
    app = null;
    assert.throws(() => process.kill(closing.pid, 0), /ESRCH/);
    assert.deepEqual(errors, []);
    console.log('PASS closing-desktop-cancels-the-owned-login');
    console.log(`Artifacts: ${directory}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
})();
