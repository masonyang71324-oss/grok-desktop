export function deriveSessionRuntime({ session, tasks = [], pending = false }) {
  const runtime = session
    ? tasks.find((task) => task.sessionId === session.sessionId) || session.runtime
    : undefined;
  const active =
    !!runtime?.finishing ||
    ['running', 'starting', 'waiting', 'cancelling', 'background'].includes(runtime?.status);
  const cancelling = !pending && (!!runtime?.cancelling || runtime?.status === 'cancelling');
  return {
    runtime,
    busy: pending || active,
    cancelling,
    canStop:
      pending ||
      (!cancelling &&
        !runtime?.finishing &&
        ['running', 'starting', 'waiting'].includes(runtime?.status)),
    canQueue: !!session && active && !pending,
  };
}

export function isWorkflowControl({ runtime, text, attachments = [], commands = [] }) {
  return (
    runtime?.status === 'background' &&
    !!runtime.finishing &&
    !attachments.length &&
    /^\/workflow (?:pause|resume|stop)(?: [^\r\n]+)?$/.test(text.trim()) &&
    commands.some((command) => command.name?.replace(/^\//, '') === 'workflow')
  );
}

// Readiness is not a reset. Only a new user turn or explicit reconnect rearms
// a target, so reconnect's own error/ready events cannot start another attempt.
export function createReconnectBudget() {
  const pending = new Set(),
    attempted = new Set();
  return {
    disconnected(key, { state, action }) {
      if (state === 'sleeping' || ['login', 'settings', 'usage'].includes(action)) {
        pending.delete(key);
        return;
      }
      if (
        ['error', 'disconnected'].includes(state) &&
        !['login', 'settings', 'usage'].includes(action) &&
        !attempted.has(key)
      )
        pending.add(key);
    },
    take(key, { enabled = true, blocked = false, trusted = true } = {}) {
      if (!enabled || blocked || !trusted || !pending.has(key) || attempted.has(key)) return false;
      pending.delete(key);
      attempted.add(key);
      return true;
    },
    rearm(key) {
      attempted.delete(key);
      pending.delete(key);
    },
  };
}
