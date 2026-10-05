const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { createDiagnostics } = require('../electron/diagnostics.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diagnostics test '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return path.join(root, 'report.zip');
}

function metadata() {
  return {
    versions: {
      app: '1.9.1-beta.1',
      electron: '44.5.1',
      node: '22.22.0',
      chrome: '148.0.7778.0',
      cli: 'grok 1.0.46 (d46ab12)',
    },
    platform: 'win32',
    arch: 'x64',
    settings: {
      language: 'zh-CN',
      theme: 'dark',
      permissionMode: 'read',
      updateChannel: 'beta',
      autoReconnect: true,
      notifications: false,
      ui: { zoomPercent: 110 },
    },
    counts: { sessions: 3, activeTasks: 1, queuedTasks: 2, pendingApprovals: 1 },
    engine: { configured: true, connection: 'ready' },
  };
}

test('preview and ZIP contain only rebuilt allowlisted metadata and operational events', async (t) => {
  const destination = await fixture(t);
  const secret = 'SYNTHETIC_SECRET_7e924';
  const source = metadata();
  Object.assign(source, {
    prompt: secret,
    sessions: [{ id: secret, title: secret }],
    attachments: [`C:\\Users\\${secret}\\private.txt`],
  });
  Object.assign(source.versions, { provider: secret });
  Object.assign(source.settings, {
    grokPath: `C:\\${secret}\\grok.exe`,
    modelId: secret,
    projectTrust: { [secret]: true },
    promptTemplates: [{ text: secret }],
  });
  Object.assign(source.engine, { path: secret, error: secret });
  const log =
    [
      {
        time: '2026-10-05T08:00:00.000Z',
        event: 'connection',
        state: 'ready',
        prompt: secret,
        cwd: secret,
      },
      {
        time: '2026-10-05T08:01:00.000Z',
        event: 'request-failed',
        command: 'workspace.read',
        code: 'ENOENT',
        error: secret,
      },
      {
        time: '2026-10-05T08:02:00.000Z',
        event: 'request-failed',
        command: `workspace.${secret}`,
        code: secret,
      },
      { time: '2026-10-05T08:03:00.000Z', event: 'renderer-gone', reason: secret },
      { time: secret, event: 'connection', state: secret },
      { time: '2026-10-05T08:04:00.000Z', event: secret, message: secret },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n') + `\ninvalid ${secret}`;
  const service = createDiagnostics({
    getMetadata: () => source,
    readLogs: () => [log],
    chooseDestination: () => destination,
  });
  const preview = await service.preview();
  const json = JSON.stringify(preview.report);
  assert.ok(!json.includes(secret));
  assert.equal(preview.report.versions.cli, '1.0.46');
  assert.deepEqual(preview.report.settings, metadata().settings);
  assert.deepEqual(preview.report.counts, metadata().counts);
  assert.deepEqual(preview.report.events[1], {
    time: '2026-10-05T08:01:00.000Z',
    event: 'request-failed',
    operation: 'workspace',
    code: 'ENOENT',
  });
  assert.equal(preview.report.events.length, 5);
  assert.deepEqual(await service.export(preview.id), { canceled: false });
  const zip = await JSZip.loadAsync(await fs.readFile(destination));
  assert.deepEqual(Object.keys(zip.files), ['diagnostics.json']);
  const exported = await zip.file('diagnostics.json').async('string');
  assert.deepEqual(JSON.parse(exported), preview.report);
  assert.ok(!exported.includes(secret));
});

test('export uses the exact immutable preview even after inputs and the returned report are changed', async (t) => {
  const destination = await fixture(t);
  const source = metadata();
  let log = '{"event":"app-start","version":"1.9.1"}';
  const service = createDiagnostics({
    getMetadata: () => source,
    readLogs: () => [log],
    chooseDestination: () => destination,
  });
  const preview = await service.preview();
  const expected = JSON.stringify(preview.report, null, 2) + '\n';
  source.counts.sessions = 999;
  source.settings.permissionMode = 'auto';
  log = '{"event":"turn-error"}';
  preview.report.versions.app = 'FORGED_SECRET';
  await service.preview();
  await service.export(preview.id);
  const zip = await JSZip.loadAsync(await fs.readFile(destination));
  assert.equal(await zip.file('diagnostics.json').async('string'), expected);
});

test('unknown previews and renderer supplied reports never reach the save dialog', async (t) => {
  await fixture(t);
  let chosen = false;
  const service = createDiagnostics({
    getMetadata: metadata,
    readLogs: () => [],
    chooseDestination: () => {
      chosen = true;
      return null;
    },
  });
  await assert.rejects(service.export('made-up'), { code: 'DIAGNOSTICS_PREVIEW_EXPIRED' });
  await assert.rejects(service.export({ report: metadata() }), {
    code: 'DIAGNOSTICS_PREVIEW_EXPIRED',
  });
  assert.equal(chosen, false);
  const preview = await service.preview();
  assert.deepEqual(await service.export(preview.id), { canceled: true });
});

test('secrets in allowed keys cannot bypass enums, numeric checks or strict version parsing', async () => {
  const secret = 'SYNTHETIC_SECRET_238';
  const source = metadata();
  source.versions = {
    app: `1.9.1-${secret}`,
    electron: secret,
    node: `22.2.0 ${secret}`,
    chrome: secret,
    cli: `grok 1.0.46 (${secret})`,
  };
  source.platform = secret;
  source.arch = secret;
  source.settings = {
    language: secret,
    theme: secret,
    permissionMode: secret,
    updateChannel: secret,
    autoReconnect: secret,
    notifications: secret,
    ui: { zoomPercent: secret },
  };
  source.counts = {
    sessions: secret,
    activeTasks: -1,
    queuedTasks: Infinity,
    pendingApprovals: '3',
  };
  source.engine = { configured: secret, connection: secret };
  const service = createDiagnostics({
    getMetadata: () => source,
    readLogs: () => ['{"event":"app-start","version":"' + secret + '"}'],
    chooseDestination: () => null,
  });
  const { report } = await service.preview();
  assert.ok(!JSON.stringify(report).includes(secret));
  assert.deepEqual(report.versions, {});
  assert.deepEqual(report.settings, {});
  assert.deepEqual(report.counts, {});
  assert.deepEqual(report.engine, {});
});

test('failed archive replacement preserves the existing file and permits retrying the preview', async (t) => {
  const destination = await fixture(t);
  await fs.writeFile(destination, 'existing-file');
  const service = createDiagnostics({
    getMetadata: metadata,
    readLogs: () => [],
    chooseDestination: () => destination,
  });
  const preview = await service.preview();
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (to === destination) throw Object.assign(new Error('failed'), { code: 'EIO' });
    return rename(from, to);
  });
  await assert.rejects(service.export(preview.id), { code: 'EIO' });
  assert.equal(await fs.readFile(destination, 'utf8'), 'existing-file');
  t.mock.restoreAll();
  await service.export(preview.id);
  const zip = await JSZip.loadAsync(await fs.readFile(destination));
  assert.deepEqual(JSON.parse(await zip.file('diagnostics.json').async('string')), preview.report);
});

test('diagnostics retain actual sleeping connections and staged update events', async () => {
  const source = metadata();
  source.engine.connection = 'sleeping';
  const service = createDiagnostics({
    getMetadata: () => source,
    readLogs: () => [
      JSON.stringify({ event: 'connection', state: 'sleeping' }) +
        '\n' +
        JSON.stringify({ event: 'app-update', state: 'installer:staged', version: '1.9.2' }),
    ],
    chooseDestination: () => null,
  });
  const { report } = await service.preview();
  assert.equal(report.engine.connection, 'sleeping');
  assert.deepEqual(report.events, [
    { event: 'connection', state: 'sleeping' },
    { event: 'app-update', state: 'installer:staged', version: '1.9.2' },
  ]);
});
