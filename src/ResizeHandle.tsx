import { useRef } from 'react';

export default function ResizeHandle({
  axis,
  value,
  min,
  max,
  onChange,
  onCommit,
  onReset,
  label,
  reverse = false,
  className = '',
}: {
  axis: 'horizontal' | 'vertical';
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  onReset?: () => void;
  label: string;
  reverse?: boolean;
  className?: string;
}) {
  const drag = useRef<{ start: number; value: number; last: number; pointerId: number } | null>(
    null,
  );
  const bound = (next: number) => Math.round(Math.max(Math.min(min, max), Math.min(max, next)));
  const direction = reverse ? -1 : 1;
  function keyboard(key: string, shift: boolean) {
    let next = value;
    if (key === 'Home') next = min;
    else if (key === 'End') next = max;
    else if (
      (axis === 'horizontal' && ['ArrowLeft', 'ArrowRight'].includes(key)) ||
      (axis === 'vertical' && ['ArrowUp', 'ArrowDown'].includes(key))
    )
      next += (['ArrowLeft', 'ArrowUp'].includes(key) ? -1 : 1) * direction * (shift ? 30 : 10);
    else if (key === 'Escape' && onReset) {
      onReset();
      return true;
    } else return false;
    next = bound(next);
    onChange(next);
    onCommit?.(next);
    return true;
  }
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === 'horizontal' ? 'vertical' : 'horizontal'}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={bound(value)}
      className={`resize-handle resize-${axis} ${className}`}
      onKeyDown={(event) => {
        if (keyboard(event.key, event.shiftKey)) event.preventDefault();
      }}
      onDoubleClick={() => onReset?.()}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = axis === 'horizontal' ? event.clientX : event.clientY;
        drag.current = { start, value, last: value, pointerId: event.pointerId };
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        state.last = bound(
          state.value +
            ((axis === 'horizontal' ? event.clientX : event.clientY) - state.start) * direction,
        );
        onChange(state.last);
      }}
      onPointerUp={(event) => {
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        drag.current = null;
        onCommit?.(state.last);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (drag.current) {
          onCommit?.(drag.current.last);
          drag.current = null;
        }
      }}
    />
  );
}
