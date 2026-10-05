const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser, bundle, css;
before(async () => {
  const result = await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import SessionList from './src/SessionList';import EngineDialog from './src/EngineDialog';import {useEngine} from './src/useEngine';window.ui={React,createRoot,flushSync,SessionList,EngineDialog,useEngine};`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    outdir: 'test-results/maintenance-bundle',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  bundle = result.outputFiles.find((x) => x.path.endsWith('.js')).text;
  css =
    (await fs.readFile(path.join(__dirname, '../src/styles.css'), 'utf8')) +
    (result.outputFiles.find((x) => x.path.endsWith('.css'))?.text || '');
  browser = await launchBrowser();
});
after(async () => browser?.close());
async function fixture(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  page.setDefaultTimeout(5000);
  await page.setContent(
    '<div id="root" style="display:flex;flex-direction:column;width:300px;height:420px"></div>',
  );
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  return page;
}
test('session list virtualizes manual scrolling and keeps selected item and menu actions correct', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const { React, createRoot, flushSync, SessionList } = window.ui;
    const root = createRoot(document.getElementById('root'));
    window.actions = [];
    const sessions = Array.from({ length: 1200 }, (_, i) => ({
      sessionId: `s${i}`,
      cwd: 'C:/project',
      title: `Session ${String(i).padStart(4, '0')}`,
    }));
    window.renderList = (project = 'one') =>
      flushSync(() =>
        root.render(
          React.createElement(SessionList, {
            key: project,
            sessions,
            activeSessionId: 's500',
            loadingSessionId: '',
            onSelect: (s) => window.actions.push(['select', s.sessionId]),
            onRename: (s) => window.actions.push(['rename', s.sessionId]),
            onExport: (s) => window.actions.push(['export', s.sessionId]),
            onDelete: (s) => window.actions.push(['delete', s.sessionId]),
          }),
        ),
      );
    window.renderList();
  });
  await page.locator('.session-item.selected').waitFor();
  assert.equal(
    await page
      .locator('.session-item.selected')
      .getByRole('button', { name: 'Session 0500', exact: true })
      .getAttribute('aria-current'),
    'true',
  );
  assert.ok((await page.locator('.session-item').count()) < 90);
  await page.locator('.session-list').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.getByRole('button', { name: 'Session 1199', exact: true }).waitFor();
  await page.getByRole('textbox', { name: '搜索会话', exact: true }).fill('Session 0500');
  const openMenu = async () => {
    await page.locator('.session-item.selected').hover();
    await page.getByRole('button', { name: 'Session 0500 · 更多操作', exact: true }).click();
  };
  await openMenu();
  await page.getByRole('button', { name: '导出会话', exact: true }).click();
  await openMenu();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.session-dropdown').count(), 0);
  await openMenu();
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await openMenu();
  await page.getByRole('button', { name: '删除会话', exact: true }).click();
  await page.getByRole('button', { name: 'Session 0500', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.actions), [
    ['export', 's500'],
    ['rename', 's500'],
    ['delete', 's500'],
    ['select', 's500'],
  ]);
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await page.locator('.session-list').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.getByRole('button', { name: 'Session 1199', exact: true }).waitFor();
  const nextId = await page.evaluate(() => {
    // The last mounted row can be the actual last session (1199), which has no
    // next item. Use the pinned active row and an asserted unmounted successor.
    const node = document.querySelector('[data-window-row="s500"]');
    if (document.querySelector('[data-window-row="s501"]'))
      throw new Error('The Tab fixture must cross an unmounted window boundary');
    node.querySelector('.session-select').focus({ preventScroll: true });
    node.querySelector('.icon-button').focus({ preventScroll: true });
    return 'Session 0501';
  });
  await page.keyboard.press('Tab');
  await page.waitForFunction(
    (expected) => document.activeElement?.textContent?.includes(expected),
    nextId,
  );
  await page.getByRole('button', { name: 'Session 0500', exact: true }).focus();
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.activeElement?.textContent?.includes('Session 1199'));
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => !!document.activeElement?.closest('.session-item')),
    false,
  );
  await page.evaluate(() => window.renderList('another-project'));
  assert.equal(await page.locator('.session-dropdown').count(), 0);
});
test('extracted engine hook and dialog preserve login/check/refresh actions and busy-update guard', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const { React, createRoot, flushSync, EngineDialog, useEngine } = window.ui;
    window.calls = [];
    window.refreshed = 0;
    window.desktop = {
      request: async (command, payload) => {
        window.calls.push({ command, payload });
        if (command === 'cli.status')
          return {
            ok: true,
            data: {
              version: '1.0.1',
              authStatus: 'authenticated',
              latestVersion: '1.0.2',
              updateAvailable: true,
            },
          };
        if (command === 'cli.refresh')
          return { ok: true, data: { cli: { version: '1.0.1' }, models: {}, commands: [] } };
        return { ok: true, data: {} };
      },
    };
    function Harness() {
      const engine = useEngine({
        getCwd: () => 'C:/project',
        isUpdateBlocked: () => true,
        hasSession: () => false,
        onRefresh: () => window.refreshed++,
        onUpdated: async () => {},
        notify: () => {},
      });
      return React.createElement(EngineDialog, {
        status: engine.cliStatus,
        authLabel: engine.engineAuthLabel,
        action: engine.engineAction,
        error: engine.engineError,
        busy: true,
        updateBlocked: true,
        onAction: engine.runEngineAction,
        onClose: () => {},
        onOnboarding: () => window.calls.push({ action: 'onboarding' }),
        onProviders: () => window.calls.push({ action: 'providers' }),
      });
    }
    flushSync(() =>
      createRoot(document.getElementById('root')).render(React.createElement(Harness)),
    );
  });
  const dialog = page.getByRole('dialog', { name: 'Grok Build 引擎' });
  assert.equal(
    await dialog.getByRole('button', { name: '更新 Grok Build', exact: true }).isDisabled(),
    true,
  );
  await dialog.getByRole('button', { name: '登录 Grok Build', exact: true }).click();
  await dialog.getByRole('button', { name: '检查引擎更新', exact: true }).click();
  await dialog.getByText('可更新至 1.0.2', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: '刷新引擎与模型', exact: true }).click();
  await page.waitForFunction(() => window.refreshed === 1);
  assert.deepEqual(
    await page.evaluate(() => window.calls.find((call) => call.command === 'system.open').payload),
    { target: 'grok-login', cwd: 'C:/project' },
  );
  assert.equal(
    await page.evaluate(() =>
      window.calls.some((call) => call.command === 'cli.status' && call.payload?.checkUpdate),
    ),
    true,
  );
});
