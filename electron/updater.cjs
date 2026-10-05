const { translate: t } = require('./i18n.cjs');
const semver = require('semver');
const RELEASES_URL = 'https://github.com/masonyang71324-oss/grok-desktop/releases';
const LATEST_RELEASE_API =
  'https://api.github.com/repos/masonyang71324-oss/grok-desktop/releases/latest';

function isNewerVersion(candidate, current) {
  return !!(semver.valid(candidate) && semver.valid(current) && semver.gt(candidate, current));
}

/** @param {{currentVersion: string, mode: 'development'|'portable'|'installer', channel?: 'stable'|'beta', autoUpdater?: import('electron-updater').AppUpdater, emit?: (event: {type: 'app-update', state: object}) => void, openExternal?: (url: string) => Promise<unknown>, fetchFn?: typeof fetch, requestInstall?: () => unknown, logger?: {log: (event: string, metadata: Record<string, string>) => void}}} options */
function createAppUpdater({
  currentVersion,
  mode,
  channel = 'stable',
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
    channel,
  };
  let started = false;
  let checkPromise = null;
  let downloadPromise = null;
  let changingChannel = false;
  const eligible = (version) => {
    if (!semver.valid(version)) return false;
    const pre = semver.prerelease(version);
    return (
      !pre ||
      (channel === 'beta' &&
        pre.length === 2 &&
        pre[0] === 'beta' &&
        typeof pre[1] === 'number' &&
        semver.parse(version).build.length === 0)
    );
  };
  const configureChannel = () => {
    if (!autoUpdater) return;
    autoUpdater.channel = channel === 'beta' ? 'beta' : 'latest';
    autoUpdater.allowPrerelease = channel === 'beta';
    // Setting channel enables downgrades in electron-updater; reset it explicitly.
    autoUpdater.allowDowngrade = false;
  };

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
    configureChannel();
    autoUpdater.on('checking-for-update', () => publish({ status: 'checking' }));
    autoUpdater.on('update-available', (info) => {
      if (!eligible(info?.version) || !isNewerVersion(info.version, currentVersion))
        return publish({ status: 'current', availableVersion: undefined });
      return publish({
        status: 'available',
        availableVersion: info?.version,
        releaseName: info?.releaseName,
      });
    });
    autoUpdater.on('update-not-available', (info) =>
      publish({
        status:
          eligible(info?.version) &&
          isNewerVersion(info.version, currentVersion) &&
          typeof info.stagingPercentage === 'number' &&
          info.stagingPercentage < 100
            ? 'staged'
            : 'current',
        availableVersion: undefined,
      }),
    );
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

  async function latestRelease() {
    if (typeof fetchFn !== 'function') throw new Error(t('当前环境无法访问更新服务。'));
    const response = await fetchFn(
      channel === 'beta'
        ? LATEST_RELEASE_API.replace('/latest', '?per_page=30')
        : LATEST_RELEASE_API,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Grok-Desktop',
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new Error(t('更新服务返回 {status}。', { status: response.status || 'Error' }));
    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : [payload];
    const valid = items.filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.tag_name === 'string' &&
        semver.valid(item.tag_name.replace(/^v/i, '')) &&
        (item.draft === undefined || typeof item.draft === 'boolean') &&
        (item.prerelease === undefined || typeof item.prerelease === 'boolean'),
    );
    if (items.length && !valid.length) throw new Error(t('更新服务没有返回有效版本号。'));
    const releases = valid
      .map((item) => ({ ...item, version: item.tag_name.replace(/^v/i, '') }))
      .filter(
        (item) => !item.draft && eligible(item.version) && (channel === 'beta' || !item.prerelease),
      );
    releases.sort((a, b) => semver.rcompare(a.version, b.version));
    return releases[0];
  }

  async function checkPortable() {
    const release = await latestRelease();
    if (!release) return publish({ status: 'current', availableVersion: undefined });
    const availableVersion = release.version;
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
    if (changingChannel) return Promise.reject(new Error(t('正在切换更新通道，请稍后重试。')));
    if (checkPromise) return checkPromise;
    if (['downloading', 'downloaded'].includes(state.status)) return Promise.resolve(snapshot());
    if (mode === 'development') return Promise.resolve(snapshot());
    publish({ status: 'checking', percent: undefined });
    checkPromise = (async () => {
      try {
        if (mode === 'portable') return await checkPortable();
        start();
        if (channel === 'beta') {
          // GitHubProvider chooses Atom publication order: a later stable hotfix can hide a
          // higher beta. Pin the highest compatible release, then keep native rollout,
          // checksum and installer download handling against that release's manifest.
          const release = await latestRelease();
          if (!release || !isNewerVersion(release.version, currentVersion))
            return publish({ status: 'current', availableVersion: undefined });
          autoUpdater.setFeedURL({
            provider: 'generic',
            url: `${RELEASES_URL}/download/${encodeURIComponent(release.tag_name)}/`,
            useMultipleRangeRequest: false,
          });
          autoUpdater.channel = semver.prerelease(release.version) ? 'beta' : 'latest';
          autoUpdater.allowPrerelease = true;
          autoUpdater.allowDowngrade = false;
        } else {
          autoUpdater.setFeedURL({
            provider: 'github',
            owner: 'masonyang71324-oss',
            repo: 'grok-desktop',
          });
          configureChannel();
        }
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
    if (changingChannel) return Promise.reject(new Error(t('正在切换更新通道，请稍后重试。')));
    if (downloadPromise) return downloadPromise;
    if (mode === 'portable') {
      const url = state.releaseUrl || RELEASES_URL;
      return openExternal(url).then(() => snapshot());
    }
    if (mode !== 'installer') return Promise.reject(new Error(t('开发环境不支持下载更新。')));
    if (state.status !== 'available')
      return Promise.reject(new Error(t('当前没有可以下载的新版本。')));
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
    if (mode !== 'installer') throw new Error(t('便携版不能自动安装，请下载并运行安装版。'));
    if (state.status !== 'downloaded') throw new Error(t('更新尚未下载完成。'));
    await requestInstall();
    return snapshot();
  }

  async function changeChannel(next, persist) {
    if (!['stable', 'beta'].includes(next)) throw new Error(t('无效的更新通道。'));
    if (
      changingChannel ||
      checkPromise ||
      downloadPromise ||
      ['checking', 'downloading', 'downloaded'].includes(state.status)
    )
      throw new Error(t('请先完成当前更新，再切换通道。'));
    changingChannel = true;
    try {
      const result = await persist();
      channel = next;
      configureChannel();
      publish({
        channel,
        status: mode === 'development' ? 'unsupported' : 'idle',
        availableVersion: undefined,
        percent: undefined,
        releaseUrl: undefined,
      });
      return result;
    } finally {
      changingChannel = false;
    }
  }

  return { start, check, download, install, changeChannel, status: snapshot };
}

module.exports = {
  LATEST_RELEASE_API,
  RELEASES_URL,
  createAppUpdater,
  isNewerVersion,
};
