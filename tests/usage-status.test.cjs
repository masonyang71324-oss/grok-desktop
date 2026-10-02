const { test } = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../src/usage-status.mjs');

function clock() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: time + delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    async advance(milliseconds) {
      const end = time + milliseconds;
      while (true) {
        const due = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
        await settle();
      }
      time = end;
      await settle();
    },
  };
}

async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function account(remainingPercent = 72) {
  return {
    fetchedAt: '2026-10-02T10:00:00Z',
    plan: 'supergrok',
    usedPercent: 28,
    remainingPercent,
    period: { type: 'MONTHLY', start: null, end: null },
  };
}

function session(used = 40) {
  return {
    info: { context: { used, total: 200, usagePct: 20, freeTokens: 160 } },
    usage: { inputTokens: 40, outputTokens: 0 },
  };
}

test('unknown quota remains unknown while an exact zero allowance is preserved', async () => {
  const { accountUsage } = await load();
  assert.deepEqual(accountUsage({ plan: 'free', usedPercent: 0, remainingPercent: null }), {
    plan: 'free',
    remainingPercent: null,
    fetchedAt: null,
  });
  assert.equal(accountUsage(account(0)).remainingPercent, 0);
  assert.equal(accountUsage({ remainingPercent: '0' }).remainingPercent, null);
});

test('context uses the current window counts, preserves zero, and falls back to the provided percent', async () => {
  const { contextUsage } = await load();
  assert.deepEqual(contextUsage(session(0)), { used: 0, total: 200, percent: 0 });
  assert.deepEqual(contextUsage({ context: { used: null, total: null, usagePct: 0 } }), {
    used: null,
    total: null,
    percent: 0,
  });
  assert.deepEqual(contextUsage({ usage: { inputTokens: 5000 } }), {
    used: null,
    total: null,
    percent: null,
  });
  assert.equal(
    contextUsage({ info: { context: { used: 20, total: 100, usagePct: 99 } } }).percent,
    20,
  );
});

test('initial context is available while the independent account read is still pending', async () => {
  const { createUsageStatusReader } = await load();
  const waiting = deferred();
  const reader = createUsageStatusReader(
    (command) => (command === 'account.usage' ? waiting.promise : Promise.resolve(session())),
    () => {},
  );
  reader.update({ cwd: 'C:/project', sessionId: 's1', connected: true });
  await settle();
  assert.equal(reader.getState().account.loading, true);
  assert.equal(reader.getState().context.data.used, 40);
  reader.dispose();
  waiting.resolve(account());
  await settle();
});

test('frequent revisions coalesce into one trailing read after the thirty second cache', async () => {
  const { createUsageStatusReader } = await load();
  const time = clock();
  const calls = [];
  const reader = createUsageStatusReader(
    async (command, payload) => {
      calls.push({ command, payload, at: time.now() });
      return command === 'account.usage' ? account() : session();
    },
    () => {},
    time,
  );
  reader.update({ cwd: 'C:/project', sessionId: 's1', revision: 0, connected: true });
  await settle();
  for (let revision = 1; revision <= 100; revision++)
    reader.update({ cwd: 'C:/project', sessionId: 's1', revision, connected: true });
  await time.advance(29999);
  assert.equal(calls.length, 2);
  await time.advance(1);
  assert.deepEqual(
    calls.map((call) => [call.command, call.at]),
    [
      ['account.usage', 0],
      ['session.usage', 0],
      ['account.usage', 30000],
      ['session.usage', 30000],
    ],
  );
  assert.deepEqual(calls[3].payload, { cwd: 'C:/project', sessionId: 's1' });
  await time.advance(60000);
  assert.equal(calls.length, 4);
  reader.dispose();
});

test('manual refresh bypasses the cache and retains prior values with an error after failure', async () => {
  const { createUsageStatusReader } = await load();
  const time = clock();
  let fail = false;
  const reader = createUsageStatusReader(
    async (command) => {
      if (fail) throw new Error('offline');
      return command === 'account.usage' ? account(0) : session(0);
    },
    () => {},
    time,
  );
  reader.update({ sessionId: 's1', connected: true });
  await settle();
  fail = true;
  reader.refresh(true);
  await settle();
  assert.equal(reader.getState().account.data.remainingPercent, 0);
  assert.equal(reader.getState().context.data.used, 0);
  assert.equal(reader.getState().account.error, 'offline');
  assert.equal(reader.getState().context.error, 'offline');
  assert.equal(reader.getState().account.updatedAt, 0);
  reader.dispose();
});

