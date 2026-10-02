import type { TimelineRow } from './timeline.mjs';
import type { Checkpoint } from './types';

export interface TaskActivityOptions {
  rows: TimelineRow[];
  turnId?: string;
  startedAt?: string;
  waitingApproval?: boolean;
  pending?: boolean;
  cancelling?: boolean;
  background?: boolean;
  finishing?: boolean;
}
export type TaskActivityPhase =
  | 'cancelling'
  | 'waiting'
  | 'preparing'
  | 'reading'
  | 'editing'
  | 'searching'
  | 'verifying'
  | 'executing'
  | 'answering'
  | 'thinking'
  | 'background'
  | 'finalizing'
  | 'working';
// Finalization is reported by the owned runtime after inference stops.
export interface TaskOutcomeResult {
  facts?: import('./types').TaskTurnResult['facts'];
  turnId: string;
  startedAt?: string;
  finishedAt?: string;
  status: 'completed' | 'cancelled' | 'failed' | 'interrupted';
  stopReason?: string;
  error?: string;
  checkpointId?: string;
}
export interface TaskOutcomeSummary {
  status: TaskOutcomeResult['status'];
  toolCount: number;
  completedToolCount: number;
  failedToolCount: number;
  unfinishedToolCount: number;
  verification: {
    count: number;
    passed: number;
    failed: number;
    unknown: number;
    items: {
      id: string;
      command: string;
      exitCode: number | null;
      status: 'passed' | 'failed' | 'unknown';
    }[];
  };
  checkpoint: {
    ready: boolean;
    cwd: string;
    fileCount: number | null;
    visibleFiles: Checkpoint['files'];
    hiddenFileCount: number;
    createdCount: number | null;
    modifiedCount: number | null;
    deletedCount: number | null;
    skippedCount: number | null;
  };
}
export function deriveTaskActivity(options: TaskActivityOptions): {
  phase: TaskActivityPhase;
  toolCount: number;
  detail: string;
};
export function elapsedMilliseconds(startedAt?: string, end?: string | number): number | null;
export function formatElapsed(milliseconds: number): string;
export function buildTaskOutcome(
  result: TaskOutcomeResult,
  rows: TimelineRow[],
  checkpoint?: Checkpoint | null,
): TaskOutcomeSummary;
