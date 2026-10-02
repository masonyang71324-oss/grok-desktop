import type { TimelineRow } from './timeline.mjs';
export type ConversationTarget = { kind: 'row'; rowId: string } | { kind: 'error' };
export interface ConversationHit {
  target: ConversationTarget;
  rowKind: TimelineRow['kind'] | 'error';
  offset: number;
  snippet: string;
}
export function searchConversation(
  rows: TimelineRow[],
  query: string,
  turnError?: string,
): ConversationHit[];
export function questionOutline(
  rows: TimelineRow[],
): { title: string; target: ConversationTarget }[];
