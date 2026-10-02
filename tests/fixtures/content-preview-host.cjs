// Isolated harness for the production preview manager; never starts ACP or reads app settings.
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const path = require('node:path');
const { createWebPreviewManager } = require('../../electron/web-preview.cjs');
app.setPath('userData', process.env.GROK_CONTENT_TEST_DATA);
app.whenReady().then(async () => {
  const parent = new BrowserWindow({ show: false });
  globalThis.contentProbe = { external: [], events: [] };
  contentProbe.manager = createWebPreviewManager({
    BrowserWindow,
    WebContentsView,
    ipcMain,
    getParent: () => parent,
    emit: (event) => contentProbe.events.push(event),
    attachmentsDirectory: path.join(process.env.GROK_CONTENT_TEST_DATA, 'captures'),
    openExternal: async (url) => {
      contentProbe.external.push(url);
    },
  });
  await parent.loadURL('about:blank');
});
app.on('window-all-closed', () => app.quit());
