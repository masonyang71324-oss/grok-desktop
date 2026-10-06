const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const os = require('node:os');
const { CliLogin } = require('../electron/cli-login.cjs');
const { setLocale } = require('../electron/i18n.cjs');

function fixture(options = {}) {
  const children = [],
    launches = [],
    killed = [];
  const login = new CliLogin({
    spawnFn(executable, args, settings) {
      launches.push({ executable, args, settings });
      const child = Object.assign(new EventEmitter(), {
        pid: 2000 + children.length,
        exitCode: null,
        signalCode: null,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      child.close = (code = 0, signal = null) => {
        child.exitCode = code;
        child.signalCode = signal;
        child.stdout.end();
        child.stderr.end();
        child.emit('close', code, signal);
      };
      children.push(child);
      return child;
    },
    killTree: async (child) => {
      killed.push(child);
      child.close(null, 'SIGTERM');
    },
    ...options,
  });
  return { login, children, launches, killed };
}

test('login launches official browser OAuth directly and resolves only after successful CLI close', async () => {
  const { login, launches, children } = fixture();
  const done = login.start('C:\\Grok Build\\grok.exe');
  assert.deepEqual(launches, [
    {
      executable: 'C:\\Grok Build\\grok.exe',
      args: ['--no-auto-update', 'login', '--oauth'],
      settings: {
        cwd: os.homedir(),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    },
  ]);
  let settled = false;
  done.finally(() => {
    settled = true;
  });
  children[0].emit('spawn');
  await Promise.resolve();
  assert.equal(settled, false);
  children[0].stdout.write('private OAuth URL ?code=secret');
  children[0].stderr.write('private credential details');
  assert.equal(children[0].stdout.readableFlowing, true);
  assert.equal(children[0].stderr.readableFlowing, true);
  children[0].close(0);
  assert.deepEqual(await done, { cancelled: false });
});

test('duplicate login clicks share a process and its exact completion promise', async () => {
  const { login, children, launches } = fixture();
  const first = login.start('grok.exe');
  assert.equal(login.start('other.exe'), first);
  assert.equal(launches.length, 1);
  children[0].close(0);
  await first;
  const next = login.start('grok.exe');
  assert.notEqual(next, first);
  assert.equal(launches.length, 2);
  children[1].close(0);
  await next;
});

test('failed CLI exit reports an application-owned error without exposing OAuth output', async () => {
  const { login, children } = fixture();
  const done = login.start('grok.exe');
  children[0].stdout.write('https://login.example/?code=secret');
  children[0].stderr.write('Authorization: secret');
  children[0].close(1);
  await assert.rejects(done, (error) => {
    assert.match(error.message, /Grok Build 登录未完成/);
    assert.doesNotMatch(error.message, /secret|login\.example|Authorization/);
    return true;
  });
});

test('spawn failures use localized safe errors for both asynchronous and synchronous failures', async () => {
  const { login, children } = fixture();
  const done = login.start('grok.exe');
  children[0].emit('error', new Error('private path secret'));
  await assert.rejects(done, /无法启动 Grok Build 登录/);
  setLocale('en');
  try {
    const failed = fixture({
      spawnFn() {
        throw new Error('private path secret');
      },
    }).login;
    await assert.rejects(failed.start('grok.exe'), (error) => {
      assert.match(error.message, /Could not start Grok Build sign-in/);
      assert.doesNotMatch(error.message, /secret/);
      return true;
    });
  } finally {
    setLocale('zh-CN');
  }
});

test('cancel waits for its owned login process cleanup and returns cancellation instead of success', async () => {
  let releaseKill, killStarted;
  const { login, children } = fixture({
    killTree: (child) => {
      killStarted = child;
      return new Promise((resolve) => {
        releaseKill = () => {
          child.close(null, 'SIGTERM');
          resolve();
        };
      });
    },
  });
  const done = login.start('grok.exe');
  const cancelled = login.cancel();
  assert.equal(killStarted, children[0]);
  let settled = false;
  done.finally(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  releaseKill();
  assert.deepEqual(await cancelled, { cancelled: true });
  assert.deepEqual(await done, { cancelled: true });
});

test('login timeout reaps its owned process and gives an explicit retry error', async () => {
  const { login, children, killed } = fixture({ timeout: 10 });
  await assert.rejects(login.start('grok.exe'), /登录等待超时/);
  assert.deepEqual(killed, [children[0]]);
});

test('cancel never passes an exited child PID to process-tree cleanup', async () => {
  for (const state of [{ exitCode: 0 }, { signalCode: 'SIGTERM' }]) {
    const { login, children, killed } = fixture();
    const done = login.start('grok.exe');
    Object.assign(children[0], state);
    assert.deepEqual(await login.cancel(), { cancelled: true });
    assert.deepEqual(await done, { cancelled: true });
    assert.deepEqual(killed, []);
    children[0].close(0);
  }
});

test('dispose cancels only its live login and prevents new work', async () => {
  const { login, children, killed, launches } = fixture();
  const done = login.start('grok.exe');
  assert.deepEqual(await login.dispose(), { cancelled: true });
  assert.deepEqual(await done, { cancelled: true });
  assert.deepEqual(killed, [children[0]]);
  await assert.rejects(login.start('grok.exe'), /登录已关闭/);
  await login.dispose();
  assert.equal(killed.length, 1);
  assert.equal(launches.length, 1);
});
