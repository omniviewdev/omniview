import { Link, type DataTableSort } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSession, SESSION_VERSION, type LoadedSession } from '../../shell/session';
import type { ContextV1, DetailPageV1, ListPageV1, ListPageViewV1 } from '../contract/v1';
import { acme } from '../testing';
import { PluginHost, type PluginHostProps } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE } from './route';

// jsdom lays nothing out: the table's region gets the size a browser would give it, so rows are in view, and a content that is longer than it, so the table has room to scroll.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 2000 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

// The sort of a list through the real chain (K3a): a plugin's definition says its `defaultSort` and which columns have a key, the host's list page holds the sort the person chose, and the tab's own `pageState`
// gives it back when the page is drawn again. The plugin is invented (Acme); what is under test is what the HOST does with a definition: the plugin never sorts, and writes nothing down.

type Row = { readonly key: string; readonly name: string; readonly count: number };

// By name: alpha, beta, gamma. By count as numbers, descending: alpha (10), beta (9), gamma (3).
const ROWS: readonly Row[] = [
  { key: 'a', name: 'gamma', count: 3 },
  { key: 'b', name: 'alpha', count: 10 },
  { key: 'c', name: 'beta', count: 9 },
];

/** The hook of a page that answers `rows` as a finished read. */
const answer =
  (title: string) =>
    (context: ContextV1): ListPageViewV1<Row> => ({
      frame: {
        tab: { title, icon: 'box' },
        path: ['Acme', title],
        scope: [{ label: context.route.connection === undefined ? 'Scope' : 'Connection', icon: 'server', text: context.route.connection ?? 'none' }],
      },
      source: { state: { kind: 'ready' }, rows: ROWS, complete: true, refreshing: false, refresh: async () => undefined },
    });

const NAME_UP: DataTableSort = { column: 'name', direction: 'ascending' };

/** A list whose Name and Count columns declare their keys, the name a link to the item's page; `defaultSort` is what it says it opens in. */
function sortable(title: string, defaultSort?: DataTableSort): ListPageV1<Row> {
  return {
    kind: 'list',
    definition: {
      title,
      nouns: { one: title, other: title },
      columns: [
        {
          id: 'name',
          header: 'Name',
          fit: 'flex',
          width: 160,
          text: (row) => row.name,
          cell: (row) => <Link to={{ page: 'sprocket', params: { name: row.name } }}>{row.name}</Link>,
          sortKey: (row) => row.name,
        },
        { id: 'count', header: 'Count', fit: 'fixed', width: 80, align: 'end', cell: (row) => String(row.count), sortKey: (row) => row.count, sortKind: 'number' },
      ],
      lines: 1,
      getRowKey: (row) => row.key,
      searchText: (row) => row.name,
      quickFilters: {
        label: 'Count',
        filters: [
          { id: 'many', label: 'Many', tone: 'success', test: (row) => row.count >= 9 },
          { id: 'few', label: 'Few', tone: 'error', test: (row) => row.count < 9 },
        ],
      },
      ...(defaultSort === undefined ? {} : { defaultSort }),
    },
    usePage: answer(title),
  };
}

const sprocketPage: DetailPageV1 = {
  kind: 'detail',
  definition: { kind: 'Sprocket', tile: { icon: 'box' }, identity: { name: 'name' }, list: { page: 'widgets', label: 'Widgets' }, tabs: [{ id: 'overview', label: 'Overview' }] },
  usePage: (context: ContextV1) => ({
    scope: [{ label: 'Connection', icon: 'server', text: context.route.connection ?? 'none' }],
    source: {
      state: { kind: 'ready' },
      refreshing: false,
      refresh: async () => undefined,
      view: { state: { role: 'running', label: 'Running' }, facts: [], tabs: { overview: { kind: 'overview', summary: [], sections: [] } } },
    },
  }),
};

