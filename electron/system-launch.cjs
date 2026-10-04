const fs = require('node:fs/promises');
const path = require('node:path');

function windowsSystemExecutable(filename, env = process.env) {
  const root = /^[a-z]:[\\/]/i.test(env.SystemRoot || '') ? env.SystemRoot : 'C:\\Windows';
  return path.win32.join(root, 'System32', filename);
}

function windowsPowerShellPath(env = process.env) {
  return windowsSystemExecutable('WindowsPowerShell\\v1.0\\powershell.exe', env);
}

async function resolvePathExecutable(
  filename,
  { env = process.env, platform = process.platform } = {},
) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const pathValue = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] || '';
  for (const entry of pathValue.split(paths.delimiter)) {
    const directory = entry.replace(/^"|"$/g, '');
    // Empty and relative PATH entries reintroduce the project's current directory.
    if (
      !paths.isAbsolute(directory) ||
      (platform === 'win32' && !/^[a-z]:[\\/]|^\\\\/i.test(directory))
    )
      continue;
    const candidate = paths.join(directory, filename);
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  return null;
}

const executableExtensions = new Set([
  '.exe',
  '.com',
  '.bat',
  '.cmd',
  '.ps1',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.msi',
  '.msp',
  '.scr',
  '.hta',
  '.lnk',
  '.url',
]);

function isExecutableOpenTarget(filepath) {
  return executableExtensions.has(path.win32.extname(filepath).toLowerCase());
}

module.exports = {
  windowsPowerShellPath,
  windowsSystemExecutable,
  resolvePathExecutable,
  isExecutableOpenTarget,
};
