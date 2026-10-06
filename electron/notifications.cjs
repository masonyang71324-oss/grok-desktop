const { translate: t } = require('./i18n.cjs');
function createNotifications({
  getWindow,
  enabled,
  Notification,
  onFailure = () => {},
  onNavigate = (_target) => {},
}) {
  let current;
  function clear() {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.flashFrame(false);
    current?.close();
    current = undefined;
  }
  function receive(event) {
    const win = getWindow();
    if (!enabled() || !win || win.isDestroyed() || win.isFocused()) return;
    let body;
    if (event.type === 'permission') body = t('Grok 需要你批准一项操作');
    else if (event.type === 'task-finished')
      body =
        event.status === 'completed'
          ? t('任务已完成')
          : event.status === 'cancelled'
            ? t('任务已停止')
            : t('任务遇到问题，请返回查看');
    else if (event.type === 'app-update' && event.state?.status === 'available')
      body = t('Grok Build Desktop {version} 可以更新', {
        version: event.state.availableVersion || '',
      });
    if (!body) return;
    win.flashFrame(true);
    if (!Notification.isSupported()) return;
    try {
      current?.close();
      current = new Notification({ title: 'Grok Build Desktop', body, silent: true });
      current.on('click', () => {
        if (win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        clear();
        if (event.sessionId && ['permission', 'task-finished'].includes(event.type))
          onNavigate({
            sessionId: event.sessionId,
            ...(event.type === 'permission' && event.requestId !== undefined
              ? { requestId: event.requestId }
              : {}),
          });
      });
      current.on('failed', onFailure);
      current.show();
    } catch {
      onFailure();
    }
  }
  return { receive, clear };
}
module.exports = { createNotifications };
