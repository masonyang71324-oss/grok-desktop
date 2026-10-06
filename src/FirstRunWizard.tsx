import { useEffect, useRef, useState } from 'react';
import { Modal, Spinner } from './components';
import { useI18n } from './i18n';
import { errorText } from './lib';
import './runtime-upgrades.css';

export type RuntimeRequest = (command: string, payload?: any) => Promise<any>;
export type CliInstallState = {
  status: 'idle' | 'installing' | 'verifying' | 'installed' | 'cancelled' | 'error';
  log: string;
  path?: string;
  version?: string;
  error?: string;
};
export type WizardCliStatus = {
  path?: string;
  version?: string;
  authStatus?: string;
  error?: string;
};
export default function FirstRunWizard({
  cliStatus,
  installState,
  request,
  onComplete,
  onClose,
}: {
  cliStatus?: WizardCliStatus;
  installState?: CliInstallState;
  request: RuntimeRequest;
  onComplete: (cwd: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [cli, setCli] = useState<WizardCliStatus>(cliStatus || {});
  const [install, setInstall] = useState<CliInstallState>(
    installState || { status: 'idle', log: '' },
  );
  const [cwd, setCwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const loginInFlight = useRef(false);
  const alive = useRef(true);
  const installing = ['installing', 'verifying'].includes(install.status);
  useEffect(() => {
    if (cliStatus) setCli(cliStatus);
  }, [cliStatus]);
  useEffect(() => {
    if (installState) setInstall(installState);
  }, [installState]);
  useEffect(() => {
    alive.current = true;
    void Promise.all([request('cli.status'), request('cli.install.state')])
      .then(([status, state]) => {
        if (alive.current) {
          setCli(status);
          setInstall(state);
        }
      })
      .catch((e) => {
        if (alive.current) setError(errorText(e));
      })
      .finally(() => {
        if (alive.current) setChecking(false);
      });
    return () => {
      alive.current = false;
      if (loginInFlight.current) void request('cli.login.cancel').catch(() => {});
    };
  }, [request]);
  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function recheck() {
    const status = await request('cli.status');
    if (alive.current) setCli(status);
  }
  async function installCli() {
    setInstall({ status: 'installing', log: '' });
    const result: CliInstallState = await request('cli.install.start');
    if (!alive.current) return;
    setInstall(result);
    if (result.status === 'installed') await recheck();
  }
  async function cancelInstall() {
    const result = await request('cli.install.cancel');
    if (alive.current) setInstall(result);
  }
  async function loginCli() {
    if (loginInFlight.current) return;
    loginInFlight.current = true;
    setLoggingIn(true);
    try {
      const result: { cancelled: boolean; status?: WizardCliStatus } = await request('cli.login');
      if (!alive.current || result.cancelled) return;
      if (result.status?.authStatus !== 'authenticated')
        throw new Error(t('未完成登录验证，请重试或重新检查登录。'));
      setCli(result.status);
    } finally {
      loginInFlight.current = false;
      if (alive.current) setLoggingIn(false);
    }
  }
  async function cancelLogin() {
    setError('');
    try {
      await request('cli.login.cancel');
    } catch (e) {
      throw new Error(t('无法取消登录，请重试。') + ' ' + errorText(e));
    }
  }
  async function close() {
    if (loginInFlight.current) {
      try {
        await cancelLogin();
      } catch (e) {
        if (alive.current) setError(errorText(e));
        return;
      }
    }
    if (installing) {
      try {
        await cancelInstall();
      } catch (e) {
        if (alive.current) setError(errorText(e));
        return;
      }
    }
    onClose();
  }
  const signedIn = cli.authStatus === 'authenticated';
  return (
    <Modal title={t('欢迎使用 Grok Build Desktop')} onClose={() => void close()} wide>
      <div className="first-run-wizard runtime-upgrades">
        <p>{t('完成程序、登录和项目设置，即可开始对话。')}</p>
        {checking && <p role="status">{t('正在检查 Grok 程序和安装状态…')}</p>}
        <section aria-label={t('Grok 程序')}>
          <h3>1. {t('Grok 程序')}</h3>
          {cli.version ? (
            <p className="runtime-ready">
              {t('已检测到 Grok {version}', { version: cli.version })}
              <small>{cli.path}</small>
            </p>
          ) : (
            <p>{t('选择已有的 grok.exe，或安装官方稳定版。')}</p>
          )}
          <div className="runtime-actions">
            <button
              disabled={checking || busy || installing}
              onClick={() =>
                void action(async () => {
                  const chosen = await request('dialog.grok');
                  if (!chosen || !alive.current) return;
                  await request('settings.save', { grokPath: chosen });
                  await recheck();
                })
              }
            >
              {t('选择 Grok 程序')}
            </button>
            {!cli.version && (
              <button
                disabled={checking || busy || installing}
                onClick={() => void action(installCli)}
              >
                {install.status === 'error' || install.status === 'cancelled'
                  ? t('重试安装')
                  : t('安装官方稳定版')}
              </button>
            )}
            {installing && (
              <button onClick={() => void action(cancelInstall)}>{t('取消安装')}</button>
            )}
          </div>
          {installing && (
            <p role="status">
              {install.status === 'verifying'
                ? t('正在验证安装版本…')
                : t('正在安装，进度来自官方安装程序…')}
            </p>
          )}
          {install.status === 'cancelled' && <p role="status">{t('安装已取消，可重新开始。')}</p>}
          {install.status === 'installed' && <p role="status">{t('CLI 版本验证通过。')}</p>}
          {install.log && (
            <pre className="runtime-install-log" aria-label={t('安装进度')}>
              {install.log}
            </pre>
          )}
          {install.error && (
            <p role="alert" className="runtime-error">
              {install.error}
            </p>
          )}
        </section>
        {cli.version && (
          <section aria-label={t('登录 Grok')}>
            <h3>2. {t('登录 Grok')}</h3>
            <p>
              {signedIn ? t('已验证登录状态。') : t('在浏览器完成官方授权，登录状态将自动更新。')}
            </p>
            <div className="runtime-actions">
              {!signedIn && (
                <button disabled={checking || busy} onClick={() => void action(loginCli)}>
                  {loggingIn && <Spinner />}
                  {t('打开官方登录')}
                </button>
              )}
              {loggingIn && (
                <button
                  onClick={() =>
                    void cancelLogin().catch((e) => {
                      if (alive.current) setError(errorText(e));
                    })
                  }
                >
                  {t('取消登录')}
                </button>
              )}
              <button disabled={checking || busy} onClick={() => void action(recheck)}>
                {t('重新检查登录')}
              </button>
            </div>
            {loggingIn && (
              <p role="status">{t('请在浏览器的官方授权页面完成登录，完成后自动刷新。')}</p>
            )}
            {cli.error && <p className="runtime-error">{cli.error}</p>}
          </section>
        )}
        {cli.version && (
          <section aria-label={t('项目目录')}>
            <h3>3. {t('项目目录')}</h3>
            <p>{cwd || t('请选择此次工作的项目目录。')}</p>
            <button
              disabled={checking || busy}
              onClick={() =>
                void action(async () => {
                  const chosen = await request('dialog.project');
                  if (chosen && alive.current) setCwd(chosen);
                })
              }
            >
              {t('选择项目目录')}
            </button>
          </section>
        )}
        {error && (
          <p role="alert" className="runtime-error">
            {error}
          </p>
        )}
        <div className="runtime-actions runtime-footer">
          <button disabled={busy && !installing && !loggingIn} onClick={() => void close()}>
            {t('稍后设置')}
          </button>
          <button
            className="primary"
            disabled={checking || busy || installing || !cli.version || !signedIn || !cwd}
            onClick={() => onComplete(cwd)}
          >
            {t('开始使用')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
