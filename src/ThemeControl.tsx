import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import type { Settings } from './types';
import { useI18n } from './i18n';
import './theme-control.css';

export default function ThemeControl({
  value,
  disabled = false,
  onChange,
}: {
  value: Settings['theme'];
  disabled?: boolean;
  onChange: (theme: Settings['theme']) => Promise<void>;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const select = useRef<HTMLSelectElement>(null);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (saving || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (document.activeElement === document.body) select.current?.focus({ preventScroll: true });
  }, [saving]);
  const labels = { dark: '深色', light: '浅色', system: '跟随系统' };
  const Icon = value === 'light' ? Sun : value === 'system' ? Monitor : Moon;
  return (
    <label className="theme-control" title={`${t('外观主题')} · ${t(labels[value])}`}>
      <Icon size={16} aria-hidden="true" />
      <select
        ref={select}
        aria-label={t('外观主题')}
        value={value}
        disabled={disabled || saving}
        onChange={async (event) => {
          const next = event.target.value as Settings['theme'];
          if (next === value || saving) return;
          restoreFocus.current = document.activeElement === event.currentTarget;
          setSaving(true);
          try {
            await onChange(next);
          } finally {
            setSaving(false);
          }
        }}
      >
        <option value="dark">{t('深色')}</option>
        <option value="light">{t('浅色')}</option>
        <option value="system">{t('跟随系统')}</option>
      </select>
      <ChevronDown size={12} className="theme-control-chevron" aria-hidden="true" />
    </label>
  );
}
