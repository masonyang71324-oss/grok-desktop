const refreshInterval = 30000;
const number = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const record = () => ({ data: null, loading: false, error: '', updatedAt: null });

export function accountUsage(value) {
  return {
    plan: typeof value?.plan === 'string' && value.plan ? value.plan : null,
    remainingPercent: number(value?.remainingPercent),
    fetchedAt:
      typeof value?.fetchedAt === 'string' && Number.isFinite(Date.parse(value.fetchedAt))
        ? value.fetchedAt
        : null,
  };
}

export function contextUsage(value) {
  const context = value?.info?.context || value?.context;
  const used = number(context?.used);
  const total = number(context?.total);
  return {
    used,
    total,
    percent:
      used !== null && total !== null && total > 0
        ? (used / total) * 100
        : number(context?.usagePct),
  };
}

export function emptyUsageState() {
  return { scope: null, account: record(), context: record() };
}

// The account and context channels are independent. Automatic revisions share a
// trailing read rather than starting a request for each workspace event.
export function createUsageStatusReader(request, onChange, options = {}) {
  const now = options.now || Date.now;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const channel = () => ({
    lastStart: -Infinity,
    token: 0,
    pending: false,
    timer: null,
    queued: false,
    force: false,
  });
  const channels = { account: channel(), context: channel() };
  let state = emptyUsageState();
  let current = null;
  // Connectivity invalidates both channels; session changes only replace the context token.
  let generation = 0;
  let activeTimer = null;
  let disposed = false;

  function publish(name, patch) {
    if (disposed) return;
    state = { ...state, [name]: { ...state[name], ...patch } };
    onChange(state);
  }

  const readable = () => current && current.connected !== false && current.visible !== false;
  const allowed = (name) => readable() && (name === 'account' || !!current.sessionId);

  function cancelScheduled(item) {
    if (item.timer !== null) clearTimer(item.timer);
    item.timer = null;
    item.queued = false;
    item.force = false;
  }

  function schedule(name, force = false) {
    if (disposed || !allowed(name)) return;
    const item = channels[name];
    if (item.pending) {
      item.queued = true;
      item.force ||= force;
      return;
    }
    const delay = force ? 0 : Math.max(0, item.lastStart + refreshInterval - now());
    if (delay > 0) {
      if (item.timer === null)
        item.timer = setTimer(() => {
          item.timer = null;
          schedule(name);
        }, delay);
      return;
    }
    cancelScheduled(item);
    item.pending = true;
    item.lastStart = now();
    const token = ++item.token;
    const version = generation;
    const scope = current;
    publish(name, { loading: true });
    Promise.resolve()
      .then(() =>
        request(
          name === 'account' ? 'account.usage' : 'session.usage',
          name === 'context' ? { cwd: scope.cwd, sessionId: scope.sessionId } : undefined,
        ),
      )
      .then((value) => {
        if (disposed || version !== generation || token !== item.token) return;
        publish(name, {
          data: name === 'account' ? accountUsage(value) : contextUsage(value),
          updatedAt: now(),
          error: '',
        });
      })
      .catch((error) => {
        if (disposed || version !== generation || token !== item.token) return;
        publish(name, { error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        if (disposed || token !== item.token) return;
        item.pending = false;
        publish(name, { loading: false });
        if (item.queued) {
          const forceQueued = item.force;
          item.queued = false;
          item.force = false;
          schedule(name, forceQueued);
        }
      });
  }

  function refresh(force = false) {
    schedule('account', force);
    schedule('context', force);
  }

  function syncActiveTimer() {
    const active = readable() && current.active && current.sessionId;
    if (!active && activeTimer !== null) {
      clearTimer(activeTimer);
      activeTimer = null;
    } else if (active && activeTimer === null) {
      activeTimer = setTimer(() => {
        activeTimer = null;
        refresh();
        syncActiveTimer();
      }, refreshInterval);
    }
  }

  function update(next) {
    if (disposed) return;
    const scopeChanged =
      !current ||
      current.cwd !== next.cwd ||
      current.sessionId !== next.sessionId ||
      current.contextWindow !== next.contextWindow;
    const revisionChanged = !current || current.revision !== next.revision;
    const wasReadable = readable();
    current = { ...next };
    if (scopeChanged) {
      cancelScheduled(channels.context);
      channels.context.token++;
      channels.context.pending = false;
      channels.context.lastStart = -Infinity;
      state = {
        ...state,
        scope: { cwd: next.cwd, sessionId: next.sessionId, contextWindow: next.contextWindow },
        context: record(),
      };
      onChange(state);
    }
    if (!readable()) {
      if (wasReadable) generation++;
      cancelScheduled(channels.account);
      cancelScheduled(channels.context);
      channels.context.token++;
      channels.context.pending = false;
      publish('context', { loading: false });
    } else if (scopeChanged || revisionChanged || !wasReadable) {
      if (!wasReadable) channels.context.lastStart = -Infinity;
      refresh();
    }
    syncActiveTimer();
  }

  function dispose() {
    disposed = true;
    generation++;
    cancelScheduled(channels.account);
    cancelScheduled(channels.context);
    if (activeTimer !== null) clearTimer(activeTimer);
    activeTimer = null;
  }

  return { update, refresh, dispose, getState: () => state };
}