test('switching sessions clears the old window and ignores its delayed response', async () => {
  const { createUsageStatusReader } = await load();
  const oldSession = deferred();
  const newSession = deferred();
  const reader = createUsageStatusReader(
    (command, payload) =>
      command === 'account.usage'
        ? Promise.resolve(account())
        : payload.sessionId === 's1'
          ? oldSession.promise
          : newSession.promise,
    () => {},
    clock(),
  );
  reader.update({ cwd: 'C:/project', sessionId: 's1', connected: true });
  reader.update({ cwd: 'C:/project', sessionId: 's2', connected: true });
  assert.equal(reader.getState().context.data, null);
  newSession.resolve(session(0));
  await settle();
  oldSession.resolve(session(150));
  await settle();
  assert.equal(reader.getState().context.data.used, 0);
  assert.equal(reader.getState().scope.sessionId, 's2');
  reader.dispose();
});

test('a session switch keeps a pending global allowance read while rejecting old context', async () => {
  const { createUsageStatusReader } = await load();
  const billing = deferred();
  const oldSession = deferred();
  const newSession = deferred();
  const time = clock();
  const reader = createUsageStatusReader(
    (command, payload) =>
      command === 'account.usage'
        ? billing.promise
        : payload.sessionId === 's1'
          ? oldSession.promise
          : newSession.promise,
    () => {},
    time,
  );
  reader.update({ cwd: 'C:/project', sessionId: 's1', connected: true });
  await settle();
  reader.update({ cwd: 'C:/project', sessionId: 's2', connected: true });
  billing.resolve(account(75));
  newSession.resolve(session(20));
  await settle();
  assert.equal(reader.getState().account.data?.remainingPercent, 75);
  assert.equal(reader.getState().account.loading, false);
  assert.equal(time.now(), 0);
  oldSession.resolve(session(150));
  await settle();
  assert.equal(reader.getState().context.data.used, 20);
  assert.equal(reader.getState().scope.sessionId, 's2');
  reader.dispose();
});

test('reconnection still discards allowance and context responses from before disconnect', async () => {
  const { createUsageStatusReader } = await load();
  const oldBilling = deferred();
  const oldSession = deferred();
  const time = clock();
  let accountReads = 0;
  let contextReads = 0;
  const reader = createUsageStatusReader(
    (command) =>
      command === 'account.usage'
        ? ++accountReads === 1
          ? oldBilling.promise
          : Promise.resolve(account(50))
        : ++contextReads === 1
          ? oldSession.promise
          : Promise.resolve(session(80)),
    () => {},
    time,
  );
  const scope = { cwd: 'C:/project', sessionId: 's1', connected: true };
  reader.update(scope);
  await settle();
  reader.update({ ...scope, connected: false });
  reader.update(scope);
  oldBilling.resolve(account(75));
  oldSession.resolve(session(150));
  await settle();
  assert.equal(reader.getState().account.data, null);
  assert.equal(reader.getState().context.data.used, 80);
  await time.advance(30000);
  assert.equal(reader.getState().account.data.remainingPercent, 50);
  assert.equal(reader.getState().context.data.used, 80);
  reader.dispose();
});

test('disposed readers ignore delayed responses and stop their scheduled work', async () => {
  const { createUsageStatusReader } = await load();
  const waiting = deferred();
  const time = clock();
  let changes = 0;
  const reader = createUsageStatusReader(
    () => waiting.promise,
    () => {
      changes++;
    },
    time,
  );
  reader.update({ sessionId: 's1', connected: true, active: true });
  reader.dispose();
  const afterDispose = changes;
  waiting.resolve(session());
  await time.advance(90000);
  assert.equal(changes, afterDispose);
});

