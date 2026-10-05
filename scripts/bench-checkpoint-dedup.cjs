const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCheckpointStore } = require('../electron/checkpoints.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint dedup bench '));
  try {
    const cwd = path.join(root, 'project'),
      directory = path.join(root, 'store');
    await fs.mkdir(cwd);
    const store = createCheckpointStore({ directory });
    const before = 'baseline\r\n'.repeat(24000),
      after = 'modified\r\n'.repeat(24000);
    for (let turn = 0; turn < 8; turn++) {
      for (let file = 0; file < 4; file++)
        await fs.writeFile(path.join(cwd, `${file}.txt`), before);
      const id = await store.begin({ cwd, sessionId: 'synthetic', turnId: String(turn) });
      for (let file = 0; file < 4; file++) await fs.writeFile(path.join(cwd, `${file}.txt`), after);
      await store.finish(id);
    }
    const { bytes, manifestBytes, blobBytes, logicalBytes, records } = await store.storage();
    console.log(
      JSON.stringify(
        {
          records: records.length,
          logicalBytes,
          physicalBytes: bytes,
          manifestBytes,
          blobBytes,
          savedPercent: Number((100 * (1 - bytes / logicalBytes)).toFixed(2)),
        },
        null,
        2,
      ),
    );
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error('Unexpected benchmark path');
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