const ready = (): PluginEntry => ({
  id: 'acme',
  name: 'Acme plugin',
  phase: 'ready',
  contribution: acme({ pages: { widgets: sortable('Widgets', NAME_UP), gadgets: sortable('Gadgets'), sprocket: sprocketPage } }),
});
const loading = (): PluginEntry => ({ id: 'acme', name: 'Acme plugin', phase: 'loading' });

type TabSpec = { readonly id: string; readonly page: string; readonly connection?: string };

/** The window as a previous run left it: these tabs, in this order, with `active` on screen. */
function sessionOf(specs: readonly TabSpec[], active: string): LoadedSession | undefined {
  const text = JSON.stringify({
    version: SESSION_VERSION,
    tabs: {
      version: 1,
      active,
      tabs: specs.map(({ id, page, connection }) => ({
        id,
        route: { plugin: 'acme', contribution: page, ...(connection === undefined ? {} : { connection }), params: {} },
        key: `acme:${page}:${connection ?? ''}`,
        pinned: false,
        preview: false,
      })),
    },
    rail: null,
    panel: { version: 1 },
  });
  return openSession({ read: async () => text, write: async () => undefined, keep: async () => undefined }, text);
}

/** The plugins the host reads: the entries now, and `set` to change them, which tells the host as the plugin store does. */
function mount(initial: readonly PluginEntry[], specs: readonly TabSpec[], active = specs[0]?.id ?? '') {
  let entries = initial;
  const listeners = new Set<() => void>();
  const plugins = {
    getSnapshot: () => entries,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const props: PluginHostProps = { plugins, inventory: 'ready', link: NO_ROUTE, onRetry: vi.fn(), onRetryInventory: vi.fn(), session: sessionOf(specs, active) };
  return {
    ...render(<PluginHost {...props} />),
    user: userEvent.setup(),
    set: (next: readonly PluginEntry[]) => {
      act(() => {
        entries = next;
        for (const listener of [...listeners]) {
          listener();
        }
      });
    },
  };
}

const slot = (id: string) => document.querySelector(`[data-page-slot][data-tab-id="${id}"]`);
const header = (name: string) => screen.getByRole('columnheader', { name });
const marks = () => screen.getAllByRole('columnheader').map((cell) => cell.getAttribute('aria-sort'));
const rowNames = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0]?.textContent);
const tabNamed = (index: number) => screen.getAllByRole('tab', { name: /./ }).filter((tab) => tab.closest('[aria-label="Open tabs"]') !== null)[index];

async function press(user: UserEvent, name: string) {
  await user.click(within(header(name)).getByRole('button', { name }));
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a plugin\'s list through the host: the sort it opens in', () => {
  it('opens in the default sort the definition says, with the header of that column saying so', () => {
    mount([ready()], [{ id: 't1', page: 'widgets' }]);

    expect(rowNames()).toEqual(['alpha', 'beta', 'gamma']);
    expect(marks()).toEqual(['ascending', 'none']);
  });

  it('opens a list whose definition has no default in the source\'s order, with its sortable headers saying none: an older plugin that gave its columns keys', () => {
    mount([ready()], [{ id: 't1', page: 'gadgets' }]);

    expect(rowNames()).toEqual(['gamma', 'alpha', 'beta']);
    expect(marks()).toEqual(['none', 'none']);
  });

  it('draws a list of an older plugin, which declares no key and no default, as it always was: no sort button, no aria-sort, the source\'s order', () => {
    mount([{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }], [{ id: 't1', page: 'widgets' }]);

    expect(within(screen.getByRole('table')).queryAllByRole('button')).toEqual([]);
    expect(screen.getAllByRole('columnheader').map((cell) => cell.getAttribute('aria-sort'))).toEqual([null]);
    expect(rowNames()).toEqual(['alpha', 'beta']);
  });
});

