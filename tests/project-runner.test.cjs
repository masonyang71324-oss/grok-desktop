const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createProjectRunner, extractLocalUrl } = require('../electron/project-runner.cjs');

async function until(fn) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for runner');
}

test('extracts only valid loopback preview URLs', () => {
  assert.equal(extractLocalUrl('http://localhost.evil.com:3000'), undefined);
  assert.equal(extractLocalUrl('http://0.0.0.0:3000'), undefined);
  assert.equal(extractLocalUrl('Local: http://localhost:4321/'), 'http://localhost:4321/');
  assert.equal(extractLocalUrl('http://[::1]:9000/'), 'http://[::1]:9000/');
});

test('runs existing scripts in paths with spaces, bounds logs and stops its process tree', async (t) => {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  t.after(() => unrelated.kill());
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'runner project spaces '));
  const events = [];
  const runner = createProjectRunner({ emit: (name, payload) => events.push({ name, payload }) });
  t.after(async () => {
    await runner.dispose();
    await fs.rm(cwd, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(cwd, 'package.json'),
    JSON.stringify({ scripts: { dev: 'node fixture.cjs', fail: 'node -e "process.exit(7)"' } }),
  );
  await fs.writeFile(
    path.join(cwd, 'fixture.cjs'),
    `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('child.pid',String(child.pid));console.log('x'.repeat(80000));console.log('http://127.0.0.1:4567/');setInterval(()=>{},1000);`,
  );
  assert.deepEqual(
    (await runner.inspect({ cwd })).scripts.map((s) => s.name),
    ['dev', 'fail'],
  );
  await assert.rejects(runner.start({ cwd, script: 'missing' }), /npm/i);
  await runner.start({ cwd, script: 'dev' });
  assert.equal(runner.busy, true);
  await until(() => runner.state({ cwd }).url);
  assert.ok(runner.state({ cwd }).log.length <= 65536);
  const pid = Number(await fs.readFile(path.join(cwd, 'child.pid'), 'utf8'));
  await runner.stop({ cwd });
  assert.equal(runner.state({ cwd }).status, 'stopped');
  assert.equal(runner.busy, false);
  assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  await until(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  });
  await runner.start({ cwd, script: 'fail' });
  await until(() => runner.state({ cwd }).status === 'error');
  assert.match(runner.state({ cwd }).error, /7/);
  assert.ok(events.every((event) => event.name === 'runner-changed' && event.payload.cwd === cwd));
});

test('Electron main process can run npm using installed Node instead of its own executable', async (t) => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'electron runner spaces '));
  t.after(() => fs.rm(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  await fs.writeFile(
    path.join(cwd, 'package.json'),
    JSON.stringify({ scripts: { verify: 'node -e "console.log(123456789)"' } }),
  );
  const script = path.join(cwd, 'electron-fixture.cjs');
  await fs.writeFile(
    script,
    `
    const {app}=require('electron');
    const {createProjectRunner}=require(${JSON.stringify(require.resolve('../electron/project-runner.cjs'))});
    const runner=createProjectRunner();
    (async()=>{
      if (!process.versions.electron) throw new Error('Expected real Electron main process');
      await runner.start({cwd:__dirname,script:'verify'});
      const deadline=Date.now()+10000;
      while(runner.state({cwd:__dirname}).status==='running' && Date.now()<deadline) await new Promise(r=>setTimeout(r,30));
      const state=runner.state({cwd:__dirname});
      if(state.status!=='stopped' || !state.log.includes('123456789')) throw new Error(JSON.stringify(state));
      await runner.dispose(); app.exit(0);
    })().catch(async error=>{console.error(error);await runner.dispose();app.exit(1)});
  `,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [script], {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 0, output);
});
