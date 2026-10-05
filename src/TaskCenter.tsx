import { useState } from 'react';
import { Modal } from './components';
import { describeSystemError, errorText, notificationText, request } from './lib';
import { useI18n } from './i18n';
import type { TaskSummary } from './types';
import { deriveTaskStatus, groupTasks } from './task-status.mjs';

export default function TaskCenter({
  tasks,
  onOpen,
  onInspectChanges,
  onClose,
  notify,
  embedded = false,
}: {
  tasks: TaskSummary[];
  onOpen: (task: TaskSummary) => void;
  onInspectChanges?: (task: TaskSummary) => void;
  onClose: () => void;
  notify: (text: string) => void;
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState('');
  const [showAll, setShowAll] = useState(false);
  const groups = groupTasks(tasks, showAll);
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
  const content = (
    <div className="workflow-list">
      <div className="task-center-filters" role="group" aria-label={t('任务筛选')}>
        <button className="text-button" aria-pressed={!showAll} onClick={() => setShowAll(false)}>
          {t('活跃与待处理')}
        </button>
        <button className="text-button" aria-pressed={showAll} onClick={() => setShowAll(true)}>
          {t('显示全部')}
        </button>
      </div>
      {!groups.length && (
        <p className="muted">{t(showAll ? '暂无任务' : '暂无活跃或待处理任务')}</p>
      )}
      {groups.map((group) => (
        <div className="task-center-group" key={group.kind}>
          <h3>
            {t(group.label)} <span>{group.tasks.length}</span>
          </h3>
          {group.tasks.map((task) => (
            <section className="workflow-card" key={task.sessionId}>
              <button className="text-button" onClick={() => onOpen(task)}>
                {task.title || t('未命名会话')}
              </button>
              <small>{task.cwd}</small>
              <span>{t(deriveTaskStatus(task).label)}</span>
              {task.error && (
                <div className="inline-error">
                  <p>{notificationText(task.error)}</p>
                  {describeSystemError(task.error) && (
                    <details>
                      <summary>{t('原始错误详情')}</summary>
                      <pre>{task.error}</pre>
                    </details>
                  )}
                </div>
              )}
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
                    {item.interrupted && (
                      <>
                        <p className="muted">
                          {t('上次中断：继续队列会重新发送整条请求，可能重复已执行的操作。')}
                        </p>
                        {onInspectChanges && (
                          <button className="text-button" onClick={() => onInspectChanges(task)}>
                            {t('先查看已做的更改')}
                          </button>
                        )}
                      </>
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
      ))}
    </div>
  );
  return embedded ? (
    <section className="task-center-embedded" aria-label={t('任务中心')}>
      <p className="task-panel-hint">{t('切换会话不会停止任务。队列暂停后需手动继续。')}</p>
      {content}
    </section>
  ) : (
    <Modal
      title={t('任务中心')}
      subtitle={t('切换会话不会停止任务。队列暂停后需手动继续。')}
      onClose={onClose}
      wide
    >
      {content}
    </Modal>
  );
}
