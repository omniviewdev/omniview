import { Link, type KeyValueRow } from '@omniviewdev/kit';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore } from '../../shell';
import type { ContextV1, DetailSource, DetailView, ListPageV1, OverviewPageV1 } from '../contract/v1';
import { acme, answering, startedOn, widgetPage, WIDGETS, type Widget } from '../testing';
import type { ConnectionsApi } from './connections/api';
import { unusedVerbs } from './homeTesting';
import { PluginHost, type PluginHostProps } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE, type HostRoute } from './route';

// jsdom lays nothing out: the table's region gets the size a browser would give it, so rows are in view, and it has no canvas to measure text on.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

// The overview page through the host (HM3), against an invented plugin (Acme) whose widgets live in connections: the page of a SCOPE, drawn with the anatomy of a detail page (the header, the in-page tabs, the Overview's summary and
// sections) for a connection and not for an object. What is under test is what the host does with an `overview` contribution: the heading it draws (the connection's NAME, the page's title when the route names none), the context its hook is
// given, the face of its tab, the layout, the links of its rows, what happens when the connection changes, and each state of the data.

const KEY = 'north-0123456789';
const OTHER = 'south-9876543210';
const NAMES: Readonly<Record<string, string>> = { [KEY]: 'north', [OTHER]: 'south' };

const retry = vi.fn<() => void>();
const refresh = vi.fn<() => Promise<void>>(async () => undefined);

type Mode = 'ready' | 'slow' | 'broken' | 'throws' | 'cell-throws' | 'rows-malformed';
const world: { mode: Mode } = { mode: 'ready' };
/** What the host told the page's hook, in the order it asked. */
let asked: ContextV1[] = [];

/** The cell of the Widgets table is the plugin's code: in the mode `cell-throws` it throws when the table draws a row. */
const columns = [
  {
    id: 'name',
    header: 'Name',
    fit: 'flex' as const,
    width: 160,
    text: (row: Widget) => row.name,
    cell: (row: Widget) => {
      if (world.mode === 'cell-throws') {
        throw new Error('SECRET the cell of the plugin');
      }

      return row.name;
    },
  },
];

const view = (name: string): DetailView => ({
  state: { role: 'healthy', label: 'Connected' },
  facts: [{ text: 'Acme region one' }],
  counts: { metrics: 4 },
  tabs: {
    overview: {
      kind: 'overview',
      summary: [{ status: { role: 'healthy', label: 'Connected' } }, { value: '2', label: 'widgets' }],
      sections: [
        { id: 'attention', kind: 'list', title: 'Needs attention', rows: [{ id: 'behind', title: <Link to={{ page: 'widgets' }}>alpha is behind</Link>, detail: 'Two writes are waiting', meta: '2' }] },
        { id: 'widgets', kind: 'table', title: 'Widgets', columns, rows: WIDGETS, getRowKey: (row: Widget) => row.key },
        // In the mode `rows-malformed` the plugin gives a section whose rows are not there.
        { id: 'details', kind: 'kv', title: 'Details', rows: world.mode === 'rows-malformed' ? (undefined as unknown as readonly KeyValueRow[]) : [{ label: 'Name', value: name }] },
      ],
    },
    metrics: { kind: 'custom', content: 'the metrics' },
  },
});

const sourceOf = (name: string): DetailSource => {
  const base = { refreshing: false, refresh };
  switch (world.mode) {
    case 'slow':
      return { ...base, state: { kind: 'loading' }, view: undefined };
    case 'broken':
      return { ...base, state: { kind: 'failed', message: 'The read timed out.', retry }, view: undefined };
    case 'ready':
    case 'throws':
    case 'cell-throws':
    case 'rows-malformed':
      return { ...base, state: { kind: 'ready' }, view: view(name) };
  }
};

const overviewPage: OverviewPageV1 = {
  kind: 'overview',
  definition: { title: 'Overview', tile: { icon: 'server', tone: 'blue' }, tabs: [{ id: 'overview', label: 'Overview' }, { id: 'metrics', label: 'Metrics' }] },
  usePage: (context: ContextV1) => {
    asked.push(context);
    if (world.mode === 'throws') {
      throw new Error('SECRET internals of the plugin');
    }

    const name = context.route.connection === undefined ? undefined : NAMES[context.route.connection];
    return {
      // A page that has no connection says so under another label, as a plugin that marks nothing does; one that has marks its face, whatever it is labelled.
      scope: [name === undefined ? { label: 'Scope', icon: 'server', text: 'all' } : { label: 'Zone', icon: 'server', text: name, role: 'connection' }],
      source: sourceOf(name ?? ''),
    };
  },
};

