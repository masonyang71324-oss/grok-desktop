'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Copy only the selected program and its optional agent alias. The closed
 * restore list never traverses the Grok home or removes files installed later.
 * @param {string} executable
 * @param {string} backupRoot
 * @returns {Promise<{directory:string,restore:()=>Promise<void>}>}
 */
async function createEngineBackup(executable, backupRoot) {
  if (
    typeof executable !== 'string' ||
    !path.isAbsolute(executable) ||
    typeof backupRoot !== 'string' ||
    !path.isAbsolute(backupRoot)
  )
    throw new Error('Engine program and backup directory must use absolute paths.');
  executable = path.resolve(executable);
  backupRoot = path.resolve(backupRoot);
  const requireProgram = async (filename) => {
    const stat = await fs.stat(filename);
    if (!stat.isFile())
      throw Object.assign(new Error('Engine program is not a regular file.'), { code: 'EISDIR' });
  };
  await requireProgram(executable);
  const originals = [executable];
  const agent = path.join(path.dirname(executable), 'agent.exe');
  const key = (filename) => (process.platform === 'win32' ? filename.toLowerCase() : filename);
  if (key(agent) !== key(executable)) {
    try {
      await requireProgram(agent);
      originals.push(agent);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await fs.mkdir(backupRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(backupRoot, 'engine-'));
  const copies = originals.map((original) => ({
    original,
    saved: path.join(directory, path.basename(original)),
  }));
  for (const file of copies) await fs.copyFile(file.original, file.saved);
  return {
    directory,
    async restore() {
      for (const file of copies) await fs.copyFile(file.saved, file.original);
    },
  };
}

module.exports = { createEngineBackup };
