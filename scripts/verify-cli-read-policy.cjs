'use strict';
// Official ACP metadata only, backed by a deterministic loopback model.
// Every permission is cancelled: this probe never authorizes tool execution.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { GrokClient } = require('../electron/acp.cjs');
const exec = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label) {
  const start = Date.now();
  while (!predicate()) {
    assert.ok(Date.now() - start < 30000, `Timed out: ${label}`);
    await delay(30);
  }
}
async function main() {
  const executable = path.resolve(process.argv[2] || 'test-results/cli-install-probe/grok.exe');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-read-policy-'));
  const dirs = Object.fromEntries(
    ['profile', 'home', 'roaming', 'local', 'tmp', 'cwd'].map((name) => [
      name,
      path.join(root, name),
    ]),
  );
  await Promise.all(Object.values(dirs).map((dir) => fs.mkdir(dir)));
  await fs.writeFile(path.join(dirs.cwd, 'fixture.txt'), 'LOCAL_READ_POLICY_FIXTURE\n');
  const stages = [
    { name: 'read_file', args: { target_file: 'fixture.txt', offset: 1, limit: 5 } },
    { name: 'grep', args: { pattern: 'LOCAL_READ_POLICY_FIXTURE', path: '.' } },
    { name: 'list_dir', args: { target_directory: '.' } },
    {
      name: 'run_terminal_command',
      args: { command: 'echo LOCAL_READ_POLICY_FIXTURE', description: 'Read fixture' },
    },
  ];
  const report = {
    checkedAt: new Date().toISOString(),
    scope: 'Official CLI / synthetic loopback model / synthetic project; all permissions cancelled',
    requests: [],
    blockedProxyRequests: [],
    permissions: [],
    tools: {},
    cleaned: false,
  };
  let stage,
    emitted = false,
    failure;
  const children = [];
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.hostname !== '127.0.0.1') {
        report.blockedProxyRequests.push({ method: request.method, host: url.hostname });
        response.writeHead(502);
        response.end('{}');
        return;
      }
      if (request.method === 'GET' && url.pathname.endsWith('/models')) {
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
        response.writeHead(404);
        response.end('{}');
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(input.model, 'local-audit');
      assert.equal(request.headers.authorization, 'Bearer audit-fake-local-key');
      const isTurn = input.tools?.some((tool) => tool.function?.name === 'run_terminal_command');
      report.requests.push({ model: input.model, path: url.pathname, stage: stage?.name, isTurn });
      let toolCall;
      if (isTurn && !emitted) {
        for (const tool of input.tools) {
          if (stages.some((item) => item.name === tool.function?.name))
            report.tools[tool.function.name] = tool.function.parameters;
        }
        assert.ok(report.tools[stage.name], `Official tool missing: ${stage.name}`);
        emitted = true;
        toolCall = {
          id: `probe-${stage.name}`,
          type: 'function',
          function: { name: stage.name, arguments: JSON.stringify(stage.args) },
        };
      }
      const content = isTurn ? 'LOCAL_READ_POLICY_DONE' : 'Local fixture';
      if (input.stream) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunk = (delta, finish_reason = null) =>
          response.write(
            `data: ${JSON.stringify({
              id: 'local-read-policy',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'local-audit',
              choices: [{ index: 0, delta, finish_reason }],
            })}\n\n`,
          );
        chunk({ role: 'assistant', content: '' });
        chunk(toolCall ? { tool_calls: [{ index: 0, ...toolCall }] } : { content });
        chunk({}, toolCall ? 'tool_calls' : 'stop');
        response.end('data: [DONE]\n\n');
      } else {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            id: 'local-read-policy',
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
[permission]
ask = ["*"]
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
  let client;
  try {
    report.version = (
      await exec(executable, ['--version'], {
        env,
        cwd: dirs.cwd,
        windowsHide: true,
        timeout: 10000,
      })
    ).stdout.trim();
    client = new GrokClient({
      getExecutable: () => executable,
      spawnFn: (exe, args, options) => {
        const child = spawn(exe, args, { ...options, env, cwd: dirs.cwd });
        children.push(child);
        return child;
      },
      emit: (event) => {
        if (event.type === 'permission') {
          report.permissions.push({ stage: stage.name, params: event.params });
          client.respondPermission({ requestId: event.requestId, cancelled: true });
        }
        if (event.type === 'turn-error') failure = Error(event.message);
      },
    });
    for (stage of stages) {
      emitted = false;
      const session = await client.newSession({
        cwd: dirs.cwd,
        modelId: 'local-audit',
        permissionMode: 'ask',
      });
      await client.send({
        sessionId: session.sessionId,
        text: `LOCAL_READ_POLICY_${stage.name}: synthetic tool metadata fixture.`,
      });
      await until(() => !client.activeTurn, stage.name);
      if (failure) throw failure;
      assert.ok(
        report.permissions.some((item) => item.stage === stage.name),
        `No permission: ${stage.name}`,
      );
    }
    report.passed = true;
  } finally {
    client?.dispose();
    await until(
      () => children.every((child) => child.exitCode !== null || child.signalCode !== null),
      'owned CLI exits',
    );
    await new Promise((resolve) => server.close(resolve));
    // root was created by this script; never remove caller-supplied paths.
    await fs.rm(root, { recursive: true, force: true });
    report.cleaned = true;
    await fs.mkdir(path.join(__dirname, '../test-results'), { recursive: true });
    await fs.writeFile(
      path.join(__dirname, '../test-results/cli-read-policy.json'),
      JSON.stringify(report, null, 2),
    );
  }
  console.log(
    JSON.stringify({
      version: report.version,
      passed: report.passed,
      permissions: report.permissions.length,
      cleaned: report.cleaned,
      blockedProxyRequests: report.blockedProxyRequests,
    }),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
