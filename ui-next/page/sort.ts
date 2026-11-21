import type { DataTableColumn, DataTableSort } from '@omniviewdev/kit';

// The sort of a list (K3a). The page holds the sort in force and hands it to the kit's table, which sorts by the keys the columns declare (a stable sort: a tie keeps the order the rows were given in, a row with no key is
// last in either direction). What the page decides is which sort that is: what the person chose, else what the definition says it opens in, and only ever a column that sorts. These are those decisions, pure, and
// the form in which the choice is kept for the host to give back (`PageMemory`): plain data, written only by `keepSort` and read only by `keptSort`, which trusts nothing it reads.

/** Whether `column` names a column of the table that sorts: one that declares a sort key. A column with none has no sort button, and a name that is no column is none. */
export function sortsBy<TRow>(columns: ReadonlyArray<DataTableColumn<TRow>>, column: string): boolean {
  return columns.some((candidate) => candidate.id === column && candidate.sortKey !== undefined);
}

/**
 * The sort in force: the person's choice while it names a column that sorts, else the definition's default while it does, else none, which is the source's own order. A choice or a default that names a
 * column that does not sort is skipped and not an error: a plugin that came back with other columns, or one that wrote a default for a column it has not given a key yet, is drawn as a list was drawn before.
 * The sort it gives back is the one it was given, so a caller that compares sorts by identity sees no change.
 */
export function sortInForce<TRow>(columns: ReadonlyArray<DataTableColumn<TRow>>, chosen: DataTableSort | undefined, fallback: DataTableSort | undefined): DataTableSort | undefined {
  if (chosen !== undefined && sortsBy(columns, chosen.column)) {
    return chosen;
  }

  return fallback !== undefined && sortsBy(columns, fallback.column) ? fallback : undefined;
}

/** The sort the person chose, read back from what the host held for the page: nothing unless it is a column and a direction, of a column that sorts now. */
export function keptSort<TRow>(columns: ReadonlyArray<DataTableColumn<TRow>>, kept: unknown): DataTableSort | undefined {
  const sort = typeof kept === 'object' && kept !== null && 'sort' in kept ? kept.sort : undefined;
  if (typeof sort !== 'object' || sort === null || !('column' in sort) || !('direction' in sort)) {
    return undefined;
  }

  const { column, direction } = sort;
  return typeof column === 'string' && (direction === 'ascending' || direction === 'descending') && sortsBy(columns, column) ? { column, direction } : undefined;
}

/** What the page writes once the person chose `sort`: what the host held, with the sort set in it, so that whatever else the host keeps for the tab stays. A value that is no record is started again. */
export function keepSort(kept: unknown, sort: DataTableSort): unknown {
  const others = typeof kept === 'object' && kept !== null && !Array.isArray(kept) ? kept : {};
  return { ...others, sort: { column: sort.column, direction: sort.direction } };
}
