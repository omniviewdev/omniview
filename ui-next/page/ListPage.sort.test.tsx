import type { DataTableColumn } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListPageDefinition, ListSource } from './definition';
import { ListPage } from './ListPage';
import type { PageMemory } from './memory';
import { SEARCH_DELAY_MS } from './useSearchDraft';

// jsdom lays nothing out: the table's region gets the size a browser would give it, so rows are in view.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

// The sort of a list (K3a): the page holds the sort in force, seeded from the definition's `defaultSort`, and hands it to the kit's table, which does the sorting by the keys the columns declare.
// The page is plugin-agnostic, so the tests are too: invented items. The source's order is NOT the order of any column, so a test can tell a sorted list from one that was left as it was, and the
// ties of every column are in an order that is neither ascending nor descending by name.
type Item = { readonly key: string; readonly name: string; readonly state: string; readonly count: number | undefined };

const item = (key: string, name: string, state: string, count?: number): Item => ({ key, name, state, count });

// By name, naturally: alpha-one, alpha-two, beta-one, beta-two, gamma. By count as numbers: 3, 9, 10 (alpha-two), 10 (beta-two), then the one with none (as text 10 would come before 3).
// By state as text: Done, Failed, then Running three times, in the source's order: gamma, beta-one, beta-two.
const ITEMS: readonly Item[] = [
  item('a', 'gamma', 'Running', 3),
  item('b', 'alpha-two', 'Failed', 10),
  item('c', 'beta-one', 'Running', 9),
  item('d', 'alpha-one', 'Done'),
  item('e', 'beta-two', 'Running', 10),
];

const COLUMNS: ReadonlyArray<DataTableColumn<Item>> = [
  { id: 'name', header: 'Name', fit: 'id', text: (row) => row.name, cell: (row) => row.name, sortKey: (row) => row.name },
  { id: 'state', header: 'State', fit: 'fixed', width: 120, cell: (row) => row.state, sortKey: (row) => row.state },
  { id: 'count', header: 'Count', fit: 'fixed', width: 80, align: 'end', cell: (row) => (row.count === undefined ? '-' : String(row.count)), sortKey: (row) => row.count, sortKind: 'number' },
  { id: 'note', header: 'Note', fit: 'fixed', width: 80, cell: () => 'note' },
];

const definition: ListPageDefinition<Item> = {
  title: 'Items',
  nouns: { one: 'Item', other: 'Items' },
  columns: COLUMNS,
  lines: 1,
  getRowKey: (row) => row.key,
  searchText: (row) => `${row.name}\n${row.state}`.toLowerCase(),
  defaultSort: { column: 'name', direction: 'ascending' },
  quickFilters: {
    label: 'Item state',
    filters: [
      { id: 'running', label: 'Running', tone: 'success', test: (row) => row.state === 'Running' },
      { id: 'failed', label: 'Failed', tone: 'error', test: (row) => row.state === 'Failed' },
    ],
  },
};

const source = (over: Partial<ListSource<Item>> = {}): ListSource<Item> => ({ state: { kind: 'ready' }, rows: ITEMS, complete: true, refreshing: false, refresh: async () => undefined, ...over });

const page = (over: Partial<ListSource<Item>> = {}, def: ListPageDefinition<Item> = definition, memory?: PageMemory) => <ListPage definition={def} source={source(over)} memory={memory} />;

const rowNames = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]?.textContent);
const header = (name: string) => screen.getByRole('columnheader', { name });
const press = (name: string) => {
  fireEvent.click(within(header(name)).getByRole('button', { name }));
};

const marks = () => screen.getAllByRole('columnheader').map((cell) => cell.getAttribute('aria-sort'));

