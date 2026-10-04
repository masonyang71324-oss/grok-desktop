import { memo, useId, useMemo } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  CircleStop,
  FileDiff,
  FolderOpen,
  RotateCcw,
} from 'lucide-react';
import { useI18n } from './i18n';
import {
  buildTaskOutcome,
  elapsedMilliseconds,
  formatElapsed,
  type TaskOutcomeResult,
} from './task-presentation.mjs';
import type { TimelineRow } from './timeline.mjs';
import type { Checkpoint } from './types';
import './task-presentation.css';

export type { TaskOutcomeResult } from './task-presentation.mjs';
export interface TaskOutcomeProps {
  result: TaskOutcomeResult;
  rows: TimelineRow[];
  checkpoint?: Checkpoint | null;
  loading?: boolean;
  onReview: () => void;
  onRestore: () => void;
  onOpenFile: (path: string) => void;
}

const statusLabels = {
  completed: '任务已完成',
  cancelled: '任务已停止',
  failed: '任务未完成',
  interrupted: '任务已中断',
};
const fileLabels: Record<string, string> = { created: '新建', modified: '修改', deleted: '删除' };
const verificationLabels = { passed: '已通过', failed: '未通过', unknown: '未确认结果' };

export const TaskOutcome = memo(function TaskOutcome({
  result,
  rows,
  checkpoint,
  loading = false,
  onReview,
  onRestore,
  onOpenFile,
}: TaskOutcomeProps) {
  const { t } = useI18n();
  const headingId = useId();
  const outcome = useMemo(
    () => buildTaskOutcome(result, rows, checkpoint),
    [result, rows, checkpoint],
  );
  const recorded = outcome.checkpoint;
  const canReview = recorded.ready && (recorded.fileCount ?? 0) > 0 && !loading;
  const elapsed = result.finishedAt
    ? elapsedMilliseconds(result.startedAt, result.finishedAt)
    : null;
  const Icon =
    result.status === 'completed'
      ? CheckCircle2
      : result.status === 'cancelled'
        ? CircleStop
        : CircleAlert;
  return (
    <section className={`task-outcome task-outcome-${result.status}`} aria-labelledby={headingId}>
      <div className="task-outcome-heading">
        <Icon size={19} aria-hidden="true" />
        <h3 id={headingId}>{t(statusLabels[result.status])}</h3>
        {elapsed !== null && (
          <span className="task-outcome-duration">
            {t('耗时 {duration}', { duration: formatElapsed(elapsed) })}
          </span>
        )}
      </div>
      {result.error && <p className="task-outcome-error">{result.error}</p>}
      {!result.error && result.status !== 'completed' && result.stopReason && (
        <p className="task-outcome-note">
          {t('结束原因：{reason}', { reason: result.stopReason })}
        </p>
      )}
      <div className="task-outcome-summary">
        <div className="task-outcome-summary-row">
          <span>
            {loading
              ? t('正在读取变更记录…')
              : recorded.fileCount === null
                ? t('文件变更未确认')
                : t('检查点：{count} 个文本文件变更', { count: recorded.fileCount })}
          </span>
          {outcome.toolCount > 0 && (
            <span>{t('工具 {count} 次', { count: outcome.toolCount })}</span>
          )}
          {outcome.failedToolCount > 0 && (
            <span className="task-outcome-error">
              {t('{count} 次工具失败', { count: outcome.failedToolCount })}
            </span>
          )}
          {outcome.unfinishedToolCount > 0 && (
            <span>{t('{count} 次工具未确认完成', { count: outcome.unfinishedToolCount })}</span>
          )}
        </div>
        <div className="task-outcome-summary-row">
          {outcome.verification.count ? (
            <>
              <span>{t('验证 {count} 条', { count: outcome.verification.count })}</span>
              {outcome.verification.passed > 0 && (
                <span className="task-outcome-summary-passed">
                  {t('{count} 通过', { count: outcome.verification.passed })}
                </span>
              )}
              {outcome.verification.failed > 0 && (
                <span className="task-outcome-error">
                  {t('{count} 未通过', { count: outcome.verification.failed })}
                </span>
              )}
              {outcome.verification.unknown > 0 && (
                <span>{t('{count} 未确认', { count: outcome.verification.unknown })}</span>
              )}
            </>
          ) : (
            <span>{t('验证结果未记录')}</span>
          )}
        </div>
      </div>
      {result.checkpointSkipped ? (
        <p className="task-outcome-note" role="status">
          {t('本轮未创建检查点，无法恢复本轮文件。')}
        </p>
      ) : (recorded.skippedCount ?? 0) > 0 ? (
        <p className="task-outcome-note" role="status">
          {t('检查点不完整，无法完整恢复本轮文件。')}
        </p>
      ) : null}
      {recorded.fileCount === 0 && (
        <p className="task-outcome-note">{t('未记录到可恢复变更，不代表本轮没有文件变化。')}</p>
      )}
      <details className="task-outcome-details">
        <summary>{t('变更与验证明细')}</summary>
        {result.status !== 'completed' && (
          <p className="task-outcome-note">{t('已保留本轮记录，可查看现有变更后继续。')}</p>
        )}
        <div className="task-outcome-section">
          <h4>{t('本轮文件变更')}</h4>
          {loading ? (
            <p className="task-outcome-note">{t('正在读取本轮文件变更…')}</p>
          ) : recorded.fileCount === null ? (
            <p className="task-outcome-note">{t('本轮文件变更记录尚不可用。')}</p>
          ) : (
            <>
              <p className="task-outcome-file-count">
                {t('检查点内记录 {count} 个文件变更', { count: recorded.fileCount })}
              </p>
              {recorded.fileCount > 0 && (
                <div className="task-outcome-file-counts">
                  {!!recorded.createdCount && (
                    <span>{t('新建 {count}', { count: recorded.createdCount })}</span>
                  )}
                  {!!recorded.modifiedCount && (
                    <span>{t('修改 {count}', { count: recorded.modifiedCount })}</span>
                  )}
                  {!!recorded.deletedCount && (
                    <span>{t('删除 {count}', { count: recorded.deletedCount })}</span>
                  )}
                </div>
              )}
              {recorded.cwd && (
                <div className="task-outcome-location" title={recorded.cwd}>
                  <FolderOpen size={14} aria-hidden="true" />
                  <span>{t('文件位置')}</span>
                  <code>{recorded.cwd}</code>
                </div>
              )}
              {recorded.visibleFiles.length > 0 && (
                <ul className="task-outcome-files">
                  {recorded.visibleFiles.map((file) => (
                    <li
                      key={file.path}
                      className={`task-outcome-file task-outcome-file-${file.status}`}
                    >
                      <span className="task-outcome-file-status">
                        {t(fileLabels[file.status] || file.status)}
                      </span>
                      {file.status === 'deleted' ? (
                        <span className="task-outcome-deleted-path" title={file.path}>
                          {file.path}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="task-outcome-file-open"
                          title={file.path}
                          aria-label={file.path}
                          onClick={() => onOpenFile(file.path)}
                        >
                          <span>{file.path}</span>
                          <ArrowUpRight size={13} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {recorded.hiddenFileCount > 0 && (
                <p className="task-outcome-note">
                  {t('还有 {count} 个文件，可在查看变更中展开。', {
                    count: recorded.hiddenFileCount,
                  })}
                </p>
              )}
              {(recorded.skippedCount ?? 0) > 0 && (
                <p className="task-outcome-note">
                  {t('另有 {count} 项未纳入检查点。', { count: recorded.skippedCount! })}
                </p>
              )}
              <p className="task-outcome-note">
                {t('这些数量仅包含检查点记录的可恢复文本文件。其他文件可在文件面板查看。')}
              </p>
            </>
          )}
        </div>
        <div className="task-outcome-section">
          <h4>{t('验证记录')}</h4>
          {!outcome.verification.count ? (
            <p className="task-outcome-note">{t('未检测到可识别的验证命令。')}</p>
          ) : (
            <>
              <div className="task-outcome-validation-counts">
                <span>{t('{count} 条验证命令', { count: outcome.verification.count })}</span>
                {outcome.verification.passed > 0 && (
                  <span>{t('通过 {count}', { count: outcome.verification.passed })}</span>
                )}
                {outcome.verification.failed > 0 && (
                  <span className="task-outcome-error">
                    {t('未通过 {count}', { count: outcome.verification.failed })}
                  </span>
                )}
                {outcome.verification.unknown > 0 && (
                  <span>{t('未确认 {count}', { count: outcome.verification.unknown })}</span>
                )}
              </div>
              <ul className="task-outcome-verifications">
                {outcome.verification.items.slice(0, 4).map((item) => (
                  <li
                    key={item.id}
                    className={`task-outcome-verification task-outcome-verification-${item.status}`}
                  >
                    <span className="task-outcome-verification-status">
                      {t(verificationLabels[item.status])}
                    </span>
                    <code title={item.command}>{item.command}</code>
                    {item.exitCode !== null && (
                      <span className="task-outcome-exit">
                        {t('退出码 {code}', { code: item.exitCode })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {outcome.verification.count > 4 && (
                <p className="task-outcome-note">
                  {t('还有 {count} 条验证命令，详情见任务记录。', {
                    count: outcome.verification.count - 4,
                  })}
                </p>
              )}
              <p className="task-outcome-note">
                {t('仅依据命令退出码判断；未返回退出码时不确认结果。')}
              </p>
            </>
          )}
        </div>
      </details>
      <div className="task-outcome-actions">
        <button type="button" className="secondary-button" disabled={!canReview} onClick={onReview}>
          <FileDiff size={15} aria-hidden="true" />
          {t('查看变更')}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={!canReview}
          onClick={onRestore}
        >
          <RotateCcw size={15} aria-hidden="true" />
          {t('恢复本轮文件')}
        </button>
      </div>
    </section>
  );
});

export default TaskOutcome;
