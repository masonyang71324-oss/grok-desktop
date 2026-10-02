const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('preview', {
  request: (payload) => ipcRenderer.invoke('preview:request', payload),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('preview:state', listener);
    return () => ipcRenderer.removeListener('preview:state', listener);
  },
});