/** The page's memory as a host holds it: a value that a write replaces, and the writes in order. */
function memoryOf(initial: unknown = null) {
  let held = initial;
  const writes: unknown[] = [];
  const memory: PageMemory = {
    read: () => held,
    write: (value) => {
      held = value;
      writes.push(value);
    },
  };
  return { memory, writes, held: () => held };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ListPage: a header that sorts, and one that does not', () => {
  it('draws a button in the header of each column that declares a sort key, with its state in aria-sort, and nothing of the kind in a column that declares none', () => {
    render(page());
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((cell) => cell.textContent)).toEqual(['Name', 'State', 'Count', 'Note']);
    expect(headers.map((cell) => within(cell).queryByRole('button') !== null)).toEqual([true, true, true, false]);
    expect(marks()).toEqual(['ascending', 'none', 'none', null]);
  });

  it('opens in the order of the definition\'s default sort, and says so in the header of that column', () => {
    render(page());
    expect(rowNames()).toEqual(['alpha-one', 'alpha-two', 'beta-one', 'beta-two', 'gamma']);
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('opens in a default that is descending, as the definition says', () => {
    render(page({}, { ...definition, defaultSort: { column: 'count', direction: 'descending' } }));
    expect(rowNames()).toEqual(['alpha-two', 'beta-two', 'beta-one', 'gamma', 'alpha-one']);
    expect(marks()).toEqual(['none', 'none', 'descending', null]);
  });

  it('opens in the source\'s own order, with every sortable header saying it is not the one, when the definition has no default sort (an old plugin)', () => {
    render(page({}, { ...definition, defaultSort: undefined }));
    expect(rowNames()).toEqual(['gamma', 'alpha-two', 'beta-one', 'alpha-one', 'beta-two']);
    expect(marks()).toEqual(['none', 'none', 'none', null]);
  });

  it('draws no sort button, no aria-sort and the source\'s order when no column declares a key, as every list was drawn before (an old plugin)', () => {
    const plain = COLUMNS.map(({ sortKey: _key, sortKind: _kind, ...column }) => column);
    render(page({}, { ...definition, columns: plain, defaultSort: undefined }));
    expect(screen.queryAllByRole('button').filter((button) => button.closest('thead') !== null)).toEqual([]);
    expect(marks()).toEqual([null, null, null, null]);
    expect(rowNames()).toEqual(['gamma', 'alpha-two', 'beta-one', 'alpha-one', 'beta-two']);
  });

  it('ignores a default sort that names a column with no key, or no column, and draws the source\'s order: it is a hint, not a fault of the plugin\'s page', () => {
    const { rerender } = render(page({}, { ...definition, defaultSort: { column: 'note', direction: 'ascending' } }));
    expect(rowNames()).toEqual(['gamma', 'alpha-two', 'beta-one', 'alpha-one', 'beta-two']);
    expect(marks()).toEqual(['none', 'none', 'none', null]);
    rerender(page({}, { ...definition, defaultSort: { column: 'gone', direction: 'descending' } }));
    expect(rowNames()).toEqual(['gamma', 'alpha-two', 'beta-one', 'alpha-one', 'beta-two']);
  });
});

