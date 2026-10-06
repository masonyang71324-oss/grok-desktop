import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Zap } from 'lucide-react';
import { useI18n } from './i18n';
import './effort-control.css';

export interface EffortControlProps {
  options: { id: string; value?: string; label?: string; default?: boolean }[];
  value: string;
  presets: { id: string; value: string; label?: string; description: string }[];
  disabled: boolean;
  pending?: boolean;
  modelName?: string;
  onModelClick?: () => void;
  onChange: (value: string) => void | Promise<void>;
}

const effortLabels: Record<string, string> = {
  none: '关闭推理',
  minimal: '最低',
  low: '轻量',
  medium: '标准',
  high: '深入',
  xhigh: '更深入',
  max: '最高',
  ultra: '极致',
};
const effortOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const presetLabels: Record<string, string> = {
  quick: '快速处理',
  standard: '标准处理',
  deep: '深入处理',
};
const adjustmentKeys = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);
const optionValue = (option: EffortControlProps['options'][number]) => option.value || option.id;

export default function EffortControl({
  options,
  value,
  presets,
  disabled,
  pending = false,
  modelName = 'Grok',
  onModelClick,
  onChange,
}: EffortControlProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [position, setPosition] = useState({ left: 12, top: 12, width: 256, maxHeight: 360 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const draft = useRef<string | null>(null);
  const pointer = useRef(false);
  const keyboard = useRef(false);
  const committing = useRef(false);
  const restoreFocusAfterSave = useRef<HTMLElement | null>(null);
  const popupId = useId();
  const expanded = open && !disabled;
  const locked = disabled || pending || saving;
  // Unknown server-defined levels retain their original labels/order in a select.
  // Guessing their relative strength would give the slider a misleading scale.
  const ordered = options.every((option) => effortOrder.includes(optionValue(option)))
    ? [...options].sort(
        (a, b) => effortOrder.indexOf(optionValue(a)) - effortOrder.indexOf(optionValue(b)),
      )
    : options;
  const knownScale = ordered.every((option) => effortOrder.includes(optionValue(option)));
  const shownValue = preview ?? value;
  const selected = ordered.find((option) => optionValue(option) === shownValue);
  const selectedIndex = shownValue
    ? ordered.findIndex((option) => optionValue(option) === shownValue)
    : ordered.findIndex((option) => option.default);
  const canSlide = knownScale && selectedIndex >= 0;
  const normalized = ordered.length > 1 ? Math.max(0, selectedIndex) / (ordered.length - 1) : 0;
  const optionLabel = (option: EffortControlProps['options'][number]) =>
    effortLabels[optionValue(option)]
      ? t(effortLabels[optionValue(option)])
      : option.label || optionValue(option);
  const label = !shownValue ? t('默认推理') : selected ? optionLabel(selected) : shownValue;
  const signature = options.map((option) => `${optionValue(option)}:${!!option.default}`).join('|');

  function cancelPreview() {
    pointer.current = false;
    keyboard.current = false;
    draft.current = null;
    setPreview(null);
  }
  function close(restoreFocus = true) {
    restoreFocusAfterSave.current = null;
    cancelPreview();
    setOpen(false);
    setQuickOpen(false);
    if (restoreFocus) {
      if (locked) restoreFocusAfterSave.current = trigger.current;
      else trigger.current?.focus({ preventScroll: true });
    }
  }
  function updatePreview(next: string) {
    draft.current = next;
    setPreview(next);
  }
  async function commit(next: string) {
    if (locked || committing.current) return;
    if (next === value) {
      cancelPreview();
      return;
    }
    committing.current = true;
    const focused = document.activeElement;
    restoreFocusAfterSave.current =
      focused instanceof HTMLElement && popup.current?.contains(focused) ? focused : null;
    pointer.current = false;
    keyboard.current = false;
    updatePreview(next);
    setSaving(true);
    setError('');
    try {
      await onChange(next);
    } catch {
      setError(t('无法更新推理深度，请重试。'));
    } finally {
      committing.current = false;
      setSaving(false);
      // The parent's authoritative value wins, including a rejected or adjusted request.
      cancelPreview();
    }
  }

  useEffect(() => {
    if (disabled) {
      restoreFocusAfterSave.current = null;
      setOpen(false);
      cancelPreview();
    }
  }, [disabled]);
  useEffect(() => {
    if (!committing.current) cancelPreview();
  }, [value, signature]);

  useLayoutEffect(() => {
    if (locked || !restoreFocusAfterSave.current) return;
    const previous = restoreFocusAfterSave.current;
    restoreFocusAfterSave.current = null;
    if ((expanded || previous === trigger.current) && document.activeElement === document.body) {
      const target = previous.isConnected ? previous : input.current || select.current;
      target?.focus({ preventScroll: true });
    }
  }, [locked, expanded]);

  useLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const anchor = trigger.current;
      const panel = popup.current;
      if (!anchor || !panel) return;
      const bounds = anchor.getBoundingClientRect();
      const width = Math.min(256, window.innerWidth - 24);
      const above = Math.max(0, bounds.top - 20);
      const below = Math.max(0, window.innerHeight - bounds.bottom - 20);
      const useAbove = above >= panel.scrollHeight || above > below;
      const maxHeight = useAbove ? above : below;
      const height = Math.min(panel.scrollHeight, maxHeight);
      setPosition({
        left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
        top: useAbove ? Math.max(12, bounds.top - height - 8) : bounds.bottom + 8,
        width,
        maxHeight,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [expanded, quickOpen, canSlide, error]);

  useEffect(() => {
    if (!expanded) return;
    (input.current || select.current)?.focus({ preventScroll: true });
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false);
    };
    // Disabling a focused native input during a save moves focus to the body.
    // Keep Escape available for this open popover while the request settles.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [expanded, locked]);

  return (
    <div
      className="effort-picker"
      ref={root}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
          close(false);
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
        disabled={locked}
        onClick={() => (expanded ? close(false) : setOpen(true))}
        onKeyDown={(event) => {
          if (!locked && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
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
          ref={popup}
          className="effort-popup"
          role="dialog"
          aria-label={t('推理深度')}
          aria-busy={pending || saving}
          style={position}
        >
          <section
            className="effort-energy"
            style={
              {
                '--effort-progress': `${normalized * 100}%`,
                '--effort-level': normalized,
                '--effort-charge': normalized * normalized,
                '--effort-plasma': normalized ** 4.7,
              } as CSSProperties
            }
          >
            <header className="effort-energy-header">
              <button
                type="button"
                className="effort-energy-icon"
                aria-label={t('推理快捷设置')}
                title={t('推理快捷设置')}
                aria-expanded={quickOpen}
                disabled={locked || !presets.length}
                onClick={() => setQuickOpen(!quickOpen)}
              >
                <Zap size={19} aria-hidden="true" />
              </button>
              <div className="effort-energy-heading">
                <div className="effort-energy-title">{label}</div>
                {onModelClick ? (
                  <button
                    type="button"
                    className="effort-energy-model"
                    disabled={locked}
                    aria-label={t('切换模型')}
                    title={modelName}
                    onClick={() => {
                      close(false);
                      onModelClick();
                    }}
                  >
                    <span>{modelName}</span>
                    <ChevronRight size={12} aria-hidden="true" />
                  </button>
                ) : (
                  <span className="effort-energy-model" title={modelName}>
                    {modelName}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="effort-energy-icon"
                aria-label={t('重置推理深度')}
                title={t('恢复模型默认推理深度')}
                disabled={locked}
                onClick={() => void commit('')}
              >
                <RotateCcw size={17} aria-hidden="true" />
              </button>
            </header>
            {canSlide ? (
              <div className="effort-energy-track">
                <div className="effort-energy-flow" aria-hidden="true" />
                <div
                  className="effort-energy-plasma"
                  style={{ backgroundImage: 'url("./effort-plasma.png")' }}
                  aria-hidden="true"
                />
                <div
                  className="effort-energy-particles"
                  style={{ backgroundImage: 'url("./effort-particles.png")' }}
                  aria-hidden="true"
                />
                <div
                  className="effort-energy-particles effort-energy-particles-fast"
                  style={{ backgroundImage: 'url("./effort-particles.png")' }}
                  aria-hidden="true"
                />
                <div className="effort-energy-thumb" aria-hidden="true" />
                <input
                  ref={input}
                  type="range"
                  className="effort-energy-range"
                  min={0}
                  max={ordered.length - 1}
                  step={1}
                  value={selectedIndex}
                  aria-label={t('推理深度')}
                  aria-valuetext={label}
                  disabled={locked || ordered.length < 2}
                  onPointerDown={(event) => {
                    if (locked) return;
                    pointer.current = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerUp={(event) => {
                    if (!pointer.current) return;
                    pointer.current = false;
                    const option = ordered[event.currentTarget.valueAsNumber];
                    if (option) void commit(optionValue(option));
                  }}
                  onPointerCancel={cancelPreview}
                  onLostPointerCapture={() => {
                    if (pointer.current) cancelPreview();
                  }}
                  onKeyDown={(event) => {
                    if (adjustmentKeys.has(event.key)) keyboard.current = true;
                  }}
                  onKeyUp={(event) => {
                    if (!adjustmentKeys.has(event.key)) return;
                    keyboard.current = false;
                    if (draft.current !== null) void commit(draft.current);
                  }}
                  onBlur={() => {
                    if (keyboard.current && draft.current !== null) void commit(draft.current);
                  }}
                  onChange={(event) => {
                    const option = ordered[event.currentTarget.valueAsNumber];
                    if (!option || locked) return;
                    const next = optionValue(option);
                    updatePreview(next);
                    if (!pointer.current && !keyboard.current) void commit(next);
                  }}
                />
              </div>
            ) : (
              <select
                ref={select}
                className="effort-energy-fallback"
                aria-label={t('推理深度')}
                value={shownValue}
                disabled={locked}
                onChange={(event) => void commit(event.target.value)}
              >
                <option value="">{t('默认推理')}</option>
                {shownValue && !selected && (
                  <option value={shownValue} disabled>
                    {shownValue}
                  </option>
                )}
                {ordered.map((option) => (
                  <option key={option.id} value={optionValue(option)}>
                    {optionLabel(option)}
                  </option>
                ))}
              </select>
            )}
          </section>
          {quickOpen && (
            <div className="effort-popup-presets" role="group" aria-label={t('推理快捷设置')}>
              {presets
                .filter((preset) => options.some((option) => optionValue(option) === preset.value))
                .map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    title={t(preset.description)}
                    aria-pressed={shownValue === preset.value}
                    disabled={locked}
                    onClick={() => {
                      setQuickOpen(false);
                      void commit(preset.value);
                    }}
                  >
                    {presetLabels[preset.id]
                      ? t(presetLabels[preset.id])
                      : preset.label || preset.id}
                  </button>
                ))}
            </div>
          )}
          {error && (
            <p className="effort-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
