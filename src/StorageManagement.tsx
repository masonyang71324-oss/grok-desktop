import { useEffect, useState } from 'react';
import { Modal } from './components';
import { request, errorText } from './lib';
import { useI18n } from './i18n';

type StoredAttachment = {
  name: string;
  path: string;
  createdAt: string;
  bytes: number;
  protected: boolean;
};
type AttachmentStorage = { directory: string; bytes: number; files: StoredAttachment[] };
const formatBytes = (bytes: number) =>
  `${(bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB`;

export default function StorageManagement({
  protectedPaths,
  notify,
}: {
  protectedPaths: string[];
  notify: (message: string) => void;
}) {
  const { t } = useI18n();
  const [storage, setStorage] = useState<AttachmentStorage | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const protectionKey = JSON.stringify(protectedPaths);
  function accept(next: AttachmentStorage) {
    setStorage(next);
    setSelected((previous) =>
      previous.filter((name) => next.files.some((file) => file.name === name && !file.protected)),
    );
  }
  async function refresh() {
    accept(await request<AttachmentStorage>('attachments.storage', { protectedPaths }));
  }
  useEffect(() => {
    let active = true;
    void request<AttachmentStorage>('attachments.storage', { protectedPaths })
      .then((next) => {
        if (active) accept(next);
      })
      .catch((error) => {
        if (active) notify(errorText(error));
      });
    return () => {
      active = false;
    };
  }, [protectionKey]);
  async function remove() {
    if (!selected.length) return;
    setBusy(true);
    try {
      await request('attachments.removeMany', { names: selected, protectedPaths });
      setSelected([]);
      setConfirm(false);
      await refresh();
    } catch (error) {
      notify(errorText(error));
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workflow-card">
      <h3>{t('应用附件存储')}</h3>
      <p className="muted">{t('这里只管理应用保存的附件。不会自动清理，也不会删除用户原文件。')}</p>
      <p className="muted">{t('旧会话引用无法全部确认；删除图片可能影响旧会话中的显示。')}</p>
      {storage && <p>{t('总占用：{size}', { size: formatBytes(storage.bytes) })}</p>}
      <div className="workflow-actions">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => void refresh().catch((error) => notify(errorText(error)))}
        >
          {t('刷新')}
        </button>
        <button
          className="text-button"
          onClick={() =>
            void request('system.open', { target: 'attachments' }).catch((error) =>
              notify(errorText(error)),
            )
          }
        >
          {t('打开附件目录')}
        </button>
        <button
          className="secondary-button danger"
          disabled={busy || !selected.length}
          onClick={() => setConfirm(true)}
        >
          {t('删除所选附件')}
        </button>
      </div>
      {storage?.files.map((file) => (
        <label
          key={file.name}
          className="workflow-card"
          style={{ display: 'flex', gap: 12, overflowWrap: 'anywhere' }}
        >
          <input
            type="checkbox"
            disabled={busy || file.protected}
            checked={selected.includes(file.name)}
            onChange={(event) =>
              setSelected((previous) =>
                event.target.checked
                  ? [...previous, file.name]
                  : previous.filter((name) => name !== file.name),
              )
            }
          />
          <span style={{ minWidth: 0 }}>
            <strong>{file.name}</strong>
            <br />
            {new Date(file.createdAt).toLocaleString()} · {formatBytes(file.bytes)}
            {file.protected && <span> · {t('正在使用，不能删除')}</span>}
          </span>
        </label>
      ))}
      {storage?.files.length === 0 && <p>{t('暂无应用附件')}</p>}
      {confirm && (
        <Modal
          title={t('删除这些应用附件？')}
          onClose={() => !busy && setConfirm(false)}
          footer={
            <button
              className="primary-button danger"
              disabled={busy || !selected.length}
              onClick={() => void remove()}
            >
              {t('确认删除')}
            </button>
          }
        >
          <p>{t('删除后，旧会话中引用这些图片的显示可能失效。用户原文件不会被删除。')}</p>
          <ul>
            {selected.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </Modal>
      )}
    </section>
  );
}
