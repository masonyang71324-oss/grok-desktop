'use strict';
// A standalone ACP fixture for the real desktop transport. No account or network.
const fs = require('node:fs');
const readline = require('node:readline');
const { randomUUID } = require('node:crypto');
const stateFile = process.env.GROK_DESKTOP_MOCK_STATE;
const logFile = process.env.GROK_DESKTOP_MOCK_LOG;
const models = {
  currentModelId: 'mock-grok',
  availableModels: [
    {
      modelId: 'mock-grok',
      name: '本地模拟 Grok',
      _meta: {
        supportsReasoningEffort: true,
        reasoningEffort: 'medium',
        reasoningEfforts: [
          { id: 'low', label: 'Low' },
          { id: 'medium', label: 'Medium' },
          { id: 'high', label: 'High' },
        ],
      },
    },
  ],
};
const modes = {
  currentModeId: 'agent',
  availableModes: [
    { id: 'agent', name: 'Agent' },
    { id: 'ask', name: 'Ask' },
  ],
};
const commands = [
  { name: 'mock-permission', description: '模拟权限请求' },
  { name: 'mock-cancel', description: '等待取消' },
];
let state = { sessions: [], clientVersion: '' },
  activeSessionId = '',
  turn = null;
const permissions = new Map();
try {
  if (stateFile && fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
} catch {
  process.stderr.write('[mock] state_read_error\n');
  process.exit(1);
}
const save = () => {
  if (stateFile) fs.writeFileSync(stateFile, JSON.stringify(state));
};
const log = (type, method, status) => {
  if (logFile)
    fs.appendFileSync(
      logFile,
      JSON.stringify({ type, ...(method ? { method } : {}), ...(status ? { status } : {}) }) + '\n',
    );
};
const write = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const reply = (request, result) => write({ id: request.id, result });
const fail = (request, code) => write({ id: request.id, error: { code: -32602, message: code } });
const sessionFor = (id) => state.sessions.find((session) => session.sessionId === id);
function update(session, value, record = true) {
  if (record) {
    session.updates.push(value);
    session.updatedAt = new Date().toISOString();
    save();
  }
  write({ method: 'session/update', params: { sessionId: session.sessionId, update: value } });
}
function finish(stopReason = 'end_turn') {
  if (!turn) return;
  for (const timer of turn.timers) clearTimeout(timer);
  for (const [id, permission] of permissions) if (permission.turn === turn) permissions.delete(id);
  const current = turn;
  turn = null;
  reply(current.request, { stopReason });
  log('turn-end', null, stopReason);
}
function stream(session, parts) {
  const current = turn;
  parts.forEach((text, index) =>
    current.timers.push(
      setTimeout(
        () => {
          if (turn !== current) return;
          update(session, {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text },
          });
          if (index === parts.length - 1) finish();
        },
        90 * (index + 1),
      ),
    ),
  );
}
function receive(request) {
  if (!request.method) {
    const permission = permissions.get(request.id);
    if (!permission || permission.turn !== turn) return;
    permissions.delete(request.id);
    const outcome = request.result?.outcome;
    log(
      'permission-response',
      null,
      outcome?.outcome === 'selected' ? outcome.optionId : 'cancelled',
    );
    const allowed = outcome?.outcome === 'selected' && outcome.optionId === 'allow-once';
    update(permission.session, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'mock-tool',
      status: allowed ? 'completed' : 'failed',
      content: [],
    });
    stream(permission.session, [allowed ? '模拟操作已获准。' : '模拟操作未获准。']);
    return;
  }
  log('request', request.method);
  const params = request.params || {};
  if (request.method === 'initialize') {
    state.clientVersion = params.clientInfo?.version || '';
    save();
    reply(request, {
      protocolVersion: 1,
      agentInfo: { name: 'mock-grok', version: '0.0.0-test' },
      agentCapabilities: { loadSession: true, promptCapabilities: { embeddedContext: true } },
      _meta: { modelState: models, availableCommands: commands },
    });
    return;
  }
  if (request.method === '_x.ai/commands/list') {
    reply(request, { commands });
    return;
  }
  if (request.method === 'session/new') {
    const session = {
      sessionId: randomUUID(),
      cwd: params.cwd,
      title: `模拟会话 ${state.sessions.length + 1}`,
      updates: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.sessions.push(session);
    activeSessionId = session.sessionId;
    save();
    reply(request, { sessionId: session.sessionId, models, modes });
    return;
  }
  if (request.method === 'session/list') {
    reply(request, {
      sessions: state.sessions
        .filter(
          (session) =>
            (!params.cwd || session.cwd === params.cwd) &&
            (session.updates.length || session.sessionId === activeSessionId),
        )
        .map(({ sessionId, cwd, title, createdAt, updatedAt }) => ({
          sessionId,
          cwd,
          title,
          createdAt,
          updatedAt,
        })),
    });
    return;
  }
  if (request.method === 'session/cancel') {
    if (turn?.session.sessionId === params.sessionId) finish('cancelled');
    return;
  }
  const session = sessionFor(params.sessionId);
  if (
    [
      'session/load',
      'session/prompt',
      'session/set_model',
      'session/set_mode',
      '_x.ai/session/rename',
      '_x.ai/session/delete',
      '_x.ai/session/info',
      '_x.ai/session/usage',
    ].includes(request.method) &&
    !session
  ) {
    fail(request, 'mock_session_missing');
    return;
  }
  if (request.method === 'session/load') {
    activeSessionId = session.sessionId;
    for (const value of session.updates) update(session, value, false);
    reply(request, { models, modes });
    return;
  }
  if (request.method === 'session/prompt') {
    if (turn) {
      fail(request, 'mock_turn_busy');
      return;
    }
    const text = params.prompt
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join('\n');
    turn = { request, session, timers: [] };
    update(session, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text } });
    if (text.includes('MOCK_RENDER')) {
      update(session, {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: '这是一条固定的界面测试回复，展示代码和文件修改。\n\n```javascript\nconst greeting = "你好，Grok";\nconsole.log(greeting);\n```',
        },
      });
      update(session, {
        sessionUpdate: 'tool_call',
        toolCallId: 'mock-diff',
        title: '更新示例配置',
        kind: 'edit',
        status: 'completed',
        content: [
          {
            type: 'diff',
            path: 'fixture.txt',
            oldText: 'theme = "light"\nnotifications = false',
            newText: 'theme = "dark"\nnotifications = true',
          },
        ],
      });
      finish();
    } else if (text.includes('MOCK_PERMISSION')) {
      update(session, {
        sessionUpdate: 'tool_call',
        toolCallId: 'mock-tool',
        title: '读取模拟文件',
        kind: 'read',
        status: 'pending',
        rawInput: { path: 'fixture.txt' },
      });
      const id = randomUUID();
      permissions.set(id, { turn, session });
      write({
        id,
        method: 'session/request_permission',
        params: {
          sessionId: session.sessionId,
          toolCall: {
            toolCallId: 'mock-tool',
            title: '读取模拟文件',
            rawInput: { path: 'fixture.txt' },
          },
          options: [
            { optionId: 'allow-once', kind: 'allow_once', name: 'Yes, proceed' },
            {
              optionId: 'reject-once',
              kind: 'reject_once',
              name: 'No, tell Grok what to do differently',
            },
          ],
        },
      });
    } else if (text.includes('MOCK_CANCEL'))
      update(session, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '正在等待停止。' },
      });
    else stream(session, ['模拟流式响应：', '第一段。', '已完成。']);
    return;
  }
  if (request.method === 'session/set_model') {
    reply(request, { _meta: { model: { Ok: params.modelId } } });
    return;
  }
  if (request.method === 'session/set_mode') {
    reply(request, {});
    return;
  }
  if (request.method === '_x.ai/session/rename') {
    session.title = params.title;
    save();
    reply(request, { success: true });
    return;
  }
  if (request.method === '_x.ai/session/delete') {
    state.sessions = state.sessions.filter((item) => item !== session);
    save();
    reply(request, { success: true });
    return;
  }
  if (request.method === '_x.ai/session/info') {
    reply(request, {
      result: {
        sessionId: session.sessionId,
        cwd: session.cwd,
        model: 'mock-grok',
        messages: session.updates.length,
      },
    });
    return;
  }
  if (request.method === '_x.ai/session/usage') {
    reply(request, { usage: { inputTokens: 20, outputTokens: 10 } });
    return;
  }
  write({ id: request.id, error: { code: -32601, message: 'mock_method_not_found' } });
}
if (process.argv.includes('--version')) {
  process.stdout.write('mock-grok 0.0.0-test\n');
  process.exit(0);
}
readline
  .createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on('line', (line) => {
    if (!line.trim()) return;
    try {
      receive(JSON.parse(line));
    } catch {
      log('error', null, 'protocol_error');
      process.stderr.write('[mock] protocol_error\n');
      process.exit(1);
    }
  })
  .on('close', () => {
    if (turn) for (const timer of turn.timers) clearTimeout(timer);
    process.exit(0);
  });
