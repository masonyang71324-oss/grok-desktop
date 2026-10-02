// Isolated process fixture: never installs software, reads auth or writes config.
const { spawn } = require('node:child_process');
if (process.argv[2] === 'version') {
  process.stdout.write('grok 1.0.46\n');
} else if (process.argv[2] === 'child') {
  setInterval(() => {}, 1000);
} else if (process.argv[2] === 'tree') {
  const child = spawn(process.execPath, [__filename, 'child'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  process.stdout.write(`fixture descendant ${child.pid}\n`);
  setInterval(() => {}, 1000);
} else {
  process.stdout.write('fixture download complete\n');
}
