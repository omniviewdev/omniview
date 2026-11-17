// Provenance: carried from omniviewdev/ui at 65bbefb, packages/base-ui/src/components/data-table/utils/createAdaptiveSortedRowModel.test.ts
// (the twelve tests, unchanged but for the import). The counts the register asks for (MNR-T7) are in adaptiveSortedRowModel.counts.test.ts.
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion -- carried as it was: the kit compiles with noUncheckedIndexedAccess, the lint project (tsconfig.app.json) does not, so the assertions on indexed access are needed by tsc and look unneeded to the rule */
import {
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createAdaptiveSortedRowModel } from './adaptiveSortedRowModel';

type Item = { id: string; name: string; score: number; children?: Item[] };
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createAdaptiveSortedRowModel(),
});
const columns: Array<ColumnDef<typeof features, Item>> = [
  { accessorKey: 'name', sortFn: sortFn_alphanumeric },
  { accessorKey: 'score', sortFn: (a, b) => a.original.score - b.original.score },
];
const source: Item[] = [
  { id: 'a', name: 'item-10', score: 1 },
  { id: 'b', name: 'item-2', score: 1 },
  { id: 'c', name: 'item-1', score: 2 },
];
const IMMUTABLE_META = { dataTableImmutableRows: true };
function make(data = source, sorting: SortingState = [{ id: 'name', desc: false }],
  immutable = false, definitions = columns) {
  const { result, rerender } = renderHook(
    ({ data, enabled }) => useTable({
      features, columns: definitions, data, getRowId: (row) => row.id,
      ...(immutable ? { meta: IMMUTABLE_META } : {}),
      enableSorting: enabled, initialState: { sorting },
    }),
    { initialProps: { data, enabled: true } },
  );
  return {
    model: () => result.current.getRowModel(),
    setData: (data: Item[], enabled = true) => {
      rerender({ data, enabled }); 
    },
    setSorting: (sorting: SortingState) => {
      act(() => {
        result.current.setSorting(sorting); 
      }); 
    },
  };
}

const ids = (table: ReturnType<typeof make>) => table.model().rows.map((row) => row.id);

describe.each([false, true])('adaptive sorted input (immutable=%s)', (immutable) => {
  it('uses current rows after updates, removals and recreated identities', () => {
    const table = make([], undefined, immutable);
    expect(ids(table)).toEqual([]);
    table.setData(source);
    expect(ids(table)).toEqual(['c', 'b', 'a']);
    const updated = { ...source[0]!, score: 9 };
    const next = [updated, { id: 'b-new', name: 'item-2', score: 3 }, { id: 'd', name: 'item-3', score: 4 }];
    table.setData(next);
    expect(ids(table)).toEqual(['b-new', 'd', 'a']);
    expect(table.model().rowsById.a!.original).toBe(updated);
    expect(table.model().rowsById.b).toBeUndefined();
    expect(table.model().rowsById.c).toBeUndefined();
    table.setData([{ ...updated, name: 'item-0' }, ...next.slice(1)]);
    expect(ids(table)).toEqual(['a', 'b-new', 'd']);
  });

  it('retains every current row when IDs collide after an earlier sort', () => {
    const table = make(undefined, undefined, immutable);
    expect(ids(table)).toEqual(['c', 'b', 'a']);
    const next = [
      { id: 'a', name: 'item-30', score: 4 },
      { id: 'a', name: 'item-0', score: 5 },
      { id: 'b', name: 'item-20', score: 6 },
    ];
    table.setData(next);
    expect(table.model().rows.map((row) => row.original)).toEqual([next[1], next[2], next[0]]);
  });

  it('restores source order when sorting is cleared or no selected column can sort', () => {
    const table = make(undefined, undefined, immutable);
    expect(ids(table)).toEqual(['c', 'b', 'a']);
    table.setSorting([]);
    expect(ids(table)).toEqual(['a', 'b', 'c']);
    table.setSorting([{ id: 'name', desc: true }]);
    expect(ids(table)).toEqual(['a', 'b', 'c']);
    table.setData([source[1]!, source[2]!, source[0]!], false);
    expect(ids(table)).toEqual(['b', 'c', 'a']);
  });

  it('preserves multi-sort, custom comparators and source-index tie ordering', () => {
    const table = make(source, [{ id: 'score', desc: false }, { id: 'name', desc: false }], immutable);
    expect(ids(table)).toEqual(['b', 'a', 'c']);
    table.setData([source[2]!, source[0]!, source[1]!]);
    table.setSorting([{ id: 'score', desc: false }]);
    expect(ids(table)).toEqual(['a', 'b', 'c']);
    table.setData([source[1]!, source[0]!, source[2]!]);
    expect(ids(table)).toEqual(['b', 'a', 'c']);
  });

  it('does not carry rows between table instances or disjoint replacements', () => {
    const first = make(undefined, undefined, immutable);
    const other = [{ id: 'a', name: 'item-0', score: 7 }, { id: 'b', name: 'item-20', score: 8 }];
    const second = make(other, undefined, immutable);
    expect(ids(first)).toEqual(['c', 'b', 'a']);
    expect(ids(second)).toEqual(['a', 'b']);
    expect(second.model().rows[0]!.original).toBe(other[0]);
    const replacement = [{ id: 'z', name: 'item-30', score: 0 }];
    first.setData(replacement);
    expect(ids(first)).toEqual(['z']);
    expect(first.model().rows[0]!.original).toBe(replacement[0]);
    expect(ids(second)).toEqual(['a', 'b']);
  });
});

