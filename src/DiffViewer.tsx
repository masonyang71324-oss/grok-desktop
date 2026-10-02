import { useMemo, useState } from 'react';
import { foldContext, parseDiff, splitRows, wordParts, type DiffRow } from './diff-model.mjs';
import { useI18n } from './i18n';

export default function DiffViewer({ text }: { text: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'unified' | 'split'>('unified');
  const [words, setWords] = useState(true);
  const [fold, setFold] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const model = useMemo(() => parseDiff(text), [text]);
  const rows = useMemo(
    () => (fold ? foldContext(model.rows, 3, expanded) : model.rows),
    [model, fold, expanded],
  );
  const pairs = useMemo(() => splitRows(model.rows), [model]);
  const marks = useMemo(() => {
    const result = new Map<number, { text: string; changed: boolean }[]>();
    if (words)
      for (const pair of pairs) {
        if (pair.left?.kind !== 'remove' || pair.right?.kind !== 'add') continue;
        const parts = wordParts(pair.left.text, pair.right.text);
        result.set(pair.left.id, parts.before);
        result.set(pair.right.id, parts.after);
      }
    return result;
  }, [pairs, words]);
  function lineText(row: DiffRow, withSign = false) {
    if (row.kind === 'fold')
      return (
        <button
          className="diff-fold text-button"
          onClick={() => setExpanded((old) => new Set([...old, row.id]))}
        >
          {t('展开 {count} 行上下文', { count: row.count || 0 })}
        </button>
      );
    const parts = marks.get(row.id);
    const newFile = row.kind === 'meta' && /^(?:新文件 |New file )(.+)$/.exec(row.text);
    const generated = newFile
      ? t('新文件 {path}', { path: newFile[1] })
      : row.kind === 'meta' && ['… 内容已截断', '… Content truncated'].includes(row.text)
        ? t('… 内容已截断')
        : row.text;
    const sign =
      withSign && ['add', 'remove', 'context'].includes(row.kind) ? row.source.slice(0, 1) : '';
    return (
      <span className="diff-line-content">
        {sign}
        {parts
          ? parts.map((part, index) =>
              part.changed ? <mark key={index}>{part.text}</mark> : part.text,
            )
          : generated || ' '}
      </span>
    );
  }
  function side(row: DiffRow | undefined, side: 'before' | 'after') {
    return (
      <div className={`diff-side ${row ? 'diff-' + row.kind : 'diff-empty'}`}>
        <span className="diff-line-number" aria-hidden="true">
          {row?.[side] ?? ''}
        </span>
        {row && lineText(row)}
      </div>
    );
  }
  return (
    <div className="structured-diff">
      <div className="diff-controls" aria-label={t('差异显示')}>
        <button
          className="secondary-button"
          aria-pressed={mode === 'unified'}
          onClick={() => setMode('unified')}
        >
          {t('统一')}
        </button>
        <button
          className="secondary-button"
          aria-pressed={mode === 'split'}
          onClick={() => setMode('split')}
        >
          {t('并排')}
        </button>
        <label>
          <input
            type="checkbox"
            checked={words}
            onChange={(event) => setWords(event.target.checked)}
          />
          {t('词语差异')}
        </label>
        <label>
          <input
            type="checkbox"
            checked={fold}
            onChange={(event) => setFold(event.target.checked)}
          />
          {t('折叠上下文')}
        </label>
      </div>
      <div className={`structured-diff-lines diff-${mode}`}>
        {mode === 'unified' ? (
          rows.map((row) => (
            <div className={`diff-unified-row diff-${row.kind}`} key={row.id}>
              <span className="diff-line-number" aria-hidden="true">
                {row.before ?? ''}
              </span>
              <span className="diff-line-number" aria-hidden="true">
                {row.after ?? ''}
              </span>
              {lineText(row, true)}
            </div>
          ))
        ) : (
          <>
            <div className="diff-split-heading">
              <span>{t('原内容')}</span>
              <span>{t('新内容')}</span>
            </div>
            {splitRows(rows).map((pair) =>
              pair.shared ? (
                <div className={`diff-shared diff-${pair.left?.kind}`} key={pair.id}>
                  {pair.left && lineText(pair.left)}
                </div>
              ) : (
                <div className="diff-split-row" key={pair.id}>
                  {side(pair.left, 'before')}
                  {side(pair.right, 'after')}
                </div>
              ),
            )}
          </>
        )}
      </div>
    </div>
  );
}
