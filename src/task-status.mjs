const labels = {
  approval: '等待审批',
  finishing: '正在整理结果',
  running: '进行中',
  background: '后台运行中',
  waiting: '等待中',
  paused: '已暂停',
  error: '失败',
  interrupted: '已中断',
  stopped: '已停止',
  completed: '已完成',
  idle: '空闲',
};

export function deriveTaskStatus(task) {
  let kind = 'idle';
  if (task?.permissions.length) kind = 'approval';
  else if (task?.finishing) kind = 'finishing';
  else if (['running', 'background', 'waiting', 'error', 'interrupted'].includes(task?.status))
    kind = task.status;
  else if (task?.status === 'paused' && task.queued.length) kind = 'paused';
  else if (task?.lastTurn) {
    kind =
      {
        completed: 'completed',
        cancelled: 'stopped',
        failed: 'error',
        interrupted: 'interrupted',
      }[task.lastTurn.status] || 'idle';
  } else if (task?.status === 'paused') kind = 'paused';
  return { kind, label: labels[kind] };
}

export function sessionStatusChips(task, hasDraft = false) {
  const status = deriveTaskStatus(task);
  const chips = ['idle', 'completed'].includes(status.kind) ? [] : [status];
  if (task?.queued.length)
    chips.push({ kind: 'queued', label: '排队 {count}', count: task.queued.length });
  if (hasDraft) chips.push({ kind: 'draft', label: '草稿' });
  return chips;
}

export function groupTasks(tasks, showAll = false) {
  const attention = [],
    active = [],
    history = [];
  for (const task of tasks) {
    const { kind } = deriveTaskStatus(task);
    if (
      ['approval', 'error', 'interrupted'].includes(kind) ||
      (kind === 'paused' && task.queued.length)
    )
      attention.push(task);
    else if (['running', 'finishing', 'background', 'waiting'].includes(kind) || task.queued.length)
      active.push(task);
    else history.push(task);
  }
  // Preserve snapshot order except that an approval always comes before other attention items.
  attention.sort(
    (left, right) => Number(!!right.permissions.length) - Number(!!left.permissions.length),
  );
  return [
    { kind: 'attention', label: '需要处理', tasks: attention },
    { kind: 'active', label: '活跃任务', tasks: active },
    ...(showAll ? [{ kind: 'history', label: '历史与空闲', tasks: history }] : []),
  ].filter((group) => group.tasks.length);
}
