import { rowSortingFeature, sortFn_alphanumeric, sortFn_basic, tableFeatures, useTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { useMemo } from 'react';
import { createAdaptiveSortedRowModel } from '../../table/adaptiveSortedRowModel';
import type { DataTableColumn, DataTableSort } from './types';

// The table registers only what a list uses (register T-16): sorting, with the adaptive sorted model. Selection, column visibility, widths,
// pinning and filtering are not TanStack's here: the caller owns selection and what is shown, the planner owns widths, and a filter is a
// function of the rows before they reach the table. An unused feature is a row model that never runs and a slice of state that is never
// compared.
const features = tableFeatures({ rowSortingFeature, sortedRowModel: createAdaptiveSortedRowModel() });

// TanStack wants rows to be objects; the kit takes any row type and holds TanStack to the two members it reads back.
type Data = Record<string, unknown>;

/** A row of the sorted order: the caller's row and its key. */
export type SortedRow<TRow> = { readonly id: string; readonly original: TRow };

function columnDef<TRow>(column: DataTableColumn<TRow>, sortKey: NonNullable<DataTableColumn<TRow>['sortKey']>): ColumnDef<typeof features, Data> {
  return {
    id: column.id,
    accessorFn: (row) => sortKey(row as TRow),
    // Text in natural order, so item-2 comes before item-10; numbers as numbers.
    sortFn: column.sortKind === 'number' ? sortFn_basic : sortFn_alphanumeric,
    // A missing value is last in either direction (design 13 D7).
    sortUndefined: 'last',
  };
}

/**
 * The rows in the order of the sort, as TanStack's row model gives them, with the adaptive sorted model underneath: it starts each sort from
 * the previous order, so a sparse update of rows that are replaced rather than changed costs near-linear work (T-15).
 */
export function useRowModel<TRow>({
  rows,
  getRowKey,
  columns,
  sort,
  rowsAreImmutable,
}: {
  readonly rows: readonly TRow[];
  readonly getRowKey: (row: TRow) => string;
  readonly columns: ReadonlyArray<DataTableColumn<TRow>>;
  readonly sort: DataTableSort | undefined;
  readonly rowsAreImmutable: boolean;
}): ReadonlyArray<SortedRow<TRow>> {
  const definitions = useMemo(() => columns.flatMap((column) => (column.sortKey === undefined ? [] : [columnDef(column, column.sortKey)])), [columns]);
  const column = sort?.column;
  const descending = sort?.direction === 'descending';
  const sorting = useMemo<SortingState>(() => (column === undefined ? [] : [{ id: column, desc: descending }]), [column, descending]);
  const meta = useMemo(() => ({ dataTableImmutableRows: rowsAreImmutable }), [rowsAreImmutable]);
  // TanStack types its data as a mutable array of objects and never writes to it.
  const table = useTable({ features, columns: definitions, data: rows as unknown as Data[], getRowId: (row) => getRowKey(row as TRow), state: { sorting }, meta });
  return table.getRowModel().rows as unknown as ReadonlyArray<SortedRow<TRow>>;
}
