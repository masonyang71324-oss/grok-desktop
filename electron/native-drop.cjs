const fs = require('node:fs/promises');
const { translate: t } = require('./i18n.cjs');

async function resolveNativeDrop(files, { selectProject, registerFiles }) {
  if (!files.length) return { files: [] };
  const types = await Promise.all(files.map((file) => fs.stat(file.path)));
  if (types.some((stat) => stat.isDirectory())) {
    if (files.length !== 1 || !types[0].isDirectory())
      throw new Error(t('请单独拖入一个文件夹作为项目，或只拖入文件作为附件。'));
    const projectPath = await selectProject(await fs.realpath(files[0].path));
    return projectPath ? { files: [], projectPath } : { files: [] };
  }
  return { files: await registerFiles(files) };
}

module.exports = { resolveNativeDrop };
