const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { createAppUpdater, isNewerVersion } = require('../electron/updater.cjs');

class FakeAutoUpdater extends EventEmitter {
  constructor() {
    super();
    this.autoDownload = true;
    this.autoInstallOnAppQuit = true;
    this.allowPrerelease = true;
    this.checks = 0;
    this.downloads = 0;
  }
  async checkForUpdates() {
    this.checks += 1;
  }
  async downloadUpdate() {
    this.downloads += 1;
  }
}

const makeInstaller = () => {
  const autoUpdater = new FakeAutoUpdater();
  const events = [];
  let installs = 0;
  const updater = createAppUpdater({
    currentVersion: '1.4.0',
    mode: 'installer',
    autoUpdater,
    emit: (event) => events.push(event),
    requestInstall: () => {
      installs += 1;
    },
  });
  return { updater, autoUpdater, events, installs: () => installs };
};

test('installer updates are opt-in and duplicate checks/downloads are ignored', async () => {
  const { updater, autoUpdater, events } = makeInstaller();
  updater.start();
  assert.equal(autoUpdater.autoDownload, false);
  assert.equal(autoUpdater.autoInstallOnAppQuit, false);
  assert.equal(autoUpdater.allowPrerelease, false);

  const first = updater.check();
  const second = updater.check();
  await Promise.all([first, second]);
  assert.equal(autoUpdater.checks, 1);

  autoUpdater.emit('update-available', { version: '1.4.1' });
  const downloadA = updater.download();
  const downloadB = updater.download();
  await Promise.all([downloadA, downloadB]);
  assert.equal(autoUpdater.downloads, 1);
  assert.equal(events.at(-1).state.status, 'downloading');
});

test('installer only requests restart after the update has fully downloaded', async () => {
  const fixture = makeInstaller();
  fixture.updater.start();
  await assert.rejects(() => fixture.updater.install(), /尚未下载完成/);
  assert.equal(fixture.installs(), 0);

  fixture.autoUpdater.emit('update-downloaded', { version: '1.4.1' });
  await fixture.updater.install();
  assert.equal(fixture.installs(), 1);
});

test('portable builds check the public stable release and only open its download page', async () => {
  const opened = [];
  let fetched = 0;
  const updater = createAppUpdater({
    currentVersion: '1.4.0',
    mode: 'portable',
    emit: () => {},
    openExternal: async (url) => opened.push(url),
    fetchFn: async () => {
      fetched += 1;
      return {
        ok: true,
        json: async () => ({
          tag_name: 'v1.4.1',
          html_url: 'https://github.com/masonyang71324-oss/grok-desktop/releases/tag/v1.4.1',
        }),
      };
    },
  });

  const state = await updater.check();
  assert.equal(fetched, 1);
  assert.equal(state.status, 'available');
  assert.equal(state.availableVersion, '1.4.1');
  await updater.download();
  assert.deepEqual(opened, [
    'https://github.com/masonyang71324-oss/grok-desktop/releases/tag/v1.4.1',
  ]);
  await assert.rejects(() => updater.install(), /安装版/);
});

test('stable version comparison handles v-prefixes and multi-digit components', () => {
  assert.equal(isNewerVersion('v1.10.0', '1.9.9'), true);
  assert.equal(isNewerVersion('1.4.0', '1.4.0'), false);
  assert.equal(isNewerVersion('1.3.9', '1.4.0'), false);
});
