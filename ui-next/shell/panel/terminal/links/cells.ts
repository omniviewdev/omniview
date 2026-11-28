// The logical line of a buffer row, with the cell of every character (#696 step 4). Stub: filled in with the provider.

export type CellLine = { readonly isWrapped: boolean; readonly getCell: (x: number) => { readonly getWidth: () => number; readonly getChars: () => string } | undefined };
export type CellBuffer = { readonly getLine: (y: number) => CellLine | undefined };
export type Cell = { readonly row: number; readonly x: number; readonly chars: string };
export type LogicalLine = { readonly text: string; readonly cells: readonly Cell[]; readonly first: number; readonly tooLong: boolean };

export function logicalLine(_buffer: CellBuffer, _cols: number, _y: number, _maxChars: number): LogicalLine {
  return { text: '', cells: [], first: 0, tooLong: false };
}
