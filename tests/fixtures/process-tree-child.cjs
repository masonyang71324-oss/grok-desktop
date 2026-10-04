const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const [role, directory] = process.argv.slice(2);
fs.writeFileSync(path.join(directory, `${role}.pid`), String(process.pid));
if (role === 'leaf') {
  process.send({ ready: true });
} else {
  const next = fork(__filename, [role === 'parent' ? 'middle' : 'leaf', directory], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  next.once('message', () => {
    if (role === 'parent') fs.writeFileSync(path.join(directory, 'ready'), 'ready');
    else process.send({ ready: true });
  });
}
setInterval(() => {
  if (role === 'parent' && fs.existsSync(path.join(directory, 'overflow')))
    process.stdout.write('x'.repeat(4096));
}, 20);
