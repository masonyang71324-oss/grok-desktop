'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { GrokClient } = require('./acp.cjs');
const { RuntimeActivity } = require('./background.cjs');
const { translate: t } = require('./i18n.cjs');
const { readJsonWithRecovery, assertJsonWritable, isObject } = require('./json-recovery.cjs');
const copy = (value) => structuredClone(value);

function validQueueItem(item) {
  return (
    isObject(item) &&
    typeof item.id === 'string' &&
    isObject(item.payload) &&
    (item.payload.text === undefined || typeof item.payload.text === 'string') &&
    (item.payload.attachments === undefined ||
      (Array.isArray(item.payload.attachments) && item.payload.attachments.every(isObject)))
  );
}

function validSavedQueue(records) {
  return (
    Array.isArray(records) &&
    records.every(
      (saved) =>
        isObject(saved) &&
        typeof saved.sessionId === 'string' &&
        !!saved.sessionId &&
        typeof saved.cwd === 'string' &&
        !!saved.cwd &&
        (saved.queue === undefined ||
          (Array.isArray(saved.queue) && saved.queue.every(validQueueItem))) &&
        (saved.active == null || validQueueItem(saved.active)) &&
        (saved.lastTurn === undefined || isObject(saved.lastTurn)),
    )
  );
}

function isIdleEntry(entry) {
  const client = entry.client;
  return !!(
    client.connected &&
    entry.snapshot &&
    entry.status === 'idle' &&
    !entry.running &&
    !entry.control &&
    !entry.loading &&
    !entry.reactivating &&
    !entry.backgroundDone &&
    !entry.queue.length &&
    !entry.permissions.size &&
    !entry.activity.busy &&
    !entry.activity.background.size &&
    !client.activeTurn &&
    !client._operation &&
    !client._loading &&
    !client._connecting &&
    !client._pending?.size &&
    !client._permissions?.size
  );
}

// One transport per owned conversation. The catalog connection never runs prompts.
class SessionHub {
  constructor({
    emit,
    createClient,
    storageFile,
    beforeTurn,
    afterTurn,
    maxIdleConnections = 3,
    ...options
  }) {
    this.emit = emit;
    this.createClient =
      createClient || ((publish) => new GrokClient({ ...options, emit: publish }));
    this.storageFile = storageFile;
    this.beforeTurn = beforeTurn;
    this.afterTurn = afterTurn;
    this.sessions = new Map();
    this.locks = new Map();
    this.closed = false;
    this.pending = new Set();
    this.maxIdleConnections = maxIdleConnections;
    this.activeSessionId = null;
    this.recoveryWarnings = [];
    this.catalog = this.createClient(emit);
    if (storageFile) {
      const records = readJsonWithRecovery(storageFile, {
        kind: 'queue',
        isValid: validSavedQueue,
        onRecovery: (warning) => this.recoveryWarnings.push(warning),
      });
      if (records) {
        this.lastPersistedData = JSON.stringify(records);
        for (const saved of records) {
          const entry = this._entry(saved.sessionId, saved.cwd);
          entry.title = saved.title || '';
          entry.queue = saved.queue || [];
          entry.lastTurn = saved.lastTurn;
          entry.paused = !!(saved.active || entry.queue.length || saved.status === 'interrupted');
          entry.status =
            saved.active || saved.status === 'interrupted'
              ? 'interrupted'
              : entry.paused
                ? 'paused'
                : 'idle';
          if (saved.active) {
            // A disconnect can persist both the active turn and its returned queue item.
            entry.queue = entry.queue.filter((item) => item.id !== saved.active.id);
            entry.queue.unshift({ ...saved.active, queued: true, interrupted: true });
          }
        }
      }
    }
  }

  get activeTurn() {
    return [...this.sessions.values()].find((entry) => entry.running)?.running || null;
  }
  get connected() {
    return this.catalog.connected;
  }
  get version() {
    return this.catalog.version;
  }
  get models() {
    return this.catalog.models;
  }
  get commands() {
    return this.catalog.commands;
  }
  get capabilities() {
    return this.catalog.capabilities;
  }
  ensure() {
    return this.catalog.ensure();
  }
  getCommands() {
    return this.catalog.getCommands();
  }

