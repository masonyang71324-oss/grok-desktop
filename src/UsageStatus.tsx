import { useEffect, useRef, useState } from 'react';
import { BookOpen, Gauge, RefreshCw } from 'lucide-react';
import { useI18n } from './i18n';
import { request } from './lib';
import {
  createUsageStatusReader,
  emptyUsageState,
  type UsageRead,
  type UsageStatusReader,
} from './usage-status.mjs';
import './usage-status.css';

export interface UsageStatusProps {
  cwd?: string;
  sessionId?: string;
  revision?: number;
  connected?: boolean;
  active?: boolean;
  contextWindow?: number;
  compact?: boolean;
  onOpen: () => void;
}

export default function UsageStatus({
  cwd,
  sessionId,
  revision,
  connected = true,
  active = false,
  contextWindow,
  compact = false,
  onOpen,
}: UsageStatusProps) {
  const { t, locale } = useI18n();
  const [state, setState] = useState(emptyUsageState);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const reader = useRef<UsageStatusReader | null>(null);

  useEffect(() => {
    const next = createUsageStatusReader(request, setState);
    reader.current = next;
    return () => {
      next.dispose();
      reader.current = null;
    };
  }, []);

  useEffect(() => {
    reader.current?.update({ cwd, sessionId, revision, connected, active, visible, contextWindow });
  }, [cwd, sessionId, revision, connected, active, visible, contextWindow]);

  useEffect(() => {
    const changed = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);

  const scopeMatches =
    state.scope?.cwd === cwd &&
    state.scope?.sessionId === sessionId &&
    state.scope?.contextWindow === contextWindow;
  const context = scopeMatches ? state.context : emptyUsageState().context;
  const account = state.account;
  const busy = account.loading || context.loading;
  const percent = (value: number) =>
    value > 0 && value < 0.1
      ? '<0.1%'
      : value > 99.9 && value < 100
        ? '>99.9%'
        : `${value.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
  const tokens = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 0 });
  const time = (value: number | string | null) =>
    value === null
      ? null
      : new Date(value).toLocaleTimeString(locale, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
  const caption = (value: UsageRead<unknown>, fetchedAt?: string | null) => {
    const updated = time(fetchedAt || value.updatedAt);
    const previous = (label: string) => (updated ? `${label} · ${updated}` : label);
    if (!connected) return value.data ? previous(t('未连接 · 上次数据')) : t('未连接');
    if (value.error) return value.data ? previous(t('更新失败 · 上次数据')) : t('更新失败');
    if (value.loading) return value.data ? previous(t('更新中 · 上次数据')) : t('读取中…');
    return updated ? t('更新于 {time}', { time: updated }) : t('等待统计');
  };
  const plan = account.data?.plan
    ? ({
        heavy: 'Heavy',
        supergrok: 'SuperGrok',
        premium: 'Premium',
        premium_plus: 'Premium+',
        free: t('免费套餐'),
      }[account.data.plan.toLowerCase()] ?? account.data.plan)
    : t('套餐额度');
  const remaining = account.data?.remainingPercent;
  const accountValue =
    remaining != null
      ? t('剩余 {percent}', { percent: percent(remaining) })
      : account.loading
        ? t('读取中…')
        : t('额度未返回');
  const accountCaption = caption(account, account.data?.fetchedAt);
  const contextData = context.data;
  const contextValue = !sessionId
    ? t('尚未选择会话')
    : contextData?.used != null && contextData.total != null
      ? `${tokens(contextData.used)} / ${tokens(contextData.total)}`
      : contextData?.percent != null
        ? t('已用 {percent}', { percent: percent(contextData.percent) })
        : context.loading
          ? t('读取中…')
          : t('统计未返回');
  const contextCaption = sessionId ? caption(context) : t('创建会话后显示');
  const compactState = (value: UsageRead<unknown>) =>
    !connected
      ? t('未连接')
      : value.error
        ? t('更新失败')
        : value.loading && value.data
          ? t('读取中…')
          : '';
  const detailLabel = t('查看额度与上下文明细');
  const accountDetail = `${plan}: ${accountValue} · ${accountCaption}`;
  const contextDetail = `${t('上下文')}: ${contextValue} · ${contextCaption}`;
  const progress = (value: number, label: string) => (
    <span
      className="usage-status-track"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.min(100, Math.max(0, value))}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </span>
  );

  return (
    <section className={`usage-status${compact ? ' is-compact' : ''}`} aria-label={t('用量概览')}>
      <button
        type="button"
        className="usage-status-detail"
        aria-label={compact ? `${detailLabel} · ${accountDetail} · ${contextDetail}` : detailLabel}
        onClick={onOpen}
      >
        <span className="usage-status-metric" title={compact ? accountDetail : undefined}>
          <span className="usage-status-heading">
            <Gauge size={14} aria-hidden="true" />
            <span title={plan}>{plan}</span>
          </span>
          <strong>{accountValue}</strong>
          {compact && remaining != null && progress(remaining, `${plan} ${accountValue}`)}
          <span
            className={`usage-status-caption${account.error || !connected ? ' is-stale' : ''}`}
            title={account.error || account.data?.fetchedAt || undefined}
          >
            {compact ? compactState(account) : accountCaption}
          </span>
        </span>
        <span className="usage-status-metric" title={compact ? contextDetail : undefined}>
          <span className="usage-status-heading">
            <BookOpen size={14} aria-hidden="true" />
            <span>{t('上下文')}</span>
          </span>
          <strong>{contextValue}</strong>
          {compact &&
            contextData?.percent != null &&
            progress(
              contextData.percent,
              `${t('上下文')} ${t('已用 {percent}', { percent: percent(contextData.percent) })}`,
            )}
          <span
            className={`usage-status-caption${context.error || !connected ? ' is-stale' : ''}`}
            title={
              context.error ||
              (context.updatedAt !== null
                ? new Date(context.updatedAt).toLocaleString(locale)
                : undefined)
            }
          >
            {compact ? (sessionId ? compactState(context) : '') : contextCaption}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="usage-status-refresh"
        aria-label={t('刷新用量')}
        title={t('刷新用量')}
        disabled={busy || !connected || !visible}
        onClick={() => reader.current?.refresh(true)}
      >
        <RefreshCw
          size={15}
          className={busy ? 'usage-status-spinning' : undefined}
          aria-hidden="true"
        />
      </button>
    </section>
  );
}
