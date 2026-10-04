const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runProcess } = require('../electron/process.cjs');
const { windowsSystemExecutable } = require('../electron/system-launch.cjs');
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function waitFor(predicate, timeout = 5000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('process tree fixture did not become ready');
}
for (const failure of ['timeout', 'maxBytes'])
  test(
    `runProcess ${failure} terminates its ready parent and two descendant levels`,
    { timeout: 15000 },
    async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok owned process '));
      const pids = [];
      const result = runProcess(
        process.execPath,
        [path.join(__dirname, 'fixtures/process-tree-child.cjs'), 'parent', directory],
        { timeout: failure === 'timeout' ? 6000 : 10000, maxBytes: 256 },
      ).catch((error) => error);
      try {
        await waitFor(() =>
          fs.access(path.join(directory, 'ready')).then(
            () => true,
            () => false,
          ),
        );
        for (const role of ['parent', 'middle', 'leaf'])
          pids.push(Number(await fs.readFile(path.join(directory, `${role}.pid`), 'utf8')));
        assert.ok(pids.every(alive), 'all owned processes must be alive before the trigger');
        if (failure === 'maxBytes') await fs.writeFile(path.join(directory, 'overflow'), 'go');
        const error = await result;
        assert.match(error.message, failure === 'timeout' ? /超时/ : /输出内容过大/);
        assert.deepEqual(pids.map(alive), [false, false, false]);
      } finally {
        for (const role of ['leaf', 'middle', 'parent']) {
          const pid = Number(
            await fs.readFile(path.join(directory, `${role}.pid`), 'utf8').catch(() => 0),
          );
          if (pid > 0 && alive(pid)) {
            try {
              if (process.platform === 'win32')
                execFileSync(
                  windowsSystemExecutable('taskkill.exe'),
                  ['/PID', String(pid), '/T', '/F'],
                  { windowsHide: true, stdio: 'ignore' },
                );
              else process.kill(pid, 'SIGKILL');
            } catch {}
          }
        }
        await result;
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
  );
