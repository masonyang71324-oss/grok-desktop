const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAppUpdater, isNewerVersion } = require('../electron/updater.cjs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { AppUpdater } = require('electron-updater/out/AppUpdater');
const { HttpError } = require('builder-util-runtime');

test('semantic comparison distinguishes beta sequence and stable promotion without downgrades', () => {
  assert.equal(isNewerVersion('1.10.0-beta.10', '1.10.0-beta.2'), true);
  assert.equal(isNewerVersion('1.10.0', '1.10.0-beta.10'), true);
  assert.equal(isNewerVersion('1.10.0-beta.10', '1.10.0'), false);
  assert.equal(isNewerVersion('invalid', '1.9.0'), false);
});

test('channel switch is transactional and rejects checks/downloads while persistence is pending', async () => {
  const native = new EventEmitter();
  native.checkForUpdates = async () => {};
  native.downloadUpdate = async () => {};
  const updater = createAppUpdater({
    currentVersion: '1.9.0',
    mode: 'installer',
    autoUpdater: native,
  });
  updater.start();
  assert.equal(updater.status().channel, 'stable');
  assert.equal(native.allowDowngrade, false);
  let save;
  const changing = updater.changeChannel(
    'beta',
    () =>
      new Promise((resolve) => {
        save = resolve;
      }),
  );
  await assert.rejects(updater.check(), /通道|channel/);
  assert.equal(native.allowPrerelease, false);
  save('persisted');
  assert.equal(await changing, 'persisted');
  assert.equal(updater.status().channel, 'beta');
  assert.equal(native.allowPrerelease, true);
  assert.equal(native.channel, 'beta');
  assert.equal(native.allowDowngrade, false);
  await assert.rejects(
    updater.changeChannel('stable', async () => {
      throw new Error('disk full');
    }),
    /disk full/,
  );
  assert.equal(updater.status().channel, 'beta');
  native.emit('update-downloaded', { version: '1.10.0-beta.1' });
  await assert.rejects(
    updater.changeChannel('stable', async () => {}),
    /更新|update/,
  );
  assert.equal(updater.status().channel, 'beta');
});

test('stable clients reject prerelease events and show staged eligibility without enabling download', async () => {
  const native = new EventEmitter();
  const updater = createAppUpdater({
    currentVersion: '1.9.0',
    mode: 'installer',
    autoUpdater: native,
  });
  updater.start();
  native.emit('update-available', { version: '1.10.0-beta.1' });
  assert.notEqual(updater.status().status, 'available');
  native.emit('update-not-available', { version: '1.10.0', stagingPercentage: 10 });
  assert.equal(updater.status().status, 'staged');
  await assert.rejects(updater.download(), /没有|available/);
  native.emit('update-available', { version: '1.10.0' });
  assert.equal(updater.status().status, 'available');
});

test('portable beta selects only supported stable/beta releases and stays on installed beta when stable is older', async () => {
  const urls = [];
  const updater = createAppUpdater({
    currentVersion: '1.10.0-beta.2',
    mode: 'portable',
    channel: 'beta',
    fetchFn: async (url) => {
      urls.push(url);
      return {
        ok: true,
        json: async () => [
          { tag_name: 'v1.11.0-alpha.1', prerelease: true },
          { tag_name: 'v1.10.0-beta.10', prerelease: true, html_url: 'https://example.test/beta' },
          { tag_name: 'v1.12.0', draft: true },
          { tag_name: 'v1.9.0', prerelease: false },
        ],
      };
    },
  });
  assert.equal((await updater.check()).availableVersion, '1.10.0-beta.10');
  assert.match(urls[0], /releases\?per_page/);
  await updater.changeChannel('stable', async () => {});
  assert.equal((await updater.check()).status, 'current');
});

test('malformed release data rejects while a valid empty release list means no update', async () => {
  for (const payload of [{}, [null, { tag_name: 'secret' }]]) {
    const updater = createAppUpdater({
      currentVersion: '1.9.0',
      mode: 'portable',
      channel: 'beta',
      fetchFn: async () => ({ ok: true, json: async () => payload }),
    });
    await assert.rejects(updater.check(), /有效|invalid/i);
    assert.equal(updater.status().status, 'error');
  }
  const empty = createAppUpdater({
    currentVersion: '1.9.0',
    mode: 'portable',
    channel: 'beta',
    fetchFn: async () => ({ ok: true, json: async () => [] }),
  });
  assert.equal((await empty.check()).status, 'current');
});

test('beta accepts only the supported beta.N prerelease form', async () => {
  const updater = createAppUpdater({
    currentVersion: '1.9.0',
    mode: 'portable',
    channel: 'beta',
    fetchFn: async () => ({
      ok: true,
      json: async () => [
        { tag_name: 'v1.13.0-beta.2+unsupported', prerelease: true },
        { tag_name: 'v1.12.0-beta.foo', prerelease: true },
        { tag_name: 'v1.11.0-beta.1.extra', prerelease: true },
        { tag_name: 'v1.10.0-beta.2', prerelease: true },
      ],
    }),
  });
  assert.equal((await updater.check()).availableVersion, '1.10.0-beta.2');
});

async function realUpdaterFixture(t, currentVersion = '1.10.0-beta.1') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'update provider '));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const native = new AppUpdater(null, {
    version: currentVersion,
    isPackaged: true,
    whenReady: async () => {},
    userDataPath: directory,
  });
  native.logger = null;
  const hashes = Buffer.alloc(64, 7).toString('base64');
  const requests = [],
    downloads = [];
  const releases = [
    { tag_name: 'v1.9.1', prerelease: false },
    { tag_name: 'v1.10.0-beta.2', prerelease: true },
  ];
  native.httpExecutor = {
    request: async (options) => {
      requests.push(options.path);
      if (options.path.endsWith('.atom'))
        return `<feed>${releases.map((release) => `<entry><link href="https://github.com/masonyang71324-oss/grok-desktop/releases/tag/${release.tag_name}"/><title>fixture</title><content>notes</content></entry>`).join('')}</feed>`;
      if (options.path.endsWith('/latest'))
        return JSON.stringify(releases.find((release) => !release.prerelease));
      const match = options.path.match(/\/download\/v([^/]+)\/(beta|latest)\.yml/);
      if (!match || (match[2] === 'beta' && !match[1].includes('-beta.')))
        throw new HttpError(404, 'not found');
      const percentage =
        releases.find((release) => release.tag_name === `v${match[1]}`)?.stagingPercentage ?? 100;
      return `version: ${match[1]}\nstagingPercentage: ${percentage}\nfiles:\n  - url: Grok-Desktop-${match[1]}-Setup.exe\n    sha512: ${hashes}\n    size: 512\n`;
    },
  };
  native.setFeedURL({ provider: 'github', owner: 'masonyang71324-oss', repo: 'grok-desktop' });
  native.doDownloadUpdate = async ({ updateInfoAndProvider }) => {
    downloads.push(...updateInfoAndProvider.provider.resolveFiles(updateInfoAndProvider.info));
    native.emit('update-downloaded', updateInfoAndProvider.info);
    return ['isolated-installer-boundary'];
  };
  const updater = createAppUpdater({
    currentVersion,
    mode: 'installer',
    channel: 'beta',
    autoUpdater: native,
    fetchFn: async () => ({ ok: true, json: async () => releases }),
  });
  return { updater, native, releases, requests, downloads, hashes };
}

