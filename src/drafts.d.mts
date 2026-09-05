import type { Attachment, SessionSummary } from './types';
export type Draft = { text: string; attachments: Attachment[] };
export function sameDraft(left: Draft, right: Draft): boolean;
export function createDraftStore(
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
  onError?: () => void,
): {
  read(cwd: string, sessionId?: string): Draft;
  flush(): void;
  save(cwd: string, sessionId: string | undefined, draft: Draft, deferred?: boolean): void;
  selected(cwd: string): string;
  remember(cwd: string, sessionId: string, title?: string): void;
  merge(cwd: string, sessions: SessionSummary[]): SessionSummary[];
  select(cwd: string, sessionId?: string): void;
  remove(cwd: string, sessionId: string): void;
};
