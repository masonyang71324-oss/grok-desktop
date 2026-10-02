export interface ToolFactRow {
  kind: string;
  toolKind?: string;
  input?: string;
  rawOutput?: unknown;
  status?: string;
}
export interface TaskFacts {
  toolCount: number;
  completedToolCount: number;
  failedToolCount: number;
  unfinishedToolCount: number;
  verification: { count: number; passed: number; failed: number; unknown: number };
}
export function commandFromInput(input?: string): string;
export function commandParts(command: string): { parts: string[]; ambiguousExit: boolean };
export function isValidationCommand(command: string): boolean;
export function structuredExitCode(value: unknown): number | null;
export function collectToolFacts(rows: ToolFactRow[]): TaskFacts;
