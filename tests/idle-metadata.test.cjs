const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { SessionHub } = require('../electron/session-hub.cjs');

test(
  'actual sleeping ACP reload retains desktop attachment and turn metadata and accepts the next send',
  { timeout: 10_000 },
  async (t) => {
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-idle-metadata-'));
    let finishNext;
    const hub = new SessionHub({
      emit: (event) => {
        if (event.type === 'task-finished') finishNext?.(event);
      },
      getExecutable: () => process.execPath,
      spawnFn: (executable, args, options) =>
        spawn(executable, [path.join(__dirname, '../scripts/mock-grok.cjs'), ...args], {
          ...options,
          env: {
            ...process.env,
            GROK_DESKTOP_MOCK_STATE: path.join(isolated, 'sessions.json'),
            GROK_DESKTOP_MOCK_LOG: '',
            GROK_HOME: isolated,
            USERPROFILE: isolated,
          },
        }),
    });
    t.after(async () => {
      await hub.dispose();
      fs.rmSync(isolated, { recursive: true, force: true });
    });
    const session = await hub.newSession({ cwd: isolated, permissionMode: 'auto' });
    async function send(text, attachments = []) {
      const finished = new Promise((resolve) => {
        finishNext = resolve;
      });
      const result = await hub.send({ sessionId: session.sessionId, text, attachments });
      assert.equal((await finished).status, 'completed');
      return result;
    }
    const attachments = [
      { name: 'Fixture notes', kind: 'text', text: 'Isolated attachment content' },
    ];
    const first = await send('First fixture turn', attachments);
    const before = await hub.loadSession(session);
    const firstUser = before.updates.find(
      (update) => update.sessionUpdate === 'user_message_chunk',
    );
    assert.deepEqual(firstUser._desktopAttachments, attachments);
    assert.equal(firstUser._desktopTurnId, first.turnId);
    assert.deepEqual(hub.collectIdle({ maxIdleConnections: 0 }), [session.sessionId]);
    const restored = await hub.loadSession(session);
    assert.equal(restored.sessionId, session.sessionId);
    assert.deepEqual(restored.updates, before.updates);
    assert.deepEqual(restored.updates[0]._desktopAttachments, attachments);
    assert.equal(restored.updates[0]._desktopTurnId, first.turnId);
    assert.equal(restored.permissionMode, 'auto');
    assert.ok(restored.models.availableModels.length);
    const second = await send('Second fixture turn after sleep');
    const after = await hub.loadSession(session);
    assert.deepEqual(after.updates.slice(0, before.updates.length), before.updates);
    assert.deepEqual(
      after.updates
        .filter((update) => update.sessionUpdate === 'user_message_chunk')
        .map((update) => update._desktopTurnId),
      [first.turnId, second.turnId],
    );
  },
);
