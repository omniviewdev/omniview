// The measurement behind the planner (ruling R9): a column's natural width is read from a SAMPLE of its rows, never from all of them.
// The mock measures every cell of every row in a max-content probe; that cannot be computed at scale (104 to 291 ms for 60,000 strings in
// WebKit, against 8 ms for the whole plan). The sample is the first 100 rows, the last 100, the rows in view and, for each column, the
// rows that hold its longest strings (a pass over the text lengths, not a measurement: `longestIndexes`); the table measures it once per
// change of data or columns and only lets a width grow while the user scrolls (`mergeSamples`). Without the longest strings a rare long
// value (a path, an image reference, a selector) that sits in neither end of the table is missed: the long-tailed set of the table bench
// was fitted 27 to 37 px short on three of seven text columns. The table bench records how close the sample is to a full measure, on real
// rows and on that set.

/** Rows measured from the start of the table. */
export const SAMPLE_HEAD = 100;
/** Rows measured from the end of the table. */
export const SAMPLE_TAIL = 100;
/** For each run of text of a column (and for its kept ends), the rows that hold the longest distinct strings that are measured. */
export const SAMPLE_LONGEST = 16;

/** The faces a cell draws: its text, its small second line, and a monospaced value. */
export type FitFont = 'text' | 'small' | 'mono';

/** The width of a string in a face, in px. */
export type TextMeasurer = (text: string, font: FitFont) => number;

/** One run of text in a cell. A cell with two lines (a name over its group) has two runs. */
export type TextRun = { readonly text: string; readonly font?: FitFont | undefined };

/** A column to measure: how to read its text from a row, and how many trailing characters stay whole when it is cut. */
export type SampledColumn<TRow> = {
  readonly id: string;
  readonly text: (row: TRow) => string | readonly TextRun[];
  /** The number of trailing characters of the cell's first run that stay whole when the text is cut in the middle. */
  readonly tail?: ((row: TRow) => number) | undefined;
};

/** What the sample says about one column, in px. */
export type ColumnSample = {
  /** The widest run of any line in the sample. */
  readonly textWidth: number;
  /** The widest kept end in the sample: the part that tells siblings apart. */
  readonly tailWidth: number;
};

/** The row indexes to measure, each once, in ascending order: the head, the tail and the window of rows in view. */
export function sampleIndexes(count: number, visible?: { readonly first: number; readonly last: number }): number[] {
  if (count <= 0) {
    return [];
  }

  const wanted = new Set<number>();
  for (let index = 0; index < Math.min(count, SAMPLE_HEAD); index += 1) {
    wanted.add(index);
  }

  for (let index = Math.max(0, count - SAMPLE_TAIL); index < count; index += 1) {
    wanted.add(index);
  }

  if (visible !== undefined) {
    for (let index = Math.max(0, visible.first); index <= Math.min(count - 1, visible.last); index += 1) {
      wanted.add(index);
    }
  }

  return [...wanted].sort((a, b) => a - b);
}

/** A short list of the heaviest distinct texts seen so far, heaviest first, a tie going to the row that came first. */
type Ranking = Array<{ readonly weight: number; readonly index: number; readonly text: string }>;

function rank(list: Ranking, count: number, weight: number, index: number, text: () => string): void {
  const lightest = list.at(-1);
  if (list.length >= count && lightest !== undefined && weight <= lightest.weight) {
    return;
  }

  const wanted = text();
  if (list.some((entry) => entry.text === wanted)) {
    return;
  }

  const at = list.findIndex((entry) => weight > entry.weight);
  list.splice(at < 0 ? list.length : at, 0, { weight, index, text: wanted });
  if (list.length > count) {
    list.pop();
  }
}

/**
 * For each column, the rows that hold its longest strings: the `count` longest distinct values of each run of its cell (a name and the
 * line under it are ranked apart, as they are drawn in two faces) and the `count` longest kept ends, longest first. It reads the text
 * of every row once and measures nothing, so it costs a pass over the rows, not over the canvas: a rare long value is found wherever it
 * sits, and what is then measured is a bounded number of strings however many rows there are. A value that occurs in many rows takes one
 * place, so it does not push out the next longest.
 */
