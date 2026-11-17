// From what a column declares and what a sample of its rows measured to the numbers the planner takes. The floors are the mock's
// (13 T3, T4): a measure of TEXT, "after ALL the content around the text": 160 px of text for the identity column and 72 px for the other
// text columns, plus the leading offset (the cell inset, a tile, its gap) and the trailing inset; the compact floor is the same amounts
// without the leading offset. A fixed column's width is declared, not measured.
import type { FitInput, FitKind } from './planFit';
import type { ColumnSample, TextMeasurer } from './sample';

/** The cell inset on each side, in px. */
export const CELL_INSET = 10;
/** The inset at the outer edge of the first and the last column, in px. */
export const EDGE_INSET = 12;
/** What the sort button adds to a header: the gap and the 12 px arrow. */
export const SORT_AFFORDANCE = 4 + 12;
/** Text floors, in px of text: the identity column clips last, down to 160; the other text columns down to 72. */
export const FIT_FLOOR = { flex: 72, id: 160 } as const;
/** No column wants more than this, whatever its longest name (the mock's cap). */
export const FIT_CAP = 520;
/** The start of a cut value that stays beside its kept end and the ellipsis, in px. */
export const HEAD_MIN = 24;

/** What a column declares for the planner. */
export type FitColumnDeclaration = {
  readonly id: string;
  readonly kind: FitKind;
  /** The header text, one noun. */
  readonly header: string;
  readonly sortable: boolean;
  /** A utility column (selection): it leads the table and is pinned with the identity. */
  readonly utility?: boolean | undefined;
  /** `fixed`: the width of the cell in px. */
  readonly width?: number | undefined;
  /** A flexible column: what sits between the cell inset and the text (a tile and its gap), in px. */
  readonly lead?: number | undefined;
  /** A flexible column: what sits after the text beyond the cell inset (a copy button, a trailing chip), in px. */
  readonly trail?: number | undefined;
};

/** The planner's input for every column, in order. `samples` holds the measured text of the flexible columns, by column id. */
export function fitInputs(declared: readonly FitColumnDeclaration[], samples: ReadonlyMap<string, ColumnSample>, measure: TextMeasurer): FitInput[] {
  const last = declared.length - 1;
  const ellipsis = measure('\u2026', 'text');
  return declared.map((column, index) => {
    if (column.kind === 'fixed') {
      const width = column.width ?? 0;
      return { id: column.id, kind: column.kind, natural: width, min: width, read: width, full: width, utility: column.utility };
    }

    const insetStart = index === 0 ? EDGE_INSET : CELL_INSET;
    const insetEnd = index === last ? EDGE_INSET : CELL_INSET;
    const lead = insetStart + (column.lead ?? 0);
    const trail = insetEnd + (column.trail ?? 0);
    const sample = samples.get(column.id) ?? { textWidth: 0, tailWidth: 0 };
    const header = Math.ceil(measure(column.header, 'text')) + (column.sortable ? SORT_AFFORDANCE : 0) + insetStart + insetEnd;
    // A value cut in the middle keeps its end: the floor never takes less than the end, an ellipsis and the start of it.
    const kept = sample.tailWidth > 0 ? sample.tailWidth + ellipsis + HEAD_MIN : 0;
    const text = Math.max(FIT_FLOOR[column.kind], kept);
    const natural = Math.min(FIT_CAP, Math.max(header, lead + sample.textWidth + trail));
    const min = Math.min(natural, Math.max(text, header));
    const read = Math.max(min, Math.min(natural, Math.max(Math.ceil(lead + text + trail), header)));
    const full = Math.max(read, Math.ceil(lead + text + trail));
    return { id: column.id, kind: column.kind, natural, min, read, full, utility: column.utility };
  });
}
