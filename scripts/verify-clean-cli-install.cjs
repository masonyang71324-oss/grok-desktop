'use strict';

// The official installer writes User PATH even with a redirected USERPROFILE.
// Run only on the disposable Windows runner selected by verify-cli-install.yml.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { CliInstaller, killOwnedTree } = require('../electron/cli-installer.cjs');
const { readCliStatus } = require('../electron/cli-status.cjs');

function check(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { auditCode: code });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForExit(children) {
  const stillOwned = (child) =>
    child.exitCode == null && child.signalCode == null && child.pid && isAlive(child.pid);
  const deadline = Date.now() + 5000;
  while (children.some(stillOwned) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  check(
    children.every((child) => !stillOwned(child)),
    'OWNED_PROCESS_STILL_RUNNING',
  );
}

function createScope(root, name) {
  const profile = path.join(root, name);
  const grokHome = path.join(profile, '.grok');
  const binDir = path.join(grokHome, 'bin');
  const cwd = path.join(profile, 'workspace');
  const local = path.join(profile, 'AppData', 'Local');
  const roaming = path.join(profile, 'AppData', 'Roaming');
  const temp = path.join(profile, 'Temp');
  for (const directory of [grokHome, cwd, local, roaming, temp])
    fs.mkdirSync(directory, { recursive: true });
  check(fs.readdirSync(grokHome).length === 0, 'PROFILE_NOT_EMPTY');
  const env = {};
  const allowed = new Set([
    'systemroot',
    'windir',
    'comspec',
    'path',
    'pathext',
    'processor_architecture',
    'processor_identifier',
    'number_of_processors',
  ]);
  for (const [key, value] of Object.entries(process.env))
    if (allowed.has(key.toLowerCase())) env[key] = value;
  Object.assign(env, {
    USERPROFILE: profile,
    HOME: profile,
    GROK_HOME: grokHome,
    GROK_BIN_DIR: binDir,
    GROK_CHANNEL: 'stable',
    GROK_DISABLE_AUTOUPDATER: '1',
    GROK_TELEMETRY_ENABLED: '0',
    GROK_FEEDBACK_ENABLED: '0',
    APPDATA: roaming,
    LOCALAPPDATA: local,
    TEMP: temp,
    TMP: temp,
  });
  const children = [];
  function spawnOwned(executable, args, options = {}) {
    // Ignore the inherited env supplied by CliInstaller; both installation and
    // its actual --version subprocess must use this empty, credential-free home.
    const child = spawn(executable, args, { ...options, env, cwd, windowsHide: true });
    children.push(child);
    return child;
  }
  async function run(executable, args, { timeout = 30000 } = {}) {
    const child = spawnOwned(executable, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return new Promise((resolve, reject) => {
      let stdout = '',
        stderr = '',
        timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        void killOwnedTree(child);
      }, timeout);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout = (stdout + chunk).slice(-32000);
      });
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk).slice(-32000);
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (exitCode) => {
        clearTimeout(timer);
        if (timedOut)
          reject(
            Object.assign(new Error('PROBE_PROCESS_TIMEOUT'), {
              auditCode: 'PROBE_PROCESS_TIMEOUT',
            }),
          );
        else resolve({ exitCode, stdout, stderr });
      });
    });
  }
  async function registeredOnUserPath() {
    const result = await run('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Environment]::GetEnvironmentVariable('Path', 'User')",
    ]);
    check(result.exitCode === 0, 'USER_PATH_READ_FAILED');
    return result.stdout
      .trim()
      .split(';')
      .some((entry) => entry.trim().toLowerCase() === binDir.toLowerCase());
  }
  return { profile, grokHome, binDir, local, children, spawnOwned, run, registeredOnUserPath };
}

