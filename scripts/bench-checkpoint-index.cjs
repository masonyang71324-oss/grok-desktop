const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { randomUUID } = require('node:crypto');
const { createCheckpointStore } = require('../electron/checkpoints.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint index bench '));
  const directory = path.join(root, 'store'),
    cwd = path.join(root, 'project');
  await fs.mkdir(directory);
  await fs.mkdir(cwd);
  const targetBytes = 246 * 1024 * 1024,
    count = 24,
    perRecord = targetBytes / count;
  try {
    for (let index = 0; index < count; index++) {
      const id = randomUUID();
      const entry = {
        id,
        cwd,
        sessionId: 'bench',
        turnId: String(index),
        status: 'ready',
        createdAt: new Date().toISOString(),
        files: Array.from({ length: 6 }, (_, file) => ({
          path: `file-${file}.txt`,
          status: 'modified',
          before: { content: '', mode: 438 },
          after: { content: '', mode: 438 },
        })),
        skipped: [],
      };
      let remaining = perRecord - Buffer.byteLength(JSON.stringify(entry));
      for (const file of entry.files)
        for (const side of ['before', 'after']) {
          const size = Math.min(896 * 1024, remaining);
          file[side].content = 'x'.repeat(size);
          remaining -= size;
        }
      if (remaining !== 0) throw new Error('Benchmark record allocation failed');
      await fs.writeFile(path.join(directory, `${id}.json`), JSON.stringify(entry));
    }
    const readFile = fs.readFile;
    let bodyBytes = 0,
      bodyReads = 0;
    fs.readFile = async (name, ...args) => {
      const result = await readFile(name, ...args);
      if (/^[a-f0-9-]{36}\.json$/.test(path.basename(String(name)))) {
        bodyReads++;
        bodyBytes += Buffer.byteLength(result);
      }
      return result;
    };
    async function measure(name, operation) {
      bodyBytes = 0;
      bodyReads = 0;
      const start = performance.now();
      const result = await operation();
      return {
        name,
        milliseconds: Number((performance.now() - start).toFixed(2)),
        records: result.length ?? result.records?.length,
        bodyReads,
        bodyBytes,
      };
    }
    const store = createCheckpointStore({ directory });
    const results = [
      await measure('first legacy list', () => store.list({ cwd })),
      await measure('warm list', () => store.list({ cwd })),
      await measure('warm storage', () => store.storage()),
      await measure('restart indexed list', () =>
        createCheckpointStore({ directory }).list({ cwd }),
      ),
    ];
    const indexBytes = (await fs.stat(path.join(directory, 'metadata-index'))).size;
    const originalBytes = (await store.storage()).bytes;
    console.log(JSON.stringify({ targetBytes, originalBytes, indexBytes, results }, null, 2));
    fs.readFile = readFile;
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error('Unexpected benchmark path');
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
