import type { DataTableColumn } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';
import { keepSort, keptSort, sortInForce, sortsBy } from './sort';

// The sort of a list is the person's choice, or the page's default, and only ever of a column that sorts. Invented rows: the page is plugin-agnostic.
type Row = { readonly name: string; readonly count: number };

const columns: ReadonlyArray<DataTableColumn<Row>> = [
  { id: 'name', header: 'Name', fit: 'id', cell: (row) => row.name, sortKey: (row) => row.name },
  { id: 'count', header: 'Count', fit: 'fixed', width: 72, cell: (row) => String(row.count), sortKey: (row) => row.count, sortKind: 'number' },
  { id: 'note', header: 'Note', fit: 'flex', cell: () => 'none' },
];

const NAME_UP = { column: 'name', direction: 'ascending' } as const;
const COUNT_DOWN = { column: 'count', direction: 'descending' } as const;

describe('sortsBy', () => {
  it('is true for a column that declares a sort key, and for no other: a column without one has no sort, and a name that is no column is none', () => {
    expect(sortsBy(columns, 'name')).toBe(true);
    expect(sortsBy(columns, 'count')).toBe(true);
    expect(sortsBy(columns, 'note')).toBe(false);
    expect(sortsBy(columns, 'gone')).toBe(false);
  });
});

describe('sortInForce: the person\'s choice, else the definition\'s default, else the source\'s own order', () => {
  it('is the default while the person has chosen nothing', () => {
    expect(sortInForce(columns, undefined, NAME_UP)).toEqual(NAME_UP);
  });

  it('is the choice once there is one, whatever the default', () => {
    expect(sortInForce(columns, COUNT_DOWN, NAME_UP)).toEqual(COUNT_DOWN);
  });

  it('is no sort when there is neither: an old definition draws the source\'s order as it always did', () => {
    expect(sortInForce(columns, undefined, undefined)).toBeUndefined();
  });

  it('skips a sort that names a column which does not sort now (a plugin that came back with other columns): the default, else none', () => {
    expect(sortInForce(columns, { column: 'note', direction: 'ascending' }, NAME_UP)).toEqual(NAME_UP);
    expect(sortInForce(columns, { column: 'gone', direction: 'descending' }, undefined)).toBeUndefined();
  });

  it('ignores a default that names a column which does not sort, and does not throw for it', () => {
    expect(sortInForce(columns, undefined, { column: 'note', direction: 'ascending' })).toBeUndefined();
    expect(sortInForce(columns, undefined, { column: 'gone', direction: 'ascending' })).toBeUndefined();
  });

  it('is the same object it was given, so what compares sorts by identity sees no change', () => {
    expect(sortInForce(columns, COUNT_DOWN, NAME_UP)).toBe(COUNT_DOWN);
    expect(sortInForce(columns, undefined, NAME_UP)).toBe(NAME_UP);
  });
});

describe('keptSort and keepSort: what the page keeps of the person\'s choice, as plain data', () => {
  it('gives back what it kept', () => {
    expect(keptSort(columns, keepSort(null, COUNT_DOWN))).toEqual(COUNT_DOWN);
    expect(keptSort(columns, keepSort(undefined, NAME_UP))).toEqual(NAME_UP);
  });

  it('keeps a value that survives a round trip through JSON, which is what the tab model does with it', () => {
    expect(keptSort(columns, JSON.parse(JSON.stringify(keepSort(null, COUNT_DOWN))))).toEqual(COUNT_DOWN);
  });

  it('keeps what else the host holds for the tab, and replaces only the sort', () => {
    expect(keepSort({ scroll: 40, sort: NAME_UP }, COUNT_DOWN)).toEqual({ scroll: 40, sort: COUNT_DOWN });
  });

  it('starts again from nothing when what was kept is not a record', () => {
    expect(keepSort('text', NAME_UP)).toEqual({ sort: NAME_UP });
    expect(keepSort([1, 2], NAME_UP)).toEqual({ sort: NAME_UP });
    expect(keepSort(7, NAME_UP)).toEqual({ sort: NAME_UP });
  });

  it('reads nothing from a value that holds no sort, a sort of another shape, or a column that does not sort', () => {
    expect(keptSort(columns, undefined)).toBeUndefined();
    expect(keptSort(columns, null)).toBeUndefined();
    expect(keptSort(columns, 'name')).toBeUndefined();
    expect(keptSort(columns, {})).toBeUndefined();
    expect(keptSort(columns, { sort: 'name' })).toBeUndefined();
    expect(keptSort(columns, { sort: { column: 'name' } })).toBeUndefined();
    expect(keptSort(columns, { sort: { column: 'name', direction: 'asc' } })).toBeUndefined();
    expect(keptSort(columns, { sort: { column: 7, direction: 'ascending' } })).toBeUndefined();
    expect(keptSort(columns, { sort: { column: 'note', direction: 'ascending' } })).toBeUndefined();
    expect(keptSort(columns, { sort: { column: 'gone', direction: 'descending' } })).toBeUndefined();
  });

  it('reads a sort with nothing else in it than a column and a direction', () => {
    expect(keptSort(columns, { sort: { column: 'name', direction: 'descending', extra: true } })).toStrictEqual({ column: 'name', direction: 'descending' });
  });
});
