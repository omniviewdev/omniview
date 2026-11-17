import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListPageDefinition, ListSource } from './definition';
import { ListPage } from './ListPage';
import { FELT_MS } from './useRefreshFeedback';
import { SEARCH_DELAY_MS } from './useSearchDraft';

// jsdom lays nothing out: the table's region gets the size a browser would give it, so rows are in view.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

// The page is plugin-agnostic, so the tests are too: invented items.
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
  columns: [
    { id: 'name', header: 'Name', fit: 'id', text: (row) => row.name, cell: (row) => row.name },
    { id: 'state', header: 'State', fit: 'fixed', width: 120, cell: (row) => row.state },
  ],
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

const source = (over: Partial<ListSource<Item>> = {}): ListSource<Item> => ({
  state: { kind: 'ready' },
  rows: ITEMS,
  complete: true,
  refreshing: false,
  refresh: async () => undefined,
  ...over,
});

const page = (over: Partial<ListSource<Item>> = {}, def: ListPageDefinition<Item> = definition) => <ListPage definition={def} source={source(over)} />;

const rowNames = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]?.textContent);
const footer = (container: HTMLElement) => container.querySelector('[data-ov-part="footer"]')?.textContent;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ListPage: the composition', () => {
  it('draws the heading, the Refresh command, the quick filters, the search, the table and the count, in one pane', () => {
    const { container } = render(page());
    expect(screen.getByRole('heading', { level: 1, name: 'Items' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh Items' })).toBeInTheDocument();
    const strip = screen.getByRole('group', { name: 'Item state' });
    expect(within(strip).getAllByRole('button').map((chip) => chip.textContent)).toEqual(['All 5', 'Running 3', 'Failed 1', 'Done 1']);
    expect(screen.getByRole('group', { name: 'Search and filter Items' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search Items' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Items' })).toBeInTheDocument();
    expect(rowNames()).toEqual(['alpha-one', 'alpha-two', 'beta-one', 'beta-two', 'gamma']);
    expect(footer(container)).toBe('5 Items');
  });

  it('is a pure function of its definition and its source: another list is another page, with nothing of the first left', () => {
    const { rerender } = render(page());
    rerender(page({ rows: [item('z', 'zeta', 'Done')] }));
    expect(rowNames()).toEqual(['zeta']);
    expect(screen.getByRole('button', { name: 'All 1' })).toBeInTheDocument();
  });

  it('draws no strip when the definition has no quick filters, and no tile when it has none', () => {
    render(page({}, { ...definition, quickFilters: undefined }));
    expect(screen.queryByRole('group', { name: 'Item state' })).toBeNull();
  });

  it('draws the commands the definition gives, before the Refresh command', () => {
    const onSelect = vi.fn();
    render(page({}, { ...definition, commands: { primary: { id: 'create', label: 'Create Item', onSelect } } }));
    const lane = screen.getByRole('group', { name: 'Items commands' });
    expect(within(lane).getAllByRole('button').map((button) => button.textContent)).toEqual(['Create Item', '']);
    fireEvent.click(screen.getByRole('button', { name: 'Create Item' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('ListPage: the search (applied 500 ms after the last key)', () => {
  it('shows what is typed at once and narrows the list, the counts and the footer when the delay is over', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = render(page());
    await user.type(screen.getByRole('searchbox', { name: 'Search Items' }), 'beta');
    expect(screen.getByRole('searchbox', { name: 'Search Items' })).toHaveValue('beta');
    expect(rowNames()).toHaveLength(5);
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS);
    });
    expect(rowNames()).toEqual(['beta-one', 'beta-two']);
    expect(footer(container)).toBe('2 of 5 Items');
    // counted after the search, before the chosen filter
    const strip = screen.getByRole('group', { name: 'Item state' });
    expect(within(strip).getAllByRole('button').map((chip) => chip.textContent)).toEqual(['All 2', 'Running 1', 'Failed 0', 'Done 1']);
  });

  // MNR-T13 (T-19): a search that re-filters the whole collection on every key costs that each time; a burst of keys inside the delay is one change.
  it('does no filtering work per keystroke: a burst of keys inside 500 ms is one change of the list', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime, delay: 20 });
    const searchText = vi.fn((row: Item) => `${row.name}\n${row.state}`.toLowerCase());
    render(page({}, { ...definition, searchText }));
    expect(searchText).not.toHaveBeenCalled();
    await user.type(screen.getByRole('searchbox', { name: 'Search Items' }), 'beta-one');
    expect(screen.getByRole('searchbox', { name: 'Search Items' })).toHaveValue('beta-one');
    expect(searchText).not.toHaveBeenCalled();
    expect(rowNames()).toHaveLength(5);
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS);
    });
    expect(searchText).toHaveBeenCalled();
    expect(rowNames()).toEqual(['beta-one']);
  });

  it('applies on Enter without waiting', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(page());
    await user.type(screen.getByRole('searchbox', { name: 'Search Items' }), 'gamma{Enter}');
    expect(rowNames()).toEqual(['gamma']);
  });

  it('applies a cleared field at once', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(page());
    await user.type(screen.getByRole('searchbox', { name: 'Search Items' }), 'gamma{Enter}');
    await user.clear(screen.getByRole('searchbox', { name: 'Search Items' }));
    expect(rowNames()).toHaveLength(5);
  });

  it('says "No Items match" and "0 of 5 Items" when nothing matches, and keeps the table\'s header', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = render(page());
    await user.type(screen.getByRole('searchbox', { name: 'Search Items' }), 'zzz{Enter}');
    expect(screen.getByText('No Items match')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(footer(container)).toBe('0 of 5 Items');
  });
});

