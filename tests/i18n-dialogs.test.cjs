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
        import React, {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {SettingsDialog,PermissionDialog,ActionsDialog,ManagementDialog,UsageDialog} from './src/Dialogs';
        import {setLocale} from './src/i18n';
        const root=createRoot(document.getElementById('root'));
        window.setLocale=setLocale;
        function SettingsHarness() {
          const [settings,setSettings]=useState(window.initialSettings);
          return <SettingsDialog settings={settings} models={{availableModels:[]}} bootstrap={null} busy={false}
            onClose={()=>window.closes++} onSave={async patch=>{
              window.saves.push(patch);
              if(window.rejectSave) throw Error('save failed');
              setSettings(value=>({...value,...patch}));
              if(patch.language) setLocale(patch.language);
            }}/>;
        }
        window.showSettings=()=>root.render(<SettingsHarness/>);
        window.showPermissions=item=>root.render(<PermissionDialog item={item} onReply={async (...reply)=>window.replies.push(reply)}/>);
        window.showActions=commands=>root.render(<ActionsDialog commands={commands} onClose={()=>window.closes++}
          onApply={text=>window.applied.push(text)} onContext={()=>{}} onPermissions={()=>{}} connected/>);
        window.showManagement=()=>root.render(<ManagementDialog cwd="C:/fixture" sessionId="opaque-session" onClose={()=>window.closes++} notify={text=>window.notices.push(text)}/>);
        window.showUsage=()=>root.render(<UsageDialog cwd="C:/fixture" sessionId="opaque-session" onClose={()=>window.closes++}/>);
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
  page.setDefaultTimeout(5000);
  t.after(() => page.close());
  await page.setContent('<div id="root"></div>');
  await page.evaluate(() => {
    window.saves = [];
    window.replies = [];
    window.calls = [];
    window.notices = [];
    window.applied = [];
    window.closes = 0;
    window.initialSettings = {
      language: 'zh-CN',
      theme: 'dark',
      grokPath: 'C:/grok.exe',
      modelId: '',
      effort: '',
      permissionMode: 'ask',
      notifications: true,
    };
    window.desktop = {
      request: async (command, payload) => {
        window.calls.push({ command, payload });
        if (command === 'account.usage')
          return {
            ok: true,
            data: {
              fetchedAt: '2026-09-05T04:00:00Z',
              plan: 'free',
              period: { type: 'WEEKLY', end: '2026-09-10T04:00:00Z' },
              usedPercent: 25,
              remainingPercent: 75,
              prepaidBalanceUsd: null,
              onDemandUsedUsd: null,
              onDemandCapUsd: null,
              onDemandEnabled: null,
              unified: true,
            },
          };
        if (command === 'session.usage')
          return { ok: true, data: { context: { used: 12000, total: 100000 } } };
        return { ok: true, data: { data: [], text: '服务器原始输出', exitCode: 0 } };
      },
    };
  });
  await page.addScriptTag({ content: bundle });
  return page;
}

test('language selection applies immediately without closing settings or saving other pending edits', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.showSettings());
  await page.getByPlaceholder('grok.exe 的完整路径').fill('D:/edited/grok.exe');
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.saves), [{ language: 'en' }]);
  assert.equal(
    await page.getByPlaceholder('Full path to grok.exe').inputValue(),
    'D:/edited/grok.exe',
  );
  assert.equal(
    await page.getByRole('button', { name: 'Light', exact: true }).getAttribute('class'),
    'selected',
  );
  assert.equal(await page.evaluate(() => window.closes), 0);
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.saves[1]), {
    grokPath: 'D:/edited/grok.exe',
    theme: 'light',
    modelId: '',
    effort: '',
    permissionMode: 'ask',
    notifications: true,
    language: 'en',
  });
  assert.equal(await page.evaluate(() => window.closes), 1);
});

test('failed language save restores the selector and keeps the pending settings draft', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.rejectSave = true;
    window.showSettings();
  });
  await page.getByPlaceholder('grok.exe 的完整路径').fill('D:/keep-me/grok.exe');
  await page.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await page.locator('.inline-error').waitFor();
  assert.equal(
    await page.getByRole('combobox', { name: '界面语言', exact: true }).inputValue(),
    'zh-CN',
  );
  assert.equal(
    await page.getByPlaceholder('grok.exe 的完整路径').inputValue(),
    'D:/keep-me/grok.exe',
  );
  assert.equal(await page.evaluate(() => window.closes), 0);
});

