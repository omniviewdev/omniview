// The logical line of a buffer row, with the cell of every character (#696 step 4). The matcher (`fileLinks.ts`) gives UTF-16 offsets into text and knows no cells: the emulator's widths are its own (xterm's Unicode 11 tables
// make `✅` two cells and an Arabic mark none), and a wrapped row has padding. This module reads the rows through the buffer and gives, for each UTF-16 offset of the text, the cell that holds it, so that a candidate is turned
// into a range by the buffer and never by a width table kept here. Pure: the buffer is any object with `getLine` (the emulator's `IBuffer` is one), and no `@xterm/*` is imported.

/** What of an emulator's row the walk reads. */
export type CellLine = { readonly isWrapped: boolean; readonly getCell: (x: number) => { readonly getWidth: () => number; readonly getChars: () => string } | undefined };
export type CellBuffer = { readonly getLine: (y: number) => CellLine | undefined };

/** The cell that holds a character: its row (0 is the oldest row of the scrollback), its column (0 is the first) and the characters of the cell. */
export type Cell = { readonly row: number; readonly x: number; readonly chars: string; /** The columns the cell takes: 2 for a wide character, 1 otherwise. */ readonly width: number };

export type LogicalLine = {
  /** The text of the wrapped rows joined, without the blanks that end the line. */
  readonly text: string;
  /** One entry for each UTF-16 offset of `text`: the cell that holds it (a base and its combining marks, a ZWJ cluster, all map to that cell). */
  readonly cells: readonly Cell[];
  /** The row the logical line starts on. */
  readonly first: number;
  /** The line is over `maxChars` characters (the walk stopped there: only its first characters are in `text`), or its first row is further up than `maxChars` could reach. There is no text then. */
  readonly tooLong: boolean;
};

const NOTHING: LogicalLine = { text: '', cells: [], first: 0, tooLong: true };

/**
 * The logical line that holds buffer row `y`: walks UP to the first row of the wrapped chain (a link provider is given any one row of it) and DOWN to its last, and gives the joined text. A width-0 cell is the second half of a
 * wide character and gives no text; the blank padding cell that a wide character leaves at the end of a row it did not fit on gives none either. The walk reads at most the rows `maxChars` characters can fill, up and down, so the
 * work does not grow with the line: a megabyte printed with no line break wraps over thousands of rows and a row in its middle is `tooLong` after a handful of reads.
 */
export function logicalLine(buffer: CellBuffer, cols: number, y: number, maxChars: number): LogicalLine {
  const reach = Math.ceil((maxChars + 1) / Math.max(1, cols)) + 1;
  let first = y;
  for (let up = 0; buffer.getLine(first)?.isWrapped === true; up += 1) {
    if (up >= reach) {
      return NOTHING;
    }

    first -= 1;
  }

  let text = '';
  const cells: Cell[] = [];
  for (let row = first; row < first + reach + 1; row += 1) {
    const line = buffer.getLine(row);
    if (line === undefined) {
      break;
    }

    const wrapsOn = buffer.getLine(row + 1)?.isWrapped === true;
    for (let x = 0; x < cols; x += 1) {
      const cell = line.getCell(x);
      if (cell?.getWidth() === 0) {
        continue;
      }

      const chars = cell?.getChars() ?? '';
      if (chars === '' && x === cols - 1 && wrapsOn) {
        continue;
      }

      const shown = chars === '' ? ' ' : chars;
      const at: Cell = { row, x, chars: shown, width: Math.max(1, cell?.getWidth() ?? 1) };
      cells.push(...Array.from({ length: shown.length }, () => at));

      text += shown;
    }

    if (!wrapsOn) {
      break;
    }
  }

  // The blanks that end the last row are the screen's, not the program's.
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 32) {
    end -= 1;
  }

  if (end > maxChars) {
    return { text: '', cells: [], first, tooLong: true };
  }

  return { text: text.slice(0, end), cells: cells.slice(0, end), first, tooLong: false };
}