describe('ListPage: the quick filters', () => {
  it('narrows the list to the chosen filter, and says so in the footer, leaving the other counts as they were', () => {
    const { container } = render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Running 3' }));
    expect(rowNames()).toEqual(['alpha-one', 'beta-one', 'gamma']);
    expect(footer(container)).toBe('3 of 5 Items');
    expect(screen.getByRole('button', { name: 'Running 3' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Failed 1' })).toBeInTheDocument();
  });

  it('clears the filter when the chosen chip is chosen again, and when All is', () => {
    render(page());
    fireEvent.click(screen.getByRole('button', { name: 'Running 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Running 3' }));
    expect(rowNames()).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Failed 1' }));
    expect(rowNames()).toEqual(['alpha-two']);
    fireEvent.click(screen.getByRole('button', { name: 'All 5' }));
    expect(rowNames()).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'All 5' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ListPage: Clear filters (one, in the toolbar)', () => {
  it('is absent while nothing narrows the list', () => {
    render(page());
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('appears with a filter, drops the filter and the search, and hands the focus to the search', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(page());
    const field = screen.getByRole('searchbox', { name: 'Search Items' });
    await user.type(field, 'beta{Enter}');
    fireEvent.click(screen.getByRole('button', { name: 'Running 1' }));
    expect(rowNames()).toEqual(['beta-one']);
    const clear = screen.getByRole('button', { name: 'Clear filters' });
    clear.focus();
    fireEvent.click(clear);
    expect(rowNames()).toHaveLength(5);
    expect(field).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(field).toHaveFocus();
  });

  it('appears while the search is applied, not while it is only typed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(page());
    await user.type(screen.getByRole('searchbox', { name: 'Search Items' }), 'be');
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(SEARCH_DELAY_MS);
    });
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});

describe('ListPage: the states of the body', () => {
  it('says it is loading, in a busy status, while the first rows are on their way, with no number on the chips and a count of what is loaded', () => {
    const { container } = render(page({ rows: [], state: { kind: 'loading' }, complete: false }));
    expect(screen.getByRole('status', { name: 'Loading Items' })).toHaveAttribute('aria-busy', 'true');
    const strip = screen.getByRole('group', { name: 'Item state' });
    expect(within(strip).getAllByRole('button').map((chip) => chip.textContent)).toEqual(['All', 'Running', 'Failed', 'Done']);
    expect(footer(container)).toBe('0 Items loaded');
  });

  it('says "No Items" for a whole set that is empty', () => {
    const { container } = render(page({ rows: [] }));
    expect(screen.getByText('No Items')).toBeInTheDocument();
    expect(footer(container)).toBe('0 Items');
  });

  it('is one alert, with the reason and the one Retry, and no footer, when a failure left no rows', () => {
    const retry = vi.fn();
    const { container } = render(page({ rows: [], complete: false, state: { kind: 'failed', message: 'Nobody answered.', retry } }));
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Couldn\'t load Items')).toBeInTheDocument();
    expect(within(alert).getByText('Nobody answered.')).toBeInTheDocument();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(footer(container)).toBeUndefined();
    // the way back stays where it was
    expect(screen.getByRole('searchbox', { name: 'Search Items' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh Items' })).toBeInTheDocument();
  });

  it('keeps the rows when a failure came after them', () => {
    render(page({ state: { kind: 'failed', message: 'Late.' } }));
    expect(rowNames()).toHaveLength(5);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('counts what is loaded, not what there is, while the set is still arriving', () => {
    const { container } = render(page({ complete: false }));
    expect(footer(container)).toBe('5 Items loaded');
  });
});

describe('ListPage: the user\'s own Refresh is felt (in the header\'s slot, not in the footer)', () => {
  it('says "Refreshing…" in the slot at once, with the command unavailable and the reason as its description, then "Updated"', async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const refresh = vi.fn(async () => promise);
    const { container } = render(page({ refresh }));
    const header = container.querySelector('header')!;
    expect(within(header).queryByRole('article')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Items' }));
    expect(refresh).toHaveBeenCalledTimes(1);
    const operation = within(header).getByRole('article', { name: 'Info: Refresh Items' });
    expect(within(operation).getByText('Refreshing…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh Items', description: 'Refreshing' })).toHaveAttribute('aria-disabled', 'true');
    expect(footer(container)).toBe('5 Items');
    await act(async () => {
      resolve();
      await vi.advanceTimersByTimeAsync(FELT_MS);
    });
    expect(within(header).getByRole('article', { name: 'Success: Refresh Items' })).toHaveTextContent('Updated');
    expect(screen.getByRole('button', { name: 'Refresh Items' })).not.toHaveAttribute('aria-disabled');
  });

  it('announces both ends of it, politely, through a live region that was in the page before the text', async () => {
    render(page());
    const live = screen.getAllByRole('status').find((status) => status.textContent === '')!;
    expect(live).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Items' }));
    expect(live).toHaveTextContent('Refreshing Items');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FELT_MS);
    });
    expect(live).toHaveTextContent('Items refreshed');
  });

  it('keeps the command unavailable, with its reason, while a refresh nobody asked for runs, and says nothing in the slot', () => {
    const { container } = render(page({ refreshing: true }));
    expect(screen.getByRole('button', { name: 'Refresh Items', description: 'Refreshing' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(container.querySelector('header')!).queryByRole('article')).toBeNull();
  });

  it('keeps the command unavailable while the first load runs, saying so', () => {
    render(page({ rows: [], state: { kind: 'loading' }, complete: false }));
    expect(screen.getByRole('button', { name: 'Refresh Items', description: 'Loading' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('puts nothing about it in the footer', () => {
    const { container } = render(page({ refreshing: true }));
    expect(footer(container)).toBe('5 Items');
  });
});

describe('ListPage: what it draws, counted', () => {
  it('is the same few elements however many rows it lists, and the slot is there at rest (nothing moves when it fills)', () => {
    const { container } = render(page());
    const header = container.querySelector<HTMLElement>('[data-ov-part="header"]')!;
    // under the page header: the row, the h1, the commands group, the Refresh button with its glyph (svg and path) and the slot
    expect(header.querySelector('header')?.querySelectorAll('*').length).toBe(7);
    // under the footer: the count's cluster and the count
    expect(container.querySelector('[data-ov-part="footer"]')?.querySelectorAll('*').length).toBe(2);
    expect(container.querySelector('[data-ov-slot]')).not.toBeNull();
  });
});
