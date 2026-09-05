const { translate: t } = require('./i18n.cjs');
function createNotifications({ getWindow, enabled, Notification, onFailure = () => {} }) {
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
    else if (event.type === 'turn-end')
      body = event.result?.stopReason === 'cancelled' ? t('任务已停止') : t('任务已完成');
    else if (event.type === 'turn-error') body = t('任务遇到问题，请返回查看');
    if (!body) return;
    win.flashFrame(true);
    if (!Notification.isSupported()) return;
    try {
      current?.close();
      current = new Notification({ title: 'Grok Desktop', body, silent: true });
      current.on('click', () => {
        if (win.isDestroyed()) return;
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        clear();
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
