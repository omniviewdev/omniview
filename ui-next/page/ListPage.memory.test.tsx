import type { DataTableColumn } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListPageDefinition, ListSource } from './definition';
import { ListPage } from './ListPage';
import type { PageMemory } from './memory';
import { SEARCH_DELAY_MS } from './useSearchDraft';
import { SCROLL_SETTLE_MS } from './useScrollMemory';

// jsdom lays nothing out: the table's region gets the size a browser would give it, and the size of its content is the one a test says, so a position can be reached or not.
let contentHeight = 2000;
let contentWidth = 1117;
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? contentHeight : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? contentWidth : 0;
} });

// What the list keeps of what the person chose in it, for the host to give back when the page is drawn again (H7: Back, Forward, a reload, a page the keep-alive cap let go): the sort (K3a,
// `ListPage.sort.test.tsx`), the search they applied, the quick filter they chose, and where the table is scrolled. The page is plugin-agnostic, so the tests are too: invented items.
type Item = { readonly key: string; readonly name: string; readonly state: string };

const item = (key: string, name: string, state: string): Item => ({ key, name, state });

// By name: alpha-one (Done), alpha-two (Failed), beta-one, beta-two and gamma (Running).
const ITEMS: readonly Item[] = [item('a', 'gamma', 'Running'), item('b', 'alpha-two', 'Failed'), item('c', 'beta-one', 'Running'), item('d', 'alpha-one', 'Done'), item('e', 'beta-two', 'Running')];

const COLUMNS: ReadonlyArray<DataTableColumn<Item>> = [
  { id: 'name', header: 'Name', fit: 'id', text: (row) => row.name, cell: (row) => row.name, sortKey: (row) => row.name },
  { id: 'state', header: 'State', fit: 'fixed', width: 120, cell: (row) => row.state, sortKey: (row) => row.state },
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

const page = (memory?: PageMemory, over: Partial<ListSource<Item>> = {}) => <ListPage definition={definition} source={source(over)} memory={memory} />;

const rowNames = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]?.textContent);
const field = () => screen.getByRole('searchbox', { name: 'Search Items' });
const region = () => screen.getByRole('region', { name: 'Items' });
const chip = (name: RegExp) => screen.getByRole('button', { name });

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

/** Scrolls the table the way a person does: the offset is the element's, then the event. */
function scrollTo(top: number, left = 0) {
  const element = region();
  element.scrollTop = top;
  element.scrollLeft = left;
  fireEvent.scroll(element);
}

const settle = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

const typing = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  contentHeight = 2000;
  contentWidth = 1117;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ListPage: what it keeps of the search', () => {
  it('writes nothing when it opens and nothing while it is left alone: the page does not write what it has not been asked to', () => {
    const kept = memoryOf({ other: 'kept', search: 'beta', filter: 'running', scroll: { top: 40, left: 0 } });
    render(page(kept.memory));
    settle(5 * SEARCH_DELAY_MS);
    expect(kept.writes).toEqual([]);
  });

  it('writes the search 500 ms after the last key, as plain data, and keeps what else the host holds for the tab', async () => {
    const kept = memoryOf({ other: 'kept' });
    const user = typing();
    render(page(kept.memory));
    await user.type(field(), 'alp');
    expect(kept.writes).toEqual([]);
    settle(SEARCH_DELAY_MS);
    expect(kept.writes).toEqual([{ other: 'kept', search: 'alp' }]);
    expect(rowNames()).toEqual(['alpha-one', 'alpha-two']);
  });

  it('writes it at once on Enter, and takes it out at once when the field is cleared', async () => {
    const kept = memoryOf();
    const user = typing();
    render(page(kept.memory));
    await user.type(field(), 'gamma{Enter}');
    expect(kept.held()).toEqual({ search: 'gamma' });
    await user.clear(field());
    expect(kept.held()).toBeNull();
  });

  it('writes nothing for a text that was typed and never applied: the person left before the list followed it', async () => {
    const kept = memoryOf();
    const user = typing();
    const { unmount } = render(page(kept.memory));
    await user.type(field(), 'alp');
    unmount();
    settle(2 * SEARCH_DELAY_MS);
    expect(kept.writes).toEqual([]);
  });

  it('opens with the search the host gives back: the field shows it, the list follows it at once, and Clear filters is there', () => {
    render(page(memoryOf({ search: 'beta' }).memory));
    expect(field()).toHaveValue('beta');
    expect(rowNames()).toEqual(['beta-one', 'beta-two']);
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('opens with no search when what the host gives back is not one: not text, too long to be a search, or nothing', () => {
    for (const given of [{ search: 7 }, { search: ['beta'] }, { search: { text: 'beta' } }, { search: 'x'.repeat(5000) }, { search: null }, 'beta', 7, null, undefined, []]) {
      const { unmount } = render(page(memoryOf(given).memory));
      expect(field()).toHaveValue('');
      expect(rowNames()).toHaveLength(5);
      unmount();
    }
  });

  it('keeps a search too long to be one out of what it writes, and the search it had before with it: what the list shows is what is kept, or nothing', async () => {
    const kept = memoryOf({ other: 'kept', search: 'beta' });
    const user = typing();
    render(page(kept.memory));
    await user.click(field());
    await user.paste('x'.repeat(5000));
    await user.keyboard('{Enter}');
    expect(kept.held()).toEqual({ other: 'kept' });
  });
});

