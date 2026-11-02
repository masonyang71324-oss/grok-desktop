import { useRef, useState } from 'react';
import type { Bootstrap, CliStatus, ManagementResult } from './types';
import { errorText, request } from './lib';
import { useI18n } from './i18n';

export type EngineAction = 'check' | 'refresh' | 'update' | 'login';
export type EngineUpdateState = {
  status:
    'stopping' | 'updating' | 'repairing' | 'verifying' | 'reconnecting' | 'completed' | 'error';
  version?: string;
  repaired?: boolean;
  error?: string;
};
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
  const [engineUpdateState, setEngineUpdateState] = useState<EngineUpdateState | null>(null);
  const engineUpdatingRef = useRef(false);
  const preserveUpdateError = useRef(false);
  const inFlight = useRef(false);
  const cancellingLogin = useRef(false);
  async function readEngineStatus(checkUpdate = false, { preserveError = false } = {}) {
    try {
      const status = await request<CliStatus>(
        'cli.status',
        checkUpdate ? { checkUpdate: true } : undefined,
      );
      setCliStatus(status);
      if (!preserveError && !preserveUpdateError.current) setEngineError(status.error || '');
      return status;
    } catch (error) {
      if (!preserveError && !preserveUpdateError.current) setEngineError(errorText(error));
      setCliStatus((previous) => (previous ? { ...previous, authStatus: 'unknown' } : previous));
    }
  }
  async function runEngineAction(action: EngineAction) {
    if (inFlight.current || (action === 'update' && isUpdateBlocked())) return;
    inFlight.current = true;
    engineUpdatingRef.current = action === 'update';
    preserveUpdateError.current = false;
    setEngineAction(action);
    setEngineError('');
    setEngineUpdateState(action === 'update' ? { status: 'stopping' } : null);
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
          const version = result.data?.version;
          const status = await readEngineStatus(false, { preserveError: true });
          if (!version || status?.version !== version)
            throw new Error(
              version
                ? t('更新后无法确认引擎 {version}，请检查程序路径后重试。', { version })
                : t('更新后无法确认引擎版本，请检查程序路径后重试。'),
            );
          await onUpdated();
          setEngineUpdateState({ status: 'completed', version, repaired: result.data?.repaired });
        } else {
          onRefresh(await request<Bootstrap>('cli.refresh'));
          await readEngineStatus();
        }
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
      const message = errorText(error);
      setEngineError(message);
      if (action === 'update') {
        preserveUpdateError.current = true;
        setEngineUpdateState((previous) => ({ ...previous, status: 'error', error: message }));
        await readEngineStatus(false, { preserveError: true });
      }
    } finally {
      inFlight.current = false;
      engineUpdatingRef.current = false;
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
    engineUpdateState,
    setEngineUpdateState,
    engineUpdatingRef,
    engineAuthStatus,
    engineAuthLabel,
    readEngineStatus,
    runEngineAction,
    cancelEngineLogin,
  };
}
