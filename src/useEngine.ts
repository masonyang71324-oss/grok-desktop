import { useRef, useState } from 'react';
import type { Bootstrap, CliStatus, ManagementResult } from './types';
import { errorText, request } from './lib';
import { useI18n } from './i18n';

export type EngineAction = 'check' | 'refresh' | 'update' | 'login';
export function useEngine({
  getCwd,
  isUpdateBlocked,
  hasSession,
  onRefresh,
  onUpdated,
  notify,
}: {
  getCwd: () => string;
  isUpdateBlocked: () => boolean;
  hasSession: () => boolean;
  onRefresh: (data: Bootstrap) => void;
  onUpdated: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const { t } = useI18n();
  const [cliStatus, setCliStatus] = useState<CliStatus | null>(null);
  const [engineAction, setEngineAction] = useState<EngineAction | ''>('');
  const [engineError, setEngineError] = useState('');
  const inFlight = useRef(false);
  const cancellingLogin = useRef(false);
  async function readEngineStatus(checkUpdate = false) {
    try {
      const status = await request<CliStatus>(
        'cli.status',
        checkUpdate ? { checkUpdate: true } : undefined,
      );
      setCliStatus(status);
      setEngineError(status.error || '');
    } catch (error) {
      setEngineError(errorText(error));
      setCliStatus((previous) => (previous ? { ...previous, authStatus: 'unknown' } : previous));
    }
  }
  async function runEngineAction(action: EngineAction) {
    if (inFlight.current || (action === 'update' && isUpdateBlocked())) return;
    inFlight.current = true;
    setEngineAction(action);
    setEngineError('');
    try {
      if (action === 'login') {
        const result = await request<{ cancelled: boolean; status?: CliStatus }>('cli.login');
        if (result.cancelled) return;
        if (result.status?.authStatus !== 'authenticated')
          throw new Error(t('未完成登录验证，请重试或重新检查登录。'));
        setCliStatus(result.status);
        onRefresh(await request<Bootstrap>('cli.refresh'));
        notify(t('Grok Build 已登录，引擎与模型已刷新。'));
      } else if (action === 'check') await readEngineStatus(true);
      else {
        if (action === 'update') {
          const result = await request<ManagementResult>('system.run', {
            action: 'update-install',
            cwd: getCwd(),
            values: {},
          });
          if (result.exitCode) throw new Error(result.text || t('引擎更新失败'));
          await onUpdated();
        } else onRefresh(await request<Bootstrap>('cli.refresh'));
        await readEngineStatus();
        notify(
          t(
            action === 'update'
              ? 'Grok Build 已更新'
              : hasSession()
                ? '引擎与模型已刷新，新会话将使用最新模型列表。'
                : '引擎与模型已刷新',
          ),
        );
      }
    } catch (error) {
      setEngineError(errorText(error));
    } finally {
      inFlight.current = false;
      setEngineAction('');
    }
  }
  async function cancelEngineLogin() {
    if (engineAction !== 'login' || cancellingLogin.current) return;
    cancellingLogin.current = true;
    setEngineError('');
    try {
      await request('cli.login.cancel');
    } catch (error) {
      setEngineError(t('无法取消登录，请重试。') + ' ' + errorText(error));
    } finally {
      cancellingLogin.current = false;
    }
  }
  const engineAuthStatus = cliStatus?.authStatus || 'unknown';
  const engineAuthLabel = t(
    engineAuthStatus === 'authenticated'
      ? '已登录'
      : engineAuthStatus === 'required'
        ? '需要登录'
        : '登录状态未知',
  );
  return {
    cliStatus,
    setCliStatus,
    engineAction,
    engineError,
    engineAuthStatus,
    engineAuthLabel,
    readEngineStatus,
    runEngineAction,
    cancelEngineLogin,
  };
}
