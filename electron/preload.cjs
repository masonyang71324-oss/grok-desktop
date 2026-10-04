const { contextBridge, ipcRenderer, webUtils } = require('electron');

const commands = new Set([
  'bootstrap',
  'cli.status',
  'cli.refresh',
  'cli.install.state',
  'cli.install.start',
  'cli.install.cancel',
  'cli.login',
  'providers.list',
  'providers.save',
  'providers.remove',
  'providers.enable',
  'office.preview',
  'workspace.search',
  'terminal.open',
  'terminal.state',
  'terminal.input',
  'terminal.resize',
  'terminal.close',
  'preview.open',
  'preview.capture',
  'preview.close',
  'dictation.start',
  'dialog.grok',
  'clipboard.write',
  'clipboard.image',
  'attachment.preview',
  'attachment.reauthorize',
  'settings.save',
  'drafts.flush',
  'dialog.project',
  'dialog.attach',
  'project.open',
  'project.trust',
  'project.access',
  'attachments.storage',
  'attachments.removeMany',
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
  'checkpoints.storage',
  'checkpoints.removeMany',
  'checkpoints.restore',
  'runner.inspect',
  'runner.state',
  'runner.start',
  'runner.stop',
  'update.status',
  'update.check',
  'update.download',
  'update.install',
  'system.open',
  'system.run',
]);

contextBridge.exposeInMainWorld('desktop', {
  pathsForFiles: async (files) => {
    const selected = Array.from(files)
      .map((file) => ({ name: file.name, path: webUtils.getPathForFile(file) }))
      .filter((file) => file.path);
    // This route is deliberately absent from request()'s public command list.
    // Paths originate from native File objects, not arbitrary renderer strings.
    const result = await ipcRenderer.invoke('desktop:files-selected', selected);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  },
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
