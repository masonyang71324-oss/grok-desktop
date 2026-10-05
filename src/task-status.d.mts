import type { TaskSummary } from './types';

export interface TaskStatus {
  kind:
    | 'approval'
    | 'finishing'
    | 'running'
    | 'background'
    | 'waiting'
    | 'paused'
    | 'error'
    | 'interrupted'
    | 'stopped'
    | 'completed'
    | 'idle';
  label: string;
}
export interface SessionStatusChip {
  kind: TaskStatus['kind'] | 'queued' | 'draft';
  label: string;
  count?: number;
}
export function deriveTaskStatus(task?: TaskSummary): TaskStatus;
export function sessionStatusChips(task?: TaskSummary, hasDraft?: boolean): SessionStatusChip[];
export function groupTasks(
  tasks: TaskSummary[],
  showAll?: boolean,
): {
  kind: 'attention' | 'active' | 'history';
  label: string;
  tasks: TaskSummary[];
}[];
