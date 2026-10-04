const fs = require('node:fs');
const path = require('node:path');
function createWorkspaceWatcher(emit, onError = () => {}) {
  let watcher,
    timer,
    maxTimer,
    current = '';
  function close() {
    clearTimeout(timer);
    clearTimeout(maxTimer);
    timer = maxTimer = undefined;
    watcher?.close();
    watcher = undefined;
    current = '';
  }
  return {
    start(cwd) {
      if (cwd === current) return;
      close();
      current = cwd;
      try {
        watcher = fs.watch(cwd, { recursive: true }, (_event, filename) => {
          const relative = String(filename || '').replaceAll('\\', '/');
          const parts = relative.split('/');
          if (
            parts.some((part) =>
              ['node_modules', 'target', 'dist', 'release', '.next'].includes(part),
            )
          )
            return;
          if (parts.includes('.git') && !['.git/index', '.git/HEAD'].includes(relative)) return;
          if (path.basename(relative).includes('.grok-save-')) return;
          const flush = () => {
            clearTimeout(timer);
            clearTimeout(maxTimer);
            timer = maxTimer = undefined;
            emit({ type: 'workspace-changed', cwd });
          };
          clearTimeout(timer);
          timer = setTimeout(flush, 200);
          maxTimer ||= setTimeout(flush, 1000);
        });
        watcher.on('error', () => {
          close();
          onError();
        });
      } catch {
        close();
        onError();
      }
    },
    close,
  };
}
module.exports = { createWorkspaceWatcher };
