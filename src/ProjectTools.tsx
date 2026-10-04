import { useEffect, useState } from 'react';
import { Modal } from './components';
import { errorText, request } from './lib';
import { useI18n } from './i18n';
import type { Checkpoint, CheckpointStorage, RunnerState } from './types';

export default function ProjectTools({
  cwd,
  sessionId,
  editorOpen,
  onRestored,
  onClose,
  notify,
  initialCheckpointId,
  initialRestore,
  initialStorage = false,
  onRecordsChanged,
}: {
  cwd: string;
  sessionId?: string;
  editorOpen: boolean;
  onRestored: () => void;
  onClose: () => void;
  notify: (text: string) => void;
  initialCheckpointId?: string;
  initialRestore?: boolean;
  initialStorage?: boolean;
  onRecordsChanged?: () => void;
}) {
  const { t } = useI18n();
  const [scripts, setScripts] = useState<{ name: string; command: string }[]>([]);
  const [script, setScript] = useState('');
  const [state, setState] = useState<RunnerState>({ status: 'stopped', log: '' });
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [detail, setDetail] = useState<Checkpoint | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [deleteRecord, setDeleteRecord] = useState<Checkpoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'project' | 'storage'>(initialStorage ? 'storage' : 'project');
  const [storage, setStorage] = useState<CheckpointStorage | null>(null);
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);
  const [confirmStorageDelete, setConfirmStorageDelete] = useState(false);
  const storageKinds = { turn: '任务检查点', restore: '恢复撤销记录', unreadable: '记录不可读' };
  const storageStatuses: Record<string, string> = {
    ready: '已完成',
    recording: '正在记录',
    interrupted: '已中断',
    unreadable: '记录不可读',
  };
  const formatBytes = (bytes: number) =>
    bytes < 1024
      ? `${bytes} B`
      : `${(bytes / (bytes < 1024 * 1024 ? 1024 : 1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${bytes < 1024 * 1024 ? 'KB' : 'MB'}`;
  async function refreshStorage() {
    const next = await request<CheckpointStorage>('checkpoints.storage');
    setStorage(next);
    setSelectedRecords((previous) =>
      previous.filter((id) =>
        next.records.some((record) => record.id === id && record.status !== 'recording'),
      ),
    );
  }
  async function openStorage() {
    setView('storage');
    try {
      await refreshStorage();
    } catch (error) {
      notify(errorText(error));
    }
  }
  async function removeSelectedRecords() {
    if (!selectedRecords.length) return;
    setBusy(true);
    try {
      await request('checkpoints.removeMany', { ids: selectedRecords });
      if (detail && selectedRecords.includes(detail.id)) setDetail(null);
      setSelectedRecords([]);
      setConfirmStorageDelete(false);
      await Promise.all([refresh(), refreshStorage()]);
      onRecordsChanged?.();
    } catch (error) {
      notify(errorText(error));
      await refreshStorage().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (initialStorage) void openStorage();
  }, [initialStorage]);
  useEffect(() => {
    if (!initialCheckpointId) return;
    let active = true;
    void request<Checkpoint>('checkpoints.detail', { id: initialCheckpointId })
      .then((entry) => {
        if (!active) return;
        setDetail(entry);
        setPaths(entry.files.map((file) => file.path));
        setConfirm(
          !!initialRestore && !editorOpen && entry.status === 'ready' && entry.files.length > 0,
        );
      })
      .catch((error) => {
        if (active) notify(errorText(error));
      });
    return () => {
      active = false;
    };
  }, [initialCheckpointId, initialRestore, cwd]);
  async function refresh() {
    setCheckpoints(await request<Checkpoint[]>('checkpoints.list', { cwd, sessionId }));
  }
  useEffect(() => {
    let active = true;
    void Promise.all([
      request<{ scripts: { name: string; command: string }[]; state: RunnerState }>(
        'runner.inspect',
        { cwd },
      ),
      request<Checkpoint[]>('checkpoints.list', { cwd, sessionId }),
    ])
      .then(([runner, list]) => {
        if (!active) return;
        setScripts(runner.scripts);
        setScript(runner.state.script || runner.scripts[0]?.name || '');
        setState(runner.state);
        setCheckpoints(list);
      })
      .catch((e) => {
        if (active) notify(errorText(e));
      });
    const unsub = window.desktop.onEvent((event) => {
      if (event.type === 'runner-changed' && event.cwd === cwd) setState(event.state);
      if (
        event.type === 'checkpoints-changed' &&
        event.cwd === cwd &&
        (!sessionId || event.sessionId === sessionId)
      )
        void request<Checkpoint[]>('checkpoints.list', { cwd, sessionId })
          .then((list) => {
            if (active) setCheckpoints(list);
          })
          .catch((error) => {
            if (active) notify(errorText(error));
          });
    });
    return () => {
      active = false;
      unsub();
    };
  }, [cwd, sessionId]);
  async function run(action: 'start' | 'stop' | 'restart') {
    setBusy(true);
    try {
      if (action !== 'start') setState(await request<RunnerState>('runner.stop', { cwd }));
      if (action !== 'stop') setState(await request<RunnerState>('runner.start', { cwd, script }));
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function inspect(id: string) {
    try {
      const entry = await request<Checkpoint>('checkpoints.detail', { id });
      setDetail(entry);
      setPaths(entry.files.map((file) => file.path));
      setConfirm(false);
    } catch (e) {
      notify(errorText(e));
    }
  }
  async function restore() {
    if (!detail || editorOpen) return;
    setBusy(true);
    try {
      await request('checkpoints.restore', { id: detail.id, paths });
      setConfirm(false);
      setDetail(null);
      await refresh();
      onRestored();
      notify(t('文件已恢复，可从新的检查点撤销恢复。'));
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function removeRecord() {
    if (!deleteRecord) return;
    setBusy(true);
    try {
      await request('checkpoints.remove', { id: deleteRecord.id });
      if (detail?.id === deleteRecord.id) setDetail(null);
      setDeleteRecord(null);
      await refresh();
      onRecordsChanged?.();
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('项目工具')} subtitle={cwd} onClose={onClose} wide>
      <div className="workflow-actions">
        <button
          className="secondary-button"
          aria-pressed={view === 'project'}
          disabled={busy}
          onClick={() => setView('project')}
        >
          {t('当前项目')}
        </button>
        <button
          className="secondary-button"
          aria-pressed={view === 'storage'}
          disabled={busy}
          onClick={() => void openStorage()}
        >
          {t('检查点存储管理')}
        </button>
      </div>
      {view === 'storage' ? (
        <section className="workflow-card">
          <h3>{t('所有项目的检查点存储')}</h3>
          <p className="muted">{t('检查点不会自动清理。只删除你选中的记录，项目文件保持不变。')}</p>
          {storage && (
            <p>
              {t('已使用 {used} / {limit}', {
                used: formatBytes(storage.bytes),
                limit: formatBytes(storage.limitBytes),
              })}
            </p>
          )}
          <div className="workflow-actions">
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void refreshStorage().catch((error) => notify(errorText(error)))}
            >
              {t('刷新')}
            </button>
            <button
              className="text-button"
              disabled={busy || !storage?.records.some((record) => record.status !== 'recording')}
              onClick={() =>
                setSelectedRecords(
                  storage!.records
                    .filter((record) => record.status !== 'recording')
                    .map((record) => record.id),
                )
              }
            >
              {t('选择可删除记录')}
            </button>
            <button
              className="text-button"
              disabled={busy || !selectedRecords.length}
              onClick={() => setSelectedRecords([])}
            >
              {t('清除选择')}
            </button>
            <button
              className="secondary-button danger"
              disabled={busy || !selectedRecords.length}
              onClick={() => setConfirmStorageDelete(true)}
            >
              {t('删除所选记录')}
            </button>
          </div>
          {storage?.records.map((record) => (
            <label
              key={record.id}
              className="workflow-card"
              style={{ display: 'flex', gap: 12, overflowWrap: 'anywhere' }}
            >
              <input
                type="checkbox"
                checked={selectedRecords.includes(record.id)}
                disabled={busy || record.status === 'recording'}
                onChange={(event) =>
                  setSelectedRecords((previous) =>
                    event.target.checked
                      ? [...previous, record.id]
                      : previous.filter((id) => id !== record.id),
                  )
                }
              />
              <span style={{ minWidth: 0 }}>
                <strong>{record.cwd || t('项目未知')}</strong>
                <br />
                <span>
                  {new Date(record.createdAt).toLocaleString()} · {t(storageKinds[record.kind])} ·{' '}
                  {formatBytes(record.bytes)}
                </span>
                <br />
                {record.kind !== 'unreadable' && (
                  <span>
                    {t(storageStatuses[record.status] || record.status)} ·{' '}
                    {t('{count} 个文件', { count: record.fileCount ?? 0 })}
                  </span>
                )}
                {record.status === 'recording' && <span> · {t('运行中不可删除')}</span>}
              </span>
            </label>
          ))}
          {storage?.records.length === 0 && <p>{t('暂无检查点')}</p>}
        </section>
      ) : (
        <>
          <section className="workflow-card">
            <h3>{t('运行项目')}</h3>
            {scripts.length ? (
              <>
                <select
                  aria-label={t('项目脚本')}
                  value={script}
                  disabled={busy || state.status === 'running'}
                  onChange={(event) => setScript(event.target.value)}
                >
                  {scripts.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name} — {item.command}
                    </option>
                  ))}
                </select>
                <div className="workflow-actions">
                  <button
                    className="secondary-button"
                    disabled={busy || state.status === 'running' || state.status === 'stopping'}
                    onClick={() => void run('start')}
                  >
                    {t('运行')}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || state.status !== 'running'}
                    onClick={() => void run('stop')}
                  >
                    {t('停止')}
                  </button>
                  <button
                    className="secondary-button"
                    disabled={busy || state.status === 'stopping'}
                    onClick={() => void run('restart')}
                  >
                    {t('重新运行')}
                  </button>
                  {state.url && (
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void request('system.open', { target: 'url', url: state.url }).catch((e) =>
                          notify(errorText(e)),
                        )
                      }
                    >
                      {t('打开预览')}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p>{t('未检测到可运行的 npm 脚本')}</p>
            )}
            {state.error && <p className="inline-error">{state.error}</p>}
            <pre className="workflow-log" aria-label={t('运行日志')}>
              {state.log || t('暂无运行日志')}
            </pre>
          </section>
          <section className="workflow-card">
            <h3>{t('任务检查点')}</h3>
            <p className="muted">{t('恢复只修改所选文件，不会回退会话。后续修改会阻止覆盖。')}</p>
            <button
              className="text-button"
              onClick={() => void refresh().catch((e) => notify(errorText(e)))}
            >
              {t('刷新')}
            </button>
            {!checkpoints.length && <p>{t('暂无检查点')}</p>}
            {checkpoints.map((entry) => (
              <div className="workflow-actions" key={entry.id}>
                <button
                  className="checkpoint-row"
                  disabled={entry.status !== 'ready'}
                  onClick={() => void inspect(entry.id)}
                >
                  <span>
                    {new Date(entry.createdAt).toLocaleString()}
                    {entry.status === 'interrupted' ? ` · ${t('已中断')}` : ''}
                  </span>
                  <span>
                    {entry.files.length} {t('个文件')}
                  </span>
                </button>
                <button
                  className="text-button"
                  disabled={busy || entry.status === 'recording'}
                  onClick={() => setDeleteRecord(entry)}
                >
                  {t('删除记录')}
                </button>
              </div>
            ))}
          </section>
          {detail && (
            <section className="workflow-card">
              <h3>{t('检查点文件')}</h3>
              {detail.files.map((file) => (
                <details key={file.path}>
                  <summary>
                    <input
                      type="checkbox"
                      checked={paths.includes(file.path)}
                      onChange={(event) =>
                        setPaths((previous) =>
                          event.target.checked
                            ? [...previous, file.path]
                            : previous.filter((path) => path !== file.path),
                        )
                      }
                    />
                    {file.path} ·{' '}
                    {t(
                      (
                        { modified: '修改', created: '新建', deleted: '删除' } as Record<
                          string,
                          string
                        >
                      )[file.status] || file.status,
                    )}
                  </summary>
                  <div className="checkpoint-diff">
                    <div>
                      <strong>{t('任务前')}</strong>
                      <pre>{file.before ?? t('文件不存在')}</pre>
                    </div>
                    <div>
                      <strong>{t('任务后')}</strong>
                      <pre>{file.after ?? t('文件不存在')}</pre>
                    </div>
                  </div>
                </details>
              ))}
              {detail.skipped?.map((file) => (
                <p className="muted" key={file.path}>
                  {t('未纳入检查点')}：{file.path} — {file.reason}
                </p>
              ))}
              {editorOpen && <p>{t('请先保存并关闭文件编辑器，再恢复文件。')}</p>}
              <button
                className="secondary-button"
                disabled={editorOpen || !paths.length || busy}
                onClick={() => setConfirm(true)}
              >
                {t('恢复所选文件')}
              </button>
            </section>
          )}
        </>
      )}
      {confirmStorageDelete && (
        <Modal
          title={t('删除所选检查点记录？')}
          onClose={() => !busy && setConfirmStorageDelete(false)}
          footer={
            <button
              className="primary-button danger"
              disabled={busy}
              onClick={() => void removeSelectedRecords()}
            >
              {t('确认删除')}
            </button>
          }
        >
          <p>
            {t('将删除 {count} 条恢复记录。删除后无法再使用这些记录恢复文件，项目文件保持不变。', {
              count: selectedRecords.length,
            })}
          </p>
          <ul>
            {storage?.records
              .filter((record) => selectedRecords.includes(record.id))
              .map((record) => (
                <li key={record.id}>
                  {record.cwd || t('项目未知')} · {new Date(record.createdAt).toLocaleString()} ·{' '}
                  {t(storageKinds[record.kind])}
                </li>
              ))}
          </ul>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={t('确认恢复这些文件？')}
          onClose={() => setConfirm(false)}
          footer={
            <button
              className="primary-button danger"
              disabled={busy || editorOpen}
              onClick={() => void restore()}
            >
              {t('确认恢复')}
            </button>
          }
        >
          <p>{t('这些文件将恢复到任务开始前的内容。')}</p>
          <ul>
            {paths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </Modal>
      )}
      {deleteRecord && (
        <Modal
          title={t('删除检查点记录？')}
          onClose={() => setDeleteRecord(null)}
          footer={
            <button
              className="primary-button danger"
              disabled={busy}
              onClick={() => void removeRecord()}
            >
              {t('删除记录')}
            </button>
          }
        >
          <p>{t('只删除这条恢复记录，项目文件保持不变。删除后无法使用此记录恢复文件。')}</p>
          <p>{new Date(deleteRecord.createdAt).toLocaleString()}</p>
        </Modal>
      )}
    </Modal>
  );
}
