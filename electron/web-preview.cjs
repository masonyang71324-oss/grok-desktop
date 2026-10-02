const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { translate: t } = require('./i18n.cjs');

function validatePreviewUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(t('请输入完整的 HTTP 或 HTTPS 网页地址。'));
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error(t('网页预览只支持 HTTP 和 HTTPS 地址。'));
  return url.href;
}

function createWebPreviewManager({
  BrowserWindow,
  WebContentsView,
  ipcMain,
  getParent,
  emit,
  attachmentsDirectory,
  openExternal,
}) {
  const entries = new Map();
  function find(id) {
    const entry = entries.get(id);
    if (!entry) throw new Error(t('预览窗口已关闭。'));
    return entry;
  }
  function state(entry) {
    const wc = entry.view.webContents;
    return {
      id: entry.id,
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: entry.loading,
      error: entry.error,
      back: wc.navigationHistory.canGoBack(),
      forward: wc.navigationHistory.canGoForward(),
      labels: {
        back: t('后退'),
        forward: t('前进'),
        reload: t('刷新'),
        open: t('打开'),
        capture: t('截图加入原会话草稿'),
        external: t('用浏览器打开'),
        address: t('网页地址'),
        saved: t('截图已加入原会话草稿'),
        error: t('预览未完成'),
      },
    };
  }
  function publish(entry) {
    if (!entry.window.isDestroyed()) entry.window.webContents.send('preview:state', state(entry));
  }
  async function capture(entry) {
    if (entry.loading) throw new Error(t('网页仍在加载，请稍后截图。'));
    if (entry.capturing) throw new Error(t('截图正在进行，请稍候。'));
    const url = entry.view.webContents.getURL(),
      owner = { ...entry.owner };
    entry.capturing = true;
    try {
      const image = await entry.view.webContents.capturePage();
      if (!entries.has(entry.id)) throw new Error(t('预览窗口已关闭。'));
      if (entry.loading || entry.view.webContents.getURL() !== url)
        throw new Error(t('网页在截图时发生变化，请重新截图。'));
      if (image.isEmpty()) throw new Error(t('未能获取网页截图，请重新加载后重试。'));
      await fs.mkdir(attachmentsDirectory, { recursive: true });
      const name = `preview-${new Date().toISOString().replace(/[:.]/g, '-')}-${entry.id.slice(0, 6)}.png`;
      const attachment = {
        name,
        path: path.join(attachmentsDirectory, name),
        kind: 'image',
        mimeType: 'image/png',
      };
      await fs.writeFile(attachment.path, image.toPNG());
      emit({ type: 'preview-captured', owner, attachment, url });
      const parent = getParent();
      if (parent && !parent.isDestroyed()) {
        parent.show();
        parent.focus();
      }
      return attachment;
    } finally {
      entry.capturing = false;
    }
  }
  async function act(entry, { action, url }) {
    const wc = entry.view.webContents;
    if (action === 'state') return state(entry);
    if (action === 'navigate') {
      await wc.loadURL(validatePreviewUrl(url));
      return state(entry);
    }
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === 'forward' && wc.navigationHistory.canGoForward())
      wc.navigationHistory.goForward();
    else if (action === 'reload') wc.reload();
    else if (action === 'external') await openExternal(validatePreviewUrl(wc.getURL()));
    else if (action === 'capture') return capture(entry);
    else if (action === 'close') entry.window.close();
    else if (!['back', 'forward'].includes(action)) throw new Error(t('不支持的操作。'));
    return state(entry);
  }
  ipcMain.handle('preview:request', async (event, payload) => {
    const entry = [...entries.values()].find((item) => item.window.webContents === event.sender);
    if (!entry) return { ok: false, error: t('不支持的操作。') };
    try {
      return { ok: true, data: await act(entry, payload || {}) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  return {
    async open({ url, owner }) {
      const destination = validatePreviewUrl(url);
      if (!owner || typeof owner.cwd !== 'string' || typeof owner.draftKey !== 'string')
        throw new Error(t('请选择会话后再打开预览。'));
      const id = randomUUID();
      const window = new BrowserWindow({
        width: 1100,
        height: 800,
        minWidth: 720,
        minHeight: 480,
        parent: getParent(),
        show: false,
        autoHideMenuBar: true,
        title: t('网页预览'),
        backgroundColor: '#15191d',
        webPreferences: {
          preload: path.join(__dirname, 'preview-preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const view = new WebContentsView({
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: `preview-${id}`,
        },
      });
      const entry = { id, window, view, owner: { ...owner }, loading: false, error: '' };
      entries.set(id, entry);
      window.contentView.addChildView(view);
      const resize = () => {
        const [width, height] = window.getContentSize();
        view.setBounds({ x: 0, y: 78, width, height: Math.max(0, height - 78) });
      };
      resize();
      window.on('resize', resize);
      window.on('closed', () => {
        entries.delete(id);
        if (!view.webContents.isDestroyed()) view.webContents.close();
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      const wc = view.webContents;
      wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
      wc.session.setPermissionCheckHandler(() => false);
      const navigation = (event, value) => {
        try {
          validatePreviewUrl(value);
        } catch {
          event.preventDefault();
        }
      };
      wc.on('will-navigate', navigation);
      wc.on('will-redirect', navigation);
      wc.setWindowOpenHandler(({ url: next }) => {
        try {
          void wc.loadURL(validatePreviewUrl(next)).catch(() => {});
        } catch {}
        return { action: 'deny' };
      });
      wc.on('did-start-loading', () => {
        entry.loading = true;
        entry.error = '';
        publish(entry);
      });
      wc.on('did-stop-loading', () => {
        entry.loading = false;
        publish(entry);
      });
      wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) {
          entry.error = description;
          entry.loading = false;
          publish(entry);
        }
      });
      for (const event of ['did-navigate', 'did-navigate-in-page', 'page-title-updated'])
        wc.on(event, () => publish(entry));
      await window.loadFile(path.join(__dirname, 'preview.html'));
      window.show();
      window.focus();
      void wc.loadURL(destination).catch((error) => {
        entry.error = error.message;
        publish(entry);
      });
      return state(entry);
    },
    state({ id }) {
      return state(find(id));
    },
    list() {
      return [...entries.values()].map(state);
    },
    navigate({ id, url }) {
      return act(find(id), { action: 'navigate', url });
    },
    capture({ id }) {
      return capture(find(id));
    },
    close({ id }) {
      find(id).window.close();
    },
    dispose() {
      for (const entry of [...entries.values()]) entry.window.close();
    },
  };
}
module.exports = { createWebPreviewManager, validatePreviewUrl };
