'use strict';
const { translate: t } = require('./i18n.cjs');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { randomUUID } = require('node:crypto');

const RPC_TIMEOUT = 30_000;
const SESSION_LOAD_TIMEOUT = 120_000;
const CANCEL_GRACE = 12_000;
const SESSION_STATE_METHODS = new Set([
  'initialize',
  'session/new',
  'session/load',
  'session/set_model',
  'session/set_mode',
  'session/set_config_option',
]);
const emptyModels = () => ({ currentModelId: '', availableModels: [] });
const copy = (value) => (value == null ? value : structuredClone(value));
const validId = (id) => typeof id === 'string' || typeof id === 'number';

class GrokClient {
  constructor({
    getExecutable,
    emit,
    spawnFn = spawn,
    clientVersion = require('../package.json').version,
  }) {
    this.getExecutable = getExecutable;
    this.emit = emit;
    this.spawnFn = spawnFn;
    this.clientVersion = clientVersion;
    this.connected = false;
    this.models = emptyModels();
    this.commands = [];
    this.capabilities = {};
    this.version = '';
    this.initializeResult = null;
    this.activeSessionId = null;
    this.activeTurn = null;
    this._proc = null;
    this._connecting = null;
    this._pending = new Map();
    this._permissions = new Map();
    this._sessions = new Map();
    this._nextId = 0;
    this._operation = null;
    this._loading = null;
  }

  async ensure() {
    if (this.connected) return this.initializeResult;
    if (this._connecting) return this._connecting;
    const connecting = this._connect();
    this._connecting = connecting;
    try {
      return await connecting;
    } finally {
      if (this._connecting === connecting) this._connecting = null;
    }
  }

  async _connect() {
    this.emit({ type: 'connection', state: 'connecting' });
    let child;
    try {
      child = this.spawnFn(this.getExecutable(), ['agent', '--no-leader', 'stdio'], {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this._proc = child;
      const decoder = new StringDecoder('utf8');
      let buffer = '',
        stderr = '';
      child.stdout.on('data', (chunk) => {
        if (this._proc !== child) return;
        buffer += decoder.write(chunk);
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          try {
            this._receive(JSON.parse(line));
          } catch (error) {
            this._fail(
              new Error(t('Grok ACP 协议错误：{message}', { message: error.message })),
              child,
            );
            return;
          }
        }
      });
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-3000);
      });
      child.stdin.on('error', (error) =>
        this._fail(
          new Error(t('无法向 Grok 写入请求：{message}', { message: error.message })),
          child,
        ),
      );
      child.on('error', (error) =>
        this._fail(new Error(t('无法启动 Grok：{message}', { message: error.message })), child),
      );
      child.on('exit', (code, signal) =>
        this._fail(
          new Error(
            t('Grok 进程已退出 ({code}){detail}', {
              code: signal || code,
              detail: stderr.trim() ? `: ${stderr.trim()}` : '',
            }),
          ),
          child,
        ),
      );
      const initialized = await this._request('initialize', {
        protocolVersion: 1,
        clientInfo: { name: 'grok-desktop', title: 'Grok Desktop', version: this.clientVersion },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
      if (this._proc !== child) throw new Error(t('Grok 连接已关闭'));
      if (initialized.protocolVersion !== 1)
        throw new Error(
          t('不支持 ACP 协议版本 {version}', { version: initialized.protocolVersion }),
        );
      this.initializeResult = copy(initialized);
      this.capabilities = copy(initialized.agentCapabilities || {});
      this.version = initialized.agentInfo?.version || initialized._meta?.agentVersion || '';
      this.models = copy(initialized.models || initialized._meta?.modelState || emptyModels());
      this.commands = copy(initialized._meta?.availableCommands || []);
      this.connected = true;
      await this._discoverCommands();
      this.emit({ type: 'models', models: copy(this.models) });
      this.emit({ type: 'connection', state: 'ready' });
      return copy(initialized);
    } catch (error) {
      if (child && this._proc === child) this._fail(error, child);
      else if (!child) this.emit({ type: 'connection', state: 'error', message: error.message });
      throw error;
    }
  }

