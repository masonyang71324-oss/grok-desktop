const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser;
before(async () => {
  browser = await launchBrowser();
});
after(async () => browser?.close());
async function mount(t, component, props, setup) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.evaluate(setup);
  const output = buildSync({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import Component from './src/${component}'; import {setLocale} from './src/i18n'; setLocale(window.testLanguage); createRoot(document.getElementById('root')).render(<Component {...(${props})}/>);`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    outfile: 'runtime.js',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  await page.addScriptTag({
    content: output.outputFiles.find((file) => file.path.endsWith('.js')).text,
  });
  return page;
}
test('first-run existing executable skips install and only completes after verified sign-in and chosen project', async (t) => {
  const page = await mount(
    t,
    'FirstRunWizard',
    `{request:window.call,onComplete:cwd=>window.completed.push(cwd),onClose:()=>{}}`,
    () => {
      window.calls = [];
      window.completed = [];
      window.call = async (command) => {
        window.calls.push(command);
        if (command === 'cli.status')
          return { version: '1.0.46', path: 'C:/grok.exe', authStatus: 'authenticated' };
        if (command === 'cli.install.state') return { status: 'idle', log: '' };
        if (command === 'dialog.project') return 'C:/demo';
        throw new Error(command);
      };
    },
  );
  await page.getByRole('button', { name: '选择项目目录', exact: true }).click();
  await page.getByRole('button', { name: '开始使用', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.completed), ['C:/demo']);
  assert.equal(await page.evaluate(() => window.calls.includes('cli.install.start')), false);
});
test('provider form exposes environment variable name and saves only supported public fields', async (t) => {
  const page = await mount(t, 'ProviderSettings', `{request:window.call,onClose:()=>{}}`, () => {
    window.calls = [];
    window.call = async (command, payload) => {
      window.calls.push({ command, payload });
      return {
        baseline: 'opaque',
        models: [
          {
            id: 'demo',
            model: 'remote',
            base_url: 'https://example.com/v1',
            name: 'Demo',
            env_key: 'DEMO_KEY',
            api_backend: 'responses',
            enabled: true,
            hasKey: true,
          },
        ],
      };
    };
  });
  await page.getByRole('button', { name: '编辑 Demo', exact: true }).click();
  await page.getByLabel('环境变量名称', { exact: true }).fill('NEW_KEY');
  await page.getByLabel('上下文窗口（可选）', { exact: true }).fill('');
  await page.getByRole('button', { name: '保存模型', exact: true }).click();
  await page.waitForFunction(() => window.calls.some((call) => call.command === 'providers.save'));
  const saved = await page.evaluate(
    () => window.calls.find((call) => call.command === 'providers.save').payload,
  );
  assert.equal(saved.fields.env_key, 'NEW_KEY');
  assert.equal(saved.fields.context_window, null);
  assert.equal(saved.baseline, 'opaque');
  assert.equal(Object.hasOwn(saved.fields, 'api_key'), false);
  assert.equal(await page.locator('input[type="password"]').count(), 0);
});

test('wizard waits for initial detection before allowing installation so an old read cannot replace progress', async (t) => {
  const page = await mount(
    t,
    'FirstRunWizard',
    `{request:window.call,onComplete:()=>{},onClose:()=>{}}`,
    () => {
      window.call = async (command) => {
        if (command === 'cli.status')
          return new Promise((resolve) => {
            window.releaseDetection = () => resolve({ authStatus: 'unknown' });
          });
        return { status: 'idle', log: '' };
      };
    },
  );
  const install = page.getByRole('button', { name: '安装官方稳定版', exact: true });
  await install.waitFor();
  assert.equal(await install.isDisabled(), true);
  await page.evaluate(() => window.releaseDetection());
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent === '安装官方稳定版',
      ).disabled,
  );
});

test('wizard persists chosen CLI path before checking its actual version', async (t) => {
  const page = await mount(
    t,
    'FirstRunWizard',
    `{request:window.call,onComplete:()=>{},onClose:()=>{}}`,
    () => {
      window.calls = [];
      window.selectedPath = '';
      window.call = async (command, payload) => {
        window.calls.push({ command, payload });
        if (command === 'cli.status')
          return window.selectedPath ? { path: window.selectedPath, version: '1.0.46' } : {};
        if (command === 'cli.install.state') return { status: 'idle', log: '' };
        if (command === 'dialog.grok') return 'C:/chosen/grok.exe';
        if (command === 'settings.save') {
          window.selectedPath = payload.grokPath;
          return {};
        }
        throw new Error(command);
      };
    },
  );
  await page.getByRole('button', { name: '选择 Grok 程序', exact: true }).click();
  await page.getByText('已检测到 Grok 1.0.46', { exact: false }).waitFor({ timeout: 1500 });
  assert.equal(await page.evaluate(() => window.selectedPath), 'C:/chosen/grok.exe');
});

async function wizardLoginFixture(t) {
  const page = await mount(
    t,
    'FirstRunWizard',
    `{request:window.call,onComplete:cwd=>window.completed.push(cwd),onClose:()=>window.closeCount++}`,
    () => {
      window.calls = [];
      window.completed = [];
      window.closeCount = 0;
      window.cancelError = '';
      window.call = async (command) => {
        window.calls.push(command);
        if (command === 'cli.status')
          return { version: '1.0.46', path: 'C:/grok.exe', authStatus: 'required' };
        if (command === 'cli.install.state') return { status: 'idle', log: '' };
        if (command === 'cli.login')
          return new Promise((resolve, reject) => {
            window.finishLogin = resolve;
            window.failLogin = reject;
          });
        if (command === 'cli.login.cancel') {
          if (window.cancelError) throw new Error(window.cancelError);
          window.finishLogin({ cancelled: true });
          return { cancelled: true };
        }
        if (command === 'dialog.project') return 'C:/project';
        throw new Error(command);
      };
    },
  );
  return page;
}

test('wizard completes after official sign-in without an extra status-check click', async (t) => {
  const page = await wizardLoginFixture(t);
  await page.getByRole('button', { name: '选择项目目录', exact: true }).click();
  const login = page.getByRole('button', { name: '打开官方登录', exact: true });
  await login.click();
  await page.getByRole('status').filter({ hasText: '官方授权页面' }).waitFor({ timeout: 3000 });
  assert.equal(await login.isDisabled(), true);
  assert.equal(
    await page.getByRole('button', { name: '重新检查登录', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole('button', { name: '开始使用', exact: true }).isDisabled(),
    true,
  );
  await page.evaluate(() =>
    window.finishLogin({
      cancelled: false,
      status: { version: '1.0.46', path: 'C:/grok.exe', authStatus: 'authenticated' },
    }),
  );
  await page.getByText('已验证登录状态。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '开始使用', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.completed), ['C:/project']);
  assert.equal(await page.evaluate(() => window.calls.filter((c) => c === 'cli.status').length), 1);
});

test('wizard cancellation and failed verification retain the project and allow retry', async (t) => {
  const page = await wizardLoginFixture(t);
  await page.getByRole('button', { name: '选择项目目录', exact: true }).click();
  const login = page.getByRole('button', { name: '打开官方登录', exact: true });
  await login.click();
  await page.getByRole('button', { name: '取消登录', exact: true }).click({ timeout: 3000 });
  await page.getByRole('button', { name: '取消登录', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.getByText('C:/project', { exact: true }).isVisible(), true);
  await login.click();
  await page.evaluate(() =>
    window.finishLogin({ cancelled: false, status: { authStatus: 'unknown' } }),
  );
  await page.getByRole('alert').filter({ hasText: '未完成登录验证' }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: '开始使用', exact: true }).isDisabled(),
    true,
  );
});

test('closing a pending wizard cancels its sign-in and cancellation errors keep it open', async (t) => {
  const page = await wizardLoginFixture(t);
  await page.getByRole('button', { name: '打开官方登录', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '官方授权页面' }).waitFor({ timeout: 3000 });
  await page.evaluate(() => (window.cancelError = 'Process still running'));
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '无法取消登录' }).waitFor();
  assert.equal(await page.evaluate(() => window.closeCount), 0);
  await page.evaluate(() => (window.cancelError = ''));
  await page.getByRole('button', { name: '稍后设置', exact: true }).click();
  await page.waitForFunction(() => window.closeCount === 1);
  assert.equal(
    await page.evaluate(() => window.calls.filter((c) => c === 'cli.login.cancel').length),
    2,
  );
});
