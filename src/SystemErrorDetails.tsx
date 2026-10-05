import { useState } from 'react';
import { useI18n } from './i18n';
import { copy, describeSystemError, errorText } from './lib';
import './usability-presentation.css';

export default function SystemErrorDetails({
  error,
  showExplanation = true,
  onCopy = copy,
  onExpandedChange,
}: {
  error: unknown;
  showExplanation?: boolean;
  onCopy?: (text: string) => void | Promise<void>;
  onExpandedChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const raw = errorText(error);
  const explanation = describeSystemError(error);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState<string | null>(null);
  async function copyDetails() {
    setCopyFailed(null);
    try {
      await onCopy(raw);
      setCopied(raw);
    } catch {
      setCopyFailed(raw);
    }
  }
  return (
    <div className="system-error-details">
      {showExplanation && explanation && (
        <div className="system-error-explanation">
          <strong>{explanation.title}</strong>
          <p>{explanation.description}</p>
        </div>
      )}
      <details onToggle={(event) => onExpandedChange?.(event.currentTarget.open)}>
        <summary>{t('原始错误详情')}</summary>
        <pre>{raw}</pre>
        <button type="button" className="text-button" onClick={() => void copyDetails()}>
          {copied === raw ? t('已复制原始详情') : t('复制原始详情')}
        </button>
        {copyFailed === raw && <p role="status">{t('无法复制，请选择上方原始详情手动复制。')}</p>}
      </details>
    </div>
  );
}