test('real provider finds the highest beta despite a later older stable release and preserves download manifest URLs', async (t) => {
  const { updater, native, requests, downloads, hashes } = await realUpdaterFixture(t);
  const state = await updater.check();
  assert.equal(state.status, 'available');
  assert.equal(state.availableVersion, '1.10.0-beta.2');
  assert.ok(requests.some((url) => url.includes('/download/v1.10.0-beta.2/beta.yml')));
  assert.equal(native.allowDowngrade, false);
  assert.equal(native.updateInfoAndProvider.provider.isUseMultipleRangeRequest, false);
  await updater.download();
  assert.equal(
    downloads[0].url.href,
    'https://github.com/masonyang71324-oss/grok-desktop/releases/download/v1.10.0-beta.2/Grok-Desktop-1.10.0-beta.2-Setup.exe',
  );
  assert.equal(downloads[0].info.sha512, hashes);
  assert.equal(updater.status().status, 'downloaded');
});

test('real provider promotes beta to newer stable metadata and switches back to the GitHub stable feed', async (t) => {
  const { updater, native, releases, requests } = await realUpdaterFixture(t);
  releases.unshift({ tag_name: 'v1.10.0', prerelease: false });
  assert.equal((await updater.check()).availableVersion, '1.10.0');
  assert.ok(requests.some((url) => url.includes('/download/v1.10.0/latest.yml')));
  await updater.changeChannel('stable', async () => {});
  requests.length = 0;
  assert.equal((await updater.check()).availableVersion, '1.10.0');
  assert.ok(requests.some((url) => url.endsWith('/releases.atom')));
  assert.ok(requests.some((url) => url.includes('/download/v1.10.0/latest.yml')));
  assert.equal(native.allowPrerelease, false);
  assert.equal(native.allowDowngrade, false);
});

test('pinned beta manifests still use native staged distribution and forbid bypassing download eligibility', async (t) => {
  const { updater, releases, downloads } = await realUpdaterFixture(t);
  releases[1].stagingPercentage = 0;
  assert.equal((await updater.check()).status, 'staged');
  await assert.rejects(updater.download(), /没有|available/);
  assert.deepEqual(downloads, []);
});

test('channel switching cannot overlap beta release selection or consume another channel response', async () => {
  const native = new EventEmitter();
  let releaseResponse;
  native.setFeedURL = () => {};
  native.checkForUpdates = async () =>
    native.emit('update-available', { version: '1.10.0-beta.2' });
  const updater = createAppUpdater({
    currentVersion: '1.9.0',
    mode: 'installer',
    channel: 'beta',
    autoUpdater: native,
    fetchFn: () =>
      new Promise((resolve) => {
        releaseResponse = resolve;
      }),
  });
  const checking = updater.check();
  await assert.rejects(
    updater.changeChannel('stable', async () => {}),
    /更新|update/,
  );
  releaseResponse({
    ok: true,
    json: async () => [{ tag_name: 'v1.10.0-beta.2', prerelease: true }],
  });
  assert.equal((await checking).channel, 'beta');
  await updater.changeChannel('stable', async () => {});
  assert.equal(updater.status().channel, 'stable');
  assert.equal(updater.status().availableVersion, undefined);
  await assert.rejects(updater.download(), /没有|available/);
});
