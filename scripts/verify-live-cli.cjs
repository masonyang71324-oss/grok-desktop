'use strict';
// Explicit, read-only CLI metadata probe. Never sends session/prompt or reads auth files.
const fs = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const { resolveGrok } = require('../electron/settings.cjs');
const { readCliStatus } = require('../electron/cli-status.cjs');
const { GrokClient } = require('../electron/acp.cjs');
async function main() {
  const executable = resolveGrok('');
  const status = await readCliStatus(executable, { checkUpdate: true });
  const methods = [],
    events = [];
  const client = new GrokClient({
    getExecutable: () => executable,
    spawnFn: (exe, args, options) => spawn(exe, ['--no-auto-update', ...args], options),
    emit: (event) => events.push(event.type),
  });
  const request = client._request.bind(client);
  client._request = (method, ...args) => {
    methods.push(method);
    return request(method, ...args);
  };
  let report;
  try {
    const initialized = await client.ensure();
    report = {
      checkedAt: new Date().toISOString(),
      cliVersion: status.version,
      authStatus: status.authStatus,
      latestVersion: status.latestVersion,
      updateAvailable: status.updateAvailable,
      statusError: status.error || null,
      protocolVersion: initialized.protocolVersion,
      agentVersion: client.version,
      modelIds: client.models.availableModels.map((model) => model.modelId),
      commandCount: client.commands.length,
      promptCapabilities: client.capabilities.promptCapabilities,
      requestMethods: [...new Set(methods)],
      promptRequests: methods.filter((method) => method === 'session/prompt').length,
    };
  } finally {
    const child = client._proc;
    const exiting =
      child && !child.killed && child.exitCode === null ? once(child, 'exit') : Promise.resolve();
    client.dispose();
    let timer;
    await Promise.race([
      exiting,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Owned CLI process did not exit within five seconds.')),
          5000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
  }
  report.ownedProcessExited = true;
  await fs.mkdir(path.join(__dirname, '../test-results'), { recursive: true });
  await fs.writeFile(
    path.join(__dirname, '../test-results/live-cli-metadata.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
main().catch((error) => {
  process.stderr.write(`${error.name}: CLI metadata verification failed.\n`);
  process.exitCode = 1;
});
