const fs = require('node:fs/promises');

/**
 * @param {import('node:fs').PathLike} source
 * @param {import('node:fs').PathLike} destination
 * @param {{beforeRetry?: () => void | Promise<void>}} [options]
 */
async function renameWithRetry(source, destination, { beforeRetry } = {}) {
  const delays = [30, 60, 120];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(source, destination);
    } catch (error) {
      if (
        process.platform !== 'win32' ||
        !['EPERM', 'EBUSY'].includes(error.code) ||
        attempt >= delays.length
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      await beforeRetry?.();
    }
  }
}

module.exports = { renameWithRetry };
