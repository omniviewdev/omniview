import { describe, expect, it, vi } from 'vitest';
import type { ListPageDefinition, ListSource } from './definition';
import { deriveListView, normalizeSearch, type ListQuery } from './view';

// The page is plugin-agnostic, so the tests are too: invented items and an invented state word.
type Item = { readonly key: string; readonly name: string; readonly state: string };

const item = (key: string, name: string, state: string): Item => ({ key, name, state });

const ITEMS: readonly Item[] = [
  item('a', 'alpha-one', 'Running'),
  item('b', 'alpha-two', 'Failed'),
  item('c', 'beta-one', 'Running'),
  item('d', 'beta-two', 'Done'),
  item('e', 'gamma', 'Running'),
];

const definition: ListPageDefinition<Item> = {
  title: 'Items',
  nouns: { one: 'Item', other: 'Items' },
  columns: [{ id: 'name', header: 'Name', fit: 'id', cell: (row) => row.name }],
  lines: 1,
  getRowKey: (row) => row.key,
  searchText: (row) => `${row.name}\n${row.state}`.toLowerCase(),
  quickFilters: {
    label: 'Item state',
    filters: [
      { id: 'running', label: 'Running', tone: 'success', test: (row) => row.state === 'Running' },
      { id: 'failed', label: 'Failed', tone: 'error', test: (row) => row.state === 'Failed' },
      { id: 'done', label: 'Done', tone: 'muted', test: (row) => row.state === 'Done' },
    ],
  },
};

const ready = (rows: readonly Item[] = ITEMS, over: Partial<ListSource<Item>> = {}): ListSource<Item> => ({
  state: { kind: 'ready' },
  rows,
  complete: true,
  refreshing: false,
  refresh: async () => undefined,
  ...over,
});

const ALL: ListQuery = { text: '', filter: null };

describe('normalizeSearch', () => {
  it('trims and lower-cases what was typed: the match is on the whole text, as the mock matches it', () => {
    expect(normalizeSearch('  Alpha-One ')).toBe('alpha-one');
    expect(normalizeSearch('')).toBe('');
    expect(normalizeSearch('   ')).toBe('');
  });
});

describe('deriveListView: the rows', () => {
  it('passes the rows through as they are, in the source order, and as the same array while nothing narrows them', () => {
    const source = ready();
    const view = deriveListView(definition, source, ALL);
    expect(view.rows).toBe(source.rows);
    expect(view.active).toBe(false);
  });

  it('keeps the rows whose text holds the search, case-insensitively, in the source order', () => {
    const view = deriveListView(definition, ready(), { text: 'beta', filter: null });
    expect(view.rows.map((row) => row.key)).toEqual(['c', 'd']);
    expect(view.active).toBe(true);
  });

  it('searches everything the definition says a person can read, not just the name', () => {
    const view = deriveListView(definition, ready(), { text: 'failed', filter: null });
    expect(view.rows.map((row) => row.key)).toEqual(['b']);
  });

  it('narrows to the chosen quick filter', () => {
    const view = deriveListView(definition, ready(), { text: '', filter: 'running' });
    expect(view.rows.map((row) => row.key)).toEqual(['a', 'c', 'e']);
    expect(view.active).toBe(true);
  });

  it('applies the search and the filter together', () => {
    const view = deriveListView(definition, ready(), { text: 'alpha', filter: 'running' });
    expect(view.rows.map((row) => row.key)).toEqual(['a']);
  });

  it('takes a filter that names no filter of the definition as All, and as no filter at all', () => {
    const source = ready();
    const view = deriveListView(definition, source, { text: '', filter: 'nope' });
    expect(view.rows).toBe(source.rows);
    expect(view.active).toBe(false);
  });
});

