import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Download,
  Ellipsis,
  History,
  MessageSquare,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { IconButton, Spinner } from './components';
import { WindowedList, type WindowedListHandle } from './ConversationTimeline';
import { readableDate } from './lib';
import { useI18n } from './i18n';
import type { SessionSummary } from './types';
import './session-list.css';

const estimateSession = () => 42;
export default function SessionList({
  sessions,
  activeSessionId,
  loadingSessionId,
  onSelect,
  onRename,
  onExport,
  onDelete,
}: {
  sessions: SessionSummary[];
  activeSessionId?: string;
  loadingSessionId?: string;
  onSelect: (session: SessionSummary) => void;
  onRename: (session: SessionSummary) => void;
  onExport: (session: SessionSummary) => void;
  onDelete: (session: SessionSummary) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const list = useRef<WindowedListHandle>(null);
  const filtered = useMemo(
    () =>
      sessions
        .filter((item) => (item.title || '').toLowerCase().includes(search.toLowerCase()))
        .map((summary) => ({ id: summary.sessionId, summary })),
    [sessions, search],
  );
  const pinned = useMemo(
    () => new Set([activeSessionId, menu].filter((id): id is string => !!id)),
    [activeSessionId, menu],
  );
  useEffect(() => {
    setMenu(undefined);
    let current = true;
    queueMicrotask(() => {
      if (current && activeSessionId)
        void list.current?.scrollToItem(activeSessionId, { block: 'nearest' });
    });
    return () => {
      current = false;
    };
  }, [activeSessionId]);
  useEffect(() => {
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(undefined);
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setMenu(undefined);
    };
    window.addEventListener('keydown', close);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', outside);
    };
  }, []);
  function invoke(callback: (session: SessionSummary) => void, summary: SessionSummary) {
    setMenu(undefined);
    callback(summary);
  }
  async function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target =
      event.key === 'ArrowDown'
        ? Math.min(filtered.length - 1, index + 1)
        : event.key === 'ArrowUp'
          ? Math.max(0, index - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? filtered.length - 1
              : -1;
    if (target < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    setMenu(undefined);
    const node = await list.current?.scrollToItem(filtered[target].id, { block: 'nearest' });
    node?.querySelector<HTMLButtonElement>('.session-select')?.focus();
  }
  async function tabAcrossWindow(event: KeyboardEvent<HTMLDivElement>, index: number) {
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    ];
    const edge = event.shiftKey ? buttons[0] : buttons.at(-1);
    if (event.target !== edge) return;
    const next = filtered[index + (event.shiftKey ? -1 : 1)];
    if (
      !next ||
      [...(root.current?.querySelectorAll<HTMLElement>('[data-window-row]') || [])].some(
        (node) => node.dataset.windowRow === next.id,
      )
    )
      return;
    event.preventDefault();
    setMenu(undefined);
    const node = await list.current?.scrollToItem(next.id, { block: 'nearest' });
    node?.querySelector<HTMLButtonElement>('.session-select')?.focus();
  }
  return (
    <div className="session-list-panel" ref={root}>
      <div className="history-heading">
        <span>{t('会话记录')}</span>
        <span className="count">{sessions.length}</span>
      </div>
      <div className="search-input">
        <Search size={15} />
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setMenu(undefined);
            if (scroll.current) scroll.current.scrollTop = 0;
          }}
          placeholder={t('搜索会话')}
          aria-label={t('搜索会话')}
        />
        {search && (
          <button onClick={() => setSearch('')} title={t('清除搜索')} aria-label={t('清除搜索')}>
            <X size={13} />
          </button>
        )}
      </div>
      <div className="session-list" ref={scroll}>
        {filtered.length ? (
          <WindowedList
            items={filtered}
            scrollRef={scroll}
            handleRef={list}
            estimateHeight={estimateSession}
            alwaysRender={pinned}
            renderItem={({ summary }, index) => (
              <div
                className={`session-item ${activeSessionId === summary.sessionId ? 'selected' : ''}`}
                onKeyDown={(event) => void tabAcrossWindow(event, index)}
              >
                <button
                  className="session-select"
                  onClick={() => invoke(onSelect, summary)}
                  onKeyDown={(event) => void navigate(event, index)}
                  disabled={!!loadingSessionId}
                  title={summary.title}
                  aria-current={activeSessionId === summary.sessionId ? 'true' : undefined}
                >
                  {loadingSessionId === summary.sessionId ? (
                    <Spinner />
                  ) : (
                    <MessageSquare size={15} />
                  )}
                  <span>{summary.title || t('未命名会话')}</span>
                  <small>{readableDate(summary.updatedAt)}</small>
                </button>
                <IconButton
                  label={t('{value0} · 更多操作', { value0: summary.title })}
                  onClick={() =>
                    setMenu((previous) =>
                      previous === summary.sessionId ? undefined : summary.sessionId,
                    )
                  }
                >
                  <Ellipsis size={16} />
                </IconButton>
                {menu === summary.sessionId && (
                  <div className="session-dropdown">
                    <button onClick={() => invoke(onRename, summary)}>
                      <Pencil size={14} />
                      {t('重命名')}
                    </button>
                    <button onClick={() => invoke(onExport, summary)}>
                      <Download size={14} />
                      {t('导出会话')}
                    </button>
                    <button className="danger-text" onClick={() => invoke(onDelete, summary)}>
                      <Trash2 size={14} />
                      {t('删除会话')}
                    </button>
                  </div>
                )}
              </div>
            )}
          />
        ) : (
          <div className="history-empty">
            <History size={21} />
            <span>{search ? t('没有找到相关会话') : t('从一段新的对话开始')}</span>
            <small>{search ? t('试试其他关键词') : t('此项目的会话会保存在这里')}</small>
          </div>
        )}
      </div>
    </div>
  );
}
