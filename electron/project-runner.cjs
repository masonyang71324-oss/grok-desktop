const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { translate: t } = require('./i18n.cjs');

function extractLocalUrl(text) {
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\x1b]+/g)) {
    try {
      const url = new URL(match[0]);
      if (
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
        !url.username &&
        !url.password
      )
        return url.href;
    } catch {}
  }
}

async function npmCommand() {
  if (process.platform !== 'win32') return { executable: 'npm', args: [] };
  // Executing npm's JS entry point avoids cmd.exe quoting for Windows paths and script names.
  const directories = [
    path.dirname(process.execPath),
    ...(process.env.PATH || '').split(path.delimiter),
  ];
  for (const directory of directories) {
    const cli = path.join(
      directory.replace(/^"|"$/g, ''),
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    );
    try {
      await fs.access(cli);
      return { executable: process.versions.electron ? 'node' : process.execPath, args: [cli] };
    } catch {}
  }
  throw new Error(t('未找到 npm，请安装 Node.js 并重新打开桌面应用。'));
}

function createProjectRunner({ emit = () => {} } = {}) {
  const projects = new Map();
  const key = (cwd) =>
    process.platform === 'win32' ? path.resolve(cwd).toLowerCase() : path.resolve(cwd);
  const stopped = () => ({ status: 'stopped', script: null, log: '' });
  const state = ({ cwd }) => ({ ...(projects.get(key(cwd))?.state || stopped()) });
  const publish = (project) =>
    emit('runner-changed', { cwd: project.cwd, state: { ...project.state } });
  async function inspect({ cwd }) {
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return { scripts: [], state: state({ cwd }) };
      throw error;
    }
    return {
      scripts: Object.entries(manifest.scripts || {})
        .filter(([, command]) => typeof command === 'string')
        .map(([name, command]) => ({ name, command })),
      state: state({ cwd }),
    };
  }
  async function start({ cwd, script }) {
    cwd = path.resolve(cwd);
    const existing = projects.get(key(cwd));
    if (existing?.child) throw new Error(t('项目正在运行，请先停止再重新运行。'));
    const { scripts } = await inspect({ cwd });
    if (!scripts.some((item) => item.name === script))
      throw new Error(t('请选择已有的 npm 脚本。'));
    const command = await npmCommand();
    // Recheck after awaits so simultaneous Run clicks cannot create unowned processes.
    if (projects.get(key(cwd))?.child) throw new Error(t('项目正在运行，请先停止再重新运行。'));
    const project = {
      cwd,
      state: { status: 'running', script, log: '' },
      child: null,
      stopping: false,
    };
    const child = spawn(command.executable, [...command.args, 'run', '--', script], {
      cwd,
      windowsHide: true,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    project.child = child;
    projects.set(key(cwd), project);
    project.closed = new Promise((resolve) => {
      child.once('error', (error) => {
        project.state.status = 'error';
        project.state.error = error.message;
        publish(project);
      });
      child.once('close', (code, signal) => {
        project.child = null;
        if (project.stopping) project.state.status = 'stopped';
        else if (code !== 0 && !project.state.error) {
          project.state.status = 'error';
          project.state.error = t('npm 已退出，代码：{code}', { code: code ?? signal });
        } else if (!project.state.error) project.state.status = 'stopped';
        delete project.state.url;
        publish(project);
        resolve();
      });
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        project.state.log = (project.state.log + chunk.replace(/\x1b\[[0-9;]*m/g, '')).slice(
          -65536,
        );
        const url = extractLocalUrl(project.state.log);
        if (url) project.state.url = url;
        publish(project);
      });
    }
    publish(project);
    return state({ cwd });
  }
  async function stop({ cwd }) {
    const project = projects.get(key(cwd));
    if (!project?.child) return state({ cwd });
    if (project.stopPromise) return project.stopPromise;
    project.stopPromise = (async () => {
      project.stopping = true;
      project.state.status = 'stopping';
      publish(project);
      const pid = project.child.pid;
      if (pid) {
        if (process.platform === 'win32') {
          await new Promise((resolve, reject) => {
            const killer = spawn('taskkill.exe', ['/pid', String(pid), '/T', '/F'], {
              windowsHide: true,
              shell: false,
              stdio: 'ignore',
            });
            killer.once('error', reject);
            killer.once('close', (code) =>
              code === 0 || !project.child
                ? resolve()
                : reject(new Error(t('无法停止项目进程（{code}）。', { code }))),
            );
          });
        } else {
          try {
            process.kill(-pid, 'SIGTERM');
          } catch (error) {
            if (error.code !== 'ESRCH') throw error;
          }
          const timer = setTimeout(() => {
            try {
              process.kill(-pid, 'SIGKILL');
            } catch {}
          }, 1500);
          timer.unref();
          await project.closed;
          clearTimeout(timer);
        }
      }
      await project.closed;
      return state({ cwd });
    })()
      .catch((error) => {
        project.state.status = 'error';
        project.state.error = error.message;
        project.stopping = false;
        publish(project);
        throw error;
      })
      .finally(() => {
        project.stopPromise = null;
      });
    return project.stopPromise;
  }
  return {
    inspect,
    start,
    stop,
    state,
    get busy() {
      return [...projects.values()].some((project) => !!project.child);
    },
    dispose: async () => {
      await Promise.all([...projects.values()].map((project) => stop({ cwd: project.cwd })));
    },
  };
}

module.exports = { createProjectRunner, extractLocalUrl };
