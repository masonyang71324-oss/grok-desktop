export type CellStyle = {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  background?: string;
  fontSize?: number;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
};
export type PreviewCell = {
  address: string;
  row: number;
  col: number;
  text: string;
  formula?: string;
  uncached?: boolean;
  format?: string;
  style: CellStyle;
};
export type PreviewSheet = {
  name: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  cells: PreviewCell[];
  merges: { startRow: number; startCol: number; endRow: number; endCol: number }[];
  columns: number[];
  rows: number[];
};
export type SlideRun = {
  text: string;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
};
export type SlideShape = {
  kind: 'text' | 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  src?: string;
  background?: string;
  paragraphs?: { align: 'left' | 'center' | 'right' | 'justify'; runs: SlideRun[] }[];
};
export type OfficePreviewModel = { readOnly: true; notices: string[] } & (
  | { kind: 'docx'; base64: string }
  | { kind: 'sheet'; sheets: PreviewSheet[]; truncated?: boolean }
  | {
      kind: 'pptx';
      width: number;
      height: number;
      slides: { shapes: SlideShape[]; background?: string }[];
    }
  | { kind: 'text'; text: string }
);
const extensions =
  /\.(?:docx|doc|docm|dot|dotx|xlsx|xls|xlsm|xlsb|ods|csv|tsv|pptx|ppt|pptm|pps|ppsx|pot|potx)$/i;
export function canPreviewOffice(path: string) {
  return extensions.test(path);
}
