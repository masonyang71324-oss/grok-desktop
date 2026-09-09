const RELEASES_URL = 'https://github.com/masonyang71324-oss/grok-desktop/releases';
const LATEST_RELEASE_API =
  'https://api.github.com/repos/masonyang71324-oss/grok-desktop/releases/latest';

function versionParts(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

function isNewerVersion(candidate, current) {
  const left = versionParts(candidate);
  const right = versionParts(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function createAppUpdater({
  currentVersion,
  mode,
  autoUpdater,
  emit = () => {},
  openExternal = async () => {},
  fetchFn = globalThis.fetch,
  requestInstall = () => {},
  logger = { log() {} },
}) {
  let state = {
    mode,
    status: mode === 'development' ? 'unsupported' : 'idle',
    currentVersion,
  };
  let started = false;
  let checkPromise = null;
  let downloadPromise = null;

  const snapshot = () => ({ ...state });
  const publish = (patch) => {
    state = { ...state, ...patch };
    if (patch.status !== 'error') delete state.error;
    emit({ type: 'app-update', state: snapshot() });
    logger.log('app-update', {
      state: `${state.mode}:${state.status}`,
      version: state.availableVersion || state.currentVersion,
    });
    return snapshot();
  };
  const fail = (error) => {
    const message = error?.message || String(error);
    publish({ status: 'error', error: message });
    throw error;
  };

  function start() {
    if (started || mode !== 'installer' || !autoUpdater) return snapshot();
    started = true;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('checking-for-update', () => publish({ status: 'checking' }));
    autoUpdater.on('update-available', (info) =>
      publish({
        status: 'available',
        availableVersion: info?.version,
        releaseName: info?.releaseName,
      }),
    );
    autoUpdater.on('update-not-available', () => publish({ status: 'current' }));
    autoUpdater.on('download-progress', (progress) =>
      publish({
        status: 'downloading',
        percent: Math.max(0, Math.min(100, Number(progress?.percent) || 0)),
      }),
    );
    autoUpdater.on('update-downloaded', (info) =>
      publish({
        status: 'downloaded',
        availableVersion: info?.version || state.availableVersion,
        percent: 100,
      }),
    );
    autoUpdater.on('error', (error) => {
      publish({ status: 'error', error: error?.message || String(error) });
    });
    return snapshot();
  }

  async function checkPortable() {
    if (typeof fetchFn !== 'function') throw new Error('当前环境无法访问更新服务。');
    const response = await fetchFn(LATEST_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Grok-Desktop',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`更新服务返回 ${response.status || '错误'}。`);
    const release = await response.json();
    const availableVersion = String(release.tag_name || '').replace(/^v/i, '');
    if (!availableVersion) throw new Error('更新服务没有返回有效版本号。');
    return publish(
      isNewerVersion(availableVersion, currentVersion)
        ? {
            status: 'available',
            availableVersion,
            releaseUrl: release.html_url || RELEASES_URL,
          }
        : { status: 'current', availableVersion: undefined, releaseUrl: RELEASES_URL },
    );
  }

  function check() {
    if (checkPromise) return checkPromise;
    if (state.status === 'downloading') return Promise.resolve(snapshot());
    if (mode === 'development') return Promise.resolve(snapshot());
    publish({ status: 'checking', percent: undefined });
    checkPromise = (async () => {
      try {
        if (mode === 'portable') return await checkPortable();
        start();
        await autoUpdater.checkForUpdates();
        return snapshot();
      } catch (error) {
        return fail(error);
      } finally {
        checkPromise = null;
      }
    })();
    return checkPromise;
  }

  function download() {
    if (downloadPromise) return downloadPromise;
    if (mode === 'portable') {
      const url = state.releaseUrl || RELEASES_URL;
      return openExternal(url).then(() => snapshot());
    }
    if (mode !== 'installer') return Promise.reject(new Error('开发环境不支持下载更新。'));
    if (state.status !== 'available')
      return Promise.reject(new Error('当前没有可以下载的新版本。'));
    publish({ status: 'downloading' });
    downloadPromise = Promise.resolve(autoUpdater.downloadUpdate())
      .then(() => snapshot())
      .catch(fail)
      .finally(() => {
        downloadPromise = null;
      });
    return downloadPromise;
  }

  async function install() {
    if (mode !== 'installer') throw new Error('便携版不能自动安装，请下载并运行安装版。');
    if (state.status !== 'downloaded') throw new Error('更新尚未下载完成。');
    await requestInstall();
    return snapshot();
  }

  return { start, check, download, install, status: snapshot };
}

module.exports = {
  LATEST_RELEASE_API,
  RELEASES_URL,
  createAppUpdater,
  isNewerVersion,
};