test('approval labels switch both ways while original tool text and option IDs remain unchanged', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() =>
    window.showPermissions({
      requestId: 'opaque-request',
      params: {
        toolCall: { title: 'powershell.exe', rawInput: { command: 'Write-Output "原始命令"' } },
        options: [
          {
            optionId: 'opaque-allow',
            kind: 'allow_always',
            name: "Yes, and don't ask again for this command",
          },
        ],
      },
    }),
  );
  await page.getByRole('button', { name: '允许此命令且不再询问', exact: true }).waitFor();
  await page.evaluate(() => window.setLocale('en'));
  await page.getByRole('heading', { name: 'Grok needs your approval', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Always allow this command', exact: true }).waitFor();
  assert.equal(
    await page.locator('.permission-command-preview').textContent(),
    'Write-Output "原始命令"',
  );
  assert.equal(
    await page.locator('.permission-source-options dd').textContent(),
    "Yes, and don't ask again for this command",
  );
  await page.evaluate(() => window.setLocale('zh-CN'));
  await page.getByRole('button', { name: '允许此命令且不再询问', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.replies), [['opaque-allow', false]]);

  const originalPage = await fixture(t);
  await originalPage.evaluate(() => {
    window.setLocale('en');
    window.showPermissions({
      requestId: 'opaque-original-request',
      params: {
        toolCall: { title: '设置', rawInput: { target: '取消' } },
        options: [{ optionId: 'opaque-original-option', kind: 'custom', name: '取消' }],
      },
    });
  });
  await originalPage
    .getByRole('heading', { name: 'Grok needs your approval', exact: true })
    .waitFor();
  assert.equal(await originalPage.locator('.permission-review-header h3').textContent(), '设置');
  await originalPage.getByRole('button', { name: '取消', exact: true }).waitFor();
  assert.equal(await originalPage.locator('.permission-source-options dd').textContent(), '取消');
  assert.match(
    await originalPage.locator('.permission-detail-section pre').first().textContent(),
    /取消/,
  );
  await originalPage.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(await originalPage.evaluate(() => window.replies), [
    ['opaque-original-option', false],
  ]);
});

test('English action labels and fields keep the official slash command and user objective unchanged', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.setLocale('en');
    window.showActions([
      { name: 'goal', description: '官方原始说明', input: { hint: '原始输入提示' } },
    ]);
  });
  await page
    .getByPlaceholder('Search skills, workflows, goals, or other actions…')
    .fill('Set goal');
  await page.locator('.command-card').click();
  await page.getByPlaceholder('Describe what completing this task means').fill('保留用户原文');
  await page.getByRole('button', { name: 'Add to message', exact: true }).click();
  assert.equal(await page.evaluate(() => window.applied[0]), '/goal 保留用户原文');
});

test('English management fields keep machine transport and scope values unchanged', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.setLocale('en');
    window.showManagement();
  });
  await page.getByRole('button', { name: 'MCP servers', exact: true }).click();
  await page.getByRole('button', { name: /Add MCP server/ }).click();
  await page.getByPlaceholder('For example, github').fill('fixture-server');
  await page.getByLabel('Transport').selectOption('http');
  await page.getByLabel('Scope').selectOption('project');
  await page.getByPlaceholder('https://…').fill('https://example.test/mcp');
  await page.getByRole('button', { name: 'Confirm: Add MCP server', exact: true }).click();
  await page.waitForFunction(() =>
    window.calls.some(({ payload }) => payload?.action === 'mcp-add'),
  );
  const call = await page.evaluate(() =>
    window.calls.find(({ payload }) => payload?.action === 'mcp-add'),
  );
  assert.equal(call.payload.values.transport, 'http');
  assert.equal(call.payload.values.scope, 'project');
  assert.equal(call.payload.values.name, 'fixture-server');
  assert.equal(call.payload.values.sessionId, 'opaque-session');
});

test('usage panel updates labels and interpolated allowance text when its language changes', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => window.showUsage());
  await page.locator('.account-plan-row strong').waitFor();
  await page.evaluate(() => window.setLocale('en'));
  await page.getByRole('heading', { name: 'Usage and context', exact: true }).waitFor();
  assert.equal(await page.locator('.account-plan-row strong').textContent(), 'Free plan');
  assert.equal(await page.locator('.plan-period').textContent(), 'Weekly allowance');
  assert.equal(await page.locator('.quota-heading small').textContent(), '75% remaining');
  assert.equal(
    await page
      .getByRole('progressbar', { name: 'Context used', exact: true })
      .getAttribute('aria-valuenow'),
    '12',
  );
});
