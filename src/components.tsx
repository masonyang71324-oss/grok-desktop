import { useEffect, useId, useLayoutEffect, useRef, useState, memo, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  LoaderCircle,
  RotateCcw,
  Terminal,
  X,
} from 'lucide-react';
import { copy, errorText, request } from './lib';
import { updateMarkdown, updateMarkdownLabels } from './markdown-dom';
import { useI18n, translate } from './i18n';
import type { TimelineRow } from './timeline.mjs';

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path d="M7 24 24 7M10 7h14v14M6 15v11h11" />
      </svg>
    </span>
  );
}
export function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
  className = '',
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Spinner() {
  return <LoaderCircle size={16} className="spin" />;
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  footer,
  closeOnBackdrop = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  footer?: ReactNode;
  closeOnBackdrop?: boolean;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current!;
    (
      (dialog.querySelector('input,textarea,select') ||
        dialog.querySelector('button')) as HTMLElement | null
    )?.focus();
    const key = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (
        dialogs[dialogs.length - 1] !== dialog ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229
      )
        return;
      if (event.key === 'Escape') {
        if (dialog.querySelector('[role="menu"]')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (event.key === 'Tab') {
        const items = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]',
          ),
        ).filter((item) => item.offsetParent !== null);
        const first = items[0],
          last = items[items.length - 1];
        if (!dialog.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
      >
        <div className="modal-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton label={t('关闭 · Esc')} onClick={onClose}>
            <X size={19} />
          </IconButton>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
export function Markdown({ text, notify }: { text: string; notify?: (message: string) => void }) {
  const { locale } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const originals = useRef(new WeakMap<Node, Node>());
  const copyTimers = useRef(new Map<HTMLButtonElement, number>());
  useLayoutEffect(() => {
    updateMarkdown(root.current!, text, originals.current);
  }, [text]);
  useLayoutEffect(() => {
    updateMarkdownLabels(root.current!);
  }, [locale]);
  useEffect(
    () => () => {
      for (const timer of copyTimers.current.values()) window.clearTimeout(timer);
    },
    [],
  );
  async function copyCode(button: HTMLButtonElement) {
    const code = button.closest('.code-block')?.querySelector('code');
    if (!code) return;
    button.title = '';
    try {
      await copy(code.textContent || '');
      button.dataset.copyState = '已复制';
      button.textContent = translate('已复制');
    } catch (error) {
      button.dataset.copyState = '复制失败';
      button.textContent = translate('复制失败');
      button.title = errorText(error);
      notify?.(errorText(error));
    }
    window.clearTimeout(copyTimers.current.get(button));
    copyTimers.current.set(
      button,
      window.setTimeout(() => {
        if (button.isConnected) {
          delete button.dataset.copyState;
          button.textContent = translate('复制代码');
        }
        copyTimers.current.delete(button);
      }, 1600),
    );
  }
  return (
    <div
      className="markdown"
      ref={root}
      onClick={(e) => {
        const button = (e.target as HTMLElement).closest<HTMLButtonElement>(
          'button[data-copy-code]',
        );
        if (button) {
          e.preventDefault();
          void copyCode(button);
          return;
        }
        const anchor = (e.target as HTMLElement).closest('a');
        if (anchor) {
          e.preventDefault();
          const url = anchor.getAttribute('href');
          if (url && /^https?:\/\//i.test(url))
            void request('system.open', { target: 'url', url }).catch(() => {});
        }
      }}
    />
  );
}
type OpenFile = (path: string, line?: number) => void;
function ToolFileLink({
  path,
  line,
  onOpenFile,
}: {
  path: string;
  line?: number;
  onOpenFile?: OpenFile;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="tool-file-link"
      title={path}
      disabled={!onOpenFile || !path}
      onClick={() => onOpenFile?.(path, line)}
    >
      {path || t('文件变更')}
      {line !== undefined && <span>:{line}</span>}
      <ArrowUpRight size={13} />
    </button>
  );
}
function ToolOutput({ row, onOpenFile }: { row: TimelineRow; onOpenFile?: OpenFile }) {
  const { t } = useI18n();
  return (
    <div className="tool-detail">
      {row.input && (
        <>
          <div className="eyebrow">{t('输入')}</div>
          <pre>{row.input}</pre>
        </>
      )}
      {row.toolContent?.length ? (
        <>
          <div className="eyebrow">{t('结果')}</div>
          {row.toolContent.map((content, index) =>
            content.type === 'text' ? (
              <pre key={index}>{content.text}</pre>
            ) : (
              <section className="tool-diff" key={index}>
                <ToolFileLink
                  path={content.path}
                  line={row.locations?.find((location) => location.path === content.path)?.line}
                  onOpenFile={onOpenFile}
                />
                <div className="tool-diff-grid">
                  <div className="tool-diff-old">
                    <div className="eyebrow">
                      {t('原内容')}
                      {content.oldText === null ? t(' · 新文件') : ''}
                    </div>
                    <pre>{content.oldText || ''}</pre>
                  </div>
                  <div className="tool-diff-new">
                    <div className="eyebrow">{t('新内容')}</div>
                    <pre>{content.newText}</pre>
                  </div>
                </div>
              </section>
            ),
          )}
        </>
      ) : row.text ? (
        <>
          <div className="eyebrow">{t('结果')}</div>
          <pre>{row.text}</pre>
        </>
      ) : (
        <p className="muted">{t('工具尚未返回文本结果。')}</p>
      )}
      {!!row.locations?.length && (
        <div className="tool-locations">
          <div className="eyebrow">{t('相关文件')}</div>
          {row.locations.map((location, index) => (
            <ToolFileLink key={index} {...location} onOpenFile={onOpenFile} />
          ))}
        </div>
      )}
    </div>
  );
}
export const Message = memo(function Message({
  row,
  onRetry,
  notify,
  onOpenFile,
}: {
  row: TimelineRow;
  onRetry: (text: string, attachments?: { name: string; path: string }[]) => void;
  notify: (message: string) => void;
  onOpenFile?: OpenFile;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  async function copyMessage() {
    try {
      await copy(row.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      notify(errorText(e));
    }
  }
  if (row.kind === 'thought')
    return (
      <details className="thought" open={row.streaming}>
        <summary>
          <span className={`thinking-dot ${row.streaming ? 'pulsing' : ''}`} />
          {t(row.streaming ? '正在思考' : '思考过程')}
          <ChevronDown size={13} />
        </summary>
        <div className="thought-body">
          <Markdown text={row.text} notify={notify} />
        </div>
      </details>
    );
  if (row.kind === 'tool')
    return (
      <details className={`tool-row ${row.status === 'failed' ? 'failed' : ''}`}>
        <summary>
          {['pending', 'in_progress'].includes(row.status || '') ? (
            <Spinner />
          ) : row.status === 'failed' ? (
            <X size={15} />
          ) : (
            <Check size={15} />
          )}
          <span>{row.title || t('执行工具')}</span>
          <span className="tool-status">
            {t(
              {
                pending: '等待执行',
                in_progress: '执行中',
                completed: '已完成',
                failed: '未完成',
                finished: '已结束',
                interrupted: '已中断',
              }[row.status || ''] ||
                row.status ||
                '',
            )}
          </span>
          <ChevronDown size={13} />
        </summary>
        <ToolOutput row={row} onOpenFile={onOpenFile} />
      </details>
    );
  return (
    <article className={`message ${row.kind}`}>
      <div className="message-avatar">
        {row.kind === 'assistant' ? <Brand small /> : <span>{t('你')}</span>}
      </div>
      <div className="message-content">
        <div className="message-author">
          {row.kind === 'assistant' ? 'Grok' : t('你')}
          {row.streaming && <span className="live-label">{t('正在回复')}</span>}
        </div>
        {row.kind === 'user' ? (
          <div className="user-text">{row.text}</div>
        ) : (
          <Markdown text={row.text} notify={notify} />
        )}
        <div className="inline-attachments">
          {row.attachments?.map((a) => (
            <span key={a.path}>{a.name}</span>
          ))}
        </div>
        {row.streaming && <span className="stream-cursor" />}
        <div className="message-actions">
          <IconButton label={t('复制内容')} onClick={() => void copyMessage()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
          {row.kind === 'user' && (
            <IconButton
              label={t('编辑并重新发送')}
              onClick={() => onRetry(row.text, row.attachments || [])}
            >
              <RotateCcw size={14} />
            </IconButton>
          )}
        </div>
      </div>
    </article>
  );
});
export function EmptyBox({
  icon,
  heading,
  children,
  action,
}: {
  icon: ReactNode;
  heading: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-box">
      <div className="empty-icon">{icon}</div>
      <h3>{heading}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function RawResult({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n();
  return (
    <details className="raw-result">
      <summary>
        <Terminal size={14} />
        {label ?? t('查看详细输出')}
        <ChevronDown size={13} />
      </summary>
      <pre>{text}</pre>
    </details>
  );
}