/** The widgets list, whose lane says the connection by its name as the overview's does. */
const widgets: ListPageV1<Widget> = widgetPage('Widgets', (context) => {
  const listed = answering(WIDGETS)(context);
  return { ...listed, frame: { ...listed.frame, scope: [{ label: 'Zone', icon: 'server', text: NAMES[context.route.connection ?? ''] ?? 'all', role: 'connection' }] } };
});

const ready = (): PluginEntry => {
  const base = acme();
  return {
    id: 'acme',
    name: 'Acme plugin',
    phase: 'ready',
    contribution: acme({
      sidebar: { ...base.sidebar, nodes: [{ id: 'overview', label: 'Overview', icon: 'server' }, { id: 'widgets', label: 'Widgets', icon: 'box' }, { id: 'gadgets', label: 'Gadgets', icon: 'box' }] },
      pages: { overview: overviewPage, widgets, gadgets: base.pages.gadgets ?? widgets },
      home: 'overview',
    }),
  };
};

const at = (connection?: string): HostRoute => ({ plugin: 'acme', page: 'overview', connection, params: {} });

// One snapshot for every read, as a store gives: a new array on each read would never settle.
const entries: readonly PluginEntry[] = [ready()];
const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };

function mount(over: Partial<PluginHostProps> = {}) {
  const props: PluginHostProps = { plugins, inventory: 'ready', link: NO_ROUTE, onRetry: vi.fn(), onRetryInventory: vi.fn(), session: over.link === undefined ? startedOn(entries) : undefined, ...over };
  const view = render(<PluginHost {...props} />);
  return {
    ...view,
    user: userEvent.setup(),
    /** The address changes: the next distinct link opens through smart open. */
    again: (next: Partial<PluginHostProps>) => {
      view.rerender(<PluginHost {...props} {...next} />);
    },
  };
}