describe('a plugin\'s list through the host: the sort a person chose is the tab\'s own', () => {
  it('sorts on a press, and another tab of the same page opens in its own sort and leaves the first one\'s as it was', async () => {
    const { user } = mount([ready()], [{ id: 't1', page: 'widgets', connection: 'north' }, { id: 't2', page: 'widgets', connection: 'south' }]);
    await press(user, 'Count');
    await press(user, 'Count');
    expect(marks()).toEqual(['none', 'descending']);
    expect(rowNames()).toEqual(['alpha', 'beta', 'gamma']);

    await user.click(tabNamed(1));
    expect(marks()).toEqual(['ascending', 'none']);
    await user.click(tabNamed(0));
    expect(marks()).toEqual(['none', 'descending']);
  });

  it('is there when the plugin is reloaded and the page is drawn again: the sort is the tab\'s, not the page\'s', async () => {
    const { user, set } = mount([ready()], [{ id: 't1', page: 'widgets' }]);
    await press(user, 'Count');
    expect(marks()).toEqual(['none', 'ascending']);
    expect(rowNames()).toEqual(['gamma', 'beta', 'alpha']);

    set([loading()]);
    expect(screen.queryByRole('table')).toBeNull();
    set([ready()]);
    expect(marks()).toEqual(['none', 'ascending']);
    expect(rowNames()).toEqual(['gamma', 'beta', 'alpha']);
  });

  it('is there when the keep-alive cap let the page go and the tab is shown again: five pages stay mounted, the sixth shown takes the first\'s place', async () => {
    const specs = ['t1', 't2', 't3', 't4', 't5', 't6'].map((id, index): TabSpec => ({ id, page: 'widgets', connection: `c${String(index)}` }));
    const { user } = mount([ready()], specs);
    await press(user, 'Count');
    await press(user, 'Count');
    expect(marks()).toEqual(['none', 'descending']);

    for (const index of [1, 2, 3, 4, 5]) {
      await user.click(tabNamed(index));
    }

    // The page of the first tab is gone from the document, and the tab is still in the strip.
    expect(slot('t1')).toBeNull();
    expect(slot('t6')).not.toBeNull();
    await user.click(tabNamed(0));
    expect(slot('t1')).not.toBeNull();
    expect(marks()).toEqual(['none', 'descending']);
    expect(rowNames()).toEqual(['alpha', 'beta', 'gamma']);
  });

  // K3a's known gap, closed by H7: the tab model dropped a tab's page state on every navigation and every step, so what a page kept was lost on list -> detail -> Back, where the mock keeps it (its list state is
  // the tab's and is re-seeded only when the list changes). A history entry now carries the page state of the page it left, and Back and Forward give it back.
  it('is there after list -> detail -> Back', async () => {
    const { user } = mount([ready()], [{ id: 't1', page: 'widgets' }]);
    await press(user, 'Count');
    await press(user, 'Count');
    expect(marks()).toEqual(['none', 'descending']);

    await user.click(screen.getByRole('link', { name: 'alpha' }));
    await screen.findByRole('heading', { level: 1, name: 'alpha' });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(marks()).toEqual(['none', 'descending']);
    expect(rowNames()).toEqual(['alpha', 'beta', 'gamma']);
  });
});

const region = () => screen.getByRole('region', { name: 'Widgets' });
const field = () => screen.getByRole('searchbox', { name: 'Search Widgets' });
const chip = (name: RegExp) => screen.getByRole('button', { name });

/** The table scrolled the way a person does it: the offset is the element's, and then the event. */
function scrollTable(top: number) {
  region().scrollTop = top;
  fireEvent.scroll(region());
}

/** Opens an item from the list and comes back with the Back button of the top row. */
async function openAndBack(user: UserEvent, name: string) {
  await user.click(screen.getByRole('link', { name }));
  await screen.findByRole('heading', { level: 1, name });
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByRole('table')).toBeInTheDocument();
}

