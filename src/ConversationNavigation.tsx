import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useI18n } from './i18n';
import {
  questionOutline,
  searchConversation,
  type ConversationTarget,
} from './conversation-navigation.mjs';
import type { TimelineRow } from './timeline.mjs';
import './conversation-upgrades.css';

export interface ConversationNavigationProps {
  sessionId: string;
  rows: TimelineRow[];
  turnError?: string;
  onNavigate: (target: ConversationTarget) => void;
}

export default function ConversationNavigation({
  sessionId,
  rows,
  turnError = '',
  onNavigate,
}: ConversationNavigationProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'search' | 'outline'>('search');
  const [selected, setSelected] = useState(-1);
  const hits = useMemo(() => searchConversation(rows, query, turnError), [rows, query, turnError]);
  const outline = useMemo(() => questionOutline(rows), [rows]);
  useEffect(() => {
    setQuery('');
    setSelected(-1);
  }, [sessionId]);
  useEffect(() => {
    setSelected(-1);
  }, [query]);
  const active = selected < hits.length ? selected : -1;
  const navigate = (index: number) => {
    if (!hits.length) return;
    const next = (index + hits.length) % hits.length;
    setSelected(next);
    onNavigate(hits[next].target);
  };
  return (
    <section className="conversation-navigation" aria-label={t('会话导航')}>
      <div className="conversation-navigation-tabs" role="tablist" aria-label={t('会话导航')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'search'}
          onClick={() => setTab('search')}
        >
          {t('搜索')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'outline'}
          onClick={() => setTab('outline')}
        >
          {t('问题目录')}
        </button>
      </div>
      {tab === 'search' ? (
        <>
          <input
            type="search"
            aria-label={t('搜索会话')}
            placeholder={t('搜索会话')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                navigate(
                  active < 0
                    ? event.shiftKey
                      ? hits.length - 1
                      : 0
                    : active + (event.shiftKey ? -1 : 1),
                );
              }
            }}
          />
          <p className="muted conversation-navigation-scope">
            {t('搜索当前已加载的消息、思考、工具和错误。')}
          </p>
          {!!query.trim() && (
            <>
              <div className="conversation-search-count" aria-live="polite">
                <span>
                  {active < 0
                    ? t('找到 {count} 处', { count: hits.length })
                    : t('第 {current} / {count} 处', { current: active + 1, count: hits.length })}
                </span>
                <button
                  type="button"
                  aria-label={t('上一处')}
                  title={t('上一处')}
                  disabled={!hits.length}
                  onClick={() => navigate(active < 0 ? hits.length - 1 : active - 1)}
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  type="button"
                  aria-label={t('下一处')}
                  title={t('下一处')}
                  disabled={!hits.length}
                  onClick={() => navigate(active + 1)}
                >
                  <ChevronDown size={16} />
                </button>
              </div>
              <div className="conversation-navigation-results">
                {hits.map((hit, index) => (
                  <button
                    type="button"
                    key={`${hit.target.kind === 'row' ? hit.target.rowId : 'error'}:${hit.offset}`}
                    className={index === active ? 'active' : ''}
                    aria-current={index === active ? 'true' : undefined}
                    onClick={() => navigate(index)}
                  >
                    {hit.snippet}
                  </button>
                ))}
                {!hits.length && <p className="muted">{t('没有匹配内容')}</p>}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="conversation-navigation-results">
          {outline.map((entry, index) => (
            <button
              type="button"
              key={entry.target.kind === 'row' ? entry.target.rowId : index}
              onClick={() => onNavigate(entry.target)}
            >
              <span className="conversation-outline-number">{index + 1}.</span>
              {entry.title}
            </button>
          ))}
          {!outline.length && <p className="muted">{t('当前会话还没有问题。')}</p>}
        </div>
      )}
    </section>
  );
}
