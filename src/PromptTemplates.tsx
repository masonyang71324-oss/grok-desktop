import { useEffect, useState } from 'react';
import { Edit3, Plus, Star, Trash2 } from 'lucide-react';
import { Modal } from './components';
import { useI18n } from './i18n';
import { errorText } from './lib';
import './prompt-templates.css';

type Template = { id: string; name: string; text: string };
export default function PromptTemplates({
  items,
  draft,
  onSave,
  onUse,
  onClose,
}: {
  items: Template[];
  draft: string;
  onSave: (items: Template[]) => Promise<void>;
  onUse: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [list, setList] = useState(items);
  const [editor, setEditor] = useState<Template | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setList(items), [items]);
  function create(text = '') {
    setEditor({ id: crypto.randomUUID(), name: '', text });
    setDeleting(null);
    setError('');
  }
  async function save() {
    if (!editor || busy) return;
    if (!editor.name.trim()) {
      setError(t('请输入收藏名称。'));
      return;
    }
    if (editor.name.length > 80) {
      setError(t('名称最多 80 个字符。'));
      return;
    }
    if (!editor.text.trim()) {
      setError(t('请输入提示词内容。'));
      return;
    }
    if (editor.text.length > 20000) {
      setError(t('提示词最多 20,000 个字符。'));
      return;
    }
    const existing = list.some((item) => item.id === editor.id);
    if (!existing && list.length >= 20) {
      setError(t('最多收藏 20 条提示词。'));
      return;
    }
    const value = { ...editor, name: editor.name.trim() };
    const next = existing
      ? list.map((item) => (item.id === value.id ? value : item))
      : [...list, value];
    setBusy(true);
    setError('');
    try {
      await onSave(next);
      setList(next);
      setEditor(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting || busy) return;
    const next = list.filter((item) => item.id !== deleting);
    setBusy(true);
    setError('');
    try {
      await onSave(next);
      setList(next);
      if (editor?.id === deleting) setEditor(null);
      setDeleting(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t('提示词收藏')}
      subtitle={t('保存常用提示词，使用时加入输入框。')}
      onClose={onClose}
    >
      <div className="prompt-template-actions">
        <button
          className="secondary-button"
          disabled={busy || !draft.trim() || list.length >= 20}
          onClick={() => create(draft)}
        >
          <Star size={15} />
          {t('保存当前草稿')}
        </button>
        <button
          className="secondary-button"
          disabled={busy || list.length >= 20}
          onClick={() => create()}
        >
          <Plus size={15} />
          {t('新建收藏')}
        </button>
        <span>{t('已收藏 {count}/20 条', { count: list.length })}</span>
      </div>
      {list.length >= 20 && <p className="muted">{t('最多收藏 20 条提示词。')}</p>}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {editor && (
        <div className="prompt-template-editor">
          <label className="field">
            {t('收藏名称')}
            <input
              aria-label={t('收藏名称')}
              disabled={busy}
              value={editor.name}
              placeholder={t('例如：代码审查')}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
            />
          </label>
          <label className="field">
            {t('提示词内容')}
            <textarea
              aria-label={t('提示词内容')}
              disabled={busy}
              rows={5}
              value={editor.text}
              placeholder={t('填写要重复使用的提示词…')}
              onChange={(e) => setEditor({ ...editor, text: e.target.value })}
            />
          </label>
          <div className="prompt-template-actions">
            <button className="primary-button" disabled={busy} onClick={() => void save()}>
              {busy ? t('正在保存…') : t('保存收藏')}
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                setEditor(null);
                setError('');
              }}
            >
              {t('取消编辑')}
            </button>
          </div>
        </div>
      )}
      {!list.length && !editor && (
        <div className="prompt-template-empty">
          <p>{t('还没有收藏的提示词。')}</p>
          <span>{t('保存当前草稿，或新建一条常用提示词。')}</span>
        </div>
      )}
      <div className="prompt-template-list">
        {list.map((item) => (
          <article key={item.id} className="prompt-template-item">
            <strong>{item.name}</strong>
            <p>{item.text}</p>
            <div className="prompt-template-actions">
              <button
                className="secondary-button"
                aria-label={t('使用“{name}”', { name: item.name })}
                disabled={busy}
                onClick={() => {
                  onUse(item.text);
                  onClose();
                }}
              >
                {t('使用')}
              </button>
              <button
                className="text-button"
                aria-label={t('编辑“{name}”', { name: item.name })}
                disabled={busy}
                onClick={() => {
                  setEditor({ ...item });
                  setDeleting(null);
                  setError('');
                }}
              >
                <Edit3 size={14} />
                {t('编辑')}
              </button>
              <button
                className="text-button danger-text"
                aria-label={t('删除“{name}”', { name: item.name })}
                disabled={busy}
                onClick={() => {
                  setDeleting(item.id);
                  setError('');
                }}
              >
                <Trash2 size={14} />
                {t('删除')}
              </button>
            </div>
            {deleting === item.id && (
              <div className="prompt-template-delete">
                <p>{t('删除“{name}”收藏？', { name: item.name })}</p>
                <button className="danger-button" disabled={busy} onClick={() => void remove()}>
                  {t('确认删除')}
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    setDeleting(null);
                    setError('');
                  }}
                >
                  {t('取消删除')}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </Modal>
  );
}