describe('immutable sort-key reuse', () => {
  it('returns current rows and flat rows through repeated non-sort patches and a changed sort key', () => {
    const table = make(undefined, undefined, true);
    expect(ids(table)).toEqual(['c', 'b', 'a']);
    const first = [{ ...source[0]!, score: 9 }, source[1]!, source[2]!];
    table.setData(first);
    expect(ids(table)).toEqual(['c', 'b', 'a']);
    const second = [first[0]!, { ...source[1]!, score: 11 }, source[2]!];
    table.setData(second);
    const model = table.model();
    expect(model.rows.map((row) => row.original)).toEqual([second[2], second[1], second[0]]);
    expect(model.flatRows.map((row) => row.original)).toEqual([second[2], second[1], second[0]]);
    expect(model.rowsById.b!.getValue('score')).toBe(11);

    table.setData([{ ...second[0]!, name: 'item-0' }, second[1]!, second[2]!]);
    expect(ids(table)).toEqual(['a', 'c', 'b']);
  });

  it('respects new source-index ties and sorting changes after reusing an order', () => {
    const tied = source.map((item, index) => ({ ...item, name: index < 2 ? 'item-2' : 'item-1' }));
    const table = make(tied, undefined, true);
    expect(ids(table)).toEqual(['c', 'a', 'b']);
    const first = tied.map((item) => ({ ...item, score: item.score + 1 }));
    table.setData(first);
    expect(ids(table)).toEqual(['c', 'a', 'b']);
    const second = first.map((item) => ({ ...item, score: item.score + 1 }));
    table.setData(second);
    expect(ids(table)).toEqual(['c', 'a', 'b']);
    table.setData([second[1]!, second[0]!, second[2]!]);
    expect(ids(table)).toEqual(['c', 'b', 'a']);
    table.setSorting([{ id: 'name', desc: true }]);
    expect(ids(table)).toEqual(['b', 'a', 'c']);
    table.setSorting([{ id: 'name', desc: false }]);
    expect(ids(table)).toEqual(['c', 'b', 'a']);
    table.setSorting([]);
    expect(ids(table)).toEqual(['b', 'a', 'c']);
  });

  it('does not infer custom comparator dependencies from the named accessor', () => {
    const definitions: typeof columns = [{
      accessorKey: 'name', sortFn: (a, b) => b.original.score - a.original.score,
    }];
    const table = make(source, undefined, true, definitions);
    expect(ids(table)).toEqual(['c', 'a', 'b']);
    table.setData([{ ...source[0]!, score: 5 }, source[1]!, source[2]!]);
    expect(ids(table)).toEqual(['a', 'c', 'b']);
    table.setData([source[0]!, { ...source[1]!, score: 10 }, source[2]!]);
    expect(ids(table)).toEqual(['b', 'c', 'a']);
  });

  it('still sorts changed children in hierarchical models', () => {
    const parent: Item = { id: 'parent', name: 'item-10', score: 0, children: [source[1]!, source[2]!] };
    const initial = [parent, source[0]!];
    const { result, rerender } = renderHook(({ data }) => useTable({
      features, columns, data, meta: IMMUTABLE_META, getRowId: (row) => row.id,
      getSubRows: (row) => row.children,
      initialState: { sorting: [{ id: 'name', desc: false }] },
    }), { initialProps: { data: initial } });
    expect(result.current.getSortedRowModel().rows.find((row) => row.id === 'parent')!.subRows.map((row) => row.id))
      .toEqual(['c', 'b']);
    rerender({ data: [{ ...parent, score: 1 }, source[0]!] });
    expect(result.current.getSortedRowModel().rows.find((row) => row.id === 'parent')!.subRows.map((row) => row.id))
      .toEqual(['c', 'b']);
    rerender({ data: [{ ...parent, children: [source[1]!, { ...source[2]!, name: 'item-30' }] }, source[0]!] });
    const model = result.current.getSortedRowModel();
    expect(model.rows.find((row) => row.id === 'parent')!.subRows.map((row) => row.id))
      .toEqual(['b', 'c']);
    expect(model.flatRows.find((row) => row.id === 'c')!.original.name).toBe('item-30');
  });

  it('does not assume immutability for tables that did not opt in', () => {
    const mutable = source.map((item) => ({ ...item }));
    const table = make(mutable);
    expect(ids(table)).toEqual(['c', 'b', 'a']);
    mutable[0]!.name = 'item-0';
    table.setData([...mutable]);
    expect(ids(table)).toEqual(['a', 'c', 'b']);
  });
});

