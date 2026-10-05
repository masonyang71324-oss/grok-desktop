const { translate: t, setLocale } = require('./i18n.cjs');
const { autoUpdater } = require('electron-updater');
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  dialog,
  shell,
  Menu,
  nativeTheme,
  Notification,
  screen,
  session: electronSession,
  clipboard,
  ClipboardItem,
} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { SessionHub } = require('./session-hub.cjs');
const { RuntimeActivity } = require('./background.cjs');
const { loadSettings, writeSettings, resolveGrok } = require('./settings.cjs');
const { runChecked, runProcess } = require('./process.cjs');
const { buildCommand, runManagement } = require('./management.cjs');
const workspace = require('./workspace.cjs');
const { createEventDelivery } = require('./event-delivery.cjs');
const { createNotifications } = require('./notifications.cjs');
const { resolveNativeDrop } = require('./native-drop.cjs');
const { normalizeZoomPercent, stepZoomPercent } = require('./interface-size.cjs');
const { createLogger } = require('./logger.cjs');
const { createWorkspaceWatcher } = require('./workspace-watch.cjs');
const { createCheckpointStore } = require('./checkpoints.cjs');
const { createProjectRunner } = require('./project-runner.cjs');
const { storeClipboardImage, previewAttachment } = require('./attachments.cjs');
const documentFormats = require('./document.cjs');
const { createAppUpdater } = require('./updater.cjs');
const { readCliStatus, selectUpdatedCli } = require('./cli-status.cjs');
const { CliInstaller } = require('./cli-installer.cjs');
const { ProviderStore } = require('./providers.cjs');
const { previewOffice } = require('./office-preview.cjs');
const { createTerminalManager } = require('./terminal.cjs');
const { spawnHostedPty } = require('./terminal-host-client.cjs');
const { createWebPreviewManager } = require('./web-preview.cjs');
const { launchDictation } = require('./dictation.cjs');
const { windowsPowerShellPath, isExecutableOpenTarget } = require('./system-launch.cjs');
const { createCheckpointTurnHooks } = require('./checkpoint-turns.cjs');
const { createAccessPolicy, projectKey } = require('./access-policy.cjs');
const { validateRequest } = require('./request-validation.cjs');
const { createAttachmentStorage } = require('./attachment-storage.cjs');
const { withUpdateHealth } = require('./update-health.cjs');
const { createDiagnostics } = require('./diagnostics.cjs');

app.enableSandbox();
app.setName('Grok Desktop');
app.setAppUserModelId('local.grok.desktop');
// A conventional override also lets packaged/automated launches isolate their data.
if (process.env.GROK_DESKTOP_DATA_DIR)
  app.setPath('userData', path.resolve(process.env.GROK_DESKTOP_DATA_DIR));
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
const settingsRecoveryWarnings = [];
let settings = loadSettings(settingsFile, (warning) => settingsRecoveryWarnings.push(warning)),
  settingsQueue = Promise.resolve();
setLocale(settings.language);
let requestedInterfaceZoom = normalizeZoomPercent(settings.ui.zoomPercent);
const access = createAccessPolicy();
const listedSessions = new Map();
const pendingProjectOperations = new Map();
/** @type {Set<{cwd:string,child:import('node:child_process').ChildProcess}>} */
const externalProjectTerminals = new Set();
const attachmentsDirectory = path.join(app.getPath('userData'), 'attachments');
const accessReady = (async () => {
  await fs.mkdir(attachmentsDirectory, { recursive: true });
  await access.grantManagedRoot(attachmentsDirectory);
  for (const cwd of new Set([...settings.recentProjects, settings.lastProject].filter(Boolean))) {
    try {
      const canonical = await fs.realpath(cwd);
      await access.grantProject(cwd, settings.projectTrust?.[projectKey(canonical)] !== false);
    } catch {
      /* Missing old folders can be selected again. */
    }
  }
  for (const filename of settings.selectedAttachments || []) {
    try {
      await access.grantFile(filename);
    } catch {
      /* A moved attachment is not silently reauthorized. */
    }
  }
  try {
    await access.grantExecutable(resolveGrok(settings.grokPath));
  } catch {
    /* First-run picker/installer supplies the executable. */
  }
})();
let win = null,
  quitting = false,
  exitDialogOpen = false,
  installUpdateRequested = false;
