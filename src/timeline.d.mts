import type { AcpUpdate } from './types';
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'diff'; path: string; oldText: string | null; newText: string };
export interface ToolLocation {
  path: string;
  line?: number;
}
export interface TimelineRow {
  id: string;
  kind: 'user' | 'assistant' | 'thought' | 'tool';
  text: string;
  turnId: string;
  streaming: boolean;
  toolCallId?: string;
  title?: string;
  status?: string;
  input?: string;
  toolContent?: ToolContent[];
  locations?: ToolLocation[];
  attachments?: { name: string; path: string }[];
}
export function contentText(value: any): string;
export function toolContent(value: any): ToolContent[];
export function appendUpdate(
  rows: TimelineRow[],
  update: AcpUpdate,
  turnId?: string,
): TimelineRow[];
export function finalizeTurn(rows: TimelineRow[], turnId: string, failed?: boolean): TimelineRow[];
export function fromReplay(updates: AcpUpdate[], sessionId: string): TimelineRow[];
export function createFrameBuffer<T>(
  deliver: (items: T[]) => void,
  schedule?: (fn: () => void) => number,
  cancel?: (id: number) => void,
): { push: (item: T) => void; flush: () => void; dispose: () => void };