  _entry(sessionId, cwd) {
    const entry = {
      sessionId,
      cwd,
      title: '',
      queue: [],
      permissions: new Map(),
      status: 'idle',
      connection: 'disconnected',
      paused: false,
      snapshot: null,
      running: null,
      lastUsed: Date.now(),
      activity: new RuntimeActivity({ isForegroundBusy: () => false }),
    };
    entry.client = this.createClient((event) => this._event(entry, event));
    if (sessionId) this.sessions.set(sessionId, entry);
    return entry;
  }

  _get(sessionId) {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(t('此会话尚未载入，请先打开该会话后重试。'));
    entry.lastUsed = Date.now();
    return entry;
  }

  setActiveSession(sessionId) {
    this.activeSessionId = sessionId || null;
    const entry = this.sessions.get(sessionId);
    if (entry) entry.lastUsed = Date.now();
  }

  collectIdle({
    protectSessionId = this.activeSessionId,
    maxIdleConnections = this.maxIdleConnections,
  } = {}) {
    if (this.closed) return [];
    const candidates = [...this.sessions.values()]
      .filter(isIdleEntry)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    const sleeping = [];
    let excess = candidates.length - Math.max(0, maxIdleConnections);
    for (const entry of candidates) {
      if (excess <= 0) break;
      if (entry.sessionId === protectSessionId) continue;
      entry.sleepingCapabilities = copy(entry.client.capabilities || {});
      entry.evicting = true;
      try {
        entry.client.dispose();
      } finally {
        entry.evicting = false;
      }
      entry.connection = 'sleeping';
      this.emit({ type: 'connection', sessionId: entry.sessionId, state: 'sleeping' });
      sleeping.push(entry.sessionId);
      excess--;
    }
    if (sleeping.length) this._changed();
    return sleeping;
  }

  _key(cwd) {
    const key = path.resolve(cwd);
    return process.platform === 'win32' ? key.toLowerCase() : key;
  }

