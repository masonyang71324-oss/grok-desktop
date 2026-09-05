const { translate: t } = require('./i18n.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { runProcess, runChecked } = require('./process.cjs');
const HIDDEN = new Set([
  '.git',
  'node_modules',
  '.next',
  '.cache',
  'dist',
  'release',
  'target',
  '__pycache__',
]);
const PREVIEW_BYTES = 512 * 1024;

function resolveWorkspacePath(cwd, file = '') {
  if (!cwd || !path.isAbsolute(cwd)) throw new Error(t('请先选择项目目录。'));
  const root = path.resolve(cwd),
    resolved = path.resolve(root, file);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    throw new Error(t('文件必须位于当前项目目录内。'));
  return resolved;
}

async function listFiles({ cwd, path: relative = '', showHidden = false }) {
  const directory = resolveWorkspacePath(cwd, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((x) => showHidden || !x.isDirectory() || !HIDDEN.has(x.name))
    .map((x) => ({
      name: x.name,
      path: path.relative(cwd, path.join(directory, x.name)).replaceAll('\\', '/'),
      isDirectory: x.isDirectory(),
    }))
    .sort(
      (a, b) =>
        Number(b.isDirectory) - Number(a.isDirectory) ||
        a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
    );
}

async function readFile({ cwd, path: relative }) {
  const filename = resolveWorkspacePath(cwd, relative);
  const file = await fs.open(filename, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error(t('请选择一个文件。'));
    const buffer = Buffer.alloc(Math.min(stat.size, PREVIEW_BYTES));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const data = buffer.subarray(0, bytesRead);
    if (data.includes(0)) throw new Error(t('此文件为二进制内容，请使用系统应用打开。'));
    const text = data.toString('utf8');
    return {
      path: relative,
      text,
      eol: text.includes('\r\n') ? 'crlf' : 'lf',
      truncated: stat.size > PREVIEW_BYTES,
      mtimeMs: stat.mtimeMs,
    };
  } finally {
    await file.close();
  }
}

async function saveFile({ cwd, path: relative, text, eol = 'lf', expectedMtimeMs }) {
  const filename = resolveWorkspacePath(cwd, relative);
  if (typeof text !== 'string') throw new Error(t('保存内容必须为文本。'));
  const current = await fs.stat(filename);
  if (expectedMtimeMs !== undefined && Math.abs(current.mtimeMs - expectedMtimeMs) > 1)
    throw new Error(t('文件已被 Grok 或其他应用修改，请重新打开后再保存。'));
  const normalized = text.replace(/\r\n?/g, '\n');
  const output = eol === 'crlf' ? normalized.replaceAll('\n', '\r\n') : normalized;
  const temporary = path.join(path.dirname(filename), `.grok-save-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, output, {
      encoding: 'utf8',
      flag: 'wx',
      mode: current.mode & 0o7777,
    });
    // chmod also restores permission bits that the process umask may remove on creation.
    await fs.chmod(temporary, current.mode & 0o7777);
    await fs.rename(temporary, filename);
    return { mtimeMs: (await fs.stat(filename)).mtimeMs };
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function gitChanges({ cwd }) {
  resolveWorkspacePath(cwd);
  let probe;
  try {
    probe = await runProcess('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree']);
  } catch (error) {
    if (error.code === 'ENOENT')
      return { isGit: false, branch: '', changes: [], unavailable: 'git-not-found' };
    throw error;
  }
  if (probe.exitCode !== 0 || probe.stdout.trim() !== 'true')
    return { isGit: false, branch: '', changes: [] };
  const [status, branch, prefixResult] = await Promise.all([
    runChecked('git', ['-C', cwd, 'status', '--porcelain=v1', '-z', '--untracked-files=all']),
    runChecked('git', ['-C', cwd, 'branch', '--show-current']),
    runChecked('git', ['-C', cwd, 'rev-parse', '--show-prefix']),
  ]);
  // Porcelain paths always start at the repository root, including when cwd is a subdirectory.
  const prefix = prefixResult.stdout.trim();
  const projectPath = (filename) =>
    filename?.startsWith(prefix) ? filename.slice(prefix.length) : null;
  const rows = status.stdout.split('\0'),
    changes = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!row) continue;
    const state = row.slice(0, 2),
      filename = projectPath(row.slice(3));
    const original = state.includes('R') || state.includes('C') ? projectPath(rows[++index]) : null;
    if (state === '??') {
      if (filename) changes.push({ path: filename, status: '?', staged: false });
    } else {
      for (const [column, staged] of [
        [0, true],
        [1, false],
      ]) {
        const code = state[column];
        if (code === ' ') continue;
        if (code === 'R' || code === 'C') {
          if (filename) changes.push({ path: filename, status: original ? code : 'A', staged });
          // Moving a file out of the selected project is a deletion in this view.
          else if (code === 'R' && original) changes.push({ path: original, status: 'D', staged });
        } else if (filename) changes.push({ path: filename, status: code, staged });
      }
    }
  }
  return { isGit: true, branch: branch.stdout.trim() || t('分离 HEAD'), changes };
}

async function gitDiff({ cwd, path: relative, staged = false }) {
  resolveWorkspacePath(cwd, relative);
  const result = await runChecked('git', [
    '-C',
    cwd,
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    ...(staged ? ['--cached'] : []),
    '--',
    relative,
  ]);
  if (result.stdout.trim()) return { text: result.stdout };
  const tracked = await runProcess('git', [
    '-C',
    cwd,
    'ls-files',
    '--error-unmatch',
    '--',
    relative,
  ]);
  if (tracked.exitCode !== 0) {
    const file = await readFile({ cwd, path: relative });
    return {
      text:
        t('新文件 {path}\n', { path: relative }) +
        file.text
          .split('\n')
          .map((line) => '+' + line)
          .join('\n') +
        (file.truncated ? t('\n… 内容已截断') : ''),
    };
  }
  return { text: t('此文件没有可显示的文本差异。') };
}

module.exports = { resolveWorkspacePath, listFiles, readFile, saveFile, gitChanges, gitDiff };