describe('ListPage: what it keeps of the quick filter', () => {
  it('writes the filter when it is chosen and takes it out when it is chosen again, and keeps what else the host holds', () => {
    const kept = memoryOf({ other: 'kept' });
    render(page(kept.memory));
    fireEvent.click(chip(/^Running/));
    expect(kept.writes).toEqual([{ other: 'kept', filter: 'running' }]);
    fireEvent.click(chip(/^Running/));
    expect(kept.held()).toEqual({ other: 'kept' });
    fireEvent.click(chip(/^Failed/));
    expect(kept.held()).toEqual({ other: 'kept', filter: 'failed' });
    fireEvent.click(chip(/^All/));
    expect(kept.held()).toEqual({ other: 'kept' });
    expect(kept.writes).toHaveLength(4);
  });

  it('writes nothing for All when no filter was chosen', () => {
    const kept = memoryOf();
    render(page(kept.memory));
    fireEvent.click(chip(/^All/));
    expect(kept.writes).toEqual([]);
  });

  it('opens with the filter the host gives back: its chip is pressed and the list is narrowed to it', () => {
    render(page(memoryOf({ filter: 'running' }).memory));
    expect(chip(/^Running/)).toHaveAttribute('aria-pressed', 'true');
    expect(rowNames()).toEqual(['beta-one', 'beta-two', 'gamma']);
  });

  it('opens with every item when what the host gives back is not a filter of this list: another version of the plugin had it, or it is not text', () => {
    for (const given of [{ filter: 'completed' }, { filter: 7 }, { filter: ['running'] }, { filter: null }, { filter: '' }, 'running']) {
      const { unmount } = render(page(memoryOf(given).memory));
      expect(rowNames()).toHaveLength(5);
      expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true');
      unmount();
    }
  });

  it('opens with the filter and the search together, and counts as the list does', () => {
    render(page(memoryOf({ search: 'beta', filter: 'failed' }).memory));
    expect(field()).toHaveValue('beta');
    expect(chip(/^Failed 0/)).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

describe('ListPage: Clear filters', () => {
  it('takes the search and the filter out of what the page keeps, and leaves the sort and the position', () => {
    const kept = memoryOf({ sort: { column: 'state', direction: 'descending' }, search: 'beta', filter: 'running', scroll: { top: 40, left: 0 } });
    render(page(kept.memory));
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(kept.held()).toEqual({ sort: { column: 'state', direction: 'descending' }, scroll: { top: 40, left: 0 } });
    expect(field()).toHaveValue('');
    expect(rowNames()).toHaveLength(5);
  });
});

describe('ListPage: what it keeps of where the table is scrolled', () => {
  it('writes where the table is scrolled once the scrolling stops, as plain data, and keeps what else the host holds', () => {
    const kept = memoryOf({ filter: 'running' });
    render(page(kept.memory));
    scrollTo(120);
    settle(SCROLL_SETTLE_MS - 1);
    expect(kept.writes).toEqual([]);
    settle(1);
    expect(kept.writes).toEqual([{ filter: 'running', scroll: { top: 120, left: 0 } }]);
  });

  it('writes once for a burst of scroll events, with the position it stopped at', () => {
    const kept = memoryOf();
    render(page(kept.memory));
    for (const top of [10, 50, 90, 130, 170]) {
      scrollTo(top);
      settle(SCROLL_SETTLE_MS / 3);
    }

    expect(kept.writes).toEqual([]);
    settle(SCROLL_SETTLE_MS);
    expect(kept.writes).toEqual([{ scroll: { top: 170, left: 0 } }]);
  });

  it('writes the position at once when the person presses on the page or a key, before what they press can take the page away', () => {
    const kept = memoryOf();
    render(page(kept.memory));
    scrollTo(120);
    expect(kept.writes).toEqual([]);
    fireEvent.pointerDown(within(screen.getByRole('table')).getAllByRole('cell')[0] ?? document.body);
    expect(kept.writes).toEqual([{ scroll: { top: 120, left: 0 } }]);
    settle(2 * SCROLL_SETTLE_MS);
    expect(kept.writes).toHaveLength(1);

    scrollTo(300);
    fireEvent.keyDown(region(), { key: 'Enter' });
    expect(kept.writes).toHaveLength(2);
    expect(kept.held()).toEqual({ scroll: { top: 300, left: 0 } });
  });

  it('takes the position out of what it keeps when the table is back at its start, and rounds what is not whole', () => {
    const kept = memoryOf({ scroll: { top: 120, left: 0 } });
    render(page(kept.memory));
    scrollTo(0);
    settle(SCROLL_SETTLE_MS);
    expect(kept.held()).toBeNull();

    scrollTo(33.4, 5.6);
    settle(SCROLL_SETTLE_MS);
    expect(kept.held()).toEqual({ scroll: { top: 33, left: 6 } });
  });

  it('writes nothing for the scroll of what is not the list\'s table, and nothing when the page is left before the scrolling stopped', () => {
    const kept = memoryOf();
    const { unmount } = render(page(kept.memory));
    const other = document.createElement('div');
    other.setAttribute('role', 'region');
    other.setAttribute('aria-label', 'Something else');
    region().after(other);
    other.scrollTop = 80;
    fireEvent.scroll(other);
    settle(2 * SCROLL_SETTLE_MS);
    expect(kept.writes).toEqual([]);

    scrollTo(60);
    unmount();
    settle(2 * SCROLL_SETTLE_MS);
    expect(kept.writes).toEqual([]);
  });

  it('puts the table back where the host says the page was left, as it opens', () => {
    render(page(memoryOf({ scroll: { top: 120, left: 0 } }).memory));
    expect(region().scrollTop).toBe(120);
    expect(region().scrollLeft).toBe(0);
  });

  it('puts the horizontal offset back with the vertical one, where the table is wide enough to reach it', () => {
    contentWidth = 2000;
    render(page(memoryOf({ scroll: { top: 80, left: 300 } }).memory));
    expect([region().scrollTop, region().scrollLeft]).toEqual([80, 300]);
  });

  it('puts it back once, and never again over a person who scrolled since: the table is theirs', () => {
    const { rerender } = render(page(memoryOf({ scroll: { top: 120, left: 0 } }).memory));
    expect(region().scrollTop).toBe(120);
    region().scrollTop = 300;
    rerender(page(memoryOf({ scroll: { top: 120, left: 0 } }).memory, { refreshing: true }));
    expect(region().scrollTop).toBe(300);
  });

  it('leaves the table where it is when the person scrolled it before it could be put back', () => {
    const memory = memoryOf({ scroll: { top: 400, left: 0 } }).memory;
    contentHeight = 700;
    const { rerender } = render(page(memory, { complete: false }));
    expect(region().scrollTop).toBe(0);
    scrollTo(25);
    contentHeight = 2000;
    rerender(page(memory, { complete: false, refreshing: true }));
    expect(region().scrollTop).toBe(25);
  });

  it('waits for the rows that are on their way: nothing is put back while the list loads, and it is when they arrive', () => {
    const memory = memoryOf({ scroll: { top: 400, left: 0 } }).memory;
    contentHeight = 0;
    const { rerender } = render(page(memory, { state: { kind: 'loading' }, rows: [], complete: false }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(region().scrollTop).toBe(0);
    contentHeight = 2000;
    rerender(page(memory));
    expect(region().scrollTop).toBe(400);
  });

  it('waits for the rows that are still coming while the list is not complete, and puts it back when the list is long enough', () => {
    const memory = memoryOf({ scroll: { top: 400, left: 0 } }).memory;
    contentHeight = 700;
    const { rerender } = render(page(memory, { complete: false }));
    expect(region().scrollTop).toBe(0);
    contentHeight = 1300;
    rerender(page(memory, { complete: false, refreshing: true }));
    expect(region().scrollTop).toBe(400);
  });

  it('puts it back as far as the list goes when the list is complete and has become shorter than it was', () => {
    contentHeight = 700;
    render(page(memoryOf({ scroll: { top: 400, left: 0 } }).memory));
    expect(region().scrollTop).toBe(100);
  });

  it('puts nothing back for what is not a position: a negative offset, a text, not a number, a record with none, or nothing at all', () => {
    for (const given of [{ scroll: { top: -5, left: 0 } }, { scroll: { top: 'far', left: 'x' } }, { scroll: { top: Number.NaN } }, { scroll: { top: Number.POSITIVE_INFINITY } }, { scroll: 'down' }, { scroll: 40 }, { scroll: [40] }, { scroll: {} }, { scroll: null }, [], 'scroll', null, undefined]) {
      const { unmount } = render(page(memoryOf(given).memory));
      expect(region().scrollTop).toBe(0);
      expect(region().scrollLeft).toBe(0);
      unmount();
    }
  });

  it('scrolls as any page does when the host gives it no memory: nothing is written, nothing thrown', () => {
    render(page(undefined));
    scrollTo(120);
    fireEvent.pointerDown(region());
    settle(2 * SCROLL_SETTLE_MS);
    expect(region().scrollTop).toBe(120);
  });
});
