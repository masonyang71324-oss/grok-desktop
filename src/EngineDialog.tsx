import { Modal, Spinner } from './components';
import { useI18n } from './i18n';
import type { CliStatus } from './types';
import type { EngineAction } from './useEngine';

export default function EngineDialog({
  status,
  fallbackPath,
  authLabel,
  action,
  error,
  busy,
  updateBlocked,
  onAction,
  onCancelLogin,
  onClose,
  onOnboarding,
  onProviders,
}: {
  status: CliStatus | null;
  fallbackPath?: string;
  authLabel: string;
  action: EngineAction | '';
  error: string;
  busy: boolean;
  updateBlocked: boolean;
  onAction: (action: EngineAction) => void | Promise<void>;
  onCancelLogin: () => void | Promise<void>;
  onClose: () => void;
  onOnboarding: () => void;
  onProviders: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal
      title={t('Grok Build 引擎')}
      subtitle={t('用于运行 Grok 会话的本机引擎。')}
      onClose={onClose}
    >
      <dl className="engine-details">
        <div>
          <dt>{t('引擎版本')}</dt>
          <dd>{status?.version || t('版本未知')}</dd>
        </div>
        <div>
          <dt>{t('登录状态')}</dt>
          <dd>{authLabel}</dd>
        </div>
        <div>
          <dt>{t('可执行文件')}</dt>
          <dd className="engine-path">{status?.path || fallbackPath || t('未找到')}</dd>
        </div>
        {status?.latestVersion && (
          <div>
            <dt>{t('引擎更新')}</dt>
            <dd>
              {status.updateAvailable
                ? t('可更新至 {version}', { version: status.latestVersion })
                : t('已是最新')}
            </dd>
          </div>
        )}
      </dl>
      {error && (
        <p className="danger-text" role="alert">
          {error}
        </p>
      )}
      <div className="engine-actions">
        <button className="secondary-button" disabled={!!action} onClick={onOnboarding}>
          {t('首次使用引导')}
        </button>
        <button className="secondary-button" disabled={!!action} onClick={onProviders}>
          {t('模型来源')}
        </button>
        <button
          className="secondary-button"
          disabled={!!action}
          onClick={() => void onAction('login')}
        >
          {action === 'login' && <Spinner />}
          {t('登录 Grok Build')}
        </button>
        {action === 'login' && (
          <button className="secondary-button" onClick={() => void onCancelLogin()}>
            {t('取消登录')}
          </button>
        )}
        <button
          className="secondary-button"
          disabled={!!action}
          onClick={() => void onAction('refresh')}
        >
          {action === 'refresh' && <Spinner />}
          {t('刷新引擎与模型')}
        </button>
        <button
          className="secondary-button"
          disabled={!!action}
          onClick={() => void onAction('check')}
        >
          {action === 'check' && <Spinner />}
          {t('检查引擎更新')}
        </button>
        <button
          className="primary-button"
          disabled={!!action || updateBlocked}
          onClick={() => void onAction('update')}
        >
          {action === 'update' && <Spinner />}
          {t('更新 Grok Build')}
        </button>
      </div>
      <p className="engine-hint" role={action === 'login' ? 'status' : undefined}>
        {t(
          action === 'login'
            ? '请在浏览器的官方授权页面完成登录，完成后自动刷新。'
            : '点击登录将在浏览器打开官方授权页面，完成后自动刷新引擎与模型。',
        )}
      </p>
      {busy && <p className="engine-hint">{t('等待所有任务结束后可更新引擎。')}</p>}
    </Modal>
  );
}
