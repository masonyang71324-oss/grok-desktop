const { translate: t } = require('./i18n.cjs');
const WORKFLOW_ACTIVE = new Set([
  'active',
  'user_paused',
  'back_off_paused',
  'no_progress_paused',
  'infra_paused',
  'blocked',
  'budget_limited',
]);
const WORKFLOW_TERMINAL = new Set(['interrupted', 'complete', 'failed', 'cancelled']);

class RuntimeActivity {
  constructor({ isForegroundBusy }) {
    this.isForegroundBusy = isForegroundBusy;
    this.background = new Set();
    this.mutating = false;
    this.pendingSessions = 0;
  }

  get busy() {
    return (
      this.mutating ||
      this.pendingSessions > 0 ||
      this.isForegroundBusy() ||
      this.background.size > 0
    );
  }

  onEvent(event) {
    if (event.type === 'connection' && ['disconnected', 'error'].includes(event.state)) {
      const scope = `${event.sessionId || ''}:`;
      for (const key of this.background) if (key.startsWith(scope)) this.background.delete(key);
    }
    if (event.type !== 'notification') return;
    const payload = event.payload || {};
    let id, prefix, active;
    if (['subagent_spawned', 'subagent_finished'].includes(event.kind)) {
      id = payload.subagent_id;
      prefix = 'subagent';
      active = event.kind === 'subagent_spawned';
    } else if (['task_backgrounded', 'task_completed'].includes(event.kind)) {
      id = payload.task_id || payload.task_snapshot?.task_id;
      prefix = 'task';
      active = event.kind === 'task_backgrounded';
    } else if (['scheduled_task_created', 'scheduled_task_deleted'].includes(event.kind)) {
      id = payload.task_id;
      prefix = 'schedule';
      active = event.kind === 'scheduled_task_created';
    } else if (event.kind === 'workflow_updated') {
      id = payload.run_id;
      prefix = 'workflow';
      if (WORKFLOW_ACTIVE.has(payload.status)) active = true;
      else if (WORKFLOW_TERMINAL.has(payload.status)) active = false;
      else return;
    }
    if (!id) return;
    const key = `${event.sessionId || ''}:${prefix}:${id}`;
    if (active) this.background.add(key);
    else this.background.delete(key);
  }

  assertSessionAllowed() {
    if (this.mutating)
      throw new Error(t('正在执行管理操作或重新加载配置，请完成后再操作会话或更换 Grok 程序。'));
  }

  async runSession(action) {
    this.assertSessionAllowed();
    this.pendingSessions++;
    try {
      return await action();
    } finally {
      this.pendingSessions--;
    }
  }

  async runMutation(action) {
    this.assertSessionAllowed();
    if (this.busy)
      throw new Error(t('Grok 仍有任务在运行或正在切换会话。请先结束任务，再更改扩展或更新程序。'));
    this.mutating = true;
    try {
      return await action();
    } finally {
      this.mutating = false;
    }
  }
}
module.exports = { RuntimeActivity };
