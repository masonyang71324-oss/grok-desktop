const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnHostedPty } = require('../electron/terminal-host-client.cjs');
const { createTerminalManager } = require('../electron/terminal.cjs');
test(
  'native terminal exits its isolated host and supports restart without lingering handles',
  { skip: process.platform !== 'win32', timeout: 15000 },
  async (t) => {
    const events = [];
    const manager = createTerminalManager({
      spawnPty: spawnHostedPty,
      emit: (event) => events.push(event),
    });
    t.after(() => manager.dispose());
    const entry = manager.open({ cwd: process.cwd() });
    manager.write({ id: entry.id, data: "Write-Output 'NATIVE_PROBE_READY'; exit\r" });
    const deadline = Date.now() + 10000;
    while (manager.state({ id: entry.id }).status === 'running' && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(manager.state({ id: entry.id }).status, 'exited');
    assert.match(manager.state({ id: entry.id }).log, /NATIVE_PROBE_READY/);
    assert.equal(events.filter((event) => event.type === 'terminal-exit').length, 1);
    const next = manager.open({ cwd: process.cwd(), restart: true });
    manager.write({ id: next.id, data: "Write-Output 'SECOND_PROBE_READY'\r" });
    await manager.close({ id: next.id });
    assert.equal(manager.state({ id: next.id }).status, 'exited');
    assert.equal(manager.busy, false);
  },
);
