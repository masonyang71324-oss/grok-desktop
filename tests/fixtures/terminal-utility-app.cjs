const { app } = require('electron');
app.setPath('userData', process.env.GROK_DESKTOP_DATA_DIR);
app.whenReady().then(() => {
  globalThis.terminalProbeReady = true;
});