  _persist() {
    if (!this.storageFile || this.closed) return;
    assertJsonWritable(this.storageFile);
    const records = [...this.sessions.values()]
      .filter((entry) => entry.queue.length || entry.running || entry.lastTurn)
      .map((entry) => ({
        sessionId: entry.sessionId,
        cwd: entry.cwd,
        title: entry.title,
        status: entry.status,
        queue: entry.queue,
        active: entry.running?.item,
        lastTurn: entry.lastTurn,
      }));
    const data = JSON.stringify(records);
    if (data === this.lastPersistedData) return;
    fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });
    fs.writeFileSync(`${this.storageFile}.tmp`, data, { encoding: 'utf8', flush: true });
    fs.renameSync(`${this.storageFile}.tmp`, this.storageFile);
    this.lastPersistedData = data;
  }

  _changed() {
    try {
      this._persist();
    } catch (error) {
      this.emit({
        type: 'notification',
        kind: 'queue-save-error',
        payload: { message: error.message },
      });
    }
    this.emit({ type: 'tasks-changed', tasks: this.listTasks() });
  }

  _runtime(entry) {
    const foreground = entry.control || entry.running;
    return {
      status: entry.status,
      connection: entry.connection,
      turnId: foreground?.finishing ? undefined : foreground?.turnId,
      finishing: !!entry.running?.finishing,
      startedAt: entry.running?.startedAt || foreground?.startedAt,
      lastTurn: entry.lastTurn,
      activeTurnStartIndex: foreground?.activeTurnStartIndex,
      queued: entry.queue.map(({ id, payload, createdAt, interrupted }) => ({
        id,
        text: payload.text || '',
        attachments: (payload.attachments || []).map(({ name, path, kind }) => ({
          name,
          path,
          kind,
        })),
        createdAt,
        ...(interrupted ? { interrupted: true } : {}),
      })),
      error: entry.error,
      permissions: [...entry.permissions.values()],
      capabilities: copy(entry.sleepingCapabilities || entry.client.capabilities || {}),
    };
  }

  listTasks() {
    return copy(
      [...this.sessions.values()].map((entry) => ({
        sessionId: entry.sessionId,
        cwd: entry.cwd,
        title: entry.title,
        ...this._runtime(entry),
      })),
    );
  }

  _snapshot(entry) {
    return copy({ ...entry.snapshot, runtime: this._runtime(entry) });
  }

  _event(entry, original) {
    // An intentional resource sleep is normal, not a CLI transport failure.
    if (entry.evicting && original.type === 'connection') return;
    entry.lastUsed = Date.now();
    const event = { ...original, ...(entry.sessionId ? { sessionId: entry.sessionId } : {}) };
    const foreground = entry.control || entry.running;
    // Future schedules do not write now; active tasks, subagents and workflows do.
    if (!['scheduled_task_created', 'scheduled_task_deleted'].includes(event.kind))
      entry.activity.onEvent(event);
    if (!entry.activity.background.size && entry.backgroundDone) {
      entry.backgroundDone();
      entry.backgroundDone = null;
    }
    if (event.type === 'turn-start' && foreground) {
      foreground.accepted = true;
      event.startedAt = foreground.startedAt;
      event.text = foreground.item.payload.text || '';
      event.attachments = copy(foreground.item.payload.attachments || []);
      if (foreground.item.queued) event.queueId = foreground.item.id;
    }
    if (event.turnId && foreground) event.turnId = foreground.turnId;
    if (event.type === 'session')
      entry.snapshot = copy(event.session || event.snapshot || entry.snapshot);
    if (event.type === 'connection') {
      entry.connection = event.state;
      if (['error', 'disconnected'].includes(event.state)) {
        entry.paused = true;
        entry.error = event.message;
        if (entry.running) {
          entry.interrupted = true;
          if (
            entry.running.accepted &&
            !entry.queue.some((item) => item.id === entry.running.item.id)
          )
            entry.queue.unshift({ ...entry.running.item, queued: true, interrupted: true });
        }
        entry.status = entry.running ? 'interrupted' : 'error';
        entry.permissions.clear();
      }
    }
    if (event.type === 'permission') {
      entry.permissions.set(event.requestId, copy(event));
      entry.status = 'waiting';
    }
    if (event.type === 'permission-resolved') {
      entry.permissions.delete(event.requestId);
      if (entry.running && !entry.permissions.size) entry.status = 'running';
    }
    if (event.type === 'update' && foreground) {
      event.update = { ...event.update, _desktopTurnId: foreground.turnId };
      const update = event.update;
      if (['tool_call', 'tool_call_update'].includes(update.sessionUpdate) && update.toolCallId) {
        const previous = foreground.tools.get(update.toolCallId) || {};
        foreground.tools.set(update.toolCallId, {
          kind: 'tool',
          toolKind: update.kind || previous.toolKind,
          status: update.status || previous.status || 'pending',
          input:
            update.rawInput != null
              ? typeof update.rawInput === 'string'
                ? update.rawInput
                : JSON.stringify(update.rawInput)
              : previous.input || '',
          rawOutput: update.rawOutput != null ? copy(update.rawOutput) : previous.rawOutput,
        });
      }
    }
    if (event.type === 'update' && entry.snapshot) entry.snapshot.updates.push(copy(event.update));
    const update =
      event.type === 'update' ? event.update : event.type === 'notification' ? event.payload : null;
    if (entry.snapshot && update) {
      if (update.sessionUpdate === 'current_mode_update' && entry.snapshot.modes)
        entry.snapshot.modes.currentModeId = update.currentModeId;
      if (update.sessionUpdate === 'config_option_update') {
        entry.snapshot.configOptions = copy(update.configOptions);
        entry.snapshot._meta = {
          ...entry.snapshot._meta,
          configOptions: copy(update.configOptions),
        };
      }
      if (
        update.sessionUpdate === 'model_changed' &&
        Number.isSafeInteger(update.context_window_selection) &&
        update.context_window_selection > 0
      )
        entry.snapshot.contextWindow = update.context_window_selection;
    }
    if (event.type === 'models' && entry.snapshot) entry.snapshot.models = copy(event.models);
    if (event.type === 'models' && entry.snapshot) {
      const selected = event.models.availableModels?.find(
        (model) => model.modelId === event.models.currentModelId,
      );
      if (selected?._meta?.contextWindow !== undefined)
        entry.snapshot.contextWindow = selected._meta.contextWindow;
      else delete entry.snapshot.contextWindow;
    }
    if (event.type === 'commands' && entry.snapshot) entry.snapshot.commands = copy(event.commands);
    if (['turn-end', 'turn-error'].includes(event.type) && entry.running) {
      // The final checkpoint is part of the directory lock, before the next turn.
      if (entry.control) this._finishControl(entry, event);
      else void this._finish(entry, event);
    }
    this.emit(event);
    if (event.type !== 'update') this._changed();
  }

  async newSession(payload) {
    const entry = this._entry(null, payload.cwd);
    try {
      entry.snapshot = await entry.client.newSession(payload);
      entry.sessionId = entry.snapshot.sessionId;
      this.sessions.set(entry.sessionId, entry);
      this._changed();
      return this._snapshot(entry);
    } catch (error) {
      entry.client.dispose();
      throw error;
    }
  }

  async loadSession(payload) {
    let entry = this.sessions.get(payload.sessionId);
    if (!entry) entry = this._entry(payload.sessionId, payload.cwd);
    entry.lastUsed = Date.now();
    if (entry.snapshot && entry.client.connected) return this._snapshot(entry);
    const sleeping = entry.connection === 'sleeping';
    // Capture before load events change the connection state.
    // Desktop attachments/turn ownership are absent from official CLI history.
    const retainedUpdates = sleeping ? copy(entry.snapshot?.updates || []) : null;
    const permissionMode = sleeping ? entry.snapshot?.permissionMode : undefined;
    if (!entry.loading)
      entry.loading = entry.client
        .loadSession(payload)
        .then((snapshot) => {
          if (retainedUpdates) snapshot.updates = retainedUpdates;
          if (permissionMode) {
            entry.client.setPermissionMode({ sessionId: entry.sessionId, permissionMode });
            snapshot.permissionMode = permissionMode;
          }
          if (entry.connection === 'sleeping') entry.connection = 'connected';
          delete entry.sleepingCapabilities;
          entry.snapshot = snapshot;
          return snapshot;
        })
        .finally(() => {
          entry.loading = null;
        });
    await entry.loading;
    this._changed();
    return this._snapshot(entry);
  }

  async listSessions(payload) {
    const sessions = await this.catalog.listSessions(payload);
    for (const session of sessions) {
      const entry = this.sessions.get(session.sessionId);
      if (entry) entry.title = session.title;
    }
    return sessions;
  }

  _item(payload) {
    return { id: randomUUID(), createdAt: new Date().toISOString(), payload: copy(payload) };
  }

  async send(payload) {
    const entry = this._get(payload.sessionId);
    if (this._isWorkflowControl(entry, payload)) {
      if (entry.control) throw new Error(t('当前任务正在运行，请先等待完成或停止任务。'));
      return this._track(this._sendControl(entry, payload));
    }
    if (entry.running || entry.queue.length || this.locks.has(this._key(entry.cwd)))
      return this.enqueue(payload);
    entry.paused = false;
    return this._start(entry, this._item({ ...payload, cwd: entry.cwd }));
  }

  _isWorkflowControl(entry, payload) {
    return (
      !!entry.running?.finishing &&
      [...entry.activity.background].some((key) => key.includes(':workflow:')) &&
      !payload.attachments?.length &&
      /^\/workflow (?:pause|resume|stop)(?: [^\r\n]+)?$/.test(payload.text?.trim() || '') &&
      (entry.snapshot?.commands || []).some(
        (command) => command.name?.replace(/^\//, '') === 'workflow',
      )
    );
  }

  async _sendControl(entry, payload) {
    let resolve;
    const control = {
      turnId: randomUUID(),
      startedAt: new Date().toISOString(),
      cancelling: false,
      tools: new Map(),
      item: this._item(payload),
      activeTurnStartIndex: entry.snapshot.updates.length,
      done: new Promise((done) => {
        resolve = done;
      }),
      resolve: () => resolve(),
    };
    entry.control = control;
    entry.status = 'running';
    const update = {
      sessionUpdate: 'user_message_chunk',
      _desktopTurnId: control.turnId,
      content: { type: 'text', text: payload.text },
    };
    entry.snapshot.updates.push(update);
    this._changed();
    try {
      await entry.client.send(payload, () => control.cancelling || this.closed);
      return { turnId: control.turnId };
    } catch (error) {
      if (!control.accepted)
        entry.snapshot.updates = entry.snapshot.updates.filter((item) => item !== update);
      if (entry.control === control)
        this._finishControl(entry, { type: 'turn-error', message: error.message });
      throw error;
    }
  }

  _finishControl(entry, event) {
    const control = entry.control;
    if (!control) return;
    if (event.type === 'turn-error') {
      entry.paused = true;
      entry.error = event.message;
    }
    entry.control = null;
    entry.status = 'background';
    control.resolve();
    this._changed();
  }

  enqueue(payload) {
    const entry = this._get(payload.sessionId);
    const item = this._item({ ...payload, cwd: entry.cwd });
    item.queued = true;
    entry.queue.push(item);
    if (!entry.running && !entry.paused) entry.status = 'waiting';
    this._changed();
    this._drain();
    return { queueId: item.id };
  }

  remove({ sessionId, queueId }) {
    const entry = this._get(sessionId);
    entry.queue = entry.queue.filter((item) => item.id !== queueId);
    if (!entry.queue.length && !entry.running && !entry.paused) entry.status = 'idle';
    this._changed();
  }

  resume({ sessionId }) {
    const entry = this._get(sessionId);
    entry.paused = false;
    entry.interrupted = false;
    for (const item of entry.queue) item.queued = true;
    entry.error = undefined;
    if (!entry.running) entry.status = entry.queue.length ? 'waiting' : 'idle';
    this._changed();
    this._drain();
  }

  _drain() {
    if (this.closed) return;
    for (const entry of this.sessions.values()) {
      if (
        entry.running ||
        entry.paused ||
        !entry.queue.length ||
        this.locks.has(this._key(entry.cwd))
      )
        continue;
      const item = entry.queue.shift();
      void this._start(entry, item).catch(() => {});
    }
  }

  async runWorkspaceMutation(cwd, operation) {
    const key = this._key(cwd);
    if (this.locks.has(key)) throw new Error(t('此目录仍有任务在运行，请完成后再恢复文件。'));
    this.locks.set(key, { mutation: true });
    try {
      return await operation();
    } finally {
      this.locks.delete(key);
      this._drain();
    }
  }

  _track(operation) {
    this.pending.add(operation);
    operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }

  _start(entry, item) {
    return this._track(this._startTurn(entry, item));
  }

  async _startTurn(entry, item) {
    const turnId = randomUUID();
    const running = {
      turnId,
      startedAt: new Date().toISOString(),
      item,
      cancelling: false,
      tools: new Map(),
    };
    entry.running = running;
    entry.status = 'running';
    entry.interrupted = false;
    entry.error = undefined;
    this.locks.set(this._key(entry.cwd), entry);
    this._changed();
    try {
      if (!entry.snapshot || !entry.client.connected)
        await this.loadSession({ sessionId: entry.sessionId, cwd: entry.cwd });
      if (running.cancelling || this.closed) throw new Error(t('已取消发送。'));
      running.preparing = this.beforeTurn?.({
        cwd: entry.cwd,
        sessionId: entry.sessionId,
        turnId,
        payload: copy(item.payload),
      });
      await running.preparing;
      if (running.cancelling || this.closed) throw new Error(t('已取消发送。'));
      // Save user content here because ACP intentionally suppresses its live echo.
      const update = {
        sessionUpdate: 'user_message_chunk',
        _desktopTurnId: turnId,
        content: { type: 'text', text: item.payload.text || '' },
        _desktopAttachments: copy(item.payload.attachments || []),
      };
      running.activeTurnStartIndex = entry.snapshot?.updates.length;
      entry.snapshot?.updates.push(update);
      try {
        await entry.client.send(item.payload, () => running.cancelling || this.closed);
      } catch (error) {
        if (entry.snapshot)
          entry.snapshot.updates = entry.snapshot.updates.filter((item) => item !== update);
        throw error;
      }
      return { turnId };
    } catch (error) {
      if (item.queued && !entry.queue.some((queued) => queued.id === item.id))
        entry.queue.unshift(item);
      await this._finish(entry, { type: 'turn-error', message: error.message });
      throw error;
    }
  }

  _finish(entry, event) {
    if (!entry.running) return Promise.resolve();
    if (entry.running.finishing) return entry.running.finishing;
    const running = entry.running;
    const operation = this._finishTurn(entry, event);
    running.finishing = operation;
    return this._track(operation);
  }

  async _finishTurn(entry, event) {
    const running = entry.running;
    const failed = event.type === 'turn-error';
    let checkpoint, finishError;
    entry.paused ||= failed || running.cancelling || event.result?.stopReason === 'cancelled';
    entry.error = failed ? event.message : entry.error;
    try {
      await running.preparing;
      while ((entry.activity.background.size || entry.control) && !this.closed) {
        entry.status = 'background';
        this._changed();
        if (entry.activity.background.size)
          await new Promise((resolve) => {
            entry.backgroundDone = resolve;
          });
        if (entry.control) await entry.control.done;
      }
      checkpoint = await this.afterTurn?.({
        cwd: entry.cwd,
        sessionId: entry.sessionId,
        turnId: running.turnId,
        result: event.result,
        error: failed ? event.message : undefined,
      });
    } catch (error) {
      entry.paused = true;
      entry.error = error.message;
      finishError = error.message;
    }
    const { collectToolFacts } = await import('./task-facts.mjs');
    const stopReason = event.result?.stopReason;
    const status = entry.interrupted
      ? 'interrupted'
      : running.cancelling || stopReason === 'cancelled'
        ? 'cancelled'
        : failed || finishError
          ? 'failed'
          : stopReason && stopReason !== 'end_turn'
            ? 'interrupted'
            : 'completed';
    const error =
      finishError || (failed ? event.message : entry.interrupted ? entry.error : undefined);
    entry.lastTurn = {
      turnId: running.turnId,
      startedAt: running.startedAt,
      finishedAt: new Date().toISOString(),
      status,
      facts: collectToolFacts([...running.tools.values()]),
      ...(stopReason ? { stopReason } : {}),
      ...(error ? { error } : {}),
      ...(checkpoint?.checkpointId ? { checkpointId: checkpoint.checkpointId } : {}),
      ...(checkpoint?.checkpointSkipped ? { checkpointSkipped: true } : {}),
    };
    entry.running = null;
    entry.permissions.clear();
    entry.status = entry.interrupted
      ? 'interrupted'
      : entry.error
        ? 'error'
        : entry.paused
          ? 'paused'
          : 'idle';
    this.locks.delete(this._key(entry.cwd));
    this._changed();
    this.emit({
      type: 'task-finished',
      sessionId: entry.sessionId,
      turnId: running.turnId,
      status,
    });
    this._drain();
  }

  async cancel(payload) {
    const entry = this._get(payload.sessionId);
    entry.paused = true;
    if (entry.running) entry.running.cancelling = true;
    else entry.status = 'paused';
    if (entry.control) entry.control.cancelling = true;
    this._changed();
    if (!entry.client.activeTurn) return;
    return entry.client.cancel(payload);
  }

  respondPermission(payload) {
    const matches = payload.sessionId
      ? [this._get(payload.sessionId)]
      : [...this.sessions.values()].filter((entry) => entry.permissions.has(payload.requestId));
    if (matches.length !== 1) throw new Error(t('请先选择权限请求所属的会话。'));
    return matches[0].client.respondPermission(payload);
  }

  async configure(payload) {
    const entry = this._get(payload.sessionId);
    if (entry.running) throw new Error(t('当前任务正在运行，请先等待完成或停止任务。'));
    if (entry.connection === 'sleeping')
      await this.loadSession({ sessionId: entry.sessionId, cwd: entry.cwd });
    const result = await entry.client.configure(payload);
    Object.assign(entry.snapshot, copy(result));
    return result;
  }
  async setPermissionMode(payload) {
    const entry = this._get(payload.sessionId);
    if (entry.connection === 'sleeping')
      await this.loadSession({ sessionId: entry.sessionId, cwd: entry.cwd });
    const result = entry.client.setPermissionMode(payload);
    if (entry.snapshot) entry.snapshot.permissionMode = result.permissionMode;
    return result;
  }
  async usage(payload) {
    const entry = this.sessions.get(payload.sessionId);
    if (entry?.connection === 'sleeping')
      await this.loadSession({ sessionId: entry.sessionId, cwd: entry.cwd });
    return (entry?.client || this.catalog).usage(payload);
  }
  async rename(payload) {
    const sleeping = this.sessions.get(payload.sessionId);
    if (sleeping?.connection === 'sleeping')
      await this.loadSession({ sessionId: sleeping.sessionId, cwd: sleeping.cwd });
    await (this.sessions.get(payload.sessionId)?.client || this.catalog).rename(payload);
    const entry = this.sessions.get(payload.sessionId);
    if (entry) {
      entry.title = payload.title.trim();
      this._changed();
    }
  }
  async deleteSession(payload) {
    const entry = this.sessions.get(payload.sessionId);
    if (entry?.running || entry?.queue.length)
      throw new Error(t('请先停止任务并移除排队消息，再删除会话。'));
    if (entry?.connection === 'sleeping')
      await this.loadSession({ sessionId: entry.sessionId, cwd: entry.cwd });
    await (entry?.client || this.catalog).deleteSession(payload);
    entry?.client.dispose();
    this.sessions.delete(payload.sessionId);
    this._changed();
  }
  async extension(method, params = {}, routingSessionId = params.sessionId) {
    const entry = this.sessions.get(routingSessionId);
    if (entry?.connection === 'sleeping')
      await this.loadSession({ sessionId: entry.sessionId, cwd: entry.cwd });
    return (entry?.client || this.catalog).extension(method, params);
  }
  async restart() {
    if (this.activeTurn) throw new Error(t('当前任务正在运行，请先等待完成或停止任务。'));
    for (const entry of this.sessions.values()) {
      entry.client.dispose();
      entry.error = undefined;
      entry.paused = !!entry.queue.length;
      entry.status = entry.paused ? 'paused' : 'idle';
    }
    this._changed();
    return this.catalog.restart();
  }
  async dispose() {
    try {
      this._persist();
    } catch (error) {
      this.emit({
        type: 'notification',
        kind: 'queue-save-error',
        payload: { message: error.message },
      });
    }
    this.closed = true;
    for (const entry of this.sessions.values()) {
      entry.paused = true;
      entry.backgroundDone?.();
      entry.backgroundDone = null;
      entry.client.dispose();
      this._finishControl(entry, { type: 'turn-error', message: t('已取消发送。') });
    }
    this.catalog.dispose();
    // Capture after-state only after every in-flight baseline/send has settled.
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    await Promise.all(
      [...this.sessions.values()]
        .filter((entry) => entry.running)
        .map((entry) => this._finish(entry, { type: 'turn-error', message: t('已取消发送。') })),
    );
  }
}
module.exports = { SessionHub, isIdleEntry };