const tabs = () => screen.queryAllByRole('tab', { name: /./ }).filter((tab) => tab.closest('[aria-label="Open tabs"]') !== null);
const selectedTab = () => tabs().find((tab) => tab.getAttribute('aria-selected') === 'true');
const section = (id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-detail-section="${id}"]`);
  if (found === null) {
    throw new Error(`the page draws no section "${id}"`);
  }

  return found;
};

beforeEach(() => {
  world.mode = 'ready';
  asked = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  retry.mockClear();
  refresh.mockClear();
  window.location.hash = '';
});

describe('the overview page of a route', () => {
  it('is the page of the connection: its heading is the connection\'s NAME and never its key, with the state, the fact, the summary and a section of each kind', () => {
    mount({ link: at(KEY) });

    expect(screen.getByRole('heading', { level: 1, name: 'north' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Overview sections' })).toBeInTheDocument();
    // The state is said in the header's identity line and again by the summary's status: the same word twice, once each.
    expect(screen.getAllByText('Connected')).toHaveLength(2);
    expect(screen.getByText('Acme region one')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'north status' })).toBeInTheDocument();
    // The list, the table and the key-value pairs, each in the card the Overview draws, in the order given.
    expect([...document.querySelectorAll('[data-detail-section]')].map((card) => card.getAttribute('data-detail-section'))).toEqual(['attention', 'widgets', 'details']);
    expect(within(section('attention')).getByRole('heading', { level: 2, name: 'Needs attention' })).toBeInTheDocument();
    expect(within(section('widgets')).getByRole('heading', { level: 2, name: 'Widgets' })).toBeInTheDocument();
    expect(within(section('details')).getByRole('heading', { level: 2, name: 'Details' })).toBeInTheDocument();
    expect(within(section('attention')).getByRole('list', { name: 'Needs attention' })).toHaveTextContent('alpha is behind');
    expect(within(section('widgets')).getByRole('region', { name: 'Widgets' })).toHaveTextContent('beta');
    expect(within(section('details')).getByText('Name')).toBeInTheDocument();
    expect(within(section('details')).getByText('north')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Metrics\s*4/ })).toBeInTheDocument();
    // The key is the route's and the plugin's: it is drawn nowhere.
    expect(document.body.textContent).not.toContain(KEY);
  });

  it('draws the heading from the name the window has for the connection, and the page\'s title when the route names none', () => {
    mount({ link: at() });

    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Overview status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh Overview' })).toBeInTheDocument();
  });

  it('asks the hook for the route\'s connection and no parameters: the page of a scope has no object', () => {
    mount({ link: at(KEY) });

    expect(asked.length).toBeGreaterThan(0);
    for (const context of asked) {
      expect(context.plugin).toBe('acme');
      expect(context.route).toEqual({ page: 'overview', connection: KEY, params: {} });
    }
  });

  it('draws the path in the footer alone: the plugin and the current connection have labels but no parent route', () => {
    mount({ link: at(KEY) });
    const footer = within(screen.getByRole('contentinfo', { name: 'Status bar' }));
    const path = within(footer.getByRole('navigation', { name: 'Current resource' }));

    expect(path.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Acme', 'north']);
    expect(path.getByText('north').closest('li')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'north' }).closest('header')?.querySelector('nav')).toBeNull();
    expect(path.queryByRole('button')).toBeNull();
  });

  it('says the plugin alone in the path while no connection is named', () => {
    mount({ link: at() });
    const path = within(screen.getByRole('navigation', { name: 'Current resource' }));

    expect(path.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Acme']);
  });

  it('is a tab titled Overview, whose accessible name carries the connection by its name', () => {
    mount({ link: at(KEY) });

    expect(tabs()).toHaveLength(1);
    expect(selectedTab()).toHaveAccessibleName('Overview, north');
  });

  it('is a document: the page scrolls, header and body together, as a detail page does, and not a pane', () => {
    mount({ link: at(KEY) });

    expect(document.querySelector('[data-page-slot]')).toHaveAttribute('data-layout', 'document');
  });

  it('keeps the sidebar\'s overview entry current, as the plugin\'s home and as an entry of its sidebar', () => {
    mount({ link: at(KEY) });

    expect(screen.getByRole('treeitem', { name: 'Overview', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Widgets', selected: false })).toBeInTheDocument();
  });

  it('opens at the plugin\'s home when the window has been left on it: the session\'s tab at home is the overview, with no connection named', () => {
    mount();

    expect(screen.getByRole('tablist', { name: 'Overview sections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(selectedTab()).toHaveAccessibleName('Overview');
  });

  it('switches the in-page tab with the arrow keys and shows the plugin\'s own content', async () => {
    const { user } = mount({ link: at(KEY) });
    screen.getByRole('tab', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: /Metrics/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: /Metrics/ })).toHaveTextContent('the metrics');
  });

  it('gives the plugin\'s source the page\'s own Refresh, named after the connection', async () => {
    const { user } = mount({ link: at(KEY) });
    await user.click(screen.getByRole('button', { name: 'Refresh north' }));

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('a link in a row of a section of the overview', () => {
  it('is a real anchor that carries the connection, and opens the list in the tab on screen on a plain click, in the same connection', async () => {
    const { user } = mount({ link: at(KEY) });
    const anchor = screen.getByRole('link', { name: 'alpha is behind' });
    expect(anchor).toHaveAttribute('href', `#/acme/widgets?connection=${KEY}`);

    await user.click(anchor);

    expect(tabs()).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Widgets' })).toBeInTheDocument();
    expect(selectedTab()).toHaveAccessibleName('Widgets, north');
    expect(screen.getByRole('treeitem', { name: 'Widgets', selected: true })).toBeInTheDocument();
    expect(asked.at(-1)?.route.connection).toBe(KEY);
  });
});