describe('ListPage: pressing a header (the mock\'s rule: ascending first, then round and back, never a third state)', () => {
  it('sorts the column ascending on the first press, turns it round on the second and back on the third', () => {
    render(page({}, { ...definition, defaultSort: undefined }));
    press('Count');
    expect(marks()).toEqual(['none', 'none', 'ascending', null]);
    expect(rowNames()).toEqual(['gamma', 'beta-one', 'alpha-two', 'beta-two', 'alpha-one']);
    press('Count');
    expect(marks()).toEqual(['none', 'none', 'descending', null]);
    expect(rowNames()).toEqual(['alpha-two', 'beta-two', 'beta-one', 'gamma', 'alpha-one']);
    press('Count');
    expect(marks()).toEqual(['none', 'none', 'ascending', null]);
    expect(rowNames()).toEqual(['gamma', 'beta-one', 'alpha-two', 'beta-two', 'alpha-one']);
  });

  it('turns the default column round on its first press, because the default is the sort in force', () => {
    render(page());
    press('Name');
    expect(marks()).toEqual(['descending', 'none', 'none', null]);
    expect(rowNames()).toEqual(['gamma', 'beta-two', 'beta-one', 'alpha-two', 'alpha-one']);
  });

  it('sorts another column ascending, and the column that was in force loses its mark: one sort at a time', () => {
    render(page());
    press('Name');
    press('State');
    expect(marks()).toEqual(['none', 'ascending', 'none', null]);
    press('State');
    expect(marks()).toEqual(['none', 'descending', 'none', null]);
  });

  it('draws the arrow of the direction in the header in force, and no arrow in the others', () => {
    render(page());
    const arrows = () => screen.getAllByRole('columnheader').map((cell) => cell.querySelectorAll('svg').length);
    expect(arrows()).toEqual([1, 0, 0, 0]);
    press('State');
    expect(arrows()).toEqual([0, 1, 0, 0]);
  });

  it('sorts numbers as numbers (9 before 10) and text in natural order (item-2 before item-10)', () => {
    const rows = [item('x', 'item-10', 'B', 10), item('y', 'item-2', 'A', 2), item('z', 'item-1', 'C', 1)];
    render(page({ rows }));
    expect(rowNames()).toEqual(['item-1', 'item-2', 'item-10']);
    press('Count');
    expect(rowNames()).toEqual(['item-1', 'item-2', 'item-10']);
    press('Count');
    expect(rowNames()).toEqual(['item-10', 'item-2', 'item-1']);
  });

  it('puts a row with no value last, whatever the direction', () => {
    render(page());
    press('Count');
    expect(rowNames().at(-1)).toBe('alpha-one');
    press('Count');
    expect(rowNames().at(-1)).toBe('alpha-one');
  });

  it('keeps the rows that tie in the source\'s order, in both directions (a stable sort: the default order is the tie-breaker, not the order of the last press)', () => {
    render(page({}, { ...definition, defaultSort: undefined }));
    press('State');
    // Running three times: gamma, beta-one, beta-two, the order the source gave them in
    expect(rowNames()).toEqual(['alpha-one', 'alpha-two', 'gamma', 'beta-one', 'beta-two']);
    press('State');
    expect(rowNames()).toEqual(['gamma', 'beta-one', 'beta-two', 'alpha-two', 'alpha-one']);
    // sorting by count after state does not carry the state's order into the ties of count (10 twice: alpha-two, beta-two, the source's order)
    press('Count');
    expect(rowNames()).toEqual(['gamma', 'beta-one', 'alpha-two', 'beta-two', 'alpha-one']);
  });

  it('does not write to the rows the source gave it, or to the source\'s array', () => {
    const rows = Object.freeze([...ITEMS]);
    render(page({ rows }));
    press('Name');
    press('Count');
    expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('ListPage: the header is a keyboard control', () => {
  it('sorts on Enter and on Space, from the button the Tab key reaches, and the focus stays on it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(page({}, { ...definition, defaultSort: undefined }));
    const button = within(header('Count')).getByRole('button', { name: 'Count' });
    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(marks()).toEqual(['none', 'none', 'ascending', null]);
    expect(button).toHaveFocus();
    await user.keyboard(' ');
    expect(marks()).toEqual(['none', 'none', 'descending', null]);
    expect(button).toHaveFocus();
  });

  it('is in the Tab order: one stop for each column that sorts, none for the column that does not', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(page());
    const stops: string[] = [];
    await user.tab();
    while (document.activeElement !== null && document.activeElement.closest('thead') === null && stops.length < 40) {
      stops.push(document.activeElement.textContent ?? '');
      await user.tab();
    }

    const inHeader: string[] = [];
    while (document.activeElement?.closest('thead') !== null && document.activeElement !== null && inHeader.length < 10) {
      inHeader.push(document.activeElement.textContent ?? '');
      await user.tab();
    }

    expect(inHeader).toEqual(['Name', 'State', 'Count']);
  });
});

describe('ListPage: the order follows the rows as they change (the mock re-sorts on every render, and holds nothing still)', () => {
  it('moves a row whose sort value changed to its new place and leaves every other row where it was', () => {
    const { rerender } = render(page({}, { ...definition, defaultSort: { column: 'count', direction: 'ascending' } }));
    expect(rowNames()).toEqual(['gamma', 'beta-one', 'alpha-two', 'beta-two', 'alpha-one']);
    // beta-one goes from 9 to 11: it moves past the two tens; no other row changes its place relative to another
    rerender(page({ rows: ITEMS.map((row) => (row.key === 'c' ? { ...row, count: 11 } : row)) }, { ...definition, defaultSort: { column: 'count', direction: 'ascending' } }));
    expect(rowNames()).toEqual(['gamma', 'alpha-two', 'beta-two', 'beta-one', 'alpha-one']);
  });

  it('keeps the order when a value other than the sorted one changes', () => {
    const { rerender } = render(page());
    expect(rowNames()).toEqual(['alpha-one', 'alpha-two', 'beta-one', 'beta-two', 'gamma']);
    rerender(page({ rows: ITEMS.map((row) => (row.key === 'a' ? { ...row, state: 'Failed', count: 99 } : row)) }));
    expect(rowNames()).toEqual(['alpha-one', 'alpha-two', 'beta-one', 'beta-two', 'gamma']);
  });

  it('puts a row that arrives, and takes a row that goes, in the order in force, with the sort still the person\'s', () => {
    const { rerender } = render(page());
    press('Name');
    expect(rowNames()).toEqual(['gamma', 'beta-two', 'beta-one', 'alpha-two', 'alpha-one']);
    rerender(page({ rows: [...ITEMS, item('f', 'delta', 'Done', 1)] }));
    expect(rowNames()).toEqual(['gamma', 'delta', 'beta-two', 'beta-one', 'alpha-two', 'alpha-one']);
    expect(marks()).toEqual(['descending', 'none', 'none', null]);
    rerender(page({ rows: ITEMS.filter((row) => row.key !== 'a') }));
    expect(rowNames()).toEqual(['beta-two', 'beta-one', 'alpha-two', 'alpha-one']);
  });

  it('keeps the sort in force through a refresh and a failure that came after the rows', () => {
    const { rerender } = render(page());
    press('State');
    rerender(page({ refreshing: true }));
    rerender(page({ state: { kind: 'failed', message: 'Late.' } }));
    expect(marks()).toEqual(['none', 'ascending', 'none', null]);
    expect(rowNames()).toEqual(['alpha-one', 'alpha-two', 'gamma', 'beta-one', 'beta-two']);
  });

  it('sorts what the search and the quick filter keep, and the counts do not change when the sort does', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(page());
    press('Count');
    fireEvent.click(screen.getByRole('button', { name: 'Running 3' }));
    expect(rowNames()).toEqual(['gamma', 'beta-one', 'beta-two']);
    press('Count');
    expect(rowNames()).toEqual(['beta-two', 'beta-one', 'gamma']);
    await user.type(screen.getByRole('searchbox', { name: 'Search Items' }), 'beta');
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS);
    });
    expect(rowNames()).toEqual(['beta-two', 'beta-one']);
    expect(screen.getByRole('button', { name: 'Running 2' })).toBeInTheDocument();
  });

  it('keeps the table\'s header, with the sort in it, when a search leaves nothing', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(page());
    press('State');
    await user.type(screen.getByRole('searchbox', { name: 'Search Items' }), 'zzz{Enter}');
    expect(screen.getByText('No Items match')).toBeInTheDocument();
    expect(marks()).toEqual(['none', 'ascending', 'none', null]);
  });
});