export function longestIndexes<TRow>(rows: readonly TRow[], columns: ReadonlyArray<SampledColumn<TRow>>, count: number = SAMPLE_LONGEST): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const column of columns) {
    const lists = new Map<string, Ranking>();
    const listOf = (key: string): Ranking => {
      let list = lists.get(key);
      if (list === undefined) {
        list = [];
        lists.set(key, list);
      }

      return list;
    };

    for (const [index, row] of rows.entries()) {
      const content = column.text(row);
      if (typeof content === 'string') {
        if (content !== '') {
          rank(listOf('0|text'), count, content.length, index, () => content);
        }
      } else {
        for (const [position, run] of content.entries()) {
          if (run.text !== '') {
            rank(listOf(`${position}|${run.font ?? 'text'}`), count, run.text.length, index, () => run.text);
          }
        }
      }

      const kept = column.tail?.(row) ?? 0;
      if (kept > 0) {
        const first = typeof content === 'string' ? content : (content[0]?.text ?? '');
        rank(listOf('kept'), count, kept, index, () => first.slice(-kept));
      }
    }

    const indexes = new Set<number>();
    for (const list of lists.values()) {
      for (const entry of list) {
        indexes.add(entry.index);
      }
    }

    result.set(column.id, [...indexes]);
  }

  return result;
}

/**
 * The widest text and kept end of each column over the rows at `indexes`, and over the rows `longest` names for that column. A string is
 * measured once however often it occurs.
 */
export function measureSample<TRow>(
  rows: readonly TRow[],
  indexes: readonly number[],
  columns: ReadonlyArray<SampledColumn<TRow>>,
  measure: TextMeasurer,
  longest?: ReadonlyMap<string, readonly number[]>,
): Map<string, ColumnSample> {
  const seen = new Map<string, number>();
  const width = (text: string, font: FitFont) => {
    const key = `${font}|${text}`;
    let measured = seen.get(key);
    if (measured === undefined) {
      measured = measure(text, font);
      seen.set(key, measured);
    }

    return measured;
  };

  const result = new Map<string, ColumnSample>();
  for (const column of columns) {
    let textWidth = 0;
    let tailWidth = 0;
    const read = (index: number) => {
      const row = rows[index];
      if (row === undefined) {
        return;
      }

      const content = column.text(row);
      const runs: readonly TextRun[] = typeof content === 'string' ? [{ text: content }] : content;
      for (const [position, run] of runs.entries()) {
        if (run.text === '') {
          continue;
        }

        const font = run.font ?? 'text';
        textWidth = Math.max(textWidth, width(run.text, font));
        const kept = position === 0 ? (column.tail?.(row) ?? 0) : 0;
        if (kept > 0) {
          tailWidth = Math.max(tailWidth, width(run.text.slice(-kept), font));
        }
      }
    };

    for (const index of indexes) {
      read(index);
    }

    for (const index of longest?.get(column.id) ?? []) {
      read(index);
    }

    result.set(column.id, { textWidth, tailWidth });
  }

  return result;
}

/** A width that was measured is only ever replaced by a larger one: a column does not shrink and grow while the user scrolls. */
export function mergeSamples(previous: ReadonlyMap<string, ColumnSample> | undefined, next: ReadonlyMap<string, ColumnSample>): Map<string, ColumnSample> {
  const merged = new Map<string, ColumnSample>();
  for (const [id, sample] of next) {
    const before = previous?.get(id);
    merged.set(
      id,
      before === undefined ? sample : { textWidth: Math.max(before.textWidth, sample.textWidth), tailWidth: Math.max(before.tailWidth, sample.tailWidth) },
    );
  }

  return merged;
}

/** The part of a canvas 2D context the measurer uses. */
export type MeasuringContext = {
  font: string;
  measureText: (text: string) => { readonly width: number };
};

/**
 * A measurer over a canvas context, with the CSS font of each face. Widths are rounded up to whole pixels (a column never gets one pixel
 * too few), and a width is remembered per face and string.
 */
export function createTextMeasurer(fonts: Readonly<Record<FitFont, string>>, context: MeasuringContext): TextMeasurer {
  const remembered: Record<FitFont, Map<string, number>> = { text: new Map(), small: new Map(), mono: new Map() };
  return (text, font) => {
    const cache = remembered[font];
    let width = cache.get(text);
    if (width === undefined) {
      if (context.font !== fonts[font]) {
        context.font = fonts[font];
      }

      width = Math.ceil(context.measureText(text).width);
      // A cache that is allowed to grow without bound is a leak; names repeat, so a few thousand entries is a long memory.
      if (cache.size >= 4096) {
        cache.clear();
      }

      cache.set(text, width);
    }

    return width;
  };
}
