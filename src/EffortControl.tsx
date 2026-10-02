import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useI18n } from './i18n';
import './effort-control.css';

export interface EffortControlProps {
  options: { id: string; value?: string; label?: string; default?: boolean }[];
  value: string;
  presets: { id: string; value: string; label?: string; description: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}

const effortLabels: Record<string, string> = {
  low: '轻量',
  medium: '标准',
  high: '深入',
  xhigh: '更深入',
  max: '最高',
  ultra: '极致',
};
const presetLabels: Record<string, string> = {
  quick: '快速处理',
  standard: '标准处理',
  deep: '深入处理',
};

export default function EffortControl({
  options,
  value,
  presets,
  disabled,
  onChange,
}: EffortControlProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, bottom: 12, width: 320, maxHeight: 360 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const popupId = useId();
  const expanded = open && !disabled;
  const optionValue = (option: EffortControlProps['options'][number]) => option.value || option.id;
  const optionLabel = (option: EffortControlProps['options'][number]) =>
    effortLabels[optionValue(option)]
      ? t(effortLabels[optionValue(option)])
      : option.label || optionValue(option);
  const selected = options.find((option) => optionValue(option) === value);
  const label = !value ? t('默认推理') : selected ? optionLabel(selected) : value;

  function close() {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }

  function change(next: string) {
    if (disabled) return;
    close();
    onChange(next);
  }

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const bounds = trigger.current!.getBoundingClientRect();
      const width = Math.min(320, window.innerWidth - 24);
      setPosition({
        left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
        bottom: window.innerHeight - bounds.top + 8,
        width,
        maxHeight: Math.max(0, bounds.top - 20),
      });
    };
    place();
    select.current?.focus({ preventScroll: true });
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('click', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('click', outside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [expanded]);

  return (
    <div
      className="effort-picker"
      ref={root}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (expanded && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="effort-trigger"
        aria-label={t('推理深度')}
        title={`${t('推理深度')} · ${label}`}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-controls={popupId}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (!disabled && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {expanded && (
        <div
          id={popupId}
          className="effort-popup"
          role="dialog"
          aria-label={t('推理深度')}
          style={position}
        >
          {presets.length > 0 && (
            <div className="effort-popup-presets" role="group" aria-label={t('推理快捷设置')}>
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={t(preset.description)}
                  aria-pressed={value === preset.value}
                  onClick={() => change(preset.value)}
                >
                  {presetLabels[preset.id] ? t(presetLabels[preset.id]) : preset.label || preset.id}
                </button>
              ))}
            </div>
          )}
          <label className="effort-popup-field">
            <span>{t('推理深度')}</span>
            <select
              ref={select}
              aria-label={t('推理深度')}
              value={value}
              onChange={(event) => change(event.target.value)}
            >
              <option value="">{t('默认推理')}</option>
              {value && !selected && (
                <option value={value} disabled>
                  {value}
                </option>
              )}
              {options.map((option) => (
                <option key={option.id} value={optionValue(option)}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