// Tables that page the sorted rows. 'native' uses TanStack's own sorter, the reference that the
// adaptive sorter must match with ('immutable') and without ('adaptive') the immutable-rows opt-in.
const sorters = ['native', 'adaptive', 'immutable'] as const;
type Sorter = (typeof sorters)[number];
const pagedFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createAdaptiveSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});
const nativePagedFeatures: typeof pagedFeatures = {
  ...pagedFeatures,
  sortedRowModel: createSortedRowModel(),
};
const pagedColumns: Array<ColumnDef<typeof pagedFeatures, Item>> = [
  { accessorKey: 'name', sortFn: sortFn_alphanumeric },
  { accessorKey: 'score' },
];
// Sorted by name: c, e, b, d, a. Two rows per page: [c, e], [b, d], [a].
const pagedSource: Item[] = [
  { id: 'a', name: 'item-5', score: 1 },
  { id: 'b', name: 'item-3', score: 1 },
  { id: 'c', name: 'item-1', score: 2 },
  { id: 'd', name: 'item-4', score: 2 },
  { id: 'e', name: 'item-2', score: 3 },
];
const pick = (data: Item[], ...ids: string[]) =>
  ids.map((id) => data.find((item) => item.id === id)!);
// An immutable host patch replaces one row object; every other row keeps its identity.
const rescored = (data: Item[], id: string): Item[] =>
  data.map((item) => (item.id === id ? { ...item, score: item.score + 10 } : item));
const renamed = (data: Item[], id: string, name: string): Item[] =>
  data.map((item) => (item.id === id ? { ...item, name } : item));

async function makePaged(sorter: Sorter, autoResetPageIndex: boolean) {
  const { result, rerender } = renderHook(
    ({ data }) => {
      const table = useTable({
        features: sorter === 'native' ? nativePagedFeatures : pagedFeatures,
        columns: pagedColumns,
        data,
        getRowId: (row) => row.id,
        ...(sorter === 'immutable' ? { meta: IMMUTABLE_META } : {}),
        autoResetPageIndex,
        initialState: {
          sorting: [{ id: 'name', desc: false }],
          pagination: { pageIndex: 0, pageSize: 2 },
        },
      });
      // Like a table consumer, read the page while rendering.
      return { table, rows: table.getRowModel().rows };
    },
    { initialProps: { data: pagedSource } },
  );
  // The mount render primes the row models and queues their first-run auto-reset callbacks as
  // microtasks. Settle them before the page moves, so only later data changes can reset it.
  await act(async () => {
    await Promise.resolve();
  });
  return {
    // The page as last rendered.
    page: () => ({
      index: result.current.table.state.pagination.pageIndex,
      items: result.current.rows.map((row) => row.original),
    }),
    goToPage: (index: number) => {
      act(() => {
        result.current.table.setPageIndex(index); 
      }); 
    },
    // Page resets are queued as microtasks; act settles them and the render they cause.
    setData: async (data: Item[]) => {
      await act(async () => {
        rerender({ data });
      });
    },
  };
}

describe.each(sorters)('paginated sorted rows (%s)', (sorter) => {
  it('returns to the first page with current rows after each nonsort patch', async () => {
    const table = await makePaged(sorter, true);
    let data = pagedSource;
    expect(table.page()).toEqual({ index: 0, items: pick(data, 'c', 'e') });

    // Repeat the patch so any order retained from an earlier one is reused.
    for (const id of ['b', 'c', 'e']) {
      table.goToPage(1);
      expect(table.page()).toEqual({ index: 1, items: pick(data, 'b', 'd') });
      data = rescored(data, id);
      await table.setData(data);
      expect(table.page()).toEqual({ index: 0, items: pick(data, 'c', 'e') });
    }

    // A changed sort value also returns to the first page, in the new order.
    table.goToPage(1);
    data = renamed(data, 'a', 'item-0');
    await table.setData(data);
    expect(table.page()).toEqual({ index: 0, items: pick(data, 'a', 'c') });
    table.goToPage(1);
    expect(table.page()).toEqual({ index: 1, items: pick(data, 'e', 'b') });
  });

  it('keeps the chosen page with current rows after each nonsort patch when reset is off', async () => {
    const table = await makePaged(sorter, false);
    let data = pagedSource;
    table.goToPage(1);
    expect(table.page()).toEqual({ index: 1, items: pick(data, 'b', 'd') });

    // Two patches touch the visible page; the last one is off the page.
    for (const id of ['b', 'd', 'a']) {
      data = rescored(data, id);
      await table.setData(data);
      expect(table.page()).toEqual({ index: 1, items: pick(data, 'b', 'd') });
    }

    data = renamed(data, 'a', 'item-0');
    await table.setData(data);
    expect(table.page()).toEqual({ index: 1, items: pick(data, 'e', 'b') });
  });
});