describe('ListPage: the work a press costs', () => {
  it('is one commit, with no work on the rows the list is made of: the strip is not counted again and the source is not asked again', () => {
    const rows = Array.from({ length: 5000 }, (_, index) => item(`k${String(index)}`, `row-${String(index).padStart(4, '0')}`, index % 3 === 0 ? 'Running' : 'Failed', (index * 7919) % 1000));
    const running = vi.fn((row: Item) => row.state === 'Running');
    const counted: ListPageDefinition<Item> = { ...definition, quickFilters: { label: 'Item state', filters: [{ id: 'running', label: 'Running', tone: 'success', test: running }] } };
    const commits: string[] = [];
    render(
      <Profiler
        id="page"
        onRender={(_id, phase) => {
          commits.push(phase);
        }}
      >
        {page({ rows }, counted)}
      </Profiler>,
    );
    const mounted = commits.length;
    const filtered = running.mock.calls.length;
    expect(filtered).toBeGreaterThanOrEqual(5000);
    press('Count');
    expect(commits.length - mounted).toBe(1);
    expect(running.mock.calls.length).toBe(filtered);
    expect(marks()).toEqual(['none', 'none', 'ascending', null]);
  });
});

describe('ListPage: what it keeps of the sort, for the host to give back (the tab\'s page state)', () => {
  it('keeps nothing until the person chooses: the default is the definition\'s, and is not the page\'s to write down', () => {
    const { writes } = (() => {
      const kept = memoryOf();
      render(page({}, definition, kept.memory));
      return kept;
    })();
    expect(writes).toEqual([]);
  });

  it('writes the sort the person chose, as plain data, and keeps what else the host holds for the tab', () => {
    const kept = memoryOf({ scroll: 40 });
    render(page({}, definition, kept.memory));
    press('Count');
    press('Count');
    expect(kept.writes).toEqual([
      { scroll: 40, sort: { column: 'count', direction: 'ascending' } },
      { scroll: 40, sort: { column: 'count', direction: 'descending' } },
    ]);
    expect(JSON.parse(JSON.stringify(kept.held()))).toEqual(kept.held());
  });

  it('opens in the sort the host gives back, before the default, when the page is drawn again (a reload, a page the keep-alive cap let go)', () => {
    const kept = memoryOf({ sort: { column: 'count', direction: 'descending' } });
    render(page({}, definition, kept.memory));
    expect(marks()).toEqual(['none', 'none', 'descending', null]);
    expect(rowNames()).toEqual(['alpha-two', 'beta-two', 'beta-one', 'gamma', 'alpha-one']);
    expect(kept.writes).toEqual([]);
  });

  it('presses on from the sort it was given back: the first press on that column turns it round', () => {
    const kept = memoryOf({ sort: { column: 'state', direction: 'descending' } });
    render(page({}, definition, kept.memory));
    press('State');
    expect(marks()).toEqual(['none', 'ascending', 'none', null]);
  });

  it('opens in the default when what the host gives back is not a sort of a column that sorts now', () => {
    for (const given of ['text', 7, [], {}, { sort: 'name' }, { sort: { column: 'note', direction: 'ascending' } }, { sort: { column: 'gone', direction: 'descending' } }, { sort: { column: 'count', direction: 'up' } }]) {
      cleanup();
      render(page({}, definition, memoryOf(given).memory));
      expect(marks()).toEqual(['ascending', 'none', 'none', null]);
    }
  });

  it('works with no memory at all: the sort lives as long as the page does', () => {
    render(page());
    press('State');
    expect(marks()).toEqual(['none', 'ascending', 'none', null]);
  });
});
