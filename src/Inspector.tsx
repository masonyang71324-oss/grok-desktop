import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  ListChecks,
  RefreshCw,
  Save,
  X,
} from 'lucide-react';
import type { GitChange, WorkspaceEntry } from './types';
import { baseName, errorText, request } from './lib';
import { EmptyBox, IconButton, Modal, Spinner } from './components';
import { useI18n } from './i18n';
type FileData = {
  path: string;
  text: string;
  truncated: boolean;
  mtimeMs?: number;
  eol?: 'lf' | 'crlf';
};
type InspectorTab = 'files' | 'changes' | 'plan';
type InspectorContext = {
  cwd: string;
  file: number;
  diff: number;
  refresh: number;
  tree: number;
  active: boolean;
};
const normalizeText = (text: string) => text.replace(/\r\n?/g, '\n');
export default function Inspector({
  cwd,
  plan,
  revision,
  onClose,
  notify,
  openFile: requestedFile,
  tab: initialTab = 'files',
  onTabChange,
}: {
  cwd: string;
  plan: any[];
  revision: number;
  onClose: () => void;
  notify: (message: string) => void;
  openFile?: { path: string; line?: number; requestId: number };
  tab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<InspectorTab>(initialTab);
  const [tree, setTree] = useState<Record<string, WorkspaceEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [changes, setChanges] = useState<{
    isGit: boolean;
    branch: string;
    changes: GitChange[];
    unavailable?: 'git-not-found';
  } | null>(null);
  const [file, setFile] = useState<FileData | null>(null);
  const [edited, setEdited] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);
  const contextRef = useRef<InspectorContext>({
    cwd,
    file: 0,
    diff: 0,
    refresh: 0,
    tree: 0,
    active: true,
  });
  const editorRef = useRef<HTMLTextAreaElement>(null),
    jumpLineRef = useRef<number | undefined>(undefined);
  const dirty = !!file && normalizeText(edited) !== normalizeText(file.text);
  useEffect(() => {
    if (!dirty && !saving) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty, saving]);
  if (contextRef.current.cwd !== cwd)
    contextRef.current = { cwd, file: 0, diff: 0, refresh: 0, tree: 0, active: true };
  const isCurrent = (context: InspectorContext) => contextRef.current === context && context.active;
  useEffect(() => {
    contextRef.current.active = true;
    return () => {
      contextRef.current.active = false;
    };
  }, []);
  async function refresh() {
    if (!cwd) return;
    const context = contextRef.current,
      version = ++context.refresh;
    if (tab === 'files') context.tree += 1;
    setBusy(true);
    setError('');
    try {
      if (tab === 'files') {
        const entries = await request<WorkspaceEntry[]>('workspace.list', {
          cwd: context.cwd,
          showHidden,
        });
        if (isCurrent(context) && context.refresh === version) {
          setTree({ '': entries });
          setExpanded(new Set());
        }
      } else if (tab === 'changes') {
        const result = await request<any>('workspace.changes', { cwd: context.cwd });
        if (isCurrent(context) && context.refresh === version) setChanges(result);
      }
    } catch (e) {
      if (isCurrent(context) && context.refresh === version) setError(errorText(e));
    } finally {
      if (isCurrent(context) && context.refresh === version) setBusy(false);
    }
  }
  useEffect(() => {
    setFile(null);
    setEdited('');
    setSaving(false);
    setConfirmDiscard(false);
    setDiff(null);
    setTree({});
    setExpanded(new Set());
    setChanges(null);
    setError('');
  }, [cwd]);
  useEffect(() => {
    void refresh();
  }, [cwd, tab, revision, showHidden]);
  function changeTab(next: InspectorTab) {
    setTab(next);
    onTabChange?.(next);
  }
  useEffect(() => {
    if (!cwd || !requestedFile) return;
    changeTab('files');
    void openFile(requestedFile.path, requestedFile.line);
  }, [requestedFile?.requestId]);
  useEffect(() => {
    const editor = editorRef.current,
      line = jumpLineRef.current;
    if (!file || !editor || line === undefined) return;
    jumpLineRef.current = undefined;
    const lines = normalizeText(file.text).split('\n');
    const index = Math.min(lines.length - 1, Math.max(0, Math.trunc(line) - 1));
    const start = lines.slice(0, index).reduce((offset, text) => offset + text.length + 1, 0);
    editor.focus();
    editor.setSelectionRange(start, start + lines[index].length);
    const lineHeight = parseFloat(window.getComputedStyle(editor).lineHeight) || 20;
    editor.scrollTop = Math.max(0, index * lineHeight - editor.clientHeight / 3);
  }, [file]);
  async function toggle(entry: WorkspaceEntry) {
    if (expanded.has(entry.path)) {
      setExpanded((old) => {
        const next = new Set(old);
        next.delete(entry.path);
        return next;
      });
      return;
    }
    const context = contextRef.current,
      version = context.tree;
    try {
      if (!tree[entry.path]) {
        const children = await request<WorkspaceEntry[]>('workspace.list', {
          cwd: context.cwd,
          path: entry.path,
          showHidden,
        });
        if (!isCurrent(context) || context.tree !== version) return;
        setTree((old) => ({ ...old, [entry.path]: children }));
      }
      if (isCurrent(context) && context.tree === version)
        setExpanded((old) => new Set([...old, entry.path]));
    } catch (e) {
      if (isCurrent(context) && context.tree === version) notify(errorText(e));
    }
  }
  async function openFile(path: string, line?: number) {
    const context = contextRef.current,
      version = ++context.file;
    try {
      const data = await request<FileData>('workspace.read', { cwd: context.cwd, path });
      if (isCurrent(context) && context.file === version) {
        jumpLineRef.current = line;
        setFile(data);
        setEdited(normalizeText(data.text));
        setSaving(false);
      }
    } catch (e) {
      if (isCurrent(context) && context.file === version) notify(errorText(e));
    }
  }
  async function save() {
    if (!file || saving || !dirty) return;
    const context = contextRef.current,
      version = context.file,
      submitted = { ...file, text: normalizeText(edited) };
    setSaving(true);
    try {
      const saved = await request<{ mtimeMs: number }>('workspace.save', {
        cwd: context.cwd,
        path: submitted.path,
        text: submitted.text,
        eol: submitted.eol,
        expectedMtimeMs: submitted.mtimeMs,
      });
      if (isCurrent(context) && context.file === version) {
        // Advance the saved baseline without replacing edits made during the write.
        setFile({ ...submitted, mtimeMs: saved.mtimeMs });
        notify(t('文件已保存'));
      }
    } catch (e) {
      if (isCurrent(context) && context.file === version) notify(errorText(e));
    } finally {
      if (isCurrent(context) && context.file === version) setSaving(false);
    }
  }
  async function openDiff(change: GitChange) {
    const context = contextRef.current,
      version = ++context.diff;
    try {
      const result = await request<{ text: string }>('workspace.diff', {
        cwd: context.cwd,
        path: change.path,
        staged: change.staged,
      });
      if (isCurrent(context) && context.diff === version)
        setDiff({ path: change.path, text: result.text });
    } catch (e) {
      if (isCurrent(context) && context.diff === version) notify(errorText(e));
    }
  }
  async function openSystemFile(path: string, target: 'workspace-file' | 'workspace-reveal') {
    try {
      await request('system.open', { target, cwd, path });
    } catch (error) {
      notify(errorText(error));
    }
  }
  const renderTree = (path = '', depth = 0): any =>
    (tree[path] || []).map((entry) => (
      <div key={entry.path}>
        <div className="workspace-entry">
          <button
            className="file-row"
            style={{ paddingLeft: 14 + depth * 15 }}
            onClick={() => (entry.isDirectory ? void toggle(entry) : void openFile(entry.path))}
            title={entry.path}
          >
            {entry.isDirectory ? (
              expanded.has(entry.path) ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )
            ) : (
              <span className="tree-spacer" />
            )}
            {entry.isDirectory ? (
              expanded.has(entry.path) ? (
                <FolderOpen size={15} />
              ) : (
                <Folder size={15} />
              )
            ) : (
              <FileCode2 size={15} />
            )}
            <span>{entry.name}</span>
          </button>
          <div className="workspace-entry-actions">
            <IconButton
              label={t('用默认程序打开 {name}', { name: entry.name })}
              onClick={() => void openSystemFile(entry.path, 'workspace-file')}
            >
              <ExternalLink size={13} />
            </IconButton>
            <IconButton
              label={t('在资源管理器显示 {name}', { name: entry.name })}
              onClick={() => void openSystemFile(entry.path, 'workspace-reveal')}
            >
              <FolderOpen size={13} />
            </IconButton>
          </div>
        </div>
        {entry.isDirectory && expanded.has(entry.path) && renderTree(entry.path, depth + 1)}
      </div>
    ));
  const diffRows = useMemo(() => {
    let before: number | null = null,
      after: number | null = /^(?:新文件 |New file )/.test(diff?.text || '') ? 1 : null;
    return (diff?.text || '').split('\n').map((text) => {
      const row: { text: string; before?: number; after?: number } = { text };
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (hunk) {
        before = Number(hunk[1]);
        after = Number(hunk[2]);
      } else if (text.startsWith('+') && !text.startsWith('+++') && after !== null)
        row.after = after++;
      else if (text.startsWith('-') && !text.startsWith('---') && before !== null)
        row.before = before++;
      else if (text.startsWith(' ') && before !== null && after !== null) {
        row.before = before++;
        row.after = after++;
      }
      return row;
    });
  }, [diff]);
  function closeFile() {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    discardFile();
  }
  function discardFile() {
    setConfirmDiscard(false);
    contextRef.current.file += 1;
    setFile(null);
    setEdited('');
    setSaving(false);
  }
  return (
    <aside className="inspector">
      <div className="inspector-title">
        <span>{t('项目上下文')}</span>
        <div className="button-cluster">
          <IconButton label={t('刷新')} onClick={() => void refresh()} disabled={busy || !cwd}>
            {busy ? <Spinner /> : <RefreshCw size={15} />}
          </IconButton>
          <IconButton label={t('收起上下文面板')} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
      </div>
      <div className="inspector-tabs">
        {(
          [
            { id: 'files', label: '文件', icon: <Folder size={14} /> },
            { id: 'changes', label: '变更', icon: <GitCompareArrows size={14} /> },
            { id: 'plan', label: '计划', icon: <ListChecks size={14} /> },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'active' : ''}
            onClick={() => changeTab(item.id)}
          >
            {item.icon}
            {t(item.label)}
            {item.id === 'plan' && plan.length > 0 && <span className="count">{plan.length}</span>}
          </button>
        ))}
      </div>
      {tab === 'files' && cwd && (
        <label className="inspector-options">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />
          {t('显示构建与隐藏目录')}
        </label>
      )}
      <div className="inspector-body">
        {error && <div className="inline-error">{error}</div>}
        {!cwd ? (
          <EmptyBox icon={<Folder size={23} />} heading={t('先选择一个项目')}>
            {t('文件、变更和任务计划会显示在这里。')}
          </EmptyBox>
        ) : tab === 'files' ? (
          <>
            <div className="tree-heading">
              <FolderOpen size={14} />
              {baseName(cwd)}
            </div>
            {renderTree()}
            {!busy && tree['']?.length === 0 && (
              <EmptyBox
                icon={<File size={23} />}
                heading={t(showHidden ? '项目目录为空' : '当前没有可见文件')}
              >
                {t(
                  showHidden
                    ? '开始一项任务，让 Grok 为你创建文件。'
                    : '打开“显示构建与隐藏目录”，可查看构建输出和依赖目录。',
                )}
              </EmptyBox>
            )}
          </>
        ) : tab === 'changes' ? (
          changes ? (
            changes.isGit ? (
              <>
                <div className="tree-heading">
                  <GitBranch size={14} />
                  {['分离 HEAD', 'Detached HEAD'].includes(changes.branch)
                    ? t('分离 HEAD')
                    : changes.branch || t('当前分支')}
                  <span className="count">{changes.changes.length}</span>
                </div>
                {changes.changes.length ? (
                  changes.changes.map((change, index) => (
                    <button
                      className="change-row"
                      key={change.path + '-' + index}
                      onClick={() => void openDiff(change)}
                      title={t('查看文件差异')}
                    >
                      <span
                        className={'git-status ' + (change.status.includes('D') ? 'deleted' : '')}
                      >
                        {change.status}
                      </span>
                      <div>
                        <strong>{baseName(change.path)}</strong>
                        <small>
                          {change.path}
                          {change.staged ? t(' · 已暂存') : ''}
                        </small>
                      </div>
                      <ChevronRight size={14} />
                    </button>
                  ))
                ) : (
                  <EmptyBox icon={<Check size={24} />} heading={t('工作区干净')}>
                    {t('当前没有未提交的文件变更。')}
                  </EmptyBox>
                )}
              </>
            ) : changes.unavailable === 'git-not-found' ? (
              <EmptyBox icon={<GitBranch size={23} />} heading={t('尚未安装 Git')}>
                {t('安装 Git 并重新启动应用后，即可查看项目文件变更。文件浏览和编辑仍可使用。')}
              </EmptyBox>
            ) : (
              <EmptyBox icon={<GitBranch size={23} />} heading={t('此项目尚未使用 Git')}>
                {t('选择 Git 项目后，即可在这里查看变更和文件差异。')}
              </EmptyBox>
            )
          ) : null
        ) : plan.length ? (
          <div className="plan-list">
            {plan.map((entry, index) => (
              <div
                key={index}
                className={'plan-item ' + (entry.status === 'completed' ? 'completed' : '')}
              >
                {entry.status === 'completed' ? (
                  <Check size={16} />
                ) : entry.status === 'in_progress' ? (
                  <Spinner />
                ) : (
                  <Circle size={15} />
                )}
                <div>
                  {entry.content || entry.title || entry.description || String(entry)}
                  <small>
                    {t(
                      { pending: '待开始', in_progress: '进行中', completed: '已完成' }[
                        entry.status as string
                      ] || '',
                    )}
                  </small>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyBox icon={<ListChecks size={24} />} heading={t('让任务有条理地推进')}>
            {t('Grok 为当前任务创建计划后，步骤和进度会显示在这里。')}
          </EmptyBox>
        )}
      </div>
      <div className="inspector-footer">
        <span className="status-dot" />
        {t('本地工作区')}
        <span className="ellipsis" title={cwd}>
          {cwd ? baseName(cwd) : t('未选择')}
        </span>
      </div>
      {file && (
        <Modal
          title={baseName(file.path)}
          subtitle={file.path}
          wide
          onClose={closeFile}
          footer={
            <>
              <span className="muted">
                {t(
                  file.truncated
                    ? '文件较大，仅预览部分内容'
                    : dirty
                      ? '有未保存的修改'
                      : '所有修改已保存',
                )}
              </span>
              <button
                className="primary-button"
                disabled={saving || file.truncated || !dirty}
                onClick={() => void save()}
              >
                {saving ? <Spinner /> : <Save size={15} />}
                {t('保存文件')}
              </button>
            </>
          }
        >
          <div className="file-preview-actions">
            <button
              className="secondary-button"
              onClick={() => void openSystemFile(file.path, 'workspace-file')}
            >
              <ExternalLink size={14} />
              {t('用默认程序打开')}
            </button>
            <button
              className="secondary-button"
              onClick={() => void openSystemFile(file.path, 'workspace-reveal')}
            >
              <FolderOpen size={14} />
              {t('在资源管理器显示')}
            </button>
          </div>
          <textarea
            ref={editorRef}
            className="file-editor"
            value={edited}
            onChange={(event) => setEdited(event.target.value)}
            readOnly={file.truncated}
            spellCheck={false}
            aria-label={t('文件内容')}
          />
        </Modal>
      )}
      {confirmDiscard && file && (
        <Modal
          title={t('放弃未保存的修改')}
          onClose={() => setConfirmDiscard(false)}
          footer={
            <>
              <button className="secondary-button" onClick={() => setConfirmDiscard(false)}>
                {t('继续编辑')}
              </button>
              <button className="primary-button danger" onClick={discardFile}>
                {t('放弃修改')}
              </button>
            </>
          }
        >
          <p>{t('此文件的修改尚未保存。放弃修改并关闭？')}</p>
        </Modal>
      )}
      {diff && (
        <Modal
          title={t('文件变更')}
          subtitle={diff.path}
          wide
          onClose={() => {
            contextRef.current.diff += 1;
            setDiff(null);
          }}
        >
          <div className="diff-view">
            {diff.text ? (
              diffRows.map((line, index) => (
                <div
                  key={index}
                  className={
                    line.text.startsWith('+')
                      ? 'diff-add'
                      : line.text.startsWith('-')
                        ? 'diff-remove'
                        : line.text.startsWith('@@')
                          ? 'diff-header'
                          : ''
                  }
                >
                  <span className="diff-line-number" aria-hidden="true">
                    {line.before ?? ''}
                  </span>
                  <span className="diff-line-number" aria-hidden="true">
                    {line.after ?? ''}
                  </span>
                  <span className="diff-line-content">
                    {index === 0 &&
                    (line.text === `新文件 ${diff.path}` || line.text === `New file ${diff.path}`)
                      ? t('新文件 {path}', { path: diff.path })
                      : ['… 内容已截断', '… Content truncated'].includes(line.text)
                        ? t('… 内容已截断')
                        : line.text || ' '}
                  </span>
                </div>
              ))
            ) : (
              <EmptyBox icon={<GitCompareArrows size={22} />} heading={t('没有可显示的文本差异')}>
                {t('该文件可能是二进制文件。')}
              </EmptyBox>
            )}
          </div>
        </Modal>
      )}
    </aside>
  );
}
