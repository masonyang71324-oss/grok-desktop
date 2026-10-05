const { spawn } = require('node:child_process');
const path = require('node:path');
const { windowsPowerShellPath } = require('./system-launch.cjs');

function guardian(mode, options = {}) {
  // PowerShell cannot load a script from app.asar. The packaged copy is a resource.
  const script = __dirname.includes('app.asar')
    ? path.join(process.resourcesPath, 'owned-process-guardian.ps1')
    : path.join(__dirname, 'owned-process-guardian.ps1');
  return spawn(
    windowsPowerShellPath(),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-Mode',
      mode,
    ],
    { ...options, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] },
  );
}

/** Launch internal workloads inside a job before they can create descendants. */
function spawnOwnedProcess(executable, args, options) {
  if (process.platform !== 'win32') return spawn(executable, args, options);
  const child = guardian('run', options);
  child.stdin.on('error', () => {}); // Spawn errors are delivered through the child error event.
  child.stdin.end(`${JSON.stringify({ executable, args, cwd: options.cwd })}\n`);
  return child;
}

/** The Utility host is still idle until its job and live main-process watch are ready. */
async function superviseUtility() {
  if (process.platform !== 'win32') return;
  const child = guardian('utility');
  child.stdin.end();
  let diagnostic = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    diagnostic = (diagnostic + chunk).slice(-2000);
  });
  await new Promise((resolve, reject) => {
    let ready = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Terminal lifetime supervision did not start.'));
    }, 10000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      ready += chunk;
      if (ready.includes('OWNED_JOB_READY')) {
        clearTimeout(timer);
        resolve(undefined);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error(diagnostic.trim() || 'Terminal lifetime supervisor exited.'));
    });
  });
}

module.exports = { spawnOwnedProcess, superviseUtility };