let engineState = { authStatus: 'unknown' };
let draftFlushTimer = null;
let draftAttachmentPaths = [];
const activity = new RuntimeActivity({
  isForegroundBusy: () => !!client.activeTurn,
});
const eventListeners = new Set();
const logger = createLogger(path.join(app.getPath('userData'), 'logs'));
const diagnostics = createDiagnostics({
  getMetadata: () => {
    const entries = [...client.sessions.values()];
    const { language, theme, permissionMode, updateChannel, autoReconnect, notifications, ui } =
      settings;
    let configured = false;
    try {
      configured = !!resolveGrok(settings.grokPath);
    } catch {
      /* No CLI configured. */
    }
    return {
      versions: {
        app: app.getVersion(),
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        cli: engineState.version || client.version,
      },
      platform: process.platform,
      arch: process.arch,
      settings: {
        language,
        theme,
        permissionMode,
        updateChannel,
        autoReconnect,
        notifications,
        ui: { zoomPercent: ui.zoomPercent },
      },
      engine: { configured, connection: client.catalog.connected ? 'ready' : 'disconnected' },
      counts: {
        sessions: entries.length,
        activeTasks: entries.filter((entry) => entry.running || entry.control).length,
        queuedTasks: entries.reduce((sum, entry) => sum + entry.queue.length, 0),
        pendingApprovals: entries.reduce((sum, entry) => sum + entry.permissions.size, 0),
      },
    };
  },
  readLogs: async () => {
    await logger.flush();
    return Promise.all(
      ['desktop.log.2', 'desktop.log.1', 'desktop.log'].map(async (name) => {
        try {
          return await fs.readFile(path.join(logger.directory, name), 'utf8');
        } catch (error) {
          if (error.code === 'ENOENT') return '';
          throw error;
        }
      }),
    );
  },
  chooseDestination: async ({ defaultName }) => {
    const selected = await dialog.showSaveDialog(win, {
      title: t('导出诊断包'),
      defaultPath: defaultName,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    return selected.canceled ? null : selected.filePath || null;
  },
});
const appUpdater = createAppUpdater({
  currentVersion: app.getVersion(),
  channel: settings.updateChannel === 'beta' ? 'beta' : 'stable',
  mode:
    !app.isPackaged || process.env.GROK_DESKTOP_TEST_GROK_SCRIPT
      ? 'development'
      : process.env.PORTABLE_EXECUTABLE_FILE
        ? 'portable'
        : 'installer',
  autoUpdater,
  emit,
  openExternal: (url) => shell.openExternal(url),
  requestInstall: () => {
    installUpdateRequested = true;
    app.quit();
  },
  logger,
});
const delivery = createEventDelivery((event) => {
  if (win && !win.isDestroyed()) win.webContents.send('desktop:event', event);
});
const notifications = createNotifications({
  getWindow: () => win,
  enabled: () => settings.notifications && !quitting,
  Notification,
  onFailure: () => logger.log('notification-failed'),
  onNavigate: ({ sessionId, requestId }) => {
    const task = client.listTasks().find((item) => item.sessionId === sessionId);
    emit({
      type: 'notification-activate',
      session: task ? { sessionId: task.sessionId, cwd: task.cwd, title: task.title || '' } : null,
      ...(requestId !== undefined ? { requestId } : {}),
    });
  },
});
const workspaceWatcher = createWorkspaceWatcher(emit, () => logger.log('workspace-watch-failed'));
const checkpoints = createCheckpointStore({
  directory: path.join(app.getPath('userData'), 'checkpoints'),
});
const runner = createProjectRunner({ emit: (type, data) => emit({ type, ...data }) });
const terminals = createTerminalManager({ spawnPty: spawnHostedPty, emit });
const cliInstaller = new CliInstaller({ emit });
const providers = new ProviderStore();
const attachmentStorage = createAttachmentStorage({
  directory: attachmentsDirectory,
  referencedPaths: async () => {
    const paths = [...draftAttachmentPaths];
    for (const entry of client.sessions.values())
      for (const item of [...entry.queue, ...(entry.running ? [entry.running.item] : [])])
        for (const file of item.payload.attachments || []) if (file.path) paths.push(file.path);
    return paths;
  },
});
const previews = createWebPreviewManager({
  BrowserWindow,
  WebContentsView,
  ipcMain,
  getParent: () => win,
  emit,
  attachmentsDirectory: path.join(app.getPath('userData'), 'attachments'),
  openExternal: (url) => shell.openExternal(url),
});
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
  authorizeRead: (input) => access.authorizeRead(input),
  storageFile: path.join(app.getPath('userData'), 'queued-tasks.json'),
  getExecutable: () => resolveGrok(settings.grokPath),
  emit,
  clientVersion: app.getVersion(),
  ...secureTurnHooks(
    createCheckpointTurnHooks({
      store: checkpoints,
      emit,
      chooseWithoutCheckpoint: async ({ cwd, sessionId }) => {
        const result = await dialog.showMessageBox(win, {
          type: 'warning',
          title: t('检查点空间已满'),
          message: t('本轮无法创建检查点。继续发送后，本轮文件改动将无法通过检查点恢复。'),
          detail: cwd,
          buttons: [t('取消并清理'), t('继续发送（无检查点）')],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1) emit({ type: 'checkpoint-storage-request', cwd, sessionId });
        return result.response === 1;
      },
    }),
  ),
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

function secureTurnHooks(hooks) {
  return {
    beforeTurn: async (input) => {
      access.project(input.cwd, true);
      const missing = [];
      for (const file of input.payload?.attachments || [])
        if (typeof file.text !== 'string') {
          try {
            await access.file(file.path);
          } catch (error) {
            if (error.code === 'FILE_ACCESS_NOT_REGISTERED') missing.push(file.path);
            else throw error;
          }
        }
      if (missing.length && !(await reauthorizeAttachmentPaths(missing)))
        throw new Error(t('原附件尚未重新授权，已取消本轮发送。'));
      return hooks.beforeTurn(input);
    },
    afterTurn: hooks.afterTurn,
  };
}
function sessionAccess(sessionId, write = true) {
  const entry =
    client.sessions.get(sessionId) ||
    (listedSessions.has(sessionId) ? { cwd: listedSessions.get(sessionId) } : null);
  if (!entry) throw new Error(t('请先打开该会话。'));
  access.project(entry.cwd, write);
  return entry;
}
async function listProjectSessions(cwd) {
  const project = access.project(cwd);
  if (!project.trusted) return [];
  const sessions = await client.listSessions({ cwd: project.cwd });
  for (const item of sessions) listedSessions.set(item.sessionId, project.cwd);
  return sessions;
}
function projectOperation(cwd, run) {
  const project = access.project(cwd, true),
    id = projectKey(project.cwd);
  pendingProjectOperations.set(id, (pendingProjectOperations.get(id) || 0) + 1);
  const release = () => {
    const count = (pendingProjectOperations.get(id) || 1) - 1;
    if (count) pendingProjectOperations.set(id, count);
    else pendingProjectOperations.delete(id);
  };
  try {
    return Promise.resolve(run(project.cwd)).finally(release);
  } catch (error) {
    release();
    throw error;
  }
}
async function projectManifest(cwd) {
  const directory = await validCwd(cwd);
  try {
    await access.file(path.join(directory, 'package.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return directory;
}
async function selectProjectTrust(cwd) {
  const current = access.project(cwd);
  const active = () =>
    (pendingProjectOperations.get(projectKey(current.cwd)) || 0) > 0 ||
    [...externalProjectTerminals].some(
      (record) =>
        projectKey(record.cwd) === projectKey(current.cwd) &&
        record.child.exitCode === null &&
        record.child.signalCode === null,
    ) ||
    client
      .listTasks()
      .some(
        (task) =>
          task.cwd === current.cwd &&
          (task.turnId ||
            task.finishing ||
            task.queued.length ||
            ['running', 'waiting', 'background'].includes(task.status)),
      ) ||
    terminals.state({ cwd: current.cwd })?.status === 'running' ||
    ['running', 'stopping'].includes(runner.state({ cwd: current.cwd }).status);
  if (active()) throw new Error(t('请先停止此项目的任务并清空队列，再更改信任设置。'));
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    title: t('是否信任此项目？'),
    message: t('信任后可运行 Grok、终端和项目脚本，并修改项目文件。不了解来源时可先只看文件。'),
    detail: current.cwd,
    buttons: [t('只看文件'), t('信任并启用'), t('取消')],
    defaultId: 0,
    cancelId: 2,
  });
  if (result.response === 2) return { ...current, cancelled: true };
  if (result.response === 0 && active())
    throw new Error(t('请先停止此项目的任务并清空队列，再更改信任设置。'));
  // This project already has a validated canonical identity. Change its in-memory
  // authority synchronously after the final active check, before persisting it.
  const grant = access.setProjectTrust(current.cwd, result.response === 1);
  await saveSettings({
    projectTrust: { ...settings.projectTrust, [projectKey(grant.cwd)]: grant.trusted },
  });
  if (!grant.trusted)
    for (const entry of client.sessions.values())
      if (entry.cwd === grant.cwd) entry.client.dispose();
  emit({ type: 'project-access', ...grant });
  return grant;
}
async function registerAttachments(files) {
  const selected = [];
  for (const file of files) selected.push({ ...file, path: await access.grantFile(file.path) });
  await saveSettings({
    selectedAttachments: [
      ...new Set([...(settings.selectedAttachments || []), ...selected.map((file) => file.path)]),
    ],
  });
  return selected;
}
async function selectDroppedProject(cwd) {
  let existing;
  try {
    existing = access.project(cwd);
  } catch {}
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    title: t('打开拖入的文件夹'),
    message: t(
      existing
        ? '将这个文件夹作为项目打开？'
        : '将这个文件夹作为项目打开？信任后可运行任务；不了解来源时可先只看文件。',
    ),
    detail: cwd,
    buttons: existing ? [t('打开项目'), t('取消')] : [t('只看文件'), t('信任并启用'), t('取消')],
    defaultId: 0,
    cancelId: existing ? 1 : 2,
  });
  if (result.response === (existing ? 1 : 2)) return null;
  if (existing) return existing.cwd;
  const grant = await access.grantProject(cwd, result.response === 1);
  await saveSettings({
    projectTrust: { ...settings.projectTrust, [projectKey(grant.cwd)]: grant.trusted },
  });
  return grant.cwd;
}
async function reauthorizeAttachmentPaths(paths) {
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.some((filename) => typeof filename !== 'string' || !path.isAbsolute(filename))
  )
    throw new Error(t('操作参数无效。'));
  const originals = [...new Set(paths)];
  const selected = await dialog.showOpenDialog(win, {
    title: t('重新选择原附件以恢复授权'),
    defaultPath: originals[0],
    properties: ['openFile', 'multiSelections'],
  });
  if (selected.canceled || !selected.filePaths.length) return false;
  const nativePaths = await Promise.all(
    selected.filePaths.map((filename) => fs.realpath(filename)),
  );
  const nativeKeys = new Set(nativePaths.map(projectKey));
  for (const original of originals) {
    const resolved = await fs.realpath(original);
    if (!nativeKeys.has(projectKey(resolved)))
      throw new Error(t('请选择原附件；若文件已移动，请重新添加附件后发送。'));
  }
  // Only aliases proven to refer to the actual native selection gain authority.
  for (const original of originals) await access.grantFile(original);
  await saveSettings({
    selectedAttachments: [
      ...new Set([...(settings.selectedAttachments || []), ...originals, ...nativePaths]),
    ],
  });
  emit({ type: 'attachment-authorization-changed', paths: originals });
  return true;
}

function saveSettings(patch) {
  if (patch.ui?.zoomPercent !== undefined)
    requestedInterfaceZoom = normalizeZoomPercent(patch.ui.zoomPercent);
  if (patch.grokPath !== undefined && patch.grokPath !== settings.grokPath)
    activity.assertSessionAllowed();
  const operation = settingsQueue
    .then(async () => {
      const changedPath = patch.grokPath !== undefined && patch.grokPath !== settings.grokPath;
      const save = async () => {
        let target;
        if (changedPath) {
          try {
            target = resolveGrok(patch.grokPath || undefined);
          } catch (error) {
            if (patch.grokPath) throw error;
          }
        }
        if (changedPath && target && !access.hasExecutable(target)) {
          const picked = await dialog.showOpenDialog(win, {
            title: t('确认要使用的 Grok Build 程序'),
            defaultPath: target,
            properties: ['openFile'],
            filters: [{ name: t('Windows 程序'), extensions: ['exe'] }],
          });
          if (picked.canceled || !picked.filePaths[0]) throw new Error(t('已取消选择程序。'));
          const selected = await access.grantExecutable(picked.filePaths[0]);
          patch = {
            ...patch,
            grokPath:
              !patch.grokPath && projectKey(selected) === projectKey(target) ? '' : selected,
          };
        }
        if (changedPath && patch.grokPath) resolveGrok(String(patch.grokPath).trim());
        settings = await writeSettings(settingsFile, {
          ...settings,
          ...patch,
          ui: { ...settings.ui, ...patch.ui },
        });
        setLocale(settings.language);
        if (patch.language !== undefined) updateMenu();
        nativeTheme.themeSource = settings.theme;
        if (
          patch.ui?.zoomPercent !== undefined &&
          normalizeZoomPercent(patch.ui.zoomPercent) === requestedInterfaceZoom
        )
          applyInterfaceSize();
        if (!settings.notifications) notifications.clear();
        if (changedPath) await client.restart();
        return publicSettings();
      };
      const persist = () => (changedPath ? activity.runMutation(save) : save());
      return patch.updateChannel !== undefined && patch.updateChannel !== settings.updateChannel
        ? appUpdater.changeChannel(patch.updateChannel, persist)
        : persist();
    })
    .catch((error) => {
      if (
        patch.ui?.zoomPercent !== undefined &&
        requestedInterfaceZoom === normalizeZoomPercent(patch.ui.zoomPercent)
      )
        requestedInterfaceZoom = normalizeZoomPercent(settings.ui.zoomPercent);
      throw error;
    });
  settingsQueue = operation.catch(() => {});
  return operation;
}

function applyInterfaceSize() {
  if (!win || win.isDestroyed()) return;
  const zoomPercent = normalizeZoomPercent(settings.ui.zoomPercent);
  win.webContents.setZoomFactor(zoomPercent / 100);
  emit({ type: 'interface-size', zoomPercent });
}
function changeInterfaceSize(direction) {
  const zoomPercent =
    direction === 'reset' ? 100 : stepZoomPercent(requestedInterfaceZoom, direction);
  void saveSettings({ ui: { zoomPercent } }).catch((error) => {
    if (requestedInterfaceZoom === zoomPercent)
      requestedInterfaceZoom = normalizeZoomPercent(settings.ui.zoomPercent);
    emit({
      type: 'interface-size',
      zoomPercent: normalizeZoomPercent(settings.ui.zoomPercent),
      error: error.message,
    });
  });
}

function publicSettings() {
  const { projectTrust, selectedAttachments, ...result } = settings;
  return result;
}

function runGrokDiagnostic(executable, args, options) {
  return runProcess(
    executable,
    process.env.GROK_DESKTOP_TEST_GROK_SCRIPT
      ? [path.resolve(process.env.GROK_DESKTOP_TEST_GROK_SCRIPT), ...args]
      : args,
    options,
  );
}

async function engineStatus({ checkUpdate = false } = {}) {
  const executable = resolveGrok(settings.grokPath);
  const next = await readCliStatus(executable, { run: runGrokDiagnostic, checkUpdate });
  engineState = { ...next, version: next.version || client.version };
  return { ...engineState, models: client.models };
}

async function refreshEngine() {
  activity.assertSessionAllowed();
  // The catalog connection owns no turns. Refreshing it keeps all session tasks alive.
  await client.catalog.restart();
  await engineStatus();
  return bootstrap();
}

async function validCwd(cwd, trusted = false) {
  access.project(cwd, trusted);
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd))
    throw new Error(t('请选择有效的项目目录。'));
  const stat = await fs.stat(cwd).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(t('项目目录不存在或无法访问，请重新选择。'));
  const resolved = await fs.realpath(cwd);
  access.project(resolved, trusted);
  return resolved;
}

