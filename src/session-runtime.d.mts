import type { Command, SessionSnapshot, TaskRuntime, TaskSummary } from './types';
export function isWorkflowControl(options: {
  runtime?: TaskRuntime;
  text: string;
  attachments?: unknown[];
  commands?: Command[];
}): boolean;
export function deriveSessionRuntime(options: {
  session: Pick<SessionSnapshot, 'sessionId' | 'runtime'> | null;
  tasks?: TaskSummary[];
  pending?: boolean;
}): {
  runtime: TaskRuntime | undefined;
  busy: boolean;
  cancelling: boolean;
  canStop: boolean;
  canQueue: boolean;
};
export function createReconnectBudget(): {
  disconnected(key: string, event: { state: string; action: string }): void;
  take(key: string, options?: { enabled?: boolean; blocked?: boolean; trusted?: boolean }): boolean;
  rearm(key: string): void;
};
