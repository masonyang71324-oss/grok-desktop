const { contextBridge, ipcRenderer, webUtils } = require('electron');

const commands = new Set([
  'bootstrap',
  'dialog.grok',
  'clipboard.write',
  'clipboard.image',
  'attachment.preview',
  'settings.save',
  'dialog.project',
  'dialog.attach',
  'project.open',
  'sessions.list',
  'session.new',
  'session.load',
  'session.send',
  'session.enqueue',
  'tasks.list',
  'tasks.remove',
  'tasks.resume',
  'session.configure',
  'session.cancel',
  'session.permission',
  'session.permissions',
  'session.rename',
  'session.delete',
  'session.export',
  'session.usage',
  'account.usage',
  'workspace.list',
  'workspace.read',
  'workspace.save',
  'workspace.changes',
  'workspace.diff',
  'checkpoints.list',
  'checkpoints.detail',
  'checkpoints.remove',
  'checkpoints.restore',
  'runner.inspect',
  'runner.state',
  'runner.start',
  'runner.stop',
  'system.open',
  'system.run',
]);

contextBridge.exposeInMainWorld('desktop', {
  pathsForFiles: (files) =>
    Array.from(files)
      .map((file) => ({ name: file.name, path: webUtils.getPathForFile(file) }))
      .filter((file) => file.path),
  request: (command, payload) => {
    if (!commands.has(command)) return Promise.resolve({ ok: false, error: '不支持的操作。' });
    return ipcRenderer.invoke('desktop:request', command, payload);
  },
  onEvent: (callback) => {
    const listener = (_event, value) => {
      if (value.type === 'event-batch') value.events.forEach(callback);
      else callback(value);
    };
    ipcRenderer.on('desktop:event', listener);
    return () => ipcRenderer.removeListener('desktop:event', listener);
  },
});
