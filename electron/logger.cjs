const fs = require('node:fs/promises');
const path = require('node:path');

// Only structured operational metadata is accepted. Never persist user content,
// command arguments, paths, upstream error bodies, credentials or tool output.
const allowed = new Set(['command', 'state', 'reason', 'code', 'version', 'durationMs']);
function createLogger(directory, maxBytes = 1024 * 1024) {
  let queue = Promise.resolve();
  const filename = path.join(directory, 'desktop.log');
  function log(event, fields = {}) {
    const metadata = Object.fromEntries(Object.entries(fields).filter(([key]) => allowed.has(key)));
    const line = JSON.stringify({ time: new Date().toISOString(), event, ...metadata }) + '\n';
    queue = queue
      .then(async () => {
        await fs.mkdir(directory, { recursive: true });
        const size = (await fs.stat(filename).catch(() => null))?.size || 0;
        if (size + Buffer.byteLength(line) > maxBytes) {
          await fs.rm(filename + '.2', { force: true });
          await fs.rename(filename + '.1', filename + '.2').catch((e) => {
            if (e.code !== 'ENOENT') throw e;
          });
          await fs.rename(filename, filename + '.1').catch((e) => {
            if (e.code !== 'ENOENT') throw e;
          });
        }
        await fs.appendFile(filename, line, 'utf8');
      })
      .catch(() => {});
  }
  return { log, flush: () => queue, directory };
}
module.exports = { createLogger };
