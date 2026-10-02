'use strict';
// Creates and deletes one temporary official CLI session. No prompts/model inference.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { resolveGrok } = require('../electron/settings.cjs');
const { GrokClient } = require('../electron/acp.cjs');
async function stop(client) {
  const child = client._proc;
  const exited = child && child.exitCode === null ? once(child, 'exit') : Promise.resolve();
  client.dispose();
  let timer;
  await Promise.race([
    exited,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Owned CLI exit timeout')), 5000);
    }),
  ]).finally(() => clearTimeout(timer));
}
async function observe(predicate) {
  const until = Date.now() + 3000;
  while (!predicate() && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(predicate(), 'Expected official state notification was not observed');
}
async function main() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'grok live config '));
  const methods = [];
  let client,
    sessionId,
    deleted = false;
  const make = () => {
    const result = new GrokClient({
      getExecutable: () => resolveGrok(''),
      spawnFn: (exe, args, options) => spawn(exe, ['--no-auto-update', ...args], options),
      emit: () => {},
    });
    const request = result._request.bind(result);
    result._request = (method, ...args) => {
      methods.push(method);
      return request(method, ...args);
    };
    return result;
  };
  const report = {
    checkedAt: new Date().toISOString(),
    configurationChecks: [],
    modeChecks: [],
    historyReload: false,
    renamed: false,
    deleted: false,
    promptRequests: 0,
  };
  try {
    client = make();
    const snapshot = await client.newSession({ cwd, permissionMode: 'ask' });
    sessionId = snapshot.sessionId;
    const models = snapshot.models.availableModels;
    for (const model of models) {
      const efforts =
        model._meta?.supportsReasoningEffort === false ? [] : model._meta?.reasoningEfforts || [];
      const choices = efforts.length ? efforts.map((item) => item.value || item.id) : [undefined];
      for (const effort of choices) {
        const result = await client.configure({
          sessionId,
          modelId: model.modelId,
          ...(effort ? { effort } : {}),
        });
        await observe(() => {
          const current = client._sessions.get(sessionId)?.models;
          const chosen = current?.availableModels.find((item) => item.modelId === model.modelId);
          return (
            current?.currentModelId === model.modelId &&
            (!effort || chosen?._meta?.reasoningEffort === effort)
          );
        });
        report.configurationChecks.push({
          modelId: model.modelId,
          effort: effort || null,
          verified: true,
          notificationAfterReply: effort
            ? result.models.availableModels.find((item) => item.modelId === model.modelId)?._meta
                ?.reasoningEffort !== effort
            : false,
        });
      }
      for (const contextWindow of model._meta?.contextWindows || []) {
        const result = await client.configure({ sessionId, modelId: model.modelId, contextWindow });
        await observe(() => client._sessions.get(sessionId)?.contextWindow === contextWindow);
        report.configurationChecks.push({
          modelId: model.modelId,
          contextWindow,
          verified: true,
          notificationAfterReply: result.contextWindow !== contextWindow,
        });
      }
    }
    for (const mode of snapshot.modes?.availableModes || []) {
      const result = await client.configure({ sessionId, modeId: mode.id });
      assert.equal(result.modes.currentModeId, mode.id);
      report.modeChecks.push(mode.id);
    }
    await client.rename({ cwd, sessionId, title: 'Temporary desktop verification' });
    report.renamed = true;
    const listed = await client.listSessions({ cwd });
    assert.ok(listed.some((item) => item.sessionId === sessionId));
    await stop(client);
    client = make();
    const loaded = await client.loadSession({ cwd, sessionId });
    assert.equal(loaded.sessionId, sessionId);
    assert.equal(loaded.cwd, cwd);
    report.historyReload = true;
    await client.deleteSession({ cwd, sessionId });
    deleted = true;
    const after = await client.listSessions({ cwd });
    assert.equal(
      after.some((item) => item.sessionId === sessionId),
      false,
    );
    report.deleted = true;
  } finally {
    try {
      if (client && sessionId && !deleted) {
        await client.deleteSession({ cwd, sessionId });
        deleted = true;
      }
    } finally {
      try {
        if (client) await stop(client);
      } finally {
        if (deleted || !sessionId) await fs.rm(cwd, { recursive: true, force: true });
      }
    }
  }
  report.requestMethods = [...new Set(methods)];
  report.promptRequests = methods.filter((method) => method === 'session/prompt').length;
  assert.equal(report.promptRequests, 0);
  await fs.mkdir(path.join(__dirname, '../test-results'), { recursive: true });
  await fs.writeFile(
    path.join(__dirname, '../test-results/live-cli-session.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
module.exports = { verifyLiveSession: main };
if (require.main === module)
  main().catch((error) => {
    process.stderr.write(
      `${error.name}: Temporary live session check failed (${error.message}).\n`,
    );
    process.exitCode = 1;
  });
