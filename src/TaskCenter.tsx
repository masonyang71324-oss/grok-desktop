import { useState } from 'react';
import { Modal } from './components';
import { errorText, request } from './lib';
import { useI18n } from './i18n';
import type { TaskSummary } from './types';

export default function TaskCenter({
  tasks,
  onOpen,
  onClose,
  notify,
}: {
  tasks: TaskSummary[];
  onOpen: (task: TaskSummary) => void;
  onClose: () => void;
  notify: (text: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState('');
  async function act(command: string, sessionId: string, queueId?: string) {
    setBusy(sessionId);
    try {
      await request(command, { sessionId, queueId });
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy('');
    }
  }
  return (
    <Modal
      title={t('任务中心')}
      subtitle={t('切换会话不会停止任务。队列暂停后需手动继续。')}
      onClose={onClose}
      wide
    >
      <div className="workflow-list">
        {!tasks.length && <p className="muted">{t('暂无任务')}</p>}
        {tasks.map((task) => (
          <section className="workflow-card" key={task.sessionId}>
            <button className="text-button" onClick={() => onOpen(task)}>
              {task.title || t('未命名会话')}
            </button>
            <small>{task.cwd}</small>
            <span>
              {t(
                (
                  {
                    idle: '待开始',
                    running: '进行中',
                    background: '后台任务运行中',
                    waiting: '等待中',
                    paused: '已暂停',
                    error: '失败',
                    interrupted: '已中断',
                  } as Record<string, string>
                )[task.status] || task.status,
              )}
            </span>
            {!!task.permissions.length && <p>{t('等待审批')}</p>}
            {task.error && <p className="inline-error">{task.error}</p>}
            {task.status === 'background' && (
              <p className="muted">
                {t('本轮后台操作尚未完成，同项目的新请求会继续等待。可打开会话管理后台操作。')}
              </p>
            )}
            {task.queued.map((item) => (
              <div className="queue-item" key={item.id}>
                <div>
                  {item.text}
                  {!!item.attachments?.length && (
                    <small>{item.attachments.map((file) => file.name).join(', ')}</small>
                  )}
                </div>
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() => void act('tasks.remove', task.sessionId, item.id)}
                >
                  {t('移除')}
                </button>
              </div>
            ))}
            {!!task.queued.length && ['paused', 'error', 'interrupted'].includes(task.status) && (
              <button
                className="secondary-button"
                disabled={!!busy}
                onClick={() => void act('tasks.resume', task.sessionId)}
              >
                {t('继续队列')}
              </button>
            )}
            {['running', 'waiting'].includes(task.status) && (
              <button
                className="secondary-button"
                disabled={!!busy}
                onClick={() => void act('session.cancel', task.sessionId)}
              >
                {t('停止任务')}
              </button>
            )}
          </section>
        ))}
      </div>
    </Modal>
  );
}
