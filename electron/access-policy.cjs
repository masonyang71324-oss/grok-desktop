const fs = require('node:fs/promises');
const path = require('node:path');
const { translate: t } = require('./i18n.cjs');
const key = (value) =>
  process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const inside = (root, filename) =>
  filename === root || filename.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
const denied = () =>
  Object.assign(new Error(t('请先通过文件或项目选择器选择此路径。')), {
    code: 'FILE_ACCESS_NOT_REGISTERED',
  });

function createAccessPolicy() {
  const projects = new Map(),
    files = new Map(),
    managed = new Map(),
    executables = new Set();
  function absolute(value) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0'))
      throw denied();
    return value;
  }
  function project(cwd, write = false) {
    const entry = projects.get(key(absolute(cwd)));
    if (!entry) throw denied();
    if (write && !entry.trusted)
      throw new Error(t('请先信任此项目，再发送任务、修改文件或运行程序。'));
    return { ...entry };
  }
  function containing(filename) {
    const target = key(filename);
    return [...projects.entries()]
      .sort(([a], [b]) => b.length - a.length)
      .find(([root]) => inside(root, target))?.[1];
  }
  async function file(filename, write = false) {
    absolute(filename);
    const lexical = key(filename);
    if (
      !files.has(lexical) &&
      !containing(filename) &&
      ![...managed.keys()].some((root) => inside(root, lexical))
    )
      throw denied();
    const resolved = await fs.realpath(filename);
    const scope = containing(resolved);
    if (write) {
      if (!scope) throw new Error(t('修改文件需要已信任的项目。'));
      project(scope.cwd, true);
    } else if (
      !scope &&
      !files.has(key(resolved)) &&
      ![...managed.keys()].some((root) => inside(root, key(resolved)))
    )
      throw denied();
    return resolved;
  }
  return {
    project,
    file,
    execution(filename) {
      const scope = containing(absolute(filename));
      if (scope) return project(scope.cwd, true);
      return undefined;
    },
    setProjectTrust(cwd, trusted) {
      const current = project(cwd);
      const entry = { cwd: current.cwd, trusted: trusted === true };
      for (const [alias, old] of projects)
        if (key(old.cwd) === key(current.cwd)) projects.set(alias, entry);
      return { ...entry };
    },
    async grantProject(cwd, trusted) {
      absolute(cwd);
      const resolved = await fs.realpath(cwd);
      if (!(await fs.stat(resolved)).isDirectory()) throw denied();
      const entry = { cwd: resolved, trusted: trusted === true };
      for (const [alias, old] of projects)
        if (key(old.cwd) === key(resolved)) projects.set(alias, entry);
      projects.set(key(cwd), entry);
      projects.set(key(resolved), entry);
      return { ...entry };
    },
    async grantFile(filename) {
      absolute(filename);
      const resolved = await fs.realpath(filename);
      if (!(await fs.stat(resolved)).isFile()) throw denied();
      files.set(key(filename), resolved);
      files.set(key(resolved), resolved);
      return resolved;
    },
    async grantManagedRoot(directory) {
      const resolved = await fs.realpath(absolute(directory));
      managed.set(key(resolved), resolved);
    },
    async grantExecutable(filename) {
      const resolved = await this.grantFile(filename);
      executables.add(key(resolved));
      executables.add(key(filename));
      return path.resolve(filename);
    },
    hasExecutable(filename) {
      return (
        typeof filename === 'string' && path.isAbsolute(filename) && executables.has(key(filename))
      );
    },
    projects() {
      return [
        ...new Map([...projects.values()].map((entry) => [key(entry.cwd), { ...entry }])).values(),
      ];
    },
  };
}
module.exports = { createAccessPolicy, projectKey: key };
