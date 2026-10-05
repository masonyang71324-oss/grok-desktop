import { useState } from 'react';
import { AlertTriangle, ChevronRight, ShieldCheck, Terminal } from 'lucide-react';
import type { PermissionMode, PermissionRequest } from './types';
import { errorText } from './lib';
import { Modal, Spinner } from './components';
import { permissionChoice, permissionOverview } from './permission-dialog.mjs';
import PermissionControl from './PermissionControl';
import DiffViewer from './DiffViewer';
import { translate as t, useI18n } from './i18n';
import './permission-dialog.css';
export function PermissionDialog({
  item,
  onReply,
  permissionMode,
  onModeChange,
  cwd,
}: {
  item: { requestId: string | number; params: PermissionRequest };
  onReply: (optionId?: string, cancelled?: boolean) => Promise<void>;
  permissionMode?: PermissionMode;
  onModeChange?: (mode: PermissionMode) => Promise<void>;
  cwd?: string;
}) {
  useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const overview = permissionOverview(item.params.toolCall, cwd);
  const title = overview.title === item.params.toolCall?.title ? overview.title : t(overview.title);
  const options = item.params.options.map((option) => {
    const display = permissionChoice(option);
    const originalLabel =
      !['allow_once', 'allow_always', 'reject_once', 'reject_always'].includes(option.kind) &&
      display.label === display.original;
    return { option, display, label: originalLabel ? display.label : t(display.label) };
  });
  async function reply(optionId?: string, cancelled = false) {
    if (busy) return;
    setBusy(true);
    try {
      await onReply(optionId, cancelled);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('Grok 需要你的批准')}
      subtitle={t('查看操作内容，再选择如何处理。')}
      closeOnBackdrop={false}
      wide={overview.diffs.length > 0}
      onClose={() => {
        if (!busy) void reply(undefined, true);
      }}
      footer={
        <div className="permission-footer">
          <div className="permission-action-grid">
            {options.map(({ option, display, label }) => (
              <button
                key={option.optionId}
                className={`permission-choice ${option.kind === 'allow_once' ? 'primary' : ''}`}
                aria-label={label}
                disabled={busy}
                onClick={() => void reply(option.optionId)}
              >
                <strong>{label}</strong>
                <small>{t(display.description)}</small>
              </button>
            ))}
          </div>
          <div className="permission-cancel-row">
            {busy && <Spinner />}
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void reply(undefined, true)}
            >
              {t('取消这项操作')}
            </button>
          </div>
        </div>
      }
    >
      <div className="permission-review-header">
        <div className="permission-review-icon">
          <ShieldCheck size={23} />
        </div>
        <div>
          <h3>{title}</h3>
          <p>{t('这项操作正在等待你的决定。')}</p>
        </div>
      </div>
      <dl className="permission-working-directory">
        <dt>{t('操作工作目录')}</dt>
        <dd>{overview.cwd || t('工具未提供工作目录')}</dd>
      </dl>
      {overview.preview && <div className="permission-command-preview">{overview.preview}</div>}
      {overview.risks.length > 0 && (
        <div className="permission-risk-notice" role="note" aria-label={t('操作影响')}>
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            {overview.risks.map((risk) => (
              <div className="permission-risk-item" key={risk.kind}>
                <strong>{t(risk.title)}</strong>
                <p>{t(risk.description)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {overview.diffs.map((diff, index) => (
        <section className="permission-file-diff" key={`${diff.path}-${index}`}>
          <h4>{diff.path}</h4>
          <DiffViewer text={diff.text} />
        </section>
      ))}
      {(overview.sections.length > 0 || overview.raw) && (
        <details className="permission-review-details">
          <summary>
            <Terminal size={15} />
            {t('查看完整命令与参数')}
            <ChevronRight size={14} />
          </summary>
          {overview.sections.map((section, index) => (
            <div className="permission-detail-section" key={index}>
              <h4>{t(section.label)}</h4>
              <pre>{section.text}</pre>
            </div>
          ))}
          <details className="permission-raw-details">
            <summary>{t('查看完整原始数据')}</summary>
            <pre>{overview.raw}</pre>
          </details>
        </details>
      )}
      <details className="permission-source-options">
        <summary>
          {t('查看官方选项说明')}
          <ChevronRight size={14} />
        </summary>
        <dl>
          {options.map(({ option, display, label }) => (
            <div key={option.optionId}>
              <dt>{label}</dt>
              <dd>{display.original || t('服务端未提供补充说明。')}</dd>
            </div>
          ))}
        </dl>
      </details>
      {permissionMode && onModeChange && (
        <div className="permission-following-mode">
          <PermissionControl
            value={permissionMode}
            onChange={onModeChange}
            disabled={busy}
            scope={t('后续操作权限')}
          />
          <p>{t('已弹出的这项操作仍需单独确认。')}</p>
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}
    </Modal>
  );
}
