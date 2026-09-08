const { translate: t, setLocale } = require('./i18n.cjs');
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  nativeTheme,
  Notification,
  screen,
  session: electronSession,
  clipboard,
} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { SessionHub } = require('./session-hub.cjs');
const { RuntimeActivity } = require('./background.cjs');
const { loadSettings, writeSettings, resolveGrok } = require('./settings.cjs');
const { runChecked } = require('./process.cjs');
const { buildCommand, runManagement } = require('./management.cjs');
const workspace = require('./workspace.cjs');
const { createEventDelivery } = require('./event-delivery.cjs');
const { createNotifications } = require('./notifications.cjs');
const { createLogger } = require('./logger.cjs');
const { createWorkspaceWatcher } = require('./workspace-watch.cjs');
const { createCheckpointStore } = require('./checkpoints.cjs');
const { createProjectRunner } = require('./project-runner.cjs');
const { storeClipboardImage, previewAttachment } = require('./attachments.cjs');

app.enableSandbox();
app.setName('Grok Desktop');
app.setAppUserModelId('local.grok.desktop');
// A conventional override also lets packaged/automated launches isolate their data.
if (process.env.GROK_DESKTOP_DATA_DIR)
  app.setPath('userData', path.resolve(process.env.GROK_DESKTOP_DATA_DIR));
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
let settings = loadSettings(settingsFile),
  settingsQueue = Promise.resolve();
setLocale(settings.language);
let win = null,
  quitting = false,
  exitDialogOpen = false;
const activity = new RuntimeActivity({
  isForegroundBusy: () => !!client.activeTurn,
});
const eventListeners = new Set();
const logger = createLogger(path.join(app.getPath('userData'), 'logs'));
const delivery = createEventDelivery((event) => {
  if (win && !win.isDestroyed()) win.webContents.send('desktop:event', event);
});
const notifications = createNotifications({
  getWindow: () => win,
  enabled: () => settings.notifications && !quitting,
  Notification,
  onFailure: () => logger.log('notification-failed'),
});
const workspaceWatcher = createWorkspaceWatcher(emit, () => logger.log('workspace-watch-failed'));
const checkpoints = createCheckpointStore({
  directory: path.join(app.getPath('userData'), 'checkpoints'),
});
const activeCheckpoints = new Map();
const runner = createProjectRunner({ emit: (type, data) => emit({ type, ...data }) });
logger.log('app-start', { version: app.getVersion() });

function emit(event) {
  for (const listener of eventListeners) listener(event);
  activity.onEvent(event);
  notifications.receive(event);
  if (event.type === 'connection') logger.log('connection', { state: event.state });
  if (event.type === 'turn-error') logger.log('turn-error');
  delivery.push(event);
}

const client = new SessionHub({
  storageFile: path.join(app.getPath('userData'), 'queued-tasks.json'),
  getExecutable: () => resolveGrok(settings.grokPath),
  emit,
  clientVersion: app.getVersion(),
  beforeTurn: async ({ cwd, sessionId, turnId }) => {
    const id = await checkpoints.begin({ cwd, sessionId, turnId });
    activeCheckpoints.set(turnId, id);
  },
  afterTurn: async ({ cwd, sessionId, turnId }) => {
    const id = activeCheckpoints.get(turnId);
    if (!id) return;
    try {
      await checkpoints.finish(id);
      emit({ type: 'checkpoints-changed', cwd, sessionId });
    } finally {
      activeCheckpoints.delete(turnId);
    }
  },
  ...(process.env.GROK_DESKTOP_TEST_GROK_SCRIPT
    ? {
        spawnFn: (executable, args, options) =>
          spawn(
            executable,
            [path.resolve(process.env.GROK_DESKTOP_TEST_GROK_SCRIPT), ...args],
            options,
          ),
      }
    : {}),
});