  _write(message) {
    if (!this._proc || this._proc.stdin.destroyed) throw new Error(t('Grok 尚未连接，请重试'));
    this._proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  _request(method, params, timeout = RPC_TIMEOUT) {
    const id = `desktop-${++this._nextId}`;
    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => {
            const error = new Error(t('Grok 请求超时：{method}。请重新连接后重试。', { method }));
            if (SESSION_STATE_METHODS.has(method)) this._fail(error);
            else {
              this._pending.delete(id);
              reject(error);
            }
          }, timeout)
        : null;
      this._pending.set(id, { resolve, reject, timer, method });
      try {
        this._write({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this._pending.delete(id);
        reject(error);
      }
    });
  }

  _receive(message) {
    if (!message || message.jsonrpc !== '2.0' || Array.isArray(message))
      throw new Error(t('收到无效 JSON-RPC 消息'));
    if (message.method) {
      if (validId(message.id)) this._serverRequest(message);
      else this._notification(message.method, message.params || {});
      return;
    }
    if (!validId(message.id)) throw new Error(t('响应缺少请求 ID'));
    const pending = this._pending.get(message.id);
    if (!pending) return;
    if (!Object.hasOwn(message, 'result') && !message.error)
      throw new Error(t('响应缺少 result 或 error'));
    this._pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      const error = new Error(
        message.error.message || t('Grok 请求失败：{method}', { method: pending.method }),
      );
      error.code = message.error.code;
      error.data = message.error.data;
      pending.reject(error);
    } else pending.resolve(message.result);
  }

  _notification(method, params) {
    if (method === '_x.ai/session_notification' && params.update) {
      if (this._loading?.sessionId === params.sessionId) this._loading.updates.push(params.update);
      else {
        this._applyUpdate(params.sessionId, params.update);
        this.emit({
          type: 'notification',
          sessionId: params.sessionId,
          kind: params.update.sessionUpdate,
          payload: copy(params.update),
        });
      }
      return;
    }
    if (method !== 'session/update') {
      this.emit({
        type: 'notification',
        sessionId: params.sessionId,
        kind: method === '_x.ai/git/worktree/status' ? 'worktree-status' : method,
        payload: copy(params),
      });
      return;
    }
    const { sessionId, update } = params;
    if (typeof sessionId !== 'string' || !update || typeof update.sessionUpdate !== 'string')
      throw new Error(t('session/update 内容不完整'));
    // Parsed notifications are owned by this transport. Snapshot construction
    // copies replay once; publishing separately protects it from callers.
    if (this._loading?.sessionId === sessionId) {
      this._loading.updates.push(update);
      return;
    }
    this._applyUpdate(sessionId, update);
    // Live user chunks echo the prompt already inserted by the renderer.
    if (this.activeTurn?.sessionId === sessionId && update.sessionUpdate === 'user_message_chunk')
      return;
    this.emit({
      type: 'update',
      sessionId,
      ...(this.activeTurn?.sessionId === sessionId ? { turnId: this.activeTurn.turnId } : {}),
      update: copy(update),
    });
  }

  _applyUpdate(sessionId, update, emit = true) {
    const session = this._sessions.get(sessionId);
    if (
      update.sessionUpdate === 'available_commands_update' &&
      Array.isArray(update.availableCommands)
    ) {
      if (session) session.commands = copy(update.availableCommands);
      if (sessionId === this.activeSessionId) this.commands = copy(update.availableCommands);
      if (emit)
        this.emit({ type: 'commands', sessionId, commands: copy(update.availableCommands) });
    }
    if (update.sessionUpdate === 'current_mode_update' && session?.modes)
      session.modes.currentModeId = update.currentModeId;
    if (update.sessionUpdate === 'config_option_update' && session)
      session._meta = { ...session._meta, configOptions: copy(update.configOptions) };
    if (update.sessionUpdate === 'model_changed' && session && update.model_id) {
      session.models.currentModelId = update.model_id;
      this._mergeModel(session, {
        modelId: update.model_id,
        ...(update.reasoning_effort ? { _meta: { reasoningEffort: update.reasoning_effort } } : {}),
      });
      if (sessionId === this.activeSessionId) this.models = copy(session.models);
      if (emit) this.emit({ type: 'models', sessionId, models: copy(session.models) });
    }
  }

  _mergeModel(session, model) {
    const index = session.models.availableModels.findIndex(
      (item) => item.modelId === model.modelId,
    );
    if (index < 0) session.models.availableModels.push(copy(model));
    else {
      const existing = session.models.availableModels[index];
      session.models.availableModels[index] = {
        ...existing,
        ...copy(model),
        _meta: { ...existing._meta, ...copy(model._meta) },
      };
    }
  }

  _serverRequest({ id, method, params = {} }) {
    if (method !== 'session/request_permission') {
      this._write({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Client method not implemented: ${method}` },
      });
      return;
    }
    if (!params.sessionId || !Array.isArray(params.options))
      throw new Error(t('权限请求缺少会话或选项'));
    if (this._permissions.has(id)) throw new Error(t('重复的权限请求 ID'));
    const turn = this.activeTurn?.sessionId === params.sessionId ? this.activeTurn : null;
    this._permissions.set(id, {
      sessionId: params.sessionId,
      turnId: turn?.turnId,
      params: copy(params),
    });
    this.emit({
      type: 'permission',
      requestId: id,
      sessionId: params.sessionId,
      ...(turn ? { turnId: turn.turnId } : {}),
      params: copy(params),
    });
    if (turn?.cancelling) {
      this.respondPermission({ requestId: id, cancelled: true });
      return;
    }
    if (turn && this._sessions.get(params.sessionId)?.permissionMode === 'auto') {
      const option = params.options.find((item) => item.kind === 'allow_once');
      if (option) this.respondPermission({ requestId: id, optionId: option.optionId });
    }
  }

  setPermissionMode({ sessionId, permissionMode }) {
    if (permissionMode !== 'ask' && permissionMode !== 'auto')
      throw new Error(t('请选择有效的权限模式：ask 或 auto。'));
    const session = this._session(sessionId);
    session.permissionMode = permissionMode;
    return { sessionId, permissionMode };
  }

  respondPermission({ requestId, optionId, cancelled = false }) {
    const permission = this._permissions.get(requestId);
    if (!permission) throw new Error(t('此权限请求已处理或已失效'));
    if (!cancelled && !permission.params.options.some((option) => option.optionId === optionId))
      throw new Error(t('请选择有效的权限选项'));
    this._write({
      jsonrpc: '2.0',
      id: requestId,
      result: { outcome: cancelled ? { outcome: 'cancelled' } : { outcome: 'selected', optionId } },
    });
    this._permissions.delete(requestId);
    this.emit({ type: 'permission-resolved', requestId, sessionId: permission.sessionId });
  }

  _clearPermissions(sessionId, write = true) {
    for (const [requestId, permission] of this._permissions) {
      if (sessionId && permission.sessionId !== sessionId) continue;
      if (write && this._proc) {
        try {
          this._write({
            jsonrpc: '2.0',
            id: requestId,
            result: { outcome: { outcome: 'cancelled' } },
          });
        } catch {}
      }
      this._permissions.delete(requestId);
      this.emit({ type: 'permission-resolved', requestId, sessionId: permission.sessionId });
    }
  }

  _fail(error, child = this._proc, state = 'error') {
    if (child && child !== this._proc) return;
    this._proc = null;
    this.connected = false;
    this._clearPermissions(null, false);
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this._pending.clear();
    if (this.activeTurn) this._finishTurn(this.activeTurn, null, error);
    this.activeSessionId = null;
    this._sessions.clear();
    this.models = emptyModels();
    this.commands = [];
    this.capabilities = {};
    this.initializeResult = null;
    if (child) {
      try {
        child.kill();
      } catch {}
    }
    this.emit({ type: 'connection', state, message: error.message });
  }

  async restart() {
    this._assertIdle();
    const connecting = this._connecting;
    this.dispose();
    if (connecting) await connecting.catch(() => {});
    return this.ensure();
  }

  dispose() {
    if (this._proc || this.activeTurn || this._pending.size)
      this._fail(new Error(t('Grok 连接已关闭')), this._proc, 'disconnected');
  }

  _assertIdle() {
    if (this.activeTurn) throw new Error(t('当前任务正在运行，请先等待完成或停止任务。'));
    if (this._operation) throw new Error(t('正在切换或设置会话，请稍后重试。'));
  }

  async _exclusive(name, action) {
    this._assertIdle();
    this._operation = name;
    try {
      await this.ensure();
      return await action();
    } finally {
      this._operation = null;
    }
  }

  _session(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session || sessionId !== this.activeSessionId)
      throw new Error(t('此会话尚未载入，请先打开该会话后重试。'));
    return session;
  }

  _snapshot(sessionId, cwd, result, updates = [], permissionMode = 'ask') {
    const session = {
      sessionId,
      cwd,
      models: copy(result.models || result._meta?.modelState || this.models),
      commands: copy(result.commands || result._meta?.availableCommands || this.commands),
      updates: copy(updates),
      ...(result.modes ? { modes: copy(result.modes) } : {}),
      _meta: copy(result._meta || {}),
      permissionMode,
    };
    this._sessions.set(sessionId, session);
    this.activeSessionId = sessionId;
    for (const update of updates) this._applyUpdate(sessionId, update, false);
    this.models = copy(session.models);
    this.commands = copy(session.commands);
    return session;
  }

  _publishSession(session) {
    this.emit({ type: 'models', sessionId: session.sessionId, models: copy(session.models) });
    this.emit({ type: 'commands', sessionId: session.sessionId, commands: copy(session.commands) });
    return copy(session);
  }

  async newSession(payload) {
    return this._exclusive('new', async () => {
      const result = await this._request('session/new', {
        cwd: payload.cwd,
        mcpServers: [],
        _meta: { yoloMode: false, autoMode: false },
      });
      if (!result?.sessionId) throw new Error(t('Grok 未返回新会话 ID'));
      const session = this._snapshot(
        result.sessionId,
        payload.cwd,
        result,
        [],
        payload.permissionMode === 'auto' ? 'auto' : 'ask',
      );
      await this._configure({ ...payload, sessionId: result.sessionId });
      await this._discoverCommands(payload.cwd, result.sessionId);
      this.emit({ type: 'sessions-changed', sessionId: result.sessionId });
      return this._publishSession(session);
    });
  }

  async loadSession({ cwd, sessionId }) {
    return this._exclusive('load', async () => {
      this._loading = { sessionId, updates: [] };
      try {
        const result = await this._request(
          'session/load',
          { sessionId, cwd, mcpServers: [], _meta: { yoloMode: false, autoMode: false } },
          SESSION_LOAD_TIMEOUT,
        );
        const permissionMode = this._sessions.get(sessionId)?.permissionMode || 'ask';
        const session = this._snapshot(
          sessionId,
          cwd,
          result,
          this._loading.updates,
          permissionMode,
        );
        await this._discoverCommands(cwd, sessionId);
        return this._publishSession(session);
      } finally {
        this._loading = null;
      }
    });
  }

  async configure(payload) {
    return this._exclusive('configure', async () => {
      await this._configure(payload);
      const session = this._session(payload.sessionId);
      return {
        models: copy(session.models),
        ...(session.modes ? { modes: copy(session.modes) } : {}),
      };
    });
  }

  async _configure({ sessionId, modelId, effort, modeId }) {
    const session = this._session(sessionId);
    const targetModelId = modelId || session.models.currentModelId;
    const model = session.models.availableModels.find((item) => item.modelId === targetModelId);
    if (modelId && session.models.availableModels.length && !model)
      throw new Error(t('当前 Grok 版本未提供所选模型'));
    if (effort && model?._meta?.supportsReasoningEffort === false)
      throw new Error(t('所选模型不支持推理强度'));
    if (
      effort &&
      model?._meta?.reasoningEfforts?.length &&
      !model._meta.reasoningEfforts.some((item) => item.id === effort || item.value === effort)
    )
      throw new Error(t('所选模型不支持此推理强度'));
    const currentModel = session.models.availableModels.find(
      (item) => item.modelId === session.models.currentModelId,
    );
    if (
      targetModelId &&
      (targetModelId !== session.models.currentModelId ||
        (effort && effort !== currentModel?._meta?.reasoningEffort))
    ) {
      const result = await this._request('session/set_model', {
        sessionId,
        modelId: targetModelId,
        ...(effort ? { _meta: { reasoningEffort: effort } } : {}),
      });
      const modelResult = result?._meta?.model;
      if (modelResult && Object.hasOwn(modelResult, 'Err')) {
        const error = modelResult.Err;
        throw new Error(
          typeof error === 'string' ? error : error?.message || JSON.stringify(error),
        );
      }
      session.models = copy(result?.models || result?._meta?.modelState || session.models);
      session.models.currentModelId =
        typeof modelResult?.Ok === 'string' ? modelResult.Ok : targetModelId;
      const selected = session.models.availableModels.find(
        (item) => item.modelId === session.models.currentModelId,
      );
      if (selected && effort) selected._meta = { ...selected._meta, reasoningEffort: effort };
      this.models = copy(session.models);
      this.emit({ type: 'models', sessionId, models: copy(session.models) });
    }
    if (modeId && modeId !== session.modes?.currentModeId) {
      if (!session.modes?.availableModes?.some((mode) => mode.id === modeId))
        throw new Error(t('当前会话未提供所选模式'));
      await this._request('session/set_mode', { sessionId, modeId });
      session.modes.currentModeId = modeId;
    }
  }

  async _promptContent(text, attachments) {
    return require('./attachments.cjs').preparePrompt(
      text,
      attachments,
      this.capabilities.promptCapabilities,
    );
  }

  async send(payload) {
    return this._exclusive('send', async () => {
      this._session(payload.sessionId);
      if (payload.permissionMode !== undefined) this.setPermissionMode(payload);
      const prompt = await this._promptContent(payload.text, payload.attachments);
      await this._configure(payload);
      let finish;
      const done = new Promise((resolve) => {
        finish = resolve;
      });
      const turn = {
        sessionId: payload.sessionId,
        turnId: randomUUID(),
        done,
        finish,
        cancelling: false,
        cancelTimer: null,
      };
      this.activeTurn = turn;
      this.emit({ type: 'turn-start', sessionId: turn.sessionId, turnId: turn.turnId });
      this._request('session/prompt', { sessionId: payload.sessionId, prompt }, 0).then(
        (result) => this._finishTurn(turn, result),
        (error) => this._finishTurn(turn, null, error),
      );
      return { turnId: turn.turnId };
    });
  }

  _finishTurn(turn, result, error) {
    if (this.activeTurn !== turn) return;
    clearTimeout(turn.cancelTimer);
    this._clearPermissions(turn.sessionId);
    this.activeTurn = null;
    if (error)
      this.emit({
        type: 'turn-error',
        sessionId: turn.sessionId,
        turnId: turn.turnId,
        message: error.message,
      });
    else this.emit({ type: 'turn-end', sessionId: turn.sessionId, turnId: turn.turnId, result });
    this.emit({ type: 'sessions-changed', sessionId: turn.sessionId });
    turn.finish();
  }

  async cancel({ sessionId }) {
    const turn = this.activeTurn;
    if (!turn) return;
    if (turn.sessionId !== sessionId) throw new Error(t('所选会话没有正在运行的任务'));
    if (!turn.cancelling) {
      turn.cancelling = true;
      this._write({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
      this._clearPermissions(sessionId);
      turn.cancelTimer = setTimeout(() => {
        if (this.activeTurn === turn)
          this._fail(
            new Error(
              t(
                'Grok 未在停止请求后结束。本应用的独立进程已终止，任务被中断；重新打开会话即可继续。',
              ),
            ),
          );
      }, CANCEL_GRACE);
    }
    await turn.done;
  }

  async _discoverCommands(cwd, sessionId) {
    try {
      const result = await this._request('_x.ai/commands/list', cwd ? { cwd } : {});
      if (Array.isArray(result?.commands)) {
        this.commands = copy(result.commands);
        const session = this._sessions.get(sessionId);
        if (session) session.commands = copy(result.commands);
      }
    } catch (error) {
      if (!this.connected) throw error;
      this.emit({
        type: 'notification',
        sessionId,
        kind: 'commands-unavailable',
        payload: { message: error.message },
      });
    }
    this.emit({
      type: 'commands',
      ...(sessionId ? { sessionId } : {}),
      commands: copy(this.commands),
    });
    return copy(this.commands);
  }

  async getCommands() {
    await this.ensure();
    const session = this._sessions.get(this.activeSessionId);
    return this._discoverCommands(session?.cwd, session?.sessionId);
  }

  // Main process services whitelist extension methods; this is never exposed as raw renderer IPC.
  async extension(method, params = {}) {
    await this.ensure();
    return this._request(method, params);
  }

  async listSessions({ cwd }) {
    await this.ensure();
    const sessions = [],
      cursors = new Set();
    let cursor;
    do {
      const result = await this._request('session/list', { cwd, ...(cursor ? { cursor } : {}) });
      for (const item of result.sessions || []) {
        const sessionId = item.sessionId || item.id;
        if (!sessionId) continue;
        sessions.push({
          sessionId,
          cwd: item.cwd || cwd,
          title: item.title || '',
          ...(item.updatedAt ? { updatedAt: item.updatedAt } : {}),
          ...(item.createdAt ? { createdAt: item.createdAt } : {}),
        });
      }
      cursor = result.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error(t('Grok 会话列表返回了重复分页标记'));
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return sessions;
  }

  async usage({ sessionId, cwd }) {
    await this.ensure();
    const info = await this._request('_x.ai/session/info', { sessionId, ...(cwd ? { cwd } : {}) });
    if (info?.error != null)
      throw new Error(
        typeof info.error === 'string'
          ? info.error
          : info.error.message || JSON.stringify(info.error),
      );
    let usage = null,
      usageError;
    try {
      usage = await this._request('_x.ai/session/usage', { sessionId });
    } catch (error) {
      usageError = error.message;
    }
    return {
      info: info?.result ?? null,
      usage: usage?.usage ?? null,
      ...(usageError ? { usageError } : {}),
    };
  }

  async rename({ sessionId, cwd, title }) {
    if (!title?.trim()) throw new Error(t('会话标题不能为空'));
    await this.ensure();
    const result = await this._request('_x.ai/session/rename', {
      sessionId,
      title: title.trim(),
      ...(cwd ? { cwd } : {}),
    });
    if (result?.success !== true) throw new Error(t('Grok 未确认会话已重命名'));
    this.emit({ type: 'sessions-changed', sessionId });
  }

  async deleteSession({ sessionId, cwd }) {
    return this._exclusive('delete', async () => {
      const result = await this._request('_x.ai/session/delete', {
        sessionId,
        ...(cwd ? { cwd } : {}),
      });
      if (result?.success !== true) throw new Error(t('Grok 未确认会话已删除'));
      this._sessions.delete(sessionId);
      if (this.activeSessionId === sessionId) this.activeSessionId = null;
      this.emit({ type: 'sessions-changed', sessionId });
    });
  }
}
module.exports = { GrokClient };
