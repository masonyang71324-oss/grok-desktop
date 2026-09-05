const { translate: t } = require('./i18n.cjs');
async function createWorktree({
  client,
  subscribe,
  sessionId,
  cwd,
  worktreePath,
  copyMode = 'clean',
  gitRef,
  label,
}) {
  if (!sessionId) throw new Error(t('请先创建或打开当前项目的会话。'));
  let resolveResult, rejectResult;
  const complete = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // Listen before dispatch: a fast local Git operation can finish before the RPC acknowledgement.
  const unsubscribe = subscribe((event) => {
    if (event.type === 'connection' && ['error', 'disconnected'].includes(event.state)) {
      rejectResult(new Error(event.message || t('Grok 连接已断开，无法继续等待工作树创建结果。')));
      return;
    }
    if (event.type !== 'notification' || event.kind !== 'worktree-status') return;
    const data = event.payload;
    if (data.sessionId !== sessionId) return;
    if (data.status === 'created') resolveResult({ path: data.worktreePath, commit: data.commit });
    else if (data.status === 'error')
      rejectResult(new Error(data.message || t('创建工作树失败。')));
    else if (data.status === 'cancelled') rejectResult(new Error(t('创建工作树已取消。')));
  });
  const timer = setTimeout(
    () => rejectResult(new Error(t('工作树创建仍未完成，请查看 Grok 工作树列表确认状态后重试。'))),
    120000,
  );
  // Attach before the request so early error notifications cannot become unhandled rejections.
  complete.catch(() => {});
  try {
    const response = await client.extension('_x.ai/git/worktree/create', {
      sessionId,
      sourcePath: cwd,
      worktreePath,
      copyMode: copyMode === 'dirty' ? 'dirty' : 'clean',
      worktreeType: 'git',
      groveWorktree: false,
      ...(gitRef ? { gitRef } : {}),
      ...(label ? { label } : {}),
    });
    if (response?.error)
      throw new Error(
        typeof response.error === 'string'
          ? response.error
          : response.error.message || JSON.stringify(response.error),
      );
    const result = response?.result;
    if (result?.status === 'exists') return { path: result.worktreePath, existed: true };
    if (result?.status !== 'creating') throw new Error(t('Grok 未确认工作树创建请求。'));
    return await complete;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}
module.exports = { createWorktree };
