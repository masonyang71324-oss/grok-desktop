import { useEffect, useRef, useState } from 'react';
import { Modal } from './components';
import { useI18n } from './i18n';
import { errorText } from './lib';
import type { RuntimeRequest } from './FirstRunWizard';
import './runtime-upgrades.css';

export type ProviderFields = {
  model?: string;
  base_url?: string;
  name?: string;
  env_key?: string;
  api_backend?: 'chat_completions' | 'responses' | 'messages';
  context_window?: number | null;
};
export type ProviderModel = ProviderFields & { id: string; enabled: boolean; hasKey: boolean };
export type ProviderList = { baseline: string; models: ProviderModel[] };
const blank = {
  id: '',
  model: '',
  base_url: '',
  name: '',
  env_key: '',
  api_backend: 'chat_completions',
  context_window: '',
};

export default function ProviderSettings({
  request,
  onClose,
  onChanged,
}: {
  request: RuntimeRequest;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { t } = useI18n();
  const [list, setList] = useState<ProviderList | null>(null);
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<ProviderModel | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void request('providers.list')
      .then((value) => {
        if (alive.current) setList(value);
      })
      .catch((e) => {
        if (alive.current) setError(errorText(e));
      });
    return () => {
      alive.current = false;
    };
  }, [request]);
  async function action(command: string, payload?: any) {
    setBusy(true);
    setError('');
    try {
      const result = await request(command, payload);
      if (alive.current) {
        setList(result);
        if (command === 'providers.save' || command === 'providers.remove') {
          setForm(false);
          setRemoving(null);
        }
      }
      if (command !== 'providers.list') onChanged?.();
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function edit(model?: ProviderModel) {
    setRemoving(null);
    setError('');
    setEditing(model?.id || null);
    setDraft(
      model
        ? {
            id: model.id,
            model: model.model || '',
            base_url: model.base_url || '',
            name: model.name || '',
            env_key: model.env_key || '',
            api_backend: model.api_backend || 'chat_completions',
            context_window: model.context_window == null ? '' : String(model.context_window),
          }
        : blank,
    );
    setForm(true);
  }
  function save() {
    if (!list) return;
    const fields: ProviderFields = {
      model: draft.model,
      base_url: draft.base_url,
      name: draft.name,
      env_key: draft.env_key,
      api_backend: draft.api_backend as ProviderFields['api_backend'],
    };
    fields.context_window = draft.context_window === '' ? null : Number(draft.context_window);
    void action('providers.save', { baseline: list.baseline, id: draft.id, fields });
  }
  const field = (
    key: keyof typeof blank,
    label: string,
    props: { type?: string; min?: number; required?: boolean; disabled?: boolean } = {},
  ) => (
    <label>
      {t(label)}
      <input
        {...props}
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
      />
    </label>
  );
  return (
    <Modal
      title={t('自定义模型')}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="provider-settings runtime-upgrades">
        <p>
          {t('编辑官方 Grok 自定义模型配置。密钥通过环境变量引用，实际密钥不会显示或发送到界面。')}
        </p>
        <p className="runtime-note">
          {t(
            '停用通过官方 disabled_models 从模型目录移除；启用恢复可用性。已有会话需重新连接以载入配置。',
          )}
        </p>
        <div className="runtime-actions">
          <button disabled={busy || !list} onClick={() => edit()}>
            {t('添加模型')}
          </button>
          <button disabled={busy} onClick={() => void action('providers.list')}>
            {t('重新载入')}
          </button>
        </div>
        <div className="provider-model-list">
          {list?.models.map((model) => (
            <section key={model.id} className="provider-model">
              <div>
                <strong>{model.name || model.id}</strong>
                <small>
                  {model.id} · {model.api_backend || 'chat_completions'}
                </small>
                <small>
                  {model.enabled ? t('已启用') : t('已停用')} ·{' '}
                  {model.hasKey ? t('密钥已配置') : t('未检测到密钥')}
                </small>
              </div>
              <div className="runtime-actions">
                <button
                  disabled={busy}
                  aria-label={`${t('编辑')} ${model.name || model.id}`}
                  onClick={() => edit(model)}
                >
                  {t('编辑')}
                </button>
                <button
                  disabled={busy}
                  aria-label={`${model.enabled ? t('停用') : t('启用')} ${model.name || model.id}`}
                  onClick={() =>
                    void action('providers.enable', {
                      baseline: list.baseline,
                      id: model.id,
                      enabled: !model.enabled,
                    })
                  }
                >
                  {model.enabled ? t('停用') : t('启用')}
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setRemoving(model);
                    setForm(false);
                  }}
                >
                  {t('移除')}
                </button>
              </div>
            </section>
          ))}
          {list && !list.models.length && !form && <p>{t('尚未配置自定义模型。')}</p>}
        </div>
        {removing && (
          <section className="runtime-remove-confirm">
            <p>{t('移除模型 {name} 及其专属配置？', { name: removing.name || removing.id })}</p>
            <div className="runtime-actions">
              <button disabled={busy} onClick={() => setRemoving(null)}>
                {t('取消')}
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action('providers.remove', { baseline: list?.baseline, id: removing.id })
                }
              >
                {t('确认移除模型')}
              </button>
            </div>
          </section>
        )}
        {form && (
          <form
            className="provider-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            {field('id', '模型标识', { required: true, disabled: busy || !!editing })}
            {field('name', '显示名称', { disabled: busy })}
            {field('model', '远端模型名称', { required: true, disabled: busy })}
            {field('base_url', '服务地址', { required: true, disabled: busy, type: 'url' })}
            {field('env_key', '环境变量名称', { disabled: busy })}
            <label>
              {t('API 协议')}
              <select
                disabled={busy}
                value={draft.api_backend}
                onChange={(event) => setDraft({ ...draft, api_backend: event.target.value })}
              >
                <option value="chat_completions">Chat Completions</option>
                <option value="responses">Responses</option>
                <option value="messages">Anthropic Messages</option>
              </select>
            </label>
            {field('context_window', '上下文窗口（可选）', {
              type: 'number',
              min: 1,
              disabled: busy,
            })}
            <p className="runtime-note">
              {t('环境变量在启动 Grok Desktop 前设置。已有内联密钥与其他配置会保留。')}
            </p>
            <div className="runtime-actions">
              <button type="button" disabled={busy} onClick={() => setForm(false)}>
                {t('取消')}
              </button>
              <button type="submit" disabled={busy || !list} className="primary">
                {t('保存模型')}
              </button>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" className="runtime-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