async function bootstrap() {
  await accessReady;
  for (const entry of client.sessions.values()) {
    try {
      access.project(entry.cwd);
    } catch {
      try {
        const canonical = await fs.realpath(entry.cwd);
        await access.grantProject(
          entry.cwd,
          settings.projectTrust?.[projectKey(canonical)] !== false,
        );
      } catch {
        /* Missing historical projects stay unavailable. */
      }
    }
  }
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
    settings: publicSettings(),
    projects: access.projects(),
    recoveryWarnings: [...settingsRecoveryWarnings, ...(client.recoveryWarnings || [])],
    version: app.getVersion(),
    update: appUpdater.status(),
    cli: {
      path: cliPath,
      version,
      connected: !!client.connected,
      authStatus: engineState.path === cliPath ? engineState.authStatus : 'unknown',
      capabilities: client.capabilities || {},
      ...(error ? { error } : {}),
    },
    models: client.models || { currentModelId: '', availableModels: [] },
    commands: client.commands || [],
  };
}

/** @param {{target:string,cwd?:string,path?:string,url?:string}} input */
async function openSystem({ target, cwd, path: filepath, url }) {
  if (target === 'attachments' || target === 'data') {
    const error = await shell.openPath(
      target === 'attachments' ? attachmentsDirectory : app.getPath('userData'),
    );
    if (error) throw new Error(error);
    return;
  }
  if (target === 'logs') {
    await fs.mkdir(logger.directory, { recursive: true });
    const error = await shell.openPath(logger.directory);
    if (error) throw new Error(error);
    return;
  }
  if (target === 'workspace-file' || target === 'workspace-reveal') {
    access.project(cwd);
    const destination = workspace.resolveWorkspacePath(await validCwd(cwd), filepath);
    if (target === 'workspace-reveal') shell.showItemInFolder(destination);
    else return openLocalPath(await access.file(destination));
    return;
  }
  if (target === 'url') {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url))
      throw new Error(t('只支持打开网页链接。'));
    await shell.openExternal(url);
    return;
  }
  if (target === 'terminal' || target === 'grok-login') {
    const directory =
      target === 'grok-login'
        ? os.homedir()
        : access.project(cwd || settings.lastProject, true).cwd;
    const exe = resolveGrok(settings.grokPath);
    const code = `& '${exe.replaceAll("'", "''")}'${target === 'grok-login' ? ' login' : ''}`;
    const child = spawn(
      windowsPowerShellPath(),
      ['-NoLogo', '-NoExit', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')],
      { cwd: directory, detached: true, stdio: 'ignore', windowsHide: false },
    );
    if (target === 'terminal') {
      const record = { cwd: directory, child };
      externalProjectTerminals.add(record);
      child.once('exit', () => externalProjectTerminals.delete(record));
      child.once('error', () => externalProjectTerminals.delete(record));
    }
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
  return openLocalPath(
    target === 'config'
      ? destination
      : target === 'project'
        ? access.project(destination).cwd
        : await access.file(destination),
  );
}

async function openLocalPath(destination) {
  if (isExecutableOpenTarget(destination) && (await fs.stat(destination)).isFile()) {
    access.execution(destination);
    const result = await dialog.showMessageBox(win, {
      type: 'warning',
      title: t('此文件可能会执行程序'),
      message: t('系统默认程序可能直接运行此文件。仅在你信任其来源时继续。'),
      detail: destination,
      buttons: [t('取消'), t('仍然打开')],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) return { cancelled: true };
    access.execution(destination);
  }
  const error = await shell.openPath(destination);
  if (error) throw new Error(error);
}

async function exportSession({ cwd, sessionId }) {
  sessionAccess(sessionId);
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

/** @param {{action:string,cwd?:string,values?:{sessionId?:string,label?:string,copyMode?:string,gitRef?:string,[key:string]:unknown}}} input */
async function management({ action, cwd, values = {} }) {
  if (cwd && !action.startsWith('update-')) access.project(cwd, true);
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
      await access.grantProject(result.path, true);
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
    const directory = cwd && !action.startsWith('update-') ? await validCwd(cwd) : os.homedir();
    const executable = resolveGrok(settings.grokPath);
    const beforeUpdate =
      action === 'update-install'
        ? await readCliStatus(executable, { run: runGrokDiagnostic, checkUpdate: true })
        : null;
    if (beforeUpdate && !beforeUpdate.latestVersion)
      throw new Error(beforeUpdate.error || t('无法检查 Grok Build 更新，请检查网络后重试。'));
    const runCommand = () => runManagement(executable, action, values, directory);
    const result =
      action === 'update-install'
        ? await withUpdateHealth(executable, runCommand, (filename) =>
            runGrokDiagnostic(filename, ['--version'], { timeout: 10000, maxBytes: 4096 }),
          )
        : await runCommand();
    if (beforeUpdate) {
      const updatedPath = await selectUpdatedCli(
        executable,
        resolveGrok(),
        beforeUpdate.latestVersion,
        { run: runGrokDiagnostic },
      );
      if (updatedPath !== executable) {
        const savePath = settingsQueue.then(async () => {
          settings = await writeSettings(settingsFile, { ...settings, grokPath: updatedPath });
        });
        settingsQueue = savePath.catch(() => {});
        await savePath;
        await engineStatus();
      }
    }
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
  'cli.status': async (payload) => {
    try {
      return await engineStatus(payload);
    } catch (error) {
      return {
        path: '',
        version: '',
        authStatus: 'unknown',
        models: client.models,
        error: error.message,
      };
    }
  },
  'cli.refresh': refreshEngine,
  'cli.install.state': () => cliInstaller.state(),
  'cli.install.start': async () => {
    const result = await activity.runMutation(() => cliInstaller.start());
    if (result.status === 'installed') {
      await access.grantExecutable(result.path);
      await saveSettings({ grokPath: result.path });
    }
    return result;
  },
  'cli.install.cancel': () => cliInstaller.cancel(),
  'cli.login': () => openSystem({ target: 'grok-login', cwd: settings.lastProject }),
  'providers.list': () => providers.list(),
  'providers.save': (payload) =>
    activity.runMutation(async () => {
      const result = providers.save(payload);
      await client.restart();
      return result;
    }),
  'providers.remove': (payload) =>
    activity.runMutation(async () => {
      const result = providers.remove(payload);
      await client.restart();
      return result;
    }),
  'providers.enable': (payload) =>
    activity.runMutation(async () => {
      const result = providers.setEnabled(payload);
      await client.restart();
      return result;
    }),
  'office.preview': async (payload) =>
    previewOffice({ ...payload, path: await access.file(payload.path) }),
  'workspace.search': async (payload) =>
    workspace.searchFiles({ ...payload, cwd: await validCwd(payload.cwd) }),
  'terminal.open': (payload) =>
    projectOperation(payload.cwd, async (cwd) =>
      terminals.open({ ...payload, cwd: await validCwd(cwd, true) }),
    ),
  'terminal.state': (payload) => terminals.state(payload),
  'terminal.input': (payload) => terminals.write(payload),
  'terminal.resize': (payload) => terminals.resize(payload),
  'terminal.close': (payload) => terminals.close(payload),
  'preview.open': async (payload) =>
    previews.open({
      ...payload,
      owner: { ...payload.owner, cwd: await validCwd(payload.owner?.cwd) },
    }),
  'preview.capture': (payload) => previews.capture(payload),
  'preview.close': (payload) => previews.close(payload),
  'dictation.start': () => {
    win?.focus();
    return launchDictation({
      scriptPath: app.isPackaged ? path.join(process.resourcesPath, 'voice-typing.ps1') : undefined,
    });
  },
  'settings.save': saveSettings,
  'diagnostics.preview': () => diagnostics.preview(),
  'diagnostics.export': ({ id }) => diagnostics.export(id),
  'drafts.flush': ({ protectedPaths = [] }) => {
    draftAttachmentPaths = protectedPaths;
    if (!draftFlushTimer)
      draftFlushTimer = setTimeout(() => {
        draftFlushTimer = null;
        electronSession.defaultSession.flushStorageData();
      }, 250);
  },
  'clipboard.write': ({ text, html }) => {
    if (typeof text !== 'string') throw new Error(t('复制内容无效。'));
    return typeof html === 'string'
      ? clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([text], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ])
      : clipboard.writeText(text);
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
  'attachment.preview': async (payload) =>
    previewAttachment({ ...payload, path: await access.file(payload.path) }),
  'attachment.reauthorize': async ({ path: filename }) => ({
    authorized: await reauthorizeAttachmentPaths([filename]),
  }),
  'attachments.storage': (payload) => attachmentStorage.list(payload),
  'attachments.removeMany': (payload) => attachmentStorage.removeMany(payload),
  'dialog.grok': async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('选择 Grok Build 程序'),
      defaultPath: settings.grokPath || undefined,
      properties: ['openFile'],
      filters: [{ name: t('Windows 程序'), extensions: ['exe'] }],
    });
    return result.canceled ? null : access.grantExecutable(result.filePaths[0]);
  },
  'dialog.project': async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('打开项目'),
      defaultPath: settings.lastProject || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    let project;
    try {
      project = access.project(result.filePaths[0]);
    } catch {
      project = await access.grantProject(result.filePaths[0], false);
      if ((await selectProjectTrust(project.cwd)).cancelled) return null;
    }
    return project.cwd;
  },
  'dialog.attach': async () => {
    const result = await dialog.showOpenDialog(win, {
      title: t('添加文件上下文'),
      defaultPath: settings.lastProject || undefined,
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: t('常见文档'),
          extensions: ['pdf', 'pptx', 'ipynb', ...documentFormats.extensions, 'txt', 'md'],
        },
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
        { name: t('Word 与 WPS 文字'), extensions: documentFormats.groups.word },
        { name: t('表格'), extensions: documentFormats.groups.sheets },
        { name: t('演示文稿'), extensions: ['pptx', ...documentFormats.groups.ppt, 'odp', 'otp'] },
        { name: t('PDF 与 OFD'), extensions: ['pdf', 'ofd'] },
        { name: t('图片'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
        { name: t('所有文件'), extensions: ['*'] },
      ],
    });
    return result.canceled
      ? []
      : registerAttachments(
          result.filePaths.map((filename) => ({
            name: path.basename(filename),
            path: filename,
          })),
        );
  },
  'project.open': async ({ cwd }) => {
    const directory = await validCwd(cwd);
    await saveSettings({
      lastProject: directory,
      recentProjects: [directory, ...settings.recentProjects.filter((x) => x !== directory)],
    });
    const grant = access.project(directory);
    const sessions = await listProjectSessions(directory);
    workspaceWatcher.start(directory);
    return { cwd: directory, sessions, trusted: grant.trusted };
  },
  'project.access': ({ cwd }) => access.project(cwd),
  'project.trust': ({ cwd }) => selectProjectTrust(cwd),
  'sessions.list': async ({ cwd }) => listProjectSessions(await validCwd(cwd)),
  'session.new': (payload) =>
    projectOperation(payload.cwd, () =>
      activity.runSession(async () => {
        const snapshot = await client.newSession({
          ...payload,
          cwd: await validCwd(payload.cwd, true),
          permissionMode: payload.permissionMode || settings.permissionMode,
        });
        client.setActiveSession(snapshot.sessionId);
        return snapshot;
      }),
    ),
  'session.load': (payload) =>
    projectOperation(payload.cwd, () =>
      activity.runSession(async () => {
        const snapshot = await client.loadSession({
          ...payload,
          cwd: await validCwd(payload.cwd, true),
        });
        client.setActiveSession(snapshot.sessionId);
        return snapshot;
      }),
    ),
  // Existing sessions already own a validated canonical cwd. Register the turn
  // synchronously so a cancel cannot arrive before the hub owns the pending send.
  'session.send': (payload) => {
    sessionAccess(payload.sessionId);
    return activity.runSession(() => client.send(payload));
  },
  'session.enqueue': (payload) =>
    activity.runSession(async () =>
      client.enqueue({ ...payload, cwd: await validCwd(payload.cwd, true) }),
    ),
  'tasks.list': () => client.listTasks(),
  'tasks.remove': (payload) => client.remove(payload),
  'tasks.resume': (payload) => {
    sessionAccess(payload.sessionId);
    return activity.runSession(() => client.resume(payload));
  },
  'session.configure': (payload) => {
    sessionAccess(payload.sessionId);
    return activity.runSession(() => client.configure(payload));
  },
  'session.cancel': (payload) => client.cancel(payload),
  'session.permission': (payload) => {
    sessionAccess(payload.sessionId);
    return client.respondPermission(payload);
  },
  'session.permissions': (payload) => {
    sessionAccess(payload.sessionId);
    return client.setPermissionMode(payload);
  },
  'session.rename': (payload) => {
    sessionAccess(payload.sessionId);
    return client.rename(payload);
  },
  'session.delete': (payload) => {
    sessionAccess(payload.sessionId);
    return client.deleteSession(payload);
  },
  'session.export': exportSession,
  'session.usage': (payload) => {
    sessionAccess(payload.sessionId);
    return client.usage(payload);
  },
  'account.usage': () => require('./account.cjs').readAccountUsage(client),
  'workspace.list': async (payload) => {
    access.project(payload.cwd);
    await access.file(workspace.resolveWorkspacePath(payload.cwd, payload.path || ''));
    return workspace.listFiles(payload);
  },
  'workspace.read': async (payload) => {
    access.project(payload.cwd);
    await access.file(workspace.resolveWorkspacePath(payload.cwd, payload.path));
    return workspace.readFile(payload);
  },
  'workspace.save': async (payload) => {
    access.project(payload.cwd, true);
    await access.file(workspace.resolveWorkspacePath(payload.cwd, payload.path), true);
    return workspace.saveFile(payload);
  },
  'workspace.changes': (payload) => {
    access.project(payload.cwd);
    return workspace.gitChanges(payload);
  },
  'workspace.diff': async (payload) => {
    access.project(payload.cwd);
    const filename = workspace.resolveWorkspacePath(payload.cwd, payload.path);
    try {
      await access.file(filename);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return workspace.gitDiff(payload);
  },
  'checkpoints.list': async ({ cwd, sessionId }) =>
    checkpoints.list({ cwd: await validCwd(cwd), sessionId }),
  'checkpoints.detail': (payload) => checkpoints.detail(payload),
  'checkpoints.remove': (payload) => checkpoints.remove(payload),
  'checkpoints.storage': () => checkpoints.storage(),
  'checkpoints.removeMany': (payload) => checkpoints.removeMany(payload),
  'checkpoints.restore': async (payload) => {
    const checkpoint = await checkpoints.detail({ id: payload.id });
    const cwd = await validCwd(checkpoint.cwd, true);
    return client.runWorkspaceMutation(cwd, async () => {
      const result = await checkpoints.restore(payload);
      emit({ type: 'workspace-changed', cwd });
      emit({ type: 'checkpoints-changed', cwd, sessionId: checkpoint.sessionId });
      return result;
    });
  },
  'runner.inspect': async ({ cwd }) => runner.inspect({ cwd: await projectManifest(cwd) }),
  'runner.state': async ({ cwd }) => runner.state({ cwd: await validCwd(cwd) }),
  'runner.start': ({ cwd, script }) =>
    projectOperation(cwd, async (directory) =>
      runner.start({ cwd: await projectManifest(directory), script }),
    ),
  'runner.stop': async ({ cwd }) => runner.stop({ cwd: await validCwd(cwd) }),
  'update.status': () => appUpdater.status(),
  'update.check': () => appUpdater.check(),
  'update.download': () => appUpdater.download(),
  'update.install': () => appUpdater.install(),
  'system.open': openSystem,
  'system.run': management,
};