function saveSettings(patch) {
  if (patch.grokPath !== undefined && patch.grokPath !== settings.grokPath)
    activity.assertSessionAllowed();
  const operation = settingsQueue.then(async () => {
    const changedPath = patch.grokPath !== undefined && patch.grokPath !== settings.grokPath;
    const save = async () => {
      if (changedPath && patch.grokPath) resolveGrok(String(patch.grokPath).trim());
      settings = await writeSettings(settingsFile, {
        ...settings,
        ...patch,
        ui: { ...settings.ui, ...patch.ui },
      });
      setLocale(settings.language);
      if (patch.language !== undefined) updateMenu();
      nativeTheme.themeSource = settings.theme;
      if (!settings.notifications) notifications.clear();
      if (changedPath) await client.restart();
      return settings;
    };
    return changedPath ? activity.runMutation(save) : save();
  });
  settingsQueue = operation.catch(() => {});
  return operation;
}

async function validCwd(cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd))
    throw new Error(t('请选择有效的项目目录。'));
  const stat = await fs.stat(cwd).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(t('项目目录不存在或无法访问，请重新选择。'));
  return fs.realpath(cwd);
}

async function bootstrap() {
  let cliPath = '',
    version = '',
    error;
  try {
    cliPath = resolveGrok(settings.grokPath);
    await client.ensure();
    version =
      client.version ||
      (await runChecked(cliPath, ['--version'], { timeout: 10000 })).stdout.trim();
    await client.getCommands();
  } catch (e) {
    error = e.message;
  }
  return {
    settings,
    version: app.getVersion(),
    cli: {
      path: cliPath,
      version,
      connected: !!client.connected,
      capabilities: client.capabilities || {},
      ...(error ? { error } : {}),
    },
    models: client.models || { currentModelId: '', availableModels: [] },
    commands: client.commands || [],
  };
}

async function openSystem({ target, cwd, path: filepath, url }) {
  if (target === 'logs') {
    await fs.mkdir(logger.directory, { recursive: true });
    const error = await shell.openPath(logger.directory);
    if (error) throw new Error(error);
    return;
  }
  if (target === 'workspace-file' || target === 'workspace-reveal') {
    const destination = workspace.resolveWorkspacePath(await validCwd(cwd), filepath);
    if (target === 'workspace-reveal') shell.showItemInFolder(destination);
    else {
      const error = await shell.openPath(destination);
      if (error) throw new Error(error);
    }
    return;
  }
  if (target === 'url') {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url))
      throw new Error(t('只支持打开网页链接。'));
    await shell.openExternal(url);
    return;
  }
  if (target === 'terminal') {
    const directory = await validCwd(cwd || settings.lastProject || os.homedir());
    const exe = resolveGrok(settings.grokPath);
    const code = `& '${exe.replaceAll("'", "''")}'`;
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoExit', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')],
      { cwd: directory, detached: true, stdio: 'ignore', windowsHide: false },
    );
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    return;
  }
  const destination =
    target === 'project'
      ? await validCwd(cwd)
      : target === 'config'
        ? path.join(process.env.GROK_HOME || path.join(os.homedir(), '.grok'), 'config.toml')
        : filepath;
  if (!destination || !path.isAbsolute(destination)) throw new Error(t('请选择有效的文件或目录。'));
  const error = await shell.openPath(destination);
  if (error) throw new Error(error);
}

