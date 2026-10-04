'use strict';
// One real official-CLI scenario: stdio MCP invocation, cancel, then owned CLI disposal.
// Explicit executable input; only that file is copied. No existing Grok profile is read.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { GrokClient } = require('../electron/acp.cjs');
const { SessionHub } = require('../electron/session-hub.cjs');
const { windowsPowerShellPath } = require('../electron/system-launch.cjs');
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
async function until(predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await delay(40);
  }
}
async function bounded(operation, label, timeout = 15000) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function main() {
  assert.equal(process.platform, 'win32');
  assert.ok(
    process.argv[2],
    'Usage: node scripts/verify-cli-mcp-lifecycle.cjs <official-grok.exe>',
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-mcp-lifecycle-'));
  const dirs = Object.fromEntries(
    ['bin', 'profile', 'home', 'roaming', 'local', 'tmp', 'cwd'].map((name) => [
      name,
      path.join(root, name),
    ]),
  );
  await Promise.all(Object.values(dirs).map((folder) => fs.mkdir(folder)));
  const executable = path.join(dirs.bin, 'grok.exe');
  await fs.copyFile(path.resolve(process.argv[2]), executable);
  const fixtureScript = path.join(root, 'mcp-owned-server.cjs');
  await fs.copyFile(path.join(__dirname, 'fixtures/mcp-owned-server.cjs'), fixtureScript);
  // Bound project discovery without consulting user's Git configuration.
  await Promise.all(
    ['objects', 'refs/heads'].map((name) =>
      fs.mkdir(path.join(dirs.cwd, '.git', name), { recursive: true }),
    ),
  );
  await fs.writeFile(path.join(dirs.cwd, '.git/HEAD'), 'ref: refs/heads/main\n');
  await fs.writeFile(
    path.join(dirs.cwd, '.git/config'),
    '[core]\nrepositoryformatversion = 0\nbare = false\n',
  );
  const report = {
    checkedAt: new Date().toISOString(),
    scope: 'One official CLI + loopback model + stdio MCP lifecycle; no paid model or user profile',
    requests: [],
    protocolMethods: [],
    permissions: [],
    blockedProxyRequests: [],
  };
  const children = [];
  let hub,
    failure,
    toolEmitted = false,
    searched = false,
    heldCompletion = false,
    stage = 'setup',
    ready;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.hostname !== '127.0.0.1') {
        report.blockedProxyRequests.push({ method: request.method, host: url.hostname });
        response.writeHead(502);
        response.end();
        return;
      }
      if (request.method === 'GET' && url.pathname.endsWith('/models')) {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'local-mcp-audit', object: 'model', owned_by: 'fixture' }],
          }),
        );
        return;
      }
      if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
        response.writeHead(404);
        response.end('{}');
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks));
      assert.equal(input.model, 'local-mcp-audit');
      const names = (input.tools || []).map((tool) => tool.function?.name || tool.name);
      report.requests.push({
        path: url.pathname,
        model: input.model,
        stream: input.stream,
        toolNames: names,
      });
      const direct = names.find((name) => name === 'audit_mcp__hold_owned_tree');
      const useTool = names.find((name) => name === 'use_tool');
      const searchTool = names.find((name) => name === 'search_tool');
      report.toolResults = (input.messages || [])
        .filter(
          (message) =>
            message.role === 'tool' &&
            ['owned-mcp-call', 'owned-mcp-search'].includes(message.tool_call_id),
        )
        .map((message) => ({
          id: message.tool_call_id,
          content: String(message.content).slice(0, 2000),
        }));
      report.metaToolInputs = (input.tools || [])
        .filter((tool) => ['use_tool', 'search_tool'].includes(tool.function?.name))
        .map((tool) => ({
          name: tool.function.name,
          required: tool.function.parameters?.required,
          fields: Object.fromEntries(
            Object.entries(tool.function.parameters?.properties || {}).map(([key, value]) => [
              key,
              { type: value.type, itemsType: value.items?.type },
            ]),
          ),
        }));
      const isTurn = !!(direct || useTool);
      if (isTurn && toolEmitted) {
        heldCompletion = true;
        return;
      }
      let call;
      if (isTurn && searchTool && !searched) {
        // A zero-latency synthetic answer can race Grok's asynchronous MCP registration.
        await until(
          () =>
            fs.readFile(path.join(root, 'mcp-protocol.jsonl'), 'utf8').then(
              (text) => text.includes('"method":"tools/list"'),
              () => false,
            ),
          'MCP startup tools/list',
          15000,
        );
        await delay(500);
        searched = true;
        call = {
          id: 'owned-mcp-search',
          type: 'function',
          function: {
            name: searchTool,
            arguments: JSON.stringify({ query: 'audit_mcp__hold_owned_tree' }),
          },
        };
      } else if (isTurn && !toolEmitted) {
        if (searched) {
          const searchResult = report.toolResults.find((item) => item.id === 'owned-mcp-search');
          assert.ok(
            searchResult?.content.includes('audit_mcp__hold_owned_tree'),
            'Actual MCP catalog must expose the fixture tool before invocation',
          );
          report.catalogConfirmed = true;
        }
        toolEmitted = true;
        call = {
          id: 'owned-mcp-call',
          type: 'function',
          function: {
            name: direct || useTool,
            arguments: JSON.stringify(
              direct ? {} : { tool_name: 'audit_mcp__hold_owned_tree', tool_input: {} },
            ),
          },
        };
      }
      const content = 'Local fixture response';
      if (input.stream) {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        });
        const chunk = (delta, finish_reason = null) =>
          response.write(
            `data: ${JSON.stringify({ id: 'local-mcp', object: 'chat.completion.chunk', created: 1, model: 'local-mcp-audit', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
          );
        chunk({ role: 'assistant', content: '' });
        chunk(call ? { tool_calls: [{ index: 0, ...call }] } : { content });
        chunk({}, call ? 'tool_calls' : 'stop');
        response.end('data: [DONE]\n\n');
      } else {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            id: 'local-mcp',
            object: 'chat.completion',
            created: 1,
            model: 'local-mcp-audit',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  ...(call ? { content: null, tool_calls: [call] } : { content }),
                },
                finish_reason: call ? 'tool_calls' : 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      }
    } catch (error) {
      failure = error;
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
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
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
    LOCAL_MCP_KEY: 'fixture-only-not-a-credential',
    GROK_DISABLE_AUTOUPDATER: '1',
    GROK_TELEMETRY_ENABLED: '0',
    GROK_FEEDBACK_ENABLED: '0',
    GROK_TELEMETRY_TRACE_UPLOAD: '0',
    GROK_TELEMETRY_MIXPANEL_ENABLED: '0',
    GROK_MANAGED_MCPS_ENABLED: '0',
    GROK_CURSOR_MCPS_ENABLED: '0',
    GROK_CLAUDE_MCPS_ENABLED: '0',
    GROK_SUBAGENTS: '0',
    GROK_MEMORY: '0',
    GROK_WORKFLOWS: '0',
    GROK_WEB_FETCH: '0',
    HTTP_PROXY: base,
    HTTPS_PROXY: base,
    ALL_PROXY: base,
    NO_PROXY: '127.0.0.1,localhost',
  });
  await fs.writeFile(
    path.join(dirs.home, 'config.toml'),
    `disable_web_search = true
[models]
default = "local-mcp-audit"
allowed_models = ["local-mcp-audit"]
remote_fetch = false
session_summary = "local-mcp-audit"
prompt_suggestion = "local-mcp-audit"
max_retries = 0
[model.local-mcp-audit]
model = "local-mcp-audit"
name = "Local MCP lifecycle fixture"
base_url = "${base}/v1"
env_key = "LOCAL_MCP_KEY"
api_backend = "chat_completions"
context_window = 32000
[cli]
auto_update = false
[features]
telemetry = "off"
backend_tools = false
[managed_mcps]
enabled = false
[compat.claude]
mcps = false
[compat.cursor]
mcps = false
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
[mcp_servers.audit_mcp]
command = ${JSON.stringify(process.execPath)}
args = [${JSON.stringify(fixtureScript)},${JSON.stringify(root)}]
startup_timeout_sec = 15
tool_timeout_sec = 30
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
  try {
    report.version = (
      await exec(executable, ['--version'], {
        env,
        cwd: dirs.cwd,
        windowsHide: true,
        timeout: 10000,
      })
    ).stdout.trim();
    stage = 'session';
    hub = new SessionHub({
      emit: (event) => {
        if (event.type !== 'permission') return;
        const tool = event.params.toolCall || {},
          raw = tool.rawInput;
        const known =
          raw?.tool_name === 'audit_mcp__hold_owned_tree' &&
          raw.tool_input !== null &&
          typeof raw.tool_input === 'object' &&
          !Array.isArray(raw.tool_input) &&
          Object.keys(raw.tool_input).length === 0;
        const option = event.params.options.find((item) => item.kind === 'allow_once');
        report.permissions.push({
          knownMcpTool: known,
          ...(known ? { toolName: raw.tool_name, inputKeys: [] } : {}),
          rawInputKeys: raw && typeof raw === 'object' ? Object.keys(raw) : [],
          accepted: !!(known && option),
        });
        hub.respondPermission({
          sessionId: event.sessionId,
          requestId: event.requestId,
          ...(known && option ? { optionId: option.optionId } : { cancelled: true }),
        });
        if (!known || !option) failure = new Error('Unexpected permission denied');
      },
      createClient: (emit) =>
        new GrokClient({
          getExecutable: () => executable,
          emit,
          spawnFn: (exe, args, options) => {
            const child = spawn(exe, args, { ...options, env, cwd: dirs.cwd });
            children.push(child);
            return child;
          },
        }),
    });
    const session = await bounded(
      hub.newSession({ cwd: dirs.cwd, modelId: 'local-mcp-audit', permissionMode: 'ask' }),
      'new session',
      30000,
    );
    stage = 'mcp-tool';
    await hub.send({
      sessionId: session.sessionId,
      text: 'Run the sole local MCP lifecycle fixture tool.',
    });
    await until(
      () => {
        if (failure) throw failure;
        return fsSync.existsSync(path.join(root, 'mcp-call-ready.json'));
      },
      'actual MCP tools/call',
      20000,
    );
    ready = JSON.parse(await fs.readFile(path.join(root, 'mcp-call-ready.json'), 'utf8'));
    const pids = [ready.serverPid, ready.middlePid, ready.leafPid];
    assert.ok(pids.every((pid) => Number.isSafeInteger(pid) && pid > 0 && alive(pid)));
    const cli = hub.sessions.get(session.sessionId).client._proc;
    const observer = exec(
      windowsPowerShellPath(),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(__dirname, 'read-process-ancestry.ps1'),
        String(ready.leafPid),
        String(cli.pid),
      ],
      { windowsHide: true, cwd: dirs.cwd, timeout: 10000 },
    );
    observer.child.stdin.end();
    report.ancestry = JSON.parse((await observer).stdout);
    assert.equal(report.ancestry.at(-1).ProcessId, cli.pid);
    assert.ok(report.ancestry.some((item) => item.ProcessId === ready.serverPid));
    await until(() => heldCompletion, 'local follow-up model request', 10000);
    const protocolRecords = (await fs.readFile(path.join(root, 'mcp-protocol.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    for (const method of ['initialize', 'notifications/initialized', 'tools/list', 'tools/call'])
      assert.ok(
        protocolRecords.some((item) => item.method === method),
        `Missing real MCP method: ${method}`,
      );
    report.mcp = {
      initialized: true,
      toolCalled: true,
      serverPid: ready.serverPid,
      middlePid: ready.middlePid,
      leafPid: ready.leafPid,
      allAliveBeforeCancel: true,
    };
    stage = 'cancel';
    await bounded(hub.cancel({ sessionId: session.sessionId }), 'cancel', 16000);
    report.cancel = {
      cliAlive: alive(cli.pid),
      serverAlive: alive(ready.serverPid),
      descendantsAlive: [alive(ready.middlePid), alive(ready.leafPid)],
      taskStatus: hub.listTasks()[0]?.lastTurn?.status,
    };
    stage = 'dispose';
    await bounded(hub.dispose(), 'dispose', 10000);
    const deadline = Date.now() + 5000;
    while (pids.some(alive) && Date.now() < deadline) await delay(50);
    report.dispose = {
      cliExited: cli.exitCode !== null || cli.signalCode !== null,
      remainingObservedPids: pids.filter(alive),
    };
    report.passed = report.dispose.cliExited && report.dispose.remainingObservedPids.length === 0;
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    report.failure = { stage, name: error.name, message: error.message };
    process.exitCode = 1;
  } finally {
    report.protocolMethods = (
      await fs.readFile(path.join(root, 'mcp-protocol.jsonl'), 'utf8').catch(() => '')
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    // Evidence is captured first. Cleanup cooperates through a fixture-only marker, never a stale PID.
    await fs.writeFile(path.join(root, 'stop-owned-fixture'), 'stop');
    if (hub) await bounded(hub.dispose(), 'cleanup dispose', 10000).catch(() => {});
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill();
    await until(
      () => children.every((child) => child.exitCode !== null || child.signalCode !== null),
      'CLI cleanup',
      10000,
    ).catch(() => {});
    const observedPids = [...new Set(report.protocolMethods.map((item) => item.pid))];
    await until(() => observedPids.every((pid) => !alive(pid)), 'fixture cleanup', 5000);
    report.cleanupObservedExited = observedPids.every((pid) => !alive(pid));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    report.authFileCreated = fsSync.existsSync(path.join(dirs.home, 'auth.json'));
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
    report.cleanup = { temporaryRootRemoved: true, loopbackClosed: true };
    await fs.mkdir(path.join(__dirname, '../test-results'), { recursive: true });
    await fs.writeFile(
      path.join(__dirname, '../test-results/cli-mcp-lifecycle.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(
      JSON.stringify(
        {
          version: report.version,
          mcp: report.mcp,
          cancel: report.cancel,
          dispose: report.dispose,
          passed: report.passed,
          failure: report.failure,
          methods: report.protocolMethods.map((item) => item.method),
          blockedProxyRequests: report.blockedProxyRequests,
          cleanup: report.cleanup,
        },
        null,
        2,
      ),
    );
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
