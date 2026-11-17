// Provenance: carried as an engine from omniviewdev/ui at 65bbefb, packages/base-ui/src/components/data-table/utils/createAdaptiveSortedRowModel.ts
// (last changed by 470b8f2, "Improve shared table rendering (#125)"). The body is unchanged; only this note and the file name are new.
// It imports nothing but @tanstack/react-table. Register: docs/ui-next/optimisations.md T-15 and MNR-T7.
import {
  createSortedRowModel,
  sortFn_alphanumeric,
  sortFn_text,
  tableMemo,
  type stockFeatures,
  type Row,
  type RowData,
  type RowModel,
  type Table,
  type TableFeatures,
} from '@tanstack/react-table';

interface SortKey {
  id: string;
  desc: boolean;
  fn: unknown;
  accessor: unknown;
  undefinedOrder: unknown;
  inverted: unknown;
}

const builtInSorts = new Set<unknown>([sortFn_alphanumeric, sortFn_text]);
type SortFeatures = Pick<typeof stockFeatures, 'rowSortingFeature' | 'rowPaginationFeature'>;

function immutableRows<TFeatures extends TableFeatures, TData extends RowData>(
  table: Table<TFeatures, TData>,
) {
  return (table.options.meta as { dataTableImmutableRows?: boolean } | undefined)
    ?.dataTableImmutableRows === true;
}

function sortKey<TData extends RowData>(
  sortable: Table<SortFeatures, TData>,
): SortKey | undefined {
  const sorting = sortable.atoms.sorting?.get();
  if (sorting?.length !== 1) return undefined;
  const entry = sorting[0]!;
  const column = sortable.getColumn(entry.id);
  if (!column?.getCanSort()) return undefined;
  const fn = column.getSortFn();
  if (!builtInSorts.has(fn)) return undefined;
  return {
    id: entry.id, desc: entry.desc, fn, accessor: column.accessorFn,
    undefinedOrder: column.columnDef.sortUndefined, inverted: column.columnDef.invertSorting,
  };
}

function sameSortKey(a: SortKey | undefined, b: SortKey | undefined): a is SortKey {
  return !!a && !!b && a.id === b.id && a.desc === b.desc && a.fn === b.fn &&
    a.accessor === b.accessor && a.undefinedOrder === b.undefinedOrder && a.inverted === b.inverted;
}

function compareKeys<TFeatures extends TableFeatures, TData extends RowData>(
  previous: RowModel<TFeatures, TData>,
  next: RowModel<TFeatures, TData>,
  key: SortKey,
): 'same' | 'changed' | 'structure' {
  if (previous.rows.length !== next.rows.length || next.rows.length !== next.flatRows.length) return 'structure';
  for (let index = 0; index < next.rows.length; index++) {
    const before = previous.rows[index]!;
    const after = next.rows[index]!;
    // Source positions preserve the upstream tie-breaker. Hierarchical models use the full sorter.
    if (before.id !== after.id || before.index !== after.index || before.depth !== 0 ||
      after.depth !== 0 || before.subRows.length || after.subRows.length) return 'structure';
    if (before.original === after.original) continue;
    const oldValue = before.getValue(key.id);
    const value = after.getValue(key.id);
    const type = typeof value;
    if ((value !== null && type === 'object') || type === 'function' || type === 'symbol') return 'changed';
    if (!Object.is(oldValue, value)) return 'changed';
  }
  return 'same';
}

/**
 * Start each sort from the previous order, using only the new model's rows. Native adaptive sorts
 * then handle sparse immutable patches in near-linear work instead of sorting shuffled source
 * order again. TanStack still owns comparison, stable ties, grouping and pagination resets.
 *
 * Set meta.dataTableImmutableRows only when row originals are immutable and accessors are pure.
 * Eligible flat, single-column built-in text sorts can retain their order after nonsort patches.
 * Every returned row still comes from the current model. A detected sort-value mismatch or an
 * unsupported sort ends this extra reuse path for the table instance, avoiding repeated checks.
 */
