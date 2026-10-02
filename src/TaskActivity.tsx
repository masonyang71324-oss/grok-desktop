import { memo, useEffect, useMemo, useState } from 'react';
import {
  Brain,
  FilePenLine,
  FileSearch,
  Hourglass,
  LoaderCircle,
  MessageSquare,
  Search,
  Terminal,
  TestTube2,
} from 'lucide-react';
import { useI18n } from './i18n';
import {
  deriveTaskActivity,
  elapsedMilliseconds,
  formatElapsed,
  type TaskActivityOptions,
  type TaskActivityPhase,
} from './task-presentation.mjs';
import './task-presentation.css';

export type TaskActivityProps = TaskActivityOptions;

const phaseLabels: Record<TaskActivityPhase, string> = {
  cancelling: '正在停止',
  waiting: '等待审批',
  preparing: '正在准备',
  finalizing: '正在整理结果',
  reading: '正在读取文件',
  editing: '正在修改文件',
  searching: '正在搜索',
  verifying: '正在验证',
  executing: '运行命令',
  answering: '正在回复',
  thinking: '正在思考',
  background: '后台运行中',
  working: '任务进行中',
};
const phaseIcons = {
  cancelling: LoaderCircle,
  waiting: Hourglass,
  preparing: LoaderCircle,
  finalizing: LoaderCircle,
  reading: FileSearch,
  editing: FilePenLine,
  searching: Search,
  verifying: TestTube2,
  executing: Terminal,
  answering: MessageSquare,
  thinking: Brain,
  background: LoaderCircle,
  working: LoaderCircle,
};

export const TaskActivity = memo(function TaskActivity(props: TaskActivityProps) {
  const { t } = useI18n();
  const { rows, turnId, startedAt, waitingApproval, pending, cancelling, background, finishing } =
    props;
  const activity = useMemo(
    () =>
      deriveTaskActivity({
        rows,
        turnId,
        waitingApproval,
        pending,
        cancelling,
        background,
        finishing,
      }),
    [rows, turnId, waitingApproval, pending, cancelling, background, finishing],
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!startedAt || !Number.isFinite(Date.parse(startedAt))) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, turnId]);
  const elapsed = elapsedMilliseconds(startedAt, now);
  const Icon = phaseIcons[activity.phase];
  const spinning = Icon === LoaderCircle;
  return (
    <section className={`task-activity task-activity-${activity.phase}`} aria-label={t('任务活动')}>
      <div className="task-activity-current" role="status" aria-live="polite" aria-atomic="true">
        <span className="task-activity-icon" aria-hidden="true">
          <Icon size={17} className={spinning ? 'task-activity-spin' : ''} />
        </span>
        <div className="task-activity-copy">
          <strong>{t(phaseLabels[activity.phase])}</strong>
          {activity.detail && (
            <span className="task-activity-detail" title={activity.detail}>
              {activity.detail}
            </span>
          )}
          {waitingApproval && !cancelling && (
            <span className="task-activity-detail">{t('请在审批面板中选择是否继续。')}</span>
          )}
        </div>
      </div>
      <div className="task-activity-meta">
        {background && activity.phase !== 'background' && <span>{t('后台')}</span>}
        {activity.toolCount > 0 && (
          <span>{t('{count} 次工具调用', { count: activity.toolCount })}</span>
        )}
        {elapsed !== null && (
          <span className="task-activity-timer">
            {t('已运行 {duration}', { duration: formatElapsed(elapsed) })}
          </span>
        )}
      </div>
    </section>
  );
});

export default TaskActivity;