async function exportSession({ cwd, sessionId }) {
  const result = await dialog.showSaveDialog(win, {
    title: t('导出会话'),
    defaultPath: path.join(app.getPath('downloads'), `Grok-${sessionId.slice(0, 8)}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (result.canceled || !result.filePath) return null;
  // Ask the official exporter for the complete transcript, including off-screen history.
  const exported = await runChecked(resolveGrok(settings.grokPath), ['export', sessionId], {
    cwd: await validCwd(cwd),
    timeout: 30000,
    maxBytes: 32 * 1024 * 1024,
  });
  await fs.writeFile(result.filePath, exported.stdout, 'utf8');
  return { path: result.filePath };
}

async function management({ action, cwd, values = {} }) {
  if (action === 'worktree-create') {
    return activity.runMutation(async () => {
      const directory = await validCwd(cwd);
      if (!(await workspace.gitChanges({ cwd: directory })).isGit)
        throw new Error(t('当前项目还不是 Git 仓库，无法创建工作树。'));
      if (!values.sessionId) throw new Error(t('请先创建或打开一个会话。'));
      const label = String(values.label || '').trim();
      if (!label || /[<>:"/\\|?*]/.test(label) || label === '.' || label === '..')
        throw new Error(t('请填写有效的工作树名称，不要使用路径符号。'));
      const picked = await dialog.showOpenDialog(win, {
        title: t('选择新工作树的存放目录'),
        defaultPath: path.dirname(directory),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (picked.canceled) return { text: t('已取消创建。'), data: { cancelled: true } };
      const result = await require('./worktree.cjs').createWorktree({
        client,
        subscribe: (listener) => {
          eventListeners.add(listener);
          return () => eventListeners.delete(listener);
        },
        sessionId: values.sessionId,
        cwd: directory,
        worktreePath: path.join(picked.filePaths[0], label),
        copyMode: values.copyMode,
        gitRef: values.gitRef,
        label,
      });
      return {
        text: t(result.existed ? '工作树已存在：{path}' : '工作树已创建：{path}', {
          path: result.path,
        }),
        data: result,
      };
    });
  }
  if (action === 'memory-list') return require('./capabilities.cjs').listMemory();
  if (
    [
      'workflow-list',
      'task-list',
      'subagent-list',
      'task-stop',
      'subagent-stop',
      'schedule-delete',
    ].includes(action)
  ) {
    return require('./capabilities.cjs').runCapability(client, action, {
      cwd,
      ...values,
    });
  }
  const command = buildCommand(action, values);
  const run = async () => {
    const directory = cwd ? await validCwd(cwd) : os.homedir();
    const result = await runManagement(resolveGrok(settings.grokPath), action, values, directory);
    if (command.mutates) {
      await client.restart();
      emit({
        type: 'notification',
        kind: 'settings-reloaded',
        payload: { message: t('配置已更新，Grok 已重新连接。') },
      });
    }
    return result;
  };
  return command.mutates ? activity.runMutation(run) : run();
}

const handlers = {
  bootstrap,
  'settings.save': saveSettings,
  'clipboard.write': ({ text }) => {
    if (typeof text !== 'string') throw new Error(t('复制内容无效。'));
    return clipboard.writeText(text);
  },
  'clipboard.image': async () => {
    const items = await clipboard.read();
    const image = items.find((item) => item.types.includes('image/png'));
    if (!image) return null;
    const blob = await image.getType('image/png');
    return storeClipboardImage(
      Buffer.from(await blob.arrayBuffer()),
      path.join(app.getPath('userData'), 'attachments'),
    );
  },
  'attachment.preview': previewAttachment,
  'dialog.grok': async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('选择 Grok Build 程序'),
      defaultPath: settings.grokPath || undefined,
      properties: ['openFile'],
      filters: [{ name: t('Windows 程序'), extensions: ['exe'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  },
  'dialog.project': async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('打开项目'),
      defaultPath: settings.lastProject || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  },
  'dialog.attach': async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('添加文件上下文'),
      defaultPath: settings.lastProject || undefined,
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: t('文本与代码'),
          extensions: [
            'txt',
            'md',
            'json',
            'js',
            'jsx',
            'ts',
            'tsx',
            'py',
            'rs',
            'go',
            'java',
            'c',
            'cpp',
            'h',
            'css',
            'html',
            'xml',
            'yaml',
            'yml',
            'toml',
            'csv',
            'log',
            'sql',
            'sh',
            'ps1',
          ],
        },
        { name: t('图片'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
        { name: t('所有文件'), extensions: ['*'] },
      ],
    });
    return result.canceled
      ? []
      : result.filePaths.map((filename) => ({
          name: path.basename(filename),
          path: filename,
        }));
  },
  'project.open': async ({ cwd }) => {
    const directory = await validCwd(cwd);
    await saveSettings({
      lastProject: directory,
      recentProjects: [directory, ...settings.recentProjects.filter((x) => x !== directory)],
    });
    const sessions = await client.listSessions({ cwd: directory });
    workspaceWatcher.start(directory);
    return { cwd: directory, sessions };
  },
  'sessions.list': async ({ cwd }) => client.listSessions({ cwd: await validCwd(cwd) }),
  'session.new': (payload) =>
    activity.runSession(async () =>
      client.newSession({
        ...payload,
        cwd: await validCwd(payload.cwd),
        permissionMode: payload.permissionMode || settings.permissionMode,
      }),
    ),
  'session.load': (payload) =>
    activity.runSession(async () =>
      client.loadSession({ ...payload, cwd: await validCwd(payload.cwd) }),
    ),
  'session.send': (payload) =>
    activity.runSession(async () => client.send({ ...payload, cwd: await validCwd(payload.cwd) })),
  'session.enqueue': (payload) =>
    activity.runSession(async () =>
      client.enqueue({ ...payload, cwd: await validCwd(payload.cwd) }),
    ),
  'tasks.list': () => client.listTasks(),
  'tasks.remove': (payload) => client.remove(payload),
  'tasks.resume': (payload) => activity.runSession(() => client.resume(payload)),
  'session.configure': (payload) => activity.runSession(() => client.configure(payload)),
  'session.cancel': (payload) => client.cancel(payload),
  'session.permission': (payload) => client.respondPermission(payload),
  'session.permissions': (payload) => client.setPermissionMode(payload),
  'session.rename': (payload) => client.rename(payload),
  'session.delete': (payload) => client.deleteSession(payload),
  'session.export': exportSession,
  'session.usage': (payload) => client.usage(payload),
  'account.usage': () => require('./account.cjs').readAccountUsage(client),
  'workspace.list': workspace.listFiles,
  'workspace.read': workspace.readFile,
  'workspace.save': workspace.saveFile,
  'workspace.changes': workspace.gitChanges,
  'workspace.diff': workspace.gitDiff,
  'checkpoints.list': async ({ cwd, sessionId }) =>
    checkpoints.list({ cwd: await validCwd(cwd), sessionId }),
  'checkpoints.detail': (payload) => checkpoints.detail(payload),
  'checkpoints.remove': (payload) => checkpoints.remove(payload),
  'checkpoints.restore': async (payload) => {
    const checkpoint = await checkpoints.detail({ id: payload.id });
    const cwd = await validCwd(checkpoint.cwd);
    return client.runWorkspaceMutation(cwd, async () => {
      const result = await checkpoints.restore(payload);
      emit({ type: 'workspace-changed', cwd });
      emit({ type: 'checkpoints-changed', cwd, sessionId: checkpoint.sessionId });
      return result;
    });
  },
  'runner.inspect': async ({ cwd }) => runner.inspect({ cwd: await validCwd(cwd) }),
  'runner.state': async ({ cwd }) => runner.state({ cwd: await validCwd(cwd) }),
  'runner.start': async ({ cwd, script }) => runner.start({ cwd: await validCwd(cwd), script }),
  'runner.stop': async ({ cwd }) => runner.stop({ cwd: await validCwd(cwd) }),
  'system.open': openSystem,
  'system.run': management,
};

ipcMain.handle('desktop:request', async (event, command, payload) => {
  if (!win || event.sender !== win.webContents || !Object.hasOwn(handlers, command))
    return { ok: false, error: t('不支持的操作。') };
  try {
    return { ok: true, data: await handlers[command](payload ?? {}) };
  } catch (error) {
    const message = error?.message || String(error);
    logger.log('request-failed', { command, code: error.code || error.name || 'Error' });
    return { ok: false, error: message };
  }
});

let windowSaveTimer;
function saveWindowState() {
  clearTimeout(windowSaveTimer);
  if (!win || win.isDestroyed()) return;
  void saveSettings({ window: { ...win.getNormalBounds(), maximized: win.isMaximized() } }).catch(
    () => {},
  );
}
function createWindow() {
  nativeTheme.themeSource = settings.theme;
  const saved = settings.window;
  const area = saved
    ? screen.getDisplayMatching(saved).workArea
    : screen.getPrimaryDisplay().workArea;
  const width = Math.min(Math.max(980, saved?.width || 1480), area.width);
  const height = Math.min(Math.max(680, saved?.height || 960), area.height);
  win = new BrowserWindow({
    width,
    height,
    ...(saved
      ? {
          x: Math.max(area.x, Math.min(saved.x, area.x + area.width - width)),
          y: Math.max(area.y, Math.min(saved.y, area.y + area.height - height)),
        }
      : {}),
    minWidth: Math.min(980, area.width),
    minHeight: Math.min(680, area.height),
    show: false,
    title: 'Grok Desktop',
    backgroundColor: '#111517',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => {
    if (saved?.maximized) win.maximize();
    win.show();
  });
  win.on('focus', () => notifications.clear());
  for (const name of ['resize', 'move', 'maximize', 'unmaximize'])
    win.on(name, () => {
      clearTimeout(windowSaveTimer);
      windowSaveTimer = setTimeout(saveWindowState, 300);
    });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-prevent-unload', (event) => {
    const response = dialog.showMessageBoxSync(win, {
      type: 'warning',
      title: t('文件有未保存的修改'),
      message: t('关闭或重新载入会丢失尚未保存的文件修改。'),
      buttons: [t('继续编辑'), t('放弃修改并继续')],
      defaultId: 0,
      cancelId: 0,
    });
    if (response === 1) event.preventDefault();
    else quitting = false;
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.log('renderer-gone', { reason: details.reason });
    if (!quitting)
      dialog
        .showMessageBox(win, {
          type: 'error',
          title: t('界面已停止响应'),
          message: t('界面进程异常退出。'),
          detail: t('重新载入界面后会恢复仍在运行的任务和待批准操作。'),
          buttons: [t('重新连接并载入'), t('关闭')],
        })
        .then(({ response }) => {
          if (!win || win.isDestroyed()) return;
          if (response === 0) {
            win.reload();
          } else win.close();
        })
        .catch(() => logger.log('recovery-dialog-failed'));
  });
  win.on('close', (event) => {
    saveWindowState();
    if (quitting || (!activity.busy && !runner.busy)) return;
    event.preventDefault();
    if (exitDialogOpen) return;
    exitDialogOpen = true;
    dialog
      .showMessageBox(win, {
        type: 'question',
        title: t('任务仍在运行'),
        message: t('退出会中断 Grok 正在执行的任务。'),
        detail: t('包括此应用启动的本地代理、后台任务和项目脚本。会话记录会保留。'),
        buttons: [t('继续运行'), t('停止并退出')],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        exitDialogOpen = false;
        if (response === 1) {
          quitting = true;
          app.quit();
        }
      });
  });
  if (process.env.GROK_DESKTOP_DEV_URL) win.loadURL(process.env.GROK_DESKTOP_DEV_URL);
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
}

function updateMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: t('编辑'),
        submenu: [
          { role: 'undo', label: t('撤销') },
          { role: 'redo', label: t('重做') },
          { type: 'separator' },
          { role: 'cut', label: t('剪切') },
          { role: 'copy', label: t('复制') },
          { role: 'paste', label: t('粘贴') },
          { role: 'selectAll', label: t('全选') },
        ],
      },
      {
        label: t('视图'),
        submenu: [
          { role: 'resetZoom', label: t('实际大小') },
          { role: 'zoomIn', label: t('放大') },
          { role: 'zoomOut', label: t('缩小') },
          { type: 'separator' },
          ...(!app.isPackaged || process.env.GROK_DESKTOP_DEVTOOLS === '1'
            ? [{ role: 'toggleDevTools', label: t('开发者工具') }]
            : []),
        ],
      },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    electronSession.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    updateMenu();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  let shutdownReady = false,
    shutdownStarted = false;
  app.on('before-quit', (event) => {
    if (shutdownReady) return;
    event.preventDefault();
    // Closing the window first lets both task and unsaved-editor confirmation cancel
    // without already disposing the running agent or the settings/log queues.
    if (win && !win.isDestroyed()) {
      win.close();
      return;
    }
    if (shutdownStarted) return;
    shutdownStarted = true;
    quitting = true;
    saveWindowState();
    workspaceWatcher.close();
    const agentShutdown = client.dispose();
    delivery.dispose();
    notifications.clear();
    logger.log('app-stop');
    Promise.allSettled([settingsQueue, logger.flush(), runner.dispose(), agentShutdown]).then(
      () => {
        shutdownReady = true;
        app.quit();
      },
    );
  });
}
