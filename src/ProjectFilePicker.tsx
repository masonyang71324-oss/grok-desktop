import { useEffect, useMemo, useRef, useState } from 'react';
import { FileSearch } from 'lucide-react';
import type { Attachment } from './types';
import { errorText, request } from './lib';
import { Modal, Spinner } from './components';
import { useI18n } from './i18n';

export type ProjectFileOwner = { cwd: string; sessionId?: string };
export default function ProjectFilePicker({
  cwd,
  sessionId,
  onClose,
  onSelect,
  initialQuery = '',
}: {
  cwd: string;
  sessionId?: string;
  onClose: () => void;
  onSelect: (files: Attachment[], owner: ProjectFileOwner) => void;
  initialQuery?: string;
}) {
  const { t } = useI18n();
  const owner = useMemo(() => ({ cwd, sessionId }), [cwd, sessionId]);
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const [query, setQuery] = useState(initialQuery),
    [files, setFiles] = useState<Attachment[]>([]);
  const [selected, setSelected] = useState<Map<string, Attachment>>(new Map());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [truncated, setTruncated] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    setSelected(new Map());
    setFiles([]);
    setQuery(initialQuery);
  }, [owner, initialQuery]);
  useEffect(() => {
    const version = ++sequence.current;
    let active = true;
    setBusy(true);
    setError('');
    setFiles([]);
    setTruncated(false);
    const timer = setTimeout(() => {
      void request<{ files: Attachment[]; truncated: boolean }>(
        'workspace.search',
        { cwd: owner.cwd, query, limit: 100 },
        { timeoutMs: 60000 },
      )
        .then((result) => {
          if (active && sequence.current === version && currentOwner.current === owner) {
            setFiles(result.files);
            setTruncated(result.truncated);
          }
        })
        .catch((error) => {
          if (active && sequence.current === version && currentOwner.current === owner)
            setError(errorText(error));
        })
        .finally(() => {
          if (active && sequence.current === version && currentOwner.current === owner)
            setBusy(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [owner, query]);
  return (
    <Modal
      title={t('引用项目文件')}
      subtitle={cwd}
      onClose={onClose}
      footer={
        <>
          <span className="muted">{t('已选择 {count} 个文件', { count: selected.size })}</span>
          <button
            className="primary-button"
            disabled={!selected.size}
            onClick={() => {
              onSelect([...selected.values()], owner);
              onClose();
            }}
          >
            {t('添加 {count} 个文件', { count: selected.size })}
          </button>
        </>
      }
    >
      <label className="project-file-search">
        <FileSearch size={16} />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('搜索文件名或项目路径')}
          aria-label={t('搜索文件名或项目路径')}
        />
        {busy && <Spinner />}
      </label>
      <p className="muted">{t('按文件名和路径搜索；构建、依赖和隐藏目录不参与搜索。')}</p>
      {error && <div className="inline-error">{error}</div>}
      {truncated && (
        <p className="preview-notice" role="status">
          {t('搜索结果未完整显示，请输入更具体的文件名或路径。')}
        </p>
      )}
      <div className="project-file-results">
        {files.map((file) => (
          <label className="project-file-result" key={file.path}>
            <input
              type="checkbox"
              checked={selected.has(file.path)}
              onChange={(event) =>
                setSelected((old) => {
                  const next = new Map(old);
                  if (event.target.checked) next.set(file.path, file);
                  else next.delete(file.path);
                  return next;
                })
              }
            />
            <span title={file.path}>{file.name}</span>
          </label>
        ))}
      </div>
      {!busy && !error && files.length === 0 && <p className="muted">{t('没有匹配的项目文件')}</p>}
    </Modal>
  );
}