test('active updates run only while the selected session is visible and connected', async () => {
  const { createUsageStatusReader } = await load();
  const time = clock();
  const calls = [];
  const reader = createUsageStatusReader(
    async (command) => {
      calls.push(command);
      return command === 'account.usage' ? account() : session();
    },
    () => {},
    time,
  );
  const scope = { sessionId: 's1', connected: true, revision: 0 };
  reader.update(scope);
  await time.advance(90000);
  assert.equal(calls.length, 2);
  reader.update({ ...scope, active: true });
  await time.advance(30000);
  assert.equal(calls.length, 4);
  reader.update({ ...scope, active: true, visible: false });
  await time.advance(90000);
  assert.equal(calls.length, 4);
  reader.update({ ...scope, active: true, connected: false });
  await time.advance(90000);
  assert.equal(calls.length, 4);
  reader.update({ ...scope, active: false });
  await settle();
  const idleCalls = calls.length;
  await time.advance(90000);
  assert.equal(calls.length, idleCalls);
  reader.dispose();
});

test('the narrow status row shows actual zero, opens details, and keeps failed refresh data visibly stale', async (t) => {
  const path = require('node:path');
  const { buildSync } = require('esbuild');
  const { launchBrowser } = require('../scripts/browser-launch.cjs');
  const files = buildSync({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import UsageStatus from './src/UsageStatus'; const root=createRoot(document.getElementById('root')); window.showStatus=(props={})=>root.render(<UsageStatus cwd="C:/project" sessionId="s1" connected {...props} onOpen={()=>window.opened++}/>);`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    outfile: 'usage-status.js',
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  }).outputFiles;
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 390, height: 400 },
    timezoneId: 'Asia/Shanghai',
  });
  page.setDefaultTimeout(5000);
  await page.setContent(
    '<style>body{margin:0;font-family:Arial}#root{width:280px;margin:20px auto}button{font:inherit}</style><div id="root"></div>',
  );
  await page.evaluate(() => {
    window.opened = 0;
    window.failed = false;
    window.desktop = {
      request: async (command) =>
        window.failed
          ? { ok: false, error: 'offline' }
          : {
              ok: true,
              data:
                command === 'account.usage'
                  ? {
                      fetchedAt: '2026-10-02T10:00:00Z',
                      plan: 'supergrok',
                      remainingPercent: 0,
                      usedPercent: 100,
                    }
                  : { info: { context: { used: 0, total: 200000, usagePct: 0 } }, usage: {} },
            },
    };
  });
  await page.addStyleTag({ content: files.find((file) => file.path.endsWith('.css')).text });
  await page.addScriptTag({ content: files.find((file) => file.path.endsWith('.js')).text });
  await page.evaluate(() => window.showStatus());
  await page.getByText('剩余 0%', { exact: true }).waitFor();
  await page.getByText('0 / 200,000', { exact: true }).waitFor();
  await page.getByRole('button', { name: '查看额度与上下文明细' }).click();
  assert.equal(await page.evaluate(() => window.opened), 1);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('.usage-status').scrollWidth <= 280),
    true,
  );
  await page.evaluate(() => {
    window.failed = true;
  });
  await page.getByRole('button', { name: '刷新用量' }).click();
  await page.getByText('更新失败 · 上次数据 · 18:00', { exact: true }).waitFor();
  assert.equal(await page.getByText('剩余 0%', { exact: true }).count(), 1);
  assert.equal(await page.getByText('0 / 200,000', { exact: true }).count(), 1);
});

let compactFiles;
async function compactFixture(t, values = {}) {
  const path = require('node:path');
  const { buildSync } = require('esbuild');
  const { launchBrowser } = require('../scripts/browser-launch.cjs');
  compactFiles ||= buildSync({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import UsageStatus from './src/UsageStatus'; const root=createRoot(document.getElementById('root')); window.showStatus=(props={})=>root.render(<UsageStatus compact cwd="C:/project" sessionId="s1" connected {...props} onOpen={()=>window.opened++}/>);`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    outfile: 'usage-status-compact.js',
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  }).outputFiles;
  const browser = await launchBrowser();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 980, height: 400 },
    timezoneId: 'Asia/Shanghai',
  });
  page.setDefaultTimeout(5000);
  await page.setContent(
    '<style>body{margin:0;background:#14171b;font-family:Arial}#root{width:430px;margin:20px}button{font:inherit}</style><div id="root"></div>',
  );
  await page.evaluate((values) => {
    window.account = values.account ?? {
      fetchedAt: '2026-10-02T10:00:00Z',
      plan: 'supergrok',
      remainingPercent: 0,
    };
    window.context = values.context ?? {
      info: { context: { used: 198765, total: 500000, usagePct: 0 } },
      usage: {},
    };
    window.calls = [];
    window.opened = 0;
    window.failed = false;
    window.hold = !!values.hold;
    window.pending = [];
    window.desktop = {
      request: (command, payload) => {
        window.calls.push({ command, payload });
        const response = () =>
          window.failed
            ? { ok: false, error: 'offline' }
            : { ok: true, data: command === 'account.usage' ? window.account : window.context };
        return window.hold
          ? new Promise((resolve) => window.pending.push(() => resolve(response())))
          : Promise.resolve(response());
      },
    };
  }, values);
  await page.addStyleTag({ content: compactFiles.find((file) => file.path.endsWith('.css')).text });
  await page.addScriptTag({ content: compactFiles.find((file) => file.path.endsWith('.js')).text });
  await page.evaluate(() => window.showStatus());
  await page.waitForFunction(() => window.calls.length === 2);
  return page;
}

