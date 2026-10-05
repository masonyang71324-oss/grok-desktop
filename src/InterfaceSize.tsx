import { useId } from 'react';
import { useI18n } from './i18n';
import './usability-presentation.css';

export default function InterfaceSize({
  value = 100,
  onChange,
  disabled = false,
}: {
  value?: number;
  onChange: (percent: number) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const descriptionId = useId();
  const sizes = [100, 110, 125, 150];
  if (!sizes.includes(value)) sizes.push(value);
  return (
    <label className="field interface-size">
      {t('界面大小')}
      <select
        aria-label={t('界面大小')}
        aria-describedby={descriptionId}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {sizes
          .sort((a, b) => a - b)
          .map((percent) => (
            <option key={percent} value={percent}>
              {percent === 100 ? t('100%（默认）') : `${percent}%`}
            </option>
          ))}
      </select>
      <small id={descriptionId}>
        {t('调整整个界面的文字和控件大小，立即生效并在下次启动时保留。')}
      </small>
    </label>
  );
}