export function createAdaptiveSortedRowModel<TFeatures extends TableFeatures, TData extends RowData>() {
  const createSorted = createSortedRowModel<TFeatures, TData>();
  return (table: Table<TFeatures, TData>) => {
    // The factory belongs to rowSortingFeature; pagination remains optional at runtime.
    const sortable = table as unknown as Table<SortFeatures, TData>;
    const reuseImmutableRows = immutableRows(table);
    let order: string[] | undefined;
    let input: RowModel<TFeatures, TData> | undefined;
    let prepared: RowModel<TFeatures, TData> | undefined;
    let previousResult: RowModel<TFeatures, TData> | undefined;
    let uniqueOrder = false;

    // Inherit live options and atoms; do not copy a table's current-value getters or mutate it.
    const sortingView = Object.create(table, {
      getPreSortedRowModel: {
        value: () => {
          const next = table.getPreSortedRowModel();
          if (next === input) return prepared!;
          input = next;
          if (!order || next.rows.length < 2) {
            uniqueOrder = false;
            return (prepared = next);
          }
          if (order.length === next.rows.length) {
            let sameOrder = true;
            for (let index = 0; index < order.length; index++) {
              if (order[index] !== next.rows[index]!.id) { sameOrder = false; break; }
            }
            if (sameOrder) {
              if (reuseImmutableRows && !uniqueOrder) {
                uniqueOrder = true;
                for (const row of next.rows) {
                  if (next.rowsById[row.id] !== row) { uniqueOrder = false; break; }
                }
              }
              return (prepared = next);
            }
          }

          const remaining = new Map<string, Row<TFeatures, TData>>();
          for (const row of next.rows) remaining.set(row.id, row);
          // A seed must be a complete permutation, even when a caller supplies colliding IDs.
          uniqueOrder = remaining.size === next.rows.length;
          if (!uniqueOrder) return (prepared = next);
          const rows = new Array<Row<TFeatures, TData>>(next.rows.length);
          let index = 0;
          let changed = false;
          for (const id of order) {
            const row = remaining.get(id);
            if (!row) continue;
            if (row !== next.rows[index]) changed = true;
            rows[index++] = row;
            remaining.delete(id);
          }
          for (const row of remaining.values()) {
            if (row !== next.rows[index]) changed = true;
            rows[index++] = row;
          }
          return (prepared = changed ? { ...next, rows } : next);
        },
      },
    }) as Table<TFeatures, TData>;
    const getSorted = createSorted(sortingView);
    const readSorted = () => {
      const result = getSorted();
      if (result !== previousResult) {
        previousResult = result;
        // An upstream early return means sorting is absent or unavailable. Restore source order.
        order = result === prepared ? undefined : result.rows.map((row) => row.id);
      }
      return result === prepared && input ? input : result;
    };
    if (!reuseImmutableRows) return readSorted;

    let previousKey: SortKey | undefined;
    let reusedOrder = false;
    let readCurrent = readSorted;
    // Use the engine's memo/reset scheduler, including its pagination policy.
    readCurrent = tableMemo({
      feature: 'rowSortingFeature',
      table,
      fnName: 'table.getAdaptiveSortedRowModel',
      memoDeps: () => [table.getPreSortedRowModel(), sortable.atoms.sorting?.get(), immutableRows(table)],
      fn: () => {
        reusedOrder = false;
        const next = table.getPreSortedRowModel();
        const key = immutableRows(table) ? sortKey(sortable) : undefined;
        const comparison = uniqueOrder && order && input && next !== input &&
          sameSortKey(previousKey, key) ? compareKeys(input, next, previousKey) : undefined;
        if (comparison === 'same' && order) {
          const rows = order.map((id) => next.rowsById[id]!);
          input = next;
          prepared = { ...next, rows, flatRows: rows };
          previousResult = prepared;
          previousKey = key;
          reusedOrder = true;
          return prepared;
        }
        // Stop checking stability after a sort value changes; release the extra memo's snapshots.
        if (comparison === 'changed' || (next.rows.length > 0 &&
          (!key || next.rows.length !== next.flatRows.length))) readCurrent = readSorted;
        const result = readSorted();
        previousKey = key;
        return result;
      },
      onAfterUpdate: () => {
        if (reusedOrder) sortable.autoResetPageIndex?.();
      },
    });
    return () => readCurrent();
  };
}
