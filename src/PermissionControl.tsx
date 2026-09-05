import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ShieldCheck } from 'lucide-react';
import type { PermissionMode } from './types';
import { errorText } from './lib';
import { Spinner } from './components';
import './permission-control.css';
import { useI18n } from './i18n';

const choices = [
  {
    value: 'ask' as const,
    label: '需要时询问',
    description: 'Grok 请求授权时，由你选择允许或拒绝。',
  },
  { value: 'auto' as const, label: '自动批准', description: '自动允许后续请求的文件和工具操作。' },
];

export default function PermissionControl({
  value,
  onChange,
  disabled = false,
  scope = '当前会话',
  openSignal = 0,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => Promise<void>;
  disabled?: boolean;
  scope?: string;
  openSignal?: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  async function select(mode: PermissionMode) {
    if (busy) return;
    if (mode === value) {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onChange(mode);
      setOpen(false);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      trigger.current?.focus();
    }
  }
  return (
    <div
      className="permission-control"
      ref={root}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!open) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
          return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const items = [
            ...root.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
          ];
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`permission-trigger ${value === 'auto' ? 'is-auto' : ''}`}
        aria-label={t('操作权限：{mode}', {
          mode: t(choices.find((item) => item.value === value)?.label || ''),
        })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled || busy}
        onClick={() => {
          setError('');
          setOpen(!open);
        }}
      >
        {busy ? <Spinner /> : <ShieldCheck size={14} />}
        <span>{t('操作权限')}</span>
        <strong>{t(value === 'auto' ? '自动批准' : '需要时询问')}</strong>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="permission-menu" id={menuId} role="menu" aria-label={t('操作权限')}>
          <div className="permission-menu-heading">
            <strong>{t('操作权限')}</strong>
            <span>{t(scope)}</span>
          </div>
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="menuitemradio"
              aria-checked={value === choice.value}
              disabled={busy}
              onClick={() => void select(choice.value)}
            >
              <div>
                <strong>{t(choice.label)}</strong>
                <small>{t(choice.description)}</small>
              </div>
              {value === choice.value && <Check size={16} />}
            </button>
          ))}
          <p>{t('Grok 已记住的允许或拒绝规则仍然有效。')}</p>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
