const fs = require('node:fs');
const path = require('node:path');
function createWorkspaceWatcher(emit, onError = () => {}) {
  let watcher,
    timer,
    current = '';
  function close() {
    clearTimeout(timer);
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
          clearTimeout(timer);
          timer = setTimeout(() => emit({ type: 'workspace-changed', cwd }), 200);
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
