import type { MouseEvent, ReactNode } from 'react';
import type { DataAttributes } from '../../shared/dataAttributes';
import type { TextRun } from '../TableFit/sample';

export type { TextRun } from '../TableFit/sample';

/**
 * How a column takes width (design 13 T6). `fixed` keeps the width it declares and never moves; `flex` is a text column: it clips down to
 * 72 px of text and shares what is left; `id` is the identity column, the one that names the row: it clips last, down to 160 px of text,
 * and stays in view when the table scrolls sideways.
 */
export type DataTableFit = 'fixed' | 'flex' | 'id';

/** Numbers and other comparable values align to the end (13 A1); text to the start. */
export type DataTableAlign = 'start' | 'end';

/** How a column's sort key compares: text in natural order (`item-2` before `item-10`), or numbers. */
export type DataTableSortKind = 'text' | 'number';

export type DataTableDirection = 'ascending' | 'descending';

/** The column the rows are in the order of, and which way. No sort is the order the rows were given in. */
export type DataTableSort = {
  readonly column: string;
  readonly direction: DataTableDirection;
};

/** One column of a table of `TRow`. A list of columns keeps its identity across renders: build it once, or memoize it. */
export type DataTableColumn<TRow> = {
  /** Names the column in the sort state; unique in the table. */
  readonly id: string;
  /** One noun or short noun phrase (13 H1). It is also the accessible name of the column. */
  readonly header: string;
  readonly fit: DataTableFit;
  /** The width of a `fixed` column's cell in px, its padding included: the mock's fitted widths (a ready count 59, a status 157). */
  readonly width?: number | undefined;
  readonly align?: DataTableAlign | undefined;
  /** A `flex` or `id` column: what sits before the text beyond the cell inset (a tile and its gap), in px. */
  readonly lead?: number | undefined;
  /** A `flex` or `id` column: what sits after the text beyond the cell inset (a trailing chip), in px. */
  readonly trail?: number | undefined;
  /** What the cell shows for a row. It must be a function of the row alone: a cell renders again only when its row changes. */
  readonly cell: (row: TRow) => ReactNode;
  /** The value the column sorts by. A column without one cannot be sorted. A missing value (`undefined`) is last in either direction. */
  readonly sortKey?: ((row: TRow) => string | number | undefined) | undefined;
  readonly sortKind?: DataTableSortKind | undefined;
  /** A `flex` or `id` column: the text the cell shows, for the sampled measurement of the column's natural width. */
  readonly text?: ((row: TRow) => string | readonly TextRun[]) | undefined;
  /** A `flex` or `id` column whose text is cut in the middle: how many trailing characters stay whole (the part that tells siblings apart). */
  readonly keepEnd?: ((row: TRow) => number) | undefined;
};

/** The leading selection column: one checkbox a row, named for its row. The caller owns what is selected. */
export type DataTableSelection<TRow> = {
  /** The keys (`getRowKey`) of the selected rows. */
  readonly selected: ReadonlySet<string>;
  /** A row's checkbox was used. */
  readonly onToggle: (row: TRow) => void;
  /** The accessible name of a row's checkbox: "Select" and the row's name. */
  readonly label: (row: TRow) => string;
  /** The checkbox of the header, when the table has a select-all. Without it the header cell stays empty (no invented select-all). */
  readonly all?:
    | {
      readonly state: boolean | 'mixed';
      readonly label: string;
      readonly onToggle: () => void;
    }
    | undefined;
};

export type DataTableProps<TRow> = {
  /** Names the scroll region: the table's own name ("Items"). */
  readonly label: string;
  readonly rows: readonly TRow[];
  /** The identity of a row: stable across updates, never a field a person edits. */
  readonly getRowKey: (row: TRow) => string;
  readonly columns: ReadonlyArray<DataTableColumn<TRow>>;
  /** Two-line rows (an identity with a line under it) are 40 px; one-line rows 24 px. Compact density takes 2 px off each. */
  readonly lines?: 1 | 2 | undefined;
  /** The sort in force. Sortable columns show a button in their header when `onSortChange` is given. */
  readonly sort?: DataTableSort | undefined;
  readonly onSortChange?: ((sort: DataTableSort) => void) | undefined;
  readonly selection?: DataTableSelection<TRow> | undefined;
  /** A plain click on a row. Controls inside the row keep their own clicks. Rows are not Tab stops: expose the same action in a control. */
  readonly onRowActivate?: ((row: TRow, event: MouseEvent<HTMLElement>) => void) | undefined;
  /**
   * The caller never changes a row object after giving it: a changed row is a new object and an unchanged row keeps its identity, and sort
   * keys are pure. Then a sparse update costs near-linear sorting work instead of a full sort (about 10 times fewer comparisons).
   */
  readonly rowsAreImmutable?: boolean | undefined;
  /** The height at which the region starts to scroll, in px. Without it the region fills what its parent gives it (a data view's body). */
  readonly maxHeight?: number | undefined;
} & DataAttributes;
