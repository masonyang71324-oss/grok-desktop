const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const [role, directory] = process.argv.slice(2);
fs.writeFileSync(
  path.join(directory, `${role}.json`),
  JSON.stringify({ pid: process.pid, parentPid: process.ppid }),
);
if (!role.endsWith('-leaf')) {
  spawn(process.execPath, [__filename, `${role}-leaf`, directory], {
    windowsHide: true,
    stdio: 'ignore',
  });
}
if (role === 'runner') {
  const server = require('node:http').createServer((_, response) =>
    response.end('owned crash probe'),
  );
  server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`));
} else setInterval(() => {}, 1000);
