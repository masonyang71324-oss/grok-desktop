export interface AccountStatusUsage {
  plan: string | null;
  remainingPercent: number | null;
  fetchedAt: string | null;
}
export interface ContextStatusUsage {
  used: number | null;
  total: number | null;
  percent: number | null;
}
export interface UsageRead<T> {
  data: T | null;
  loading: boolean;
  error: string;
  updatedAt: number | null;
}
export interface UsageScope {
  contextWindow?: number;
  cwd?: string;
  sessionId?: string;
  revision?: number;
  connected?: boolean;
  active?: boolean;
  visible?: boolean;
}
export interface UsageStatusState {
  scope: Pick<UsageScope, 'cwd' | 'sessionId' | 'contextWindow'> | null;
  account: UsageRead<AccountStatusUsage>;
  context: UsageRead<ContextStatusUsage>;
}
export interface UsageStatusReader {
  update: (scope: UsageScope) => void;
  refresh: (force?: boolean) => void;
  dispose: () => void;
  getState: () => UsageStatusState;
}
export function accountUsage(value: unknown): AccountStatusUsage;
export function contextUsage(value: unknown): ContextStatusUsage;
export function emptyUsageState(): UsageStatusState;
export function createUsageStatusReader(
  request: (command: string, payload?: unknown) => Promise<unknown>,
  onChange: (state: UsageStatusState) => void,
  options?: {
    now?: () => number;
    setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  },
): UsageStatusReader;
