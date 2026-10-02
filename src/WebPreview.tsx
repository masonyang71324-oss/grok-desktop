import { useEffect, useState, useRef } from 'react';
import { Modal } from './components';
import { request, errorText } from './lib';
import { useI18n } from './i18n';
import './desktop-tools.css';
export type PreviewOwner = { cwd: string; sessionId?: string; draftKey: string };
export default function WebPreview({
  owner,
  onClose,
}: {
  owner: PreviewOwner;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState('http://localhost:3000'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const alive = useRef(true),
    opening = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    void request<{ url?: string }>('runner.state', { cwd: owner.cwd })
      .then((state) => {
        if (live && state.url) setUrl(state.url);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [owner.cwd]);
  async function open() {
    if (opening.current) return;
    opening.current = true;
    setBusy(true);
    setError('');
    try {
      await request('preview.open', { url, owner });
      if (alive.current) onClose();
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      opening.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal
      title={t('网页预览')}
      subtitle={owner.cwd}
      onClose={onClose}
      footer={
        <button
          className="primary-button"
          disabled={busy || !url.trim()}
          onClick={() => void open()}
        >
          {busy ? t('正在打开…') : t('打开预览窗口')}
        </button>
      }
    >
      <label className="field-label">
        {t('网页地址')}
        <input
          autoFocus
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void open();
            }
          }}
        />
      </label>
      <p className="muted">
        {t('在预览窗口中浏览网页，点击截图按钮即可把图片加入当前会话的草稿。截图不会自动发送。')}
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