async function main() {
  check(
    process.platform === 'win32' &&
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.GROK_DESKTOP_DISPOSABLE_WINDOWS === '1',
    'REFUSED_REQUIRES_DISPOSABLE_WINDOWS_ACTIONS_RUNNER',
  );
  const reportPath = path.resolve(__dirname, '../test-results/clean-cli-install.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const report = {
    checkedAt: new Date().toISOString(),
    status: 'running',
    stage: 'prepare',
    node: process.version,
    windows: os.release(),
    installerUrl: 'https://x.ai/cli/install.ps1',
    intendedSideEffects: [
      'Disposable child profiles: .grok downloads, binaries, completions, config and runtime state',
      'Disposable child LOCALAPPDATA: optional bundled Git payload',
      'Disposable runner User PATH: official installer adds the successful bin directory',
    ],
    cliCommands: [],
    emptyProfiles: true,
    cancellation: {},
    installation: {},
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-clean-install-'));
  const cancelled = createScope(root, 'cancelled-download');
  const installed = createScope(root, 'fresh-install');
  let cancelInstaller, installInstaller, cancellation;
  const saveReport = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  try {
    report.stage = 'cancel-during-download';
    check(!(await cancelled.registeredOnUserPath()), 'CANCEL_TARGET_ALREADY_REGISTERED');
    const executable = path.join(cancelled.binDir, 'grok.exe');
    const download = path.join(cancelled.grokHome, 'downloads', 'grok-windows-x86_64.exe');
    check(process.arch === 'x64', 'RUNNER_REQUIRES_WINDOWS_X64');
    cancelInstaller = new CliInstaller({
      binDir: cancelled.binDir,
      spawnFn: cancelled.spawnOwned,
      emit: ({ state }) => {
        if (cancellation || state.status !== 'installing' || state.log.includes('Installed to '))
          return;
        // Use the last progress value, not an old 0% retained in the log buffer.
        const progress = [
          ...state.log.matchAll(/Downloading\.\.\.\s+[\d.]+ MB \/ ([\d.]+) MB \((\d+)%\)/g),
        ].at(-1);
        if (!progress || Number(progress[2]) >= 90 || fs.existsSync(executable)) return;
        const bytes = fs.existsSync(download) ? fs.statSync(download).size : 0;
        const approximateTotal = Number(progress[1]) * 1024 * 1024;
        if (bytes <= 0 || bytes >= approximateTotal * 0.9) return;
        report.cancellation = {
          downloadProgressObserved: true,
          percentAtCancel: Number(progress[2]),
          partialBytesAtCancel: bytes,
          approximateTotalBytes: Math.round(approximateTotal),
          executableAbsentAtCancel: true,
        };
        cancellation = cancelInstaller.cancel();
      },
    });
    const cancelledResult = await cancelInstaller.start();
    if (cancellation) await cancellation;
    check(Boolean(cancellation), 'DOWNLOAD_CANCEL_NOT_TRIGGERED');
    check(cancelledResult.status === 'cancelled', 'INSTALLER_DID_NOT_REPORT_CANCELLED');
    await waitForExit(cancelled.children);
    check(!fs.existsSync(executable), 'CANCEL_RACED_WITH_COMPLETED_INSTALL');
    const cancelRegistered = await cancelled.registeredOnUserPath();
    check(!cancelRegistered, 'CANCEL_TARGET_UNEXPECTEDLY_REGISTERED');
    Object.assign(report.cancellation, {
      status: cancelledResult.status,
      ownedPids: cancelled.children.map((child) => child.pid),
      ownedProcessesExited: true,
      targetRegisteredOnUserPath: cancelRegistered,
      executableInstalled: false,
    });
    saveReport();

    report.stage = 'official-fresh-install';
    check(!(await installed.registeredOnUserPath()), 'FRESH_TARGET_ALREADY_REGISTERED');
    const states = [];
    installInstaller = new CliInstaller({
      binDir: installed.binDir,
      spawnFn: installed.spawnOwned,
      emit: ({ state }) => {
        if (states.at(-1) !== state.status) states.push(state.status);
        const version = state.log.match(/Installing Grok (\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/)?.[1];
        if (version) report.installation.announcedVersion = version;
        const progress = [...state.log.matchAll(/Downloading\.\.\.[^\r\n]*?\((\d+)%\)/g)].at(-1);
        if (progress) report.installation.lastDownloadPercent = Number(progress[1]);
      },
    });
    const result = await installInstaller.start();
    report.installation.states = states;
    report.installation.status = result.status;
    check(result.status === 'installed', 'OFFICIAL_INSTALL_NOT_VERIFIED');
    check(states.includes('verifying'), 'VERSION_VERIFICATION_NOT_REACHED');
    check(
      result.version === report.installation.announcedVersion,
      'OFFICIAL_PAYLOAD_VERSION_MISMATCH',
    );
    const authFile = path.join(installed.grokHome, 'auth.json');
    check(!fs.existsSync(authFile), 'UNEXPECTED_AUTH_FILE');
    report.stage = 'verify-installed-cli';
    const status = await readCliStatus(result.path, {
      run: (executable, args, options) => {
        check(
          args.length === 1 && ['--version', 'models'].includes(args[0]),
          'UNEXPECTED_CLI_COMMAND',
        );
        report.cliCommands.push(args[0]);
        return installed.run(executable, args, options);
      },
    });
    check(status.version === result.version, 'INSTALLED_VERSION_MISMATCH');
    check(status.authStatus === 'required', 'FRESH_CLI_NOT_LOGIN_REQUIRED');
    const registered = await installed.registeredOnUserPath();
    check(registered, 'OFFICIAL_INSTALL_DID_NOT_REGISTER_USER_PATH');
    const configExists = fs.existsSync(path.join(installed.grokHome, 'config.toml'));
    const completionsExist = fs.existsSync(
      path.join(installed.grokHome, 'completions', 'powershell', 'grok.ps1'),
    );
    check(configExists, 'INSTALLER_CONFIG_ABSENT');
    // Completions and bundled Windows tools are best-effort in the official script.
    check(!fs.existsSync(authFile), 'UNEXPECTED_AUTH_FILE');
    await waitForExit(installed.children);
    Object.assign(report.installation, {
      actualVersion: result.version,
      executable: result.path,
      authStatus: status.authStatus,
      targetRegisteredOnUserPath: registered,
      configExists,
      completionsExist,
      authFileAbsent: true,
      agentExecutableExists: fs.existsSync(path.join(installed.binDir, 'agent.exe')),
      groveExecutables: ['grove.exe', 'grove-fsmonitor.exe', 'grove-credential.exe'].filter(
        (name) => fs.existsSync(path.join(installed.binDir, name)),
      ),
      bundledGitDirectoryExists: fs.existsSync(path.join(installed.local, 'grok', 'git')),
      ownedPids: installed.children.map((child) => child.pid),
      ownedProcessesExited: true,
    });
    report.stage = 'complete';
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    // Never serialize upstream output or exception text: only our fixed codes.
    report.failureCode = error.auditCode || 'UNEXPECTED_RUNTIME_ERROR';
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([cancelInstaller?.dispose(), installInstaller?.dispose()]);
    const children = [...cancelled.children, ...installed.children];
    for (const child of children)
      if (child.pid && child.exitCode === null && child.signalCode == null && isAlive(child.pid))
        await killOwnedTree(child);
    try {
      await waitForExit(children.filter((child) => child.pid));
      report.cleanupOwnedProcessesExited = true;
    } catch {
      report.cleanupOwnedProcessesExited = false;
      report.status = 'failed';
      report.failureCode ||= 'OWNED_PROCESS_STILL_RUNNING';
      process.exitCode = 1;
    }
    saveReport();
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }
}

module.exports = { waitForExit };
if (require.main === module)
  main().catch((error) => {
    process.stderr.write(`${error.auditCode || 'CLEAN_INSTALL_PROBE_SETUP_FAILED'}\n`);
    process.exitCode = 1;
  });