describe('deriveListView: the quick filters (counted after the search and before the chosen filter)', () => {
  it('counts every filter over all the rows, and All as the whole', () => {
    const { quickFilters } = deriveListView(definition, ready(), ALL);
    expect(quickFilters?.total).toBe(5);
    expect(quickFilters?.filters.map((filter) => [filter.id, filter.count])).toEqual([['running', 3], ['failed', 1], ['done', 1]]);
  });

  it('counts over the rows the search keeps', () => {
    const { quickFilters } = deriveListView(definition, ready(), { text: 'beta', filter: null });
    expect(quickFilters?.total).toBe(2);
    expect(quickFilters?.filters.map((filter) => filter.count)).toEqual([1, 0, 1]);
  });

  it('does not count over the chosen filter: choosing one leaves the others\' counts as they were', () => {
    const { quickFilters } = deriveListView(definition, ready(), { text: '', filter: 'failed' });
    expect(quickFilters?.total).toBe(5);
    expect(quickFilters?.filters.map((filter) => filter.count)).toEqual([3, 1, 1]);
  });

  it('carries the label, the tone and the words of each filter, in the definition\'s order', () => {
    const { quickFilters } = deriveListView(definition, ready(), ALL);
    expect(quickFilters?.label).toBe('Item state');
    expect(quickFilters?.filters.map((filter) => [filter.label, filter.tone])).toEqual([['Running', 'success'], ['Failed', 'error'], ['Done', 'muted']]);
  });

  it('is absent when the definition has no quick filters', () => {
    expect(deriveListView({ ...definition, quickFilters: undefined }, ready(), ALL).quickFilters).toBeUndefined();
  });

  it('counts nothing while nothing is known yet: a load in progress shows no number, and a failure none either', () => {
    const loading = deriveListView(definition, ready([], { state: { kind: 'loading' }, complete: false }), ALL);
    expect(loading.quickFilters?.total).toBeUndefined();
    expect(loading.quickFilters?.filters.every((filter) => filter.count === undefined)).toBe(true);
    const failed = deriveListView(definition, ready([], { state: { kind: 'failed' } }), ALL);
    expect(failed.quickFilters?.total).toBeUndefined();
  });

  it('counts zero when the whole set has arrived and is empty: zero is a count', () => {
    const { quickFilters } = deriveListView(definition, ready([]), ALL);
    expect(quickFilters?.total).toBe(0);
    expect(quickFilters?.filters.map((filter) => filter.count)).toEqual([0, 0, 0]);
  });
});

describe('deriveListView: the state of the body', () => {
  it('is ready with rows to show', () => {
    expect(deriveListView(definition, ready(), ALL).state).toEqual({ kind: 'ready' });
  });

  it('is loading while the source loads and holds no rows', () => {
    expect(deriveListView(definition, ready([], { state: { kind: 'loading' }, complete: false }), ALL).state).toEqual({ kind: 'loading' });
  });

  it('is loading while the first rows are on their way, even when the source says it is ready', () => {
    expect(deriveListView(definition, ready([], { complete: false }), ALL).state).toEqual({ kind: 'loading' });
  });

  it('is an error with the message and the way to retry when a failure left no rows', () => {
    const retry = vi.fn();
    const view = deriveListView(definition, ready([], { state: { kind: 'failed', message: 'Nobody answered.', retry }, complete: false }), ALL);
    expect(view.state).toEqual({ kind: 'error', message: 'Nobody answered.', onRetry: retry });
  });

  it('keeps the rows when a failure came after them: the failure is not the state of the list', () => {
    const view = deriveListView(definition, ready(ITEMS, { state: { kind: 'failed', message: 'Late.' } }), ALL);
    expect(view.state).toEqual({ kind: 'ready' });
    expect(view.rows).toHaveLength(5);
  });

  it('is empty when the whole set has arrived and holds nothing', () => {
    expect(deriveListView(definition, ready([]), ALL).state).toEqual({ kind: 'empty' });
  });

  it('is empty, not no-match, for an empty set whatever the search says', () => {
    expect(deriveListView(definition, ready([]), { text: 'x', filter: 'running' }).state).toEqual({ kind: 'empty' });
  });

  it('is no-match when the rows exist and the search or the filter hides every one', () => {
    expect(deriveListView(definition, ready(), { text: 'zzz', filter: null }).state).toEqual({ kind: 'no-match' });
    expect(deriveListView(definition, ready([item('a', 'alpha', 'Running')]), { text: '', filter: 'failed' }).state).toEqual({ kind: 'no-match' });
  });
});

describe('deriveListView: the footer\'s count (the mock\'s H.count; decision A10)', () => {
  it('is exact when the whole set is here, and says how many of it are shown', () => {
    expect(deriveListView(definition, ready(), ALL).footer).toEqual({ shown: 5, total: { kind: 'exact', value: 5 } });
    expect(deriveListView(definition, ready(), { text: 'beta', filter: null }).footer).toEqual({ shown: 2, total: { kind: 'exact', value: 5 } });
  });

  it('is unknown with how many are loaded while the set is still arriving', () => {
    const view = deriveListView(definition, ready(ITEMS, { complete: false }), ALL);
    expect(view.footer).toEqual({ shown: 5, total: { kind: 'unknown', loaded: 5 } });
  });

  it('says how many of the loaded ones match, while the set is still arriving', () => {
    const view = deriveListView(definition, ready(ITEMS, { complete: false }), { text: 'beta', filter: null });
    expect(view.footer).toEqual({ shown: 2, total: { kind: 'unknown', loaded: 5 } });
  });

  it('reads zero loaded while the first load runs', () => {
    const view = deriveListView(definition, ready([], { state: { kind: 'loading' }, complete: false }), ALL);
    expect(view.footer).toEqual({ shown: 0, total: { kind: 'unknown', loaded: 0 } });
  });

  it('reads 0 of N when a search hides everything', () => {
    expect(deriveListView(definition, ready(), { text: 'zzz', filter: null }).footer).toEqual({ shown: 0, total: { kind: 'exact', value: 5 } });
  });
});
