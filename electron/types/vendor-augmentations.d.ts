import 'jszip';
import 'xlsx';
import '@kenjiuno/decompressrtf';

// Runtime APIs used by the pinned libraries but omitted from their published declarations.
declare module 'jszip' {
  interface JSZipObject {
    internalStream(type: 'nodebuffer'): JSZipStreamHelper<Buffer>;
  }
}
declare module 'xlsx' {
  interface SheetProps {
    id?: string;
  }
}
declare module '@kenjiuno/decompressrtf' {
  // 0.1.4 reads length/indexes and uses slice; its uncompressed branch preserves Uint8Array.
  export function decompressRTF(inputArray: Uint8Array): number[] | Uint8Array;
}