test('compact usage keeps exact values, shows only known progress, and opens details in one click', async (t) => {
  const page = await compactFixture(t);
  await page.getByText('剩余 0%', { exact: true }).waitFor();
  await page.getByText('198,765 / 500,000', { exact: true }).waitFor();
  const progress = page.getByRole('progressbar');
  assert.equal(await progress.count(), 2);
  assert.equal(await progress.nth(0).getAttribute('aria-valuenow'), '0');
  assert.equal(await progress.nth(1).getAttribute('aria-valuenow'), '39.753');
  const details = page.getByRole('button', { name: /^查看额度与上下文明细/ });
  assert.match(await details.getAttribute('aria-label'), /更新于 18:00/);
  await details.click();
  assert.equal(await page.evaluate(() => window.opened), 1);
  const layout = await page.evaluate(() => {
    const status = document.querySelector('.usage-status');
    const metrics = [...status.querySelectorAll('.usage-status-metric')];
    return {
      height: status.getBoundingClientRect().height,
      width: status.scrollWidth,
      border: getComputedStyle(status).borderTopWidth,
      aligned:
        Math.abs(metrics[0].getBoundingClientRect().top - metrics[1].getBoundingClientRect().top) <
        1,
    };
  });
  assert.ok(layout.height <= 36, `compact row grew to ${layout.height}px`);
  assert.ok(layout.width <= 430, `compact row overflowed to ${layout.width}px`);
  assert.equal(layout.border, '0px');
  assert.equal(layout.aligned, true);
});

test('compact unknown values do not invent quota or context progress', async (t) => {
  const page = await compactFixture(t, {
    account: { plan: null, remainingPercent: null },
    context: { info: {}, usage: {} },
  });
  await page.getByText('额度未返回', { exact: true }).waitFor();
  await page.getByText('统计未返回', { exact: true }).waitFor();
  assert.equal(await page.getByRole('progressbar').count(), 0);
  assert.equal(await page.getByText('剩余 100%', { exact: true }).count(), 0);
});

test('compact loading and failed refresh remain visible while prior exact values are retained', async (t) => {
  const page = await compactFixture(t, { hold: true });
  await page.getByText('读取中…', { exact: true }).first().waitFor();
  assert.equal(
    await page.getByRole('button', { name: '刷新用量', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.getByRole('progressbar').count(), 0);
  await page.evaluate(() => {
    window.hold = false;
    window.pending.splice(0).forEach((resolve) => resolve());
  });
  await page.getByText('剩余 0%', { exact: true }).waitFor();
  await page.evaluate(() => {
    window.failed = true;
  });
  await page.getByRole('button', { name: '刷新用量', exact: true }).click();
  await page.getByText('更新失败', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('剩余 0%', { exact: true }).count(), 1);
  assert.equal(await page.getByText('198,765 / 500,000', { exact: true }).count(), 1);
  assert.equal(await page.getByRole('progressbar').count(), 2);
  assert.match(
    await page.getByRole('button', { name: /^查看额度与上下文明细/ }).getAttribute('aria-label'),
    /更新失败 · 上次数据 · 18:00/,
  );
  assert.equal(await page.evaluate(() => window.calls.length), 4);
  await page.evaluate(() => window.showStatus({ connected: false }));
  await page.getByText('未连接', { exact: true }).first().waitFor();
  assert.equal(
    await page.getByRole('button', { name: '刷新用量', exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.getByText('剩余 0%', { exact: true }).count(), 1);
});