describe('a connection chosen while the overview is on screen', () => {
  // jsdom hides a `[popover]` that no rule shows (the Popover API is the setup's stand-in, which marks an element and shows nothing), and a hidden element is inaccessible to the queries.
  let shown: HTMLStyleElement | undefined;
  beforeEach(() => {
    shown = document.createElement('style');
    shown.textContent = '[popover] { display: block !important; }';
    document.head.append(shown);
  });
  afterEach(() => {
    shown?.remove();
  });

  const connected = (id: string) => ({ connection: { id, name: NAMES[id] }, readiness: 'CONNECTED' });
  const api: ConnectionsApi = {
    ...unusedVerbs,
    states: async () => ({ acme: [connected(KEY), connected(OTHER)] }),
    start: async () => ({ status: 'CONNECTED' }),
    onStatus: () => () => undefined,
    onSync: () => () => undefined,
  };

  it('keeps the page: the tab goes to the overview of the new connection and opens no tab, and the heading says the new name', async () => {
    const { user } = mount({ link: at(KEY), connections: api, panel: createPanelStore() });
    await act(async () => Promise.resolve());
    expect(screen.getByRole('heading', { level: 1, name: 'north' })).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Zone: north' }));
    await user.click(await screen.findByRole('option', { name: /south/ }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'south' })).toBeInTheDocument();
    });
    expect(tabs()).toHaveLength(1);
    expect(selectedTab()).toHaveAccessibleName('Overview, south');
    expect(screen.getByRole('tablist', { name: 'Overview sections' })).toBeInTheDocument();
    expect(asked.at(-1)?.route).toEqual({ page: 'overview', connection: OTHER, params: {} });
    expect(within(section('details')).getByText('south')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(OTHER);
  });

  it('does not carry the failure of a section to the new connection: the plugin gives that connection\'s sections, and the section is tried by itself', async () => {
    world.mode = 'cell-throws';
    const { user } = mount({ link: at(KEY), connections: api, panel: createPanelStore() });
    await act(async () => Promise.resolve());
    expect(within(section('widgets')).getByRole('alert')).toHaveTextContent('Widgets failed to display.');

    world.mode = 'ready';
    await user.click(await screen.findByRole('button', { name: 'Zone: north' }));
    await user.click(await screen.findByRole('option', { name: /south/ }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'south' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(section('widgets')).getByRole('region', { name: 'Widgets' })).toHaveTextContent('beta');
  });

  // N4 of the review of HM3b: the tab on screen went to the other connection, and where a tab already showed that very place there were TWO tabs on it, both named `Overview, south`, and the strip could not tell them apart. A place is one tab (ch16 S26): the tab that
  // shows it is shown, and the tab on screen keeps its own connection.
  const names = () => tabs().map((tab) => tab.getAttribute('aria-label'));

  it('shows the overview of that connection when one is open already, and the tab on screen keeps its own: no two tabs are on one place', async () => {
    const { user, again } = mount({ link: at(KEY), connections: api, panel: createPanelStore() });
    await act(async () => Promise.resolve());
    again({ link: at(OTHER) });
    expect(names()).toEqual(['Overview, north', 'Overview, south']);
    await user.click(tabs()[0]);
    expect(selectedTab()).toHaveAccessibleName('Overview, north');
    expect(screen.getByRole('heading', { level: 1, name: 'north' })).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Zone: north' }));
    await user.click(await screen.findByRole('option', { name: /south/ }));

    await waitFor(() => {
      expect(selectedTab()).toHaveAccessibleName('Overview, south');
    });
    expect(names()).toEqual(['Overview, north', 'Overview, south']);
    expect(screen.getByRole('heading', { level: 1, name: 'south' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(OTHER);

    // The tab that stayed is where it was left: it still shows north.
    await user.click(tabs()[0]);
    expect(screen.getByRole('heading', { level: 1, name: 'north' })).toBeInTheDocument();
  });

  it('shows the list of that connection when one is open already, and the tab on screen keeps its own: the same for a list', async () => {
    const list = (connection: string): HostRoute => ({ plugin: 'acme', page: 'widgets', connection, params: {} });
    const { user, again } = mount({ link: list(KEY), connections: api, panel: createPanelStore() });
    await act(async () => Promise.resolve());
    again({ link: list(OTHER) });
    expect(names()).toEqual(['Widgets, north', 'Widgets, south']);
    await user.click(tabs()[0]);
    expect(screen.getByRole('button', { name: 'Zone: north' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zone: north' }));
    await user.click(await screen.findByRole('option', { name: /south/ }));

    await waitFor(() => {
      expect(selectedTab()).toHaveAccessibleName('Widgets, south');
    });
    expect(names()).toEqual(['Widgets, north', 'Widgets, south']);
    expect(screen.getByRole('button', { name: 'Zone: south' })).toBeInTheDocument();
  });

  it('still moves the tab when no other tab shows the connection\'s page: the page the tab was on, in the other connection', async () => {
    const { user, again } = mount({ link: at(KEY), connections: api, panel: createPanelStore() });
    await act(async () => Promise.resolve());
    // Another tab, of another page of the same connection that is chosen: a place that is not the one the tab goes to.
    again({ link: { plugin: 'acme', page: 'widgets', connection: OTHER, params: {} } });
    await user.click(tabs()[0]);

    await user.click(await screen.findByRole('button', { name: 'Zone: north' }));
    await user.click(await screen.findByRole('option', { name: /south/ }));

    await waitFor(() => {
      expect(selectedTab()).toHaveAccessibleName('Overview, south');
    });
    expect(names()).toEqual(['Overview, south', 'Widgets, south']);
  });
});

describe('the overview in every state of its data', () => {
  it('says that it is loading under the name, with the header and the strip where they will be', () => {
    world.mode = 'slow';
    mount({ link: at(KEY) });

    expect(screen.getByRole('heading', { level: 1, name: 'north' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Overview sections' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading north' })).toBeInTheDocument();
    expect(document.querySelector('[data-detail-section]')).toBeNull();
  });

  it('says that the read failed in the page\'s words, under the name, and offers the plugin\'s Retry', async () => {
    world.mode = 'broken';
    const { user } = mount({ link: at(KEY) });

    expect(screen.getByRole('heading', { level: 1, name: 'north' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn\'t load north');
    expect(screen.getByRole('alert')).toHaveTextContent('The read timed out.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('an overview whose hook throws', () => {
  it('is the kit\'s failure notice in the page\'s place, with the strip and the sidebar, and none of the plugin\'s own words on screen', () => {
    world.mode = 'throws';
    mount({ link: at(KEY) });

    // The plugin's hook is what threw: the host ran it, in the page's own component, and the boundary around that component caught it.
    expect(asked.length).toBeGreaterThan(0);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Couldn\'t load Overview');
    expect(alert).toHaveTextContent('This page failed to display.');
    expect(screen.queryByText(/SECRET/)).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Acme navigation' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Open tabs' })).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith('[plugins] acme page overview failed to render', expect.any(Error), expect.any(String));
  });

  it('is contained to its tab: the other page of the plugin draws, and the overview draws again on Retry once the hook works', async () => {
    world.mode = 'throws';
    const { user } = mount({ link: at(KEY) });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('treeitem', { name: 'Widgets' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Widgets' })).toBeInTheDocument();

    world.mode = 'ready';
    await user.click(screen.getByRole('treeitem', { name: 'Overview' }));
    expect(screen.getByRole('heading', { level: 1, name: 'north' })).toBeInTheDocument();
  });
});

describe('an overview with a section that fails to draw (S2)', () => {
  // An overview is the aggregate of independent reads: what one section's data or cells do to themselves is that section's failure, said in its own card, and the page, its header and its other sections stay.
  /** What stays: the heading (the connection's name), the state, the summary, the strip, the sidebar, and each section that is fine. */
  function expectTheRestStays(failed: string): void {
    expect(screen.getByRole('heading', { level: 1, name: 'north' })).toBeInTheDocument();
    expect(screen.getAllByText('Connected')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'north status' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Overview sections' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Overview', selected: true })).toBeInTheDocument();
    expect([...document.querySelectorAll('[data-detail-section]')].map((card) => card.getAttribute('data-detail-section'))).toEqual(['attention', 'widgets', 'details']);
    for (const id of ['attention', 'widgets', 'details'].filter((each) => each !== failed)) {
      expect(within(section(id)).getByRole('heading', { level: 2 })).toBeInTheDocument();
    }
  }

  it('says in the card of the Widgets table that it failed to display when a cell of the plugin throws, and everything else stays', () => {
    world.mode = 'cell-throws';
    mount({ link: at(KEY) });

    expectTheRestStays('widgets');
    expect(within(section('attention')).getByRole('list', { name: 'Needs attention' })).toHaveTextContent('alpha is behind');
    expect(within(section('details')).getByText('north')).toBeInTheDocument();
    const card = within(section('widgets'));
    expect(card.getByRole('heading', { level: 2, name: 'Widgets' })).toBeInTheDocument();
    expect(card.getByRole('alert')).toHaveTextContent('Widgets failed to display.');
    expect(card.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // The page's own failure notice is not drawn, and none of the plugin's words are: they are in the log.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText(/This page failed to display/)).toBeNull();
    expect(document.body.textContent).not.toContain('SECRET');
    expect(console.error).toHaveBeenCalledWith('[page] section widgets failed to render', expect.any(Error), expect.any(String));
    expect(console.error).not.toHaveBeenCalledWith('[plugins] acme page overview failed to render', expect.anything(), expect.anything());
  });

  it('draws the table again on Retry, once the cell works, and the other sections are not drawn again', async () => {
    world.mode = 'cell-throws';
    const { user } = mount({ link: at(KEY) });
    const kept = section('attention');

    world.mode = 'ready';
    await user.click(within(section('widgets')).getByRole('button', { name: 'Retry' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(within(section('widgets')).getByRole('region', { name: 'Widgets' })).toHaveTextContent('beta');
    expectTheRestStays('');
    expect(section('attention')).toBe(kept);
  });

  it('says in the card of the Details section that it failed to display when its rows are not there, and everything else stays', () => {
    world.mode = 'rows-malformed';
    mount({ link: at(KEY) });

    expectTheRestStays('details');
    expect(within(section('widgets')).getByRole('region', { name: 'Widgets' })).toHaveTextContent('beta');
    const card = within(section('details'));
    expect(card.getByRole('heading', { level: 2, name: 'Details' })).toBeInTheDocument();
    expect(card.getByRole('alert')).toHaveTextContent('Details failed to display.');
    expect(card.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(document.body.textContent).not.toContain(KEY);
  });
});