describe('a plugin\'s list through the host: what the person chose comes back with Back and Forward, as the list was left (H7)', () => {
  it('gives back the search: the field, and the list narrowed to it', async () => {
    const { user } = mount([ready()], [{ id: 't1', page: 'widgets' }]);
    await user.type(field(), 'ta{Enter}');
    expect(rowNames()).toEqual(['beta']);
    await openAndBack(user, 'beta');
    expect(field()).toHaveValue('ta');
    expect(rowNames()).toEqual(['beta']);
  });

  it('gives back the quick filter: its chip pressed, and the list narrowed to it', async () => {
    const { user } = mount([ready()], [{ id: 't1', page: 'widgets' }]);
    await user.click(chip(/^Many/));
    expect(rowNames()).toEqual(['alpha', 'beta']);
    await openAndBack(user, 'alpha');
    expect(chip(/^Many/)).toHaveAttribute('aria-pressed', 'true');
    expect(rowNames()).toEqual(['alpha', 'beta']);
  });

  it('gives back where the table is scrolled', async () => {
    const { user } = mount([ready()], [{ id: 't1', page: 'widgets' }]);
    scrollTable(120);
    await openAndBack(user, 'alpha');
    expect(region().scrollTop).toBe(120);
  });

  it('gives back all of it, again after Forward and Back, and a page that kept nothing is a clean page', async () => {
    const { user } = mount([ready()], [{ id: 't1', page: 'widgets' }]);
    await press(user, 'Count');
    await user.click(chip(/^Many/));
    await user.type(field(), 'a{Enter}');
    scrollTable(120);
    expect(rowNames()).toEqual(['beta', 'alpha']);


    const asLeft = () => {
      expect(marks()).toEqual(['none', 'ascending']);
      expect(chip(/^Many/)).toHaveAttribute('aria-pressed', 'true');
      expect(field()).toHaveValue('a');
      expect(rowNames()).toEqual(['beta', 'alpha']);
      expect(region().scrollTop).toBe(120);
    };

    await openAndBack(user, 'alpha');
    asLeft();

    await user.click(screen.getByRole('button', { name: 'Forward' }));
    await screen.findByRole('heading', { level: 1, name: 'alpha' });
    // The detail page kept nothing: it is drawn as any page is, and Back gives the list as it was left once more.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    asLeft();
  });

  it('opens the list as it was left, but at its top, for a new navigation to it in the tab (the detail page\'s crumb), and Back from there gives the first visit with its offset', async () => {
    const { user } = mount([ready()], [{ id: 't1', page: 'widgets' }]);
    await press(user, 'Count');
    await user.click(chip(/^Many/));
    await user.type(field(), 'a{Enter}');
    scrollTable(120);
    await user.click(screen.getByRole('link', { name: 'alpha' }));
    await screen.findByRole('heading', { level: 1, name: 'alpha' });

    await user.click(within(screen.getByRole('navigation', { name: 'Current resource' })).getByRole('button', { name: 'Widgets' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(marks()).toEqual(['none', 'ascending']);
    expect(chip(/^Many/)).toHaveAttribute('aria-pressed', 'true');
    expect(field()).toHaveValue('a');
    expect(rowNames()).toEqual(['beta', 'alpha']);
    expect(region().scrollTop).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: 'alpha' });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(region().scrollTop).toBe(120);
    expect(rowNames()).toEqual(['beta', 'alpha']);
  });

  it('keeps what was chosen in the tab it was chosen in: another tab of the same list is drawn as a list is drawn', async () => {
    const { user } = mount([ready()], [{ id: 't1', page: 'widgets', connection: 'north' }, { id: 't2', page: 'widgets', connection: 'north' }]);
    await user.click(chip(/^Many/));
    expect(rowNames()).toEqual(['alpha', 'beta']);
    await user.click(tabNamed(1));
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true');
    expect(rowNames()).toEqual(['alpha', 'beta', 'gamma']);
  });
});
