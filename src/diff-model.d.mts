export type DiffRow = {
  id: number;
  source: string;
  text: string;
  kind: 'meta' | 'hunk' | 'context' | 'add' | 'remove' | 'fold';
  before?: number;
  after?: number;
  count?: number;
};
export type SplitRow = { id: string; left?: DiffRow; right?: DiffRow; shared?: boolean };
export function parseDiff(raw: string): { raw: string; rows: DiffRow[] };
export function splitRows(rows: DiffRow[]): SplitRow[];
export function foldContext(rows: DiffRow[], radius?: number, expanded?: Set<number>): DiffRow[];
export function wordParts(
  before: string,
  after: string,
): { before: { text: string; changed: boolean }[]; after: { text: string; changed: boolean }[] };
