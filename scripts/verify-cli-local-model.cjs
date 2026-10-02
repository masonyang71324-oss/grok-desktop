'use strict';
// Real official CLI + a deterministic loopback-only synthetic model provider.
// No account credentials, paid model request, or running Desktop is used.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { GrokClient } = require('../electron/acp.cjs');
const { SessionHub } = require('../electron/session-hub.cjs');
const exec = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function until(predicate, label, milliseconds = 15000) {
  const start = Date.now();
  while (!(await predicate())) {
    assert.ok(Date.now() - start < milliseconds, `Timed out: ${label}`);
    await delay(40);
  }
}
async function bounded(promise, label, milliseconds = 30000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function assistantText(snapshot) {
  return snapshot.updates
    .filter((u) => u.sessionUpdate === 'agent_message_chunk')
    .map((u) => u.content?.text || '')
    .join('');
}
async function main() {
  assert.equal(process.platform, 'win32', 'This runtime fixture currently targets Windows');
  const executable = path.resolve(
    process.argv[2] || path.join(__dirname, '../test-results/cli-install-probe/grok.exe'),
  );
  assert.ok(fsSync.existsSync(executable), `Official CLI missing: ${executable}`);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-local-model-audit-'));
  const dirs = Object.fromEntries(
    ['profile', 'home', 'roaming', 'local', 'tmp', 'cwd', 'cwd-b'].map((name) => [
      name,
      path.join(root, name),
    ]),
  );
  await Promise.all(Object.values(dirs).map((dir) => fs.mkdir(dir)));
  const report = {
    checkedAt: new Date().toISOString(),
    executable,
    fixtureRoot: root,
    scope: 'Official CLI with local synthetic model; no paid service/model-quality coverage',
    requests: [],
    blockedProxyRequests: [],
    processIds: [],
    permissionRequests: [],
    history: {},
    lifecycle: {},
  };
  const clients = [],
    hubs = [];
  const children = [],
    ownedHelperPids = new Set();
  let stage = 'history',
    fail,
    capturedTools,
    lifecycleCommand,
    lifecycleEmitted = false;
  const historyReceived = deferred(),
    releaseHistory = deferred();
  const marker = 'LOCAL_AUDIT_FINAL_A_20261003';
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.hostname !== '127.0.0.1') {
        report.blockedProxyRequests.push({ method: request.method, host: url.hostname });
        response.writeHead(502);
        response.end('External access blocked by audit fixture');
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8');
      if (request.method === 'GET' && url.pathname.endsWith('/models')) {
        report.requests.push({ method: 'GET', path: url.pathname });
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'local-audit', object: 'model', owned_by: 'audit' }],
          }),
        );
        return;
      }
      if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
        report.requests.push({ method: request.method, path: url.pathname });
        response.writeHead(404);
        response.end('{}');
        return;
      }
      const input = JSON.parse(body);
      assert.equal(input.model, 'local-audit', 'Only the fixture model is allowed');
      assert.equal(request.headers.authorization, 'Bearer audit-fake-local-key');
      report.requests.push({
        method: 'POST',
        path: url.pathname,
        model: input.model,
        stream: input.stream,
        toolNames: (input.tools || []).map((tool) => tool.function?.name || tool.name),
        stage,
      });
      const isTurn = input.tools?.some((tool) => tool.function?.name === 'run_terminal_command');
      if (isTurn) capturedTools = input.tools;
      if (stage === 'history' && isTurn) {
        historyReceived.resolve();
        await releaseHistory.promise;
      }
      const toolCall =
        isTurn && stage.startsWith('lifecycle-') && !lifecycleEmitted
          ? {
              id: `audit-tool-${stage}`,
              type: 'function',
              function: {
                name: 'run_terminal_command',
                arguments: JSON.stringify({
                  command: lifecycleCommand,
                  description:
                    'Run the temporary audit wait helper for process cleanup verification.',
                  block_until_ms: 600000,
                }),
              },
            }
          : null;
      if (toolCall) lifecycleEmitted = true;
      const content = isTurn ? marker : 'Local audit session';
      if (input.stream) {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        const chunk = (delta, finish_reason = null) =>
          response.write(
            `data: ${JSON.stringify({
              id: 'chatcmpl-local-audit',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'local-audit',
              choices: [{ index: 0, delta, finish_reason }],
            })}\n\n`,
          );
        chunk({ role: 'assistant', content: '' });
        if (toolCall) chunk({ tool_calls: [{ index: 0, ...toolCall }] });
        else chunk({ content });
        chunk({}, toolCall ? 'tool_calls' : 'stop');
        response.end('data: [DONE]\n\n');
      } else {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            id: 'chatcmpl-local-audit',
            object: 'chat.completion',
            created: 1,
            model: 'local-audit',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  ...(toolCall ? { content: null, tool_calls: [toolCall] } : { content }),
                },
                finish_reason: toolCall ? 'tool_calls' : 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      }
    } catch (error) {
      fail = error;
      response.writeHead(500);
      response.end('{}');
    }
  });
  server.on('connect', (request, socket) => {
    report.blockedProxyRequests.push({ method: 'CONNECT', host: request.url });
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const env = {};
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'NUMBER_OF_PROCESSORS',
  ])
    if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, {
    PATH: [
      path.join(systemRoot, 'System32'),
      path.join(systemRoot, 'System32/WindowsPowerShell/v1.0'),
      path.dirname(process.execPath),
    ].join(path.delimiter),
    USERPROFILE: dirs.profile,
    HOME: dirs.profile,
    GROK_HOME: dirs.home,
    APPDATA: dirs.roaming,
    LOCALAPPDATA: dirs.local,
    TEMP: dirs.tmp,
    TMP: dirs.tmp,
    LOCAL_AUDIT_KEY: 'audit-fake-local-key',
    GROK_DISABLE_AUTOUPDATER: '1',
    GROK_TELEMETRY_ENABLED: '0',
    GROK_FEEDBACK_ENABLED: '0',
    GROK_TELEMETRY_TRACE_UPLOAD: '0',
    GROK_TELEMETRY_MIXPANEL_ENABLED: '0',
    GROK_MANAGED_MCPS_ENABLED: '0',
    GROK_SUBAGENTS: '0',
    GROK_MEMORY: '0',
    GROK_WORKFLOWS: '0',
    GROK_WEB_FETCH: '0',
    HTTP_PROXY: base,
    HTTPS_PROXY: base,
    ALL_PROXY: base,
    NO_PROXY: '127.0.0.1,localhost',
  });
  report.environmentKeys = Object.keys(env).sort();
  await fs.writeFile(
    path.join(dirs.home, 'config.toml'),
    `disable_web_search = true
[models]
default = "local-audit"
allowed_models = ["local-audit"]
remote_fetch = false
session_summary = "local-audit"
prompt_suggestion = "local-audit"
max_retries = 0
[model.local-audit]
model = "local-audit"
name = "Local synthetic audit"
base_url = "${base}/v1"
env_key = "LOCAL_AUDIT_KEY"
api_backend = "chat_completions"
context_window = 32000
[cli]
auto_update = false
[features]
telemetry = "off"
backend_tools = false
[managed_mcps]
enabled = false
[relay]
enabled = false
[telemetry]
otel_enabled = false
trace_upload = false
mixpanel_enabled = false
[memory]
enabled = false
[memory_v2]
enabled = false
[toolset.bash]
login_shell_capture = false
auto_background_on_timeout = false
[endpoints]
cli_chat_proxy_base_url = "${base}"
models_base_url = "${base}/v1"
models_list_url = "${base}/v1/models"
xai_api_base_url = "${base}/v1"
managed_config_url = "${base}/managed-config"
feedback_base_url = "${base}"
trace_upload_url = "${base}/traces"
`,
  );
  const events = [];
  const makeHub = () => {
    const hub = new SessionHub({
      storageFile: path.join(root, 'desktop-queues.json'),
      emit: (event) => {
        events.push(event);
        if (event.type === 'permission') {
          report.permissionRequests.push(event.params);
          const input = event.params.toolCall?.rawInput;
          const option = event.params.options.find((item) => item.kind === 'allow_once');
          const permitted =
            stage.startsWith('lifecycle-') && input?.command === lifecycleCommand && option;
          hub.respondPermission({
            sessionId: event.sessionId,
            requestId: event.requestId,
            ...(permitted ? { optionId: option.optionId } : { cancelled: true }),
          });
          if (!permitted)
            fail = Error('Unexpected permission: denied by exact fixture command gate');
        }
      },
      createClient: (emit) => {
        const client = new GrokClient({
          getExecutable: () => executable,
          emit,
          spawnFn: (exe, args, options) => {
            const child = spawn(exe, args, { ...options, env, cwd: dirs.cwd });
            report.processIds.push(child.pid);
            children.push(child);
            return child;
          },
        });
        clients.push(client);
        return client;
      },
    });
    hubs.push(hub);
    return hub;
  };
  try {
    report.version = (
      await exec(executable, ['--version'], {
        env,
        cwd: dirs.cwd,
        windowsHide: true,
        timeout: 10000,
      })
    ).stdout.trim();
    console.log(`Official ${report.version}; isolated fixture ready`);
    const hub = makeHub();
    const a = await hub.newSession({
      cwd: dirs.cwd,
      modelId: 'local-audit',
      permissionMode: 'ask',
    });
    const b = await hub.newSession({
      cwd: dirs['cwd-b'],
      modelId: 'local-audit',
      permissionMode: 'ask',
    });
    hub.setActiveSession(a.sessionId);
    await hub.send({
      sessionId: a.sessionId,
      text: 'LOCAL_AUDIT_HISTORY: Return one plain assistant line. Do not call tools.',
    });
    await bounded(historyReceived.promise, 'local model request');
    hub.setActiveSession(b.sessionId);
    assert.equal(hub.activeSessionId, b.sessionId);
    releaseHistory.resolve();
    await until(
      () =>
        events.some((event) => event.type === 'task-finished' && event.sessionId === a.sessionId),
      'A finishes in background',
    );
    if (fail) throw fail;
    const entry = hub.sessions.get(a.sessionId);
    assert.equal(entry.lastTurn.status, 'completed');
    assert.equal(assistantText(entry.snapshot), marker);
    assert.equal(hub.activeSessionId, b.sessionId);
    const oldProcesses = clients.map((client) => client._proc).filter(Boolean);
    await hub.dispose();
    await until(
      () => oldProcesses.every((child) => child.exitCode !== null || child.signalCode !== null),
      'original CLI exit',
    );
    stage = 'reload';
    const restarted = makeHub();
    const loaded = await restarted.loadSession({ cwd: dirs.cwd, sessionId: a.sessionId });
    assert.equal(assistantText(loaded), marker);
    const queueState = await fs.readFile(path.join(root, 'desktop-queues.json'), 'utf8');
    assert.equal(
      queueState.includes(marker),
      false,
      'Desktop summaries must not impersonate official full history',
    );
    report.history = {
      passed: true,
      sessionA: a.sessionId,
      sessionB: b.sessionId,
      inactiveAtCompletion: true,
      originalCliExited: true,
      finalAssistantFromOfficialReload: assistantText(loaded),
      originalCliPids: oldProcesses.map((child) => child.pid),
      reloadCliPid: restarted.sessions.get(a.sessionId).client._proc.pid,
      desktopQueueContainsFinalAssistant: false,
      reloadedUpdateCount: loaded.updates.length,
    };
    console.log('J02: A completed while B active; new official CLI reloaded exact final assistant');
    await restarted.dispose();
    const helperPath = path.join(root, 'owned-wait.cjs');
    await fs.writeFile(
      helperPath,
      `const fs = require('node:fs');
const { spawn } = require('node:child_process');
if (process.argv[2] === '--child') {
  fs.writeFileSync(process.argv[3], JSON.stringify({ pid: process.pid, ppid: process.ppid, cwd: process.cwd() }));
  setInterval(() => {}, 1000);
} else {
  spawn(process.execPath, [__filename, '--child', process.argv[2]], { stdio: 'inherit', windowsHide: true });
}
`,
    );
    const powershell = path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const processAncestry = async (pid, rootPid) => {
      assert.ok(
        Number.isSafeInteger(pid) && pid > 0 && Number.isSafeInteger(rootPid) && rootPid > 0,
      );
      const operation = exec(
        powershell,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(__dirname, 'read-process-ancestry.ps1'),
          String(pid),
          String(rootPid),
        ],
        {
          // The observer only reads kernel PID metadata. Keep its normal OS/
          // compiler environment; the CLI, model and tool children remain in env.
          env: process.env,
          cwd: dirs.cwd,
          windowsHide: true,
          timeout: 10000,
        },
      );
      // This observer has no interactive input. Unlike the CLI tool under test,
      // Windows PowerShell must see EOF on its redirected input immediately.
      operation.child.stdin.end();
      let result;
      try {
        result = await operation;
      } catch (error) {
        report.ancestryObserverFailure = {
          code: error.code,
          signal: error.signal,
          killed: error.killed,
          stderr: String(error.stderr || '').slice(-2000),
          stdout: String(error.stdout || '').slice(-2000),
        };
        throw error;
      }
      return JSON.parse(result.stdout);
    };
    const quote = (text) => `'${text.replaceAll("'", "''")}'`;
    for (const action of ['cancel', 'dispose']) {
      stage = `lifecycle-${action}`;
      lifecycleEmitted = false;
      const readyPath = path.join(root, `ready-${action}.json`);
      lifecycleCommand = `& ${quote(process.execPath)} ${quote(helperPath)} ${quote(readyPath)}`;
      const lifecycleHub = makeHub();
      const session = await lifecycleHub.newSession({
        cwd: dirs.cwd,
        modelId: 'local-audit',
        permissionMode: 'ask',
      });
      const permissionCount = report.permissionRequests.length;
      await lifecycleHub.send({
        sessionId: session.sessionId,
        text: `LOCAL_AUDIT_${action}: Run only the single predetermined temporary audit wait helper supplied by the synthetic provider.`,
      });
      await until(() => {
        if (fail) throw fail;
        return fsSync.existsSync(readyPath);
      }, `${action}: descendant readiness`);
      const ready = JSON.parse(await fs.readFile(readyPath, 'utf8'));
      assert.ok(
        Number.isSafeInteger(ready.pid) &&
          ready.pid > 0 &&
          Number.isSafeInteger(ready.ppid) &&
          ready.ppid > 0,
      );
      ownedHelperPids.add(ready.pid);
      ownedHelperPids.add(ready.ppid);
      // Hosted Windows may provide an 8.3 TEMP alias while GetCurrentDirectory
      // reports its long name. Compare the actual directories, not spellings.
      assert.equal(
        (await fs.realpath(ready.cwd)).toLowerCase(),
        (await fs.realpath(dirs.cwd)).toLowerCase(),
      );
      const cli = lifecycleHub.sessions.get(session.sessionId).client._proc;
      const ancestry = await processAncestry(ready.pid, cli.pid);
      assert.equal(
        ancestry.at(-1).ProcessId,
        cli.pid,
        'Ready descendant must belong to this actual CLI',
      );
      assert.ok(ancestry.length >= 4, 'CLI -> PowerShell -> helper -> child must be real');
      for (const process of ancestry.slice(0, -1)) ownedHelperPids.add(process.ProcessId);
      assert.equal(
        report.permissionRequests.length - permissionCount,
        1,
        'Exactly one ask approval expected',
      );
      assert.ok(
        alive(ready.pid) && alive(ready.ppid),
        'Both helper generations alive before action',
      );
      console.log(
        `J05 ${action}: descendant ready, verified ancestry ${ancestry.map((p) => `${p.Name}:${p.ProcessId}`).join(' <- ')}`,
      );
      const started = Date.now();
      if (action === 'cancel')
        await bounded(
          lifecycleHub.cancel({ sessionId: session.sessionId }),
          'cancel completion',
          16000,
        );
      else await bounded(lifecycleHub.dispose(), 'hub dispose', 10000);
      const descendants = ancestry.slice(0, -1).map((p) => p.ProcessId);
      while (descendants.some(alive) && Date.now() - started < 8000) await delay(50);
      const remainingPids = descendants.filter(alive);
      // Retire confirmed exited IDs immediately: the OS may reuse them later.
      for (const pid of descendants) if (!remainingPids.includes(pid)) ownedHelperPids.delete(pid);
      report.lifecycle[action] = {
        passed: remainingPids.length === 0,
        readiness: ready,
        ancestry,
        approvedExactCommand: lifecycleCommand,
        permissionRequests: report.permissionRequests.length - permissionCount,
        actionElapsedMs: Date.now() - started,
        remainingPids,
        cliAliveAfterAction: alive(cli.pid),
      };
      if (remainingPids.length) {
        process.exitCode = 1;
        for (const helperPid of remainingPids) {
          if (!alive(helperPid)) continue;
          await exec(
            path.join(systemRoot, 'System32/taskkill.exe'),
            ['/PID', String(helperPid), '/T', '/F'],
            { windowsHide: true, env },
          ).catch(() => {});
        }
      }
      await lifecycleHub.dispose();
      console.log(
        `J05 ${action}: ${remainingPids.length ? `FAIL; live descendants ${remainingPids.join(',')}` : 'PASS; all descendants exited'}`,
      );
    }
  } catch (error) {
    report.error = `${error.name}: ${error.message}`;
    process.exitCode = 1;
  } finally {
    report.toolSchema = capturedTools?.find(
      (tool) => tool.function?.name === 'run_terminal_command',
    );
    releaseHistory.resolve();
    for (const hub of hubs) await hub.dispose();
    for (const client of clients) client.dispose();
    for (const pid of ownedHelperPids) {
      try {
        process.kill(pid, 0);
        await exec(
          path.join(systemRoot, 'System32/taskkill.exe'),
          ['/PID', String(pid), '/T', '/F'],
          { windowsHide: true, env },
        );
      } catch {}
    }
    await until(
      () => children.every((child) => child.exitCode !== null || child.signalCode !== null),
      'cleanup CLI exit',
    );
    await until(() => [...ownedHelperPids].every((pid) => !alive(pid)), 'cleanup descendants exit');
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    report.authenticationFileCreated = fsSync.existsSync(path.join(dirs.home, 'auth.json'));
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
    report.cleanup = {
      fixtureRootRemoved: !fsSync.existsSync(root),
      allCliProcessesExited: true,
      allObservedDescendantsExited: true,
      providerServerClosed: true,
    };
    await fs.mkdir(path.join(__dirname, '../test-results'), { recursive: true });
    await fs.writeFile(
      path.join(__dirname, '../test-results/cli-local-model.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      JSON.stringify(
        {
          version: report.version,
          history: report.history,
          lifecycle: report.lifecycle,
          error: report.error,
          blockedProxyRequests: report.blockedProxyRequests,
        },
        null,
        2,
      ),
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