ipcMain.handle('desktop:request', async (event, command, payload) => {
  if (
    !win ||
    event.sender !== win.webContents ||
    event.senderFrame !== win.webContents.mainFrame ||
    !Object.hasOwn(handlers, command)
  )
    return { ok: false, error: t('不支持的操作。') };
  try {
    const checked = validateRequest(command, payload ?? {});
    if (command === 'settings.save') {
      if (checked.recentProjects)
        checked.recentProjects = checked.recentProjects.map((cwd) => access.project(cwd).cwd);
      if (checked.lastProject) checked.lastProject = access.project(checked.lastProject).cwd;
    }
    return { ok: true, data: await handlers[command](checked) };
  } catch (error) {
    const message = error?.message || String(error);
    logger.log('request-failed', { command, code: error.code || error.name || 'Error' });
    return { ok: false, error: message };
  }
});
ipcMain.handle('desktop:files-selected', async (event, files, mode = 'files') => {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
    return { ok: false, error: t('不支持的操作。') };
  try {
    validateRequest('session.send', { sessionId: 'file-selection', attachments: files });
    if (
      !Array.isArray(files) ||
      files.some((file) => typeof file.path !== 'string' || typeof file.name !== 'string')
    )
      throw new Error(t('操作参数无效。'));
    if (!['files', 'drop'].includes(mode)) throw new Error(t('操作参数无效。'));
    return {
      ok: true,
      data:
        mode === 'drop'
          ? await resolveNativeDrop(files, {
              selectProject: selectDroppedProject,
              registerFiles: registerAttachments,
            })
          : await registerAttachments(files),
    };
  } catch (error) {
    return { ok: false, error: error.message };
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
  win.webContents.on('did-finish-load', applyInterfaceSize);
  win.webContents.on('zoom-changed', (_event, direction) => changeInterfaceSize(direction));
  win.on('closed', () => previews.dispose());
  const scheduleWindowSave = () => {
    clearTimeout(windowSaveTimer);
    windowSaveTimer = setTimeout(saveWindowState, 300);
  };
  win.on('resize', scheduleWindowSave);
  win.on('move', scheduleWindowSave);
  win.on('maximize', scheduleWindowSave);
  win.on('unmaximize', scheduleWindowSave);
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
    else {
      quitting = false;
      installUpdateRequested = false;
    }
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
    if (quitting || (!activity.busy && !runner.busy && !terminals.busy)) return;
    event.preventDefault();
    if (exitDialogOpen) return;
    exitDialogOpen = true;
    dialog
      .showMessageBox(win, {
        type: 'question',
        title: t('任务仍在运行'),
        message: t('退出会中断 Grok 正在执行的任务。'),
        detail: t('包括此应用启动的本地代理、后台任务、项目脚本和交互终端。会话记录会保留。'),
        buttons: [t('继续运行'), t('停止并退出')],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        exitDialogOpen = false;
        if (response === 1) {
          quitting = true;
          app.quit();
        } else installUpdateRequested = false;
      });
  });
  if (!app.isPackaged && process.env.GROK_DESKTOP_DEV_URL)
    win.loadURL(process.env.GROK_DESKTOP_DEV_URL);
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
          {
            label: t('实际大小'),
            accelerator: 'CommandOrControl+0',
            click: () => changeInterfaceSize('reset'),
          },
          {
            label: t('放大'),
            accelerator: 'CommandOrControl+Plus',
            click: () => changeInterfaceSize('in'),
          },
          {
            label: t('缩小'),
            accelerator: 'CommandOrControl+-',
            click: () => changeInterfaceSize('out'),
          },
          { type: 'separator' },
          ...(!app.isPackaged || process.env.GROK_DESKTOP_DEVTOOLS === '1'
            ? [
                /** @type {import('electron').MenuItemConstructorOptions} */ ({
                  role: 'toggleDevTools',
                  label: t('开发者工具'),
                }),
              ]
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
    const idleTimer = setInterval(() => {
      if (!quitting && !activity.mutating) client.collectIdle();
    }, 30000);
    idleTimer.unref();
    appUpdater.start();
    if (appUpdater.status().mode !== 'development') {
      const timer = setTimeout(() => void appUpdater.check().catch(() => {}), 10_000);
      timer.unref?.();
    }
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
    clearTimeout(draftFlushTimer);
    draftFlushTimer = null;
    electronSession.defaultSession.flushStorageData();
    workspaceWatcher.close();
    previews.dispose();
    const agentShutdown = client.dispose();
    delivery.dispose();
    notifications.clear();
    logger.log('app-stop');
    Promise.allSettled([
      settingsQueue,
      logger.flush(),
      runner.dispose(),
      agentShutdown,
      terminals.dispose(),
      cliInstaller.dispose(),
    ]).then(() => {
      shutdownReady = true;
      if (installUpdateRequested) {
        try {
          autoUpdater.quitAndInstall(false, true);
        } catch (error) {
          logger.log('update-install-failed', { code: error.code || error.name || 'Error' });
          app.quit();
        }
      } else app.quit();
    });
  });
}
