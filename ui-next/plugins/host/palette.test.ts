import { isIconName } from '@omniviewdev/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, createTabsStore, seedChips, type Destination, type PaletteStore, type PanelStore, type Route, type TabsStore } from '../../shell';
import type { FrameV1, SidebarNodeV1 } from '../contract/v1';
import { acme, answering, widgetPage } from '../testing';
import { createContributions, HOME_PAGE, routeKey, type PluginSource } from './contributions';
import { createHostPalette, type HostPalette } from './palette';
import type { PluginEntry } from './pluginStore';
import { Published } from './published';

// The host's side of the command palette (palette.ts): the three sources it registers (pages, tabs, commands), the commands it runs, what the palette opens with, and what it keeps up to date while
// the window lives. Built over a plugin source, a tab store and a contributions object made the way contributions.test.ts and PluginHost.test.tsx make theirs; the palette store is the real one
// (the model is tested in ui-next/shell/core/palette), so a row is read as the data a view would draw. Invented plugins: acme and beta contribute, gamma is loading and delta did not load.

const BETA_NODES: readonly SidebarNodeV1[] = [
  { id: 'overview', label: 'Overview', icon: 'layers' },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: 'folder-tree',
    children: [
      { id: 'items', label: 'Items', icon: 'box' },
      { id: 'storage', label: 'Storage', icon: 'folder-tree', children: [{ id: 'racks', label: 'Racks', icon: 'server' }] },
    ],
  },
  // Opens nothing: no page has this id, so the sidebar draws no entry for it and neither does the palette.
  { id: 'soon', label: 'Soon', icon: 'clock' },
];

const ready = (id: string, name: string, patch: Parameters<typeof acme>[0]): PluginEntry => ({ id, name, phase: 'ready', contribution: acme(patch) });

/** Its home page's title (Widgets) is not its name, and the leaf that opens it is labelled Start. */
const ACME = ready('acme', 'Acme plugin', {
  rail: { icon: 'layers', order: 2 },
  sidebar: {
    label: 'Acme navigation',
    title: 'Acme',
    nodes: [
      {
        id: 'group',
        label: 'Group',
        icon: 'layers',
        children: [
          { id: 'widgets', label: 'Start', icon: 'box' },
          { id: 'gadgets', label: 'Gadgets', icon: 'box' },
        ],
      },
    ],
  },
});

/** Its home page's title is its name, so the home row has no context of its own until the leaf that opens it gives one. First in the rail. */
const BETA = ready('beta', 'Beta plugin', {
  plugin: { name: 'Beta' },
  rail: { icon: 'server', order: 1 },
  sidebar: { label: 'Beta navigation', title: 'Beta', nodes: BETA_NODES },
  pages: { overview: widgetPage('Beta', answering([], 'Beta')), items: widgetPage('Items', answering([], 'Items')), racks: widgetPage('Racks', answering([], 'Racks')) },
  home: 'overview',
});

const GAMMA: PluginEntry = { id: 'gamma', name: 'Gamma plugin', phase: 'loading' };
const DELTA: PluginEntry = { id: 'delta', name: 'Delta plugin', phase: 'failed', failure: { kind: 'missing', message: 'The plugin\'s interface could not be read.' } };

/** The plugins as the store lists them, which is not the rail's order. */
const ENTRIES: readonly PluginEntry[] = [GAMMA, ACME, DELTA, BETA];

/** The sidebar nodes the plugin on the rail published, with a count of who listens. */
class CountedNodes extends Published<readonly SidebarNodeV1[] | null> {
  live = 0;

  constructor() {
    super();
    const subscribe = this.subscribe;
    this.subscribe = (listener) => {
      this.live += 1;
      const stop = subscribe(listener);
      let isStopped = false;
      return () => {
        if (!isStopped) {
          isStopped = true;
          this.live -= 1;
        }

        stop();
      };
    };
  }
}

/** The tab store as the palette is given it, counting what is subscribed through either of its two ways to listen. */
function watching(real: TabsStore): { readonly store: TabsStore; readonly live: () => number } {
  let live = 0;
  const count = (stop: () => void): (() => void) => {
    live += 1;
    let isStopped = false;
    return () => {
      if (!isStopped) {
        isStopped = true;
        live -= 1;
      }

      stop();
    };
  };

  return {
    store: {
      ...real,
      subscribe: (listener) => count(real.subscribe(listener)),
      subscribeTo: (select, listener, equals) => count(real.subscribeTo(select, listener, equals)),
    },
    live: () => live,
  };
}

type Setup = {
  readonly entries?: readonly PluginEntry[];
  readonly platform?: 'mac' | 'other';
  readonly panel?: PanelStore;
  readonly onCloseWindow?: () => void;
  /** Where each plugin was last shown, as the host remembers it: what a page of a plugin that is not on screen opens at. */
  readonly remembered?: (plugin: string) => Route | undefined;
  /** Replaces what the palette is given as the tab store: a test that needs an answer the real one cannot give. */
  readonly tabs?: (real: TabsStore) => TabsStore;
};

/** What a test holds of the palette it built: the palette and its store, the tab store, what the plugins and the published values are, and the handles that change them. */
type World = {
  readonly palette: HostPalette;
  readonly store: PaletteStore;
  readonly tabs: TabsStore;
  readonly frames: Published<FrameV1>;
  readonly nodes: CountedNodes;
  /** The listeners of the plugin source. */
  readonly listeners: ReadonlySet<() => void>;
  /** How many listeners the palette's tab store has now. */
  readonly tabListeners: () => number;
  /** What the plugins came to: the source tells whoever listens, as the plugin store does. */
  readonly set: (next: readonly PluginEntry[]) => void;
  /** Opens a tab of its own (it is not deduplicated or navigated into another) and answers its id. */
  readonly open: (destination: Destination) => string;
};

function build(setup: Setup = {}): World {
  let entries: readonly PluginEntry[] = setup.entries ?? ENTRIES;
  const heard = new Set<() => void>();
  const plugins: PluginSource = {
    getSnapshot: () => entries,
    subscribe: (listener) => {
      heard.add(listener);
      return () => {
        heard.delete(listener);
      };
    },
  };
  const frames = new Published<FrameV1>();
  const nodes = new CountedNodes();
  const contributions = createContributions({ plugins, frames });
  let counter = 0;
  const tabs = createTabsStore({
    contributions,
    newId: () => {
      counter += 1;
      return `t${String(counter)}`;
    },
  });
  const watched = watching(setup.tabs === undefined ? tabs : setup.tabs(tabs));
  const palette = createHostPalette({ tabs: watched.store, plugins, contributions, nodes, panel: setup.panel, platform: setup.platform ?? 'mac', onCloseWindow: setup.onCloseWindow, remembered: setup.remembered });
  return {
    palette,
    store: palette.store,
    tabs,
    frames,
    nodes,
    listeners: heard,
    tabListeners: watched.live,
    /** What the plugins came to: the source tells whoever listens, as the plugin store does. */
    set: (next: readonly PluginEntry[]) => {
      entries = next;
      for (const listener of [...heard]) {
        listener();
      }
    },
    /** Opens a tab of its own (it is not deduplicated or navigated into another) and answers its id. */
    open: (destination: Destination): string => {
      const result = tabs.open(destination, { how: 'new' });
      if (result.status !== 'done') {
        throw new Error(`the tab did not open: ${JSON.stringify(result)}`);
      }

      return result.id;
    },
  };
}

const at = (plugin: string, contribution: string, connection?: string): Destination => ({ route: { plugin, contribution, params: connection === undefined ? {} : { connection } } });

const rowsOf = (w: World, section: string) => w.store.getSnapshot().sections.find((candidate) => candidate.id === section)?.rows ?? [];
const titlesOf = (w: World, section: string): string[] => rowsOf(w, section).map((row) => row.title.text);

/** The palette says nothing matched `query`: it offers the places to start from instead, and counts no result. */
function expectNoResults(w: World, query: string): void {
  expect(w.store.getSnapshot().note).toEqual({ type: 'no-results', query });
  expect(w.store.getSnapshot().total).toBe(0);
}

function rowTitled(w: World, title: string) {
  const row = w.store.getSnapshot().rows.find((candidate) => candidate.title.text === title);
  if (row === undefined) {
    throw new Error(`no row is titled "${title}": ${JSON.stringify(w.store.getSnapshot().rows.map((candidate) => candidate.title.text))}`);
  }

  return row;
}

/** The pages the strip shows, left to right. */
function stripOf(w: World): string[] {
  const state = w.tabs.getSnapshot();
  return state.order.map((id) => `${state.tabs[id]?.location.route.plugin ?? '?'}/${state.tabs[id]?.location.route.contribution ?? '?'}`);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the pages source', () => {
  it('opens on the homes of the plugins: the ones that are ready in the rail\'s order, then the others as the source lists them', () => {
    const w = build();
    w.store.open();

    expect(titlesOf(w, 'goto')).toEqual(['Beta', 'Acme', 'Gamma plugin', 'Delta plugin']);

    // The rail's order is not the order the source lists the ready ones in, and the others keep the source's order, whatever their names are.
    w.set([DELTA, ACME, GAMMA, BETA]);
    w.store.refresh();
    expect(titlesOf(w, 'goto')).toEqual(['Beta', 'Acme', 'Delta plugin', 'Gamma plugin']);
  });

  it('makes one row for the home of each plugin, whatever state it is in: its glyph, its words, and the page it opens; a plugin that is not ready is Degraded', () => {
    const w = build();
    w.store.open();

    expect(
      rowsOf(w, 'goto').map((row) => ({ kind: row.kind, noun: row.noun, title: row.title.text, context: row.context.text, icon: row.tile?.icon, tone: row.tile?.tone, word: row.word, route: row.route, plugin: row.plugin })),
    ).toEqual([
      { kind: 'home', noun: 'Plugin home', title: 'Beta', context: 'Overview', icon: 'server', tone: 'neutral', word: '', route: { plugin: 'beta', contribution: 'overview', params: {} }, plugin: 'host' },
      { kind: 'home', noun: 'Plugin home', title: 'Acme', context: 'Widgets', icon: 'layers', tone: 'neutral', word: '', route: { plugin: 'acme', contribution: 'widgets', params: {} }, plugin: 'host' },
      { kind: 'home', noun: 'Plugin home', title: 'Gamma plugin', context: '', icon: 'box', tone: 'neutral', word: 'Degraded', route: { plugin: 'gamma', contribution: HOME_PAGE, params: {} }, plugin: 'host' },
      { kind: 'home', noun: 'Plugin home', title: 'Delta plugin', context: '', icon: 'status-error', tone: 'neutral', word: 'Degraded', route: { plugin: 'delta', contribution: HOME_PAGE, params: {} }, plugin: 'host' },
    ]);
  });

  it('lists the openable leaves of the sidebar of each plugin that is ready after its home, in the order the sidebar draws them, each saying whose it is and the groups it sits in; a plugin that is not ready offers its home only', () => {
    const w = build();
    w.store.open({ kind: 'goto' });

    expect(rowsOf(w, 'goto').map((row) => [row.kind, row.title.text, row.context.text])).toEqual([
      ['home', 'Beta', 'Overview'],
      ['page', 'Items', 'Beta · Inventory'],
      ['page', 'Racks', 'Beta · Inventory › Storage'],
      ['home', 'Acme', 'Widgets'],
      ['page', 'Gadgets', 'Acme · Group'],
      ['home', 'Gamma plugin', ''],
      ['home', 'Delta plugin', ''],
    ]);
  });

  it('opens a leaf at its page, as a page of the plugin that has the leaf\'s own glyph', () => {
    const w = build();
    w.store.open({ kind: 'goto' });
    const racks = rowTitled(w, 'Racks');

    expect(racks).toMatchObject({ kind: 'page', noun: 'Page', route: { plugin: 'beta', contribution: 'racks', params: {} }, tile: { icon: 'server', tone: 'neutral' }, availability: { state: 'available' } });
    expect(racks.action).toMatchObject({ type: 'open', destination: { route: { plugin: 'beta', contribution: 'racks' } } });
  });

  it('opens a page of a plugin that is not on screen at the connection that plugin was last used in, as its own sidebar does, and leaves the plugin on screen to the tab model', () => {
    const w = build({ remembered: (plugin) => (plugin === 'acme' ? { plugin: 'acme', contribution: 'widgets', params: { connection: 'north' } } : undefined) });
    w.open(at('beta', 'items'));
    w.store.open({ kind: 'goto' });
    expect(rowTitled(w, 'Gadgets').route).toEqual({ plugin: 'acme', contribution: 'gadgets', params: { connection: 'north' } });
    expect(rowTitled(w, 'Racks').route).toEqual({ plugin: 'beta', contribution: 'racks', params: {} });
    w.store.close();
    w.open(at('acme', 'widgets', 'south'));
    w.store.open({ kind: 'goto' });
    expect(rowTitled(w, 'Gadgets').route).toEqual({ plugin: 'acme', contribution: 'gadgets', params: {} });
  });

  it('says only the keys that work for a place: the four open keys of the tab model, no New window (the shell has no second window), and refuses Shift+Enter with the reason', () => {
    const w = build();
    w.store.open({ kind: 'goto' });
    expect(w.store.getSnapshot().hints.map((hint) => hint.label)).toEqual(['Open', 'Here', 'New tab', 'Background tab']);

    const tabsBefore = w.tabs.getSnapshot().order.length;
    expect(w.store.activate(undefined, { shiftKey: true })).toMatchObject({ status: 'refused', message: 'This window cannot open another one yet.' });
    expect(w.store.getSnapshot().open).toBe(true);
    expect(w.tabs.getSnapshot().order).toHaveLength(tabsBefore);
  });

  it('does not offer the leaf that opens the plugin\'s home as a second row: its label joins the home\'s context when that was empty, and the home\'s keywords in any case', () => {
    const w = build();
    w.store.open({ kind: 'goto' });
    expect(titlesOf(w, 'goto')).not.toContain('Overview');
    expect(titlesOf(w, 'goto')).not.toContain('Start');

    // Beta's home had no context of its own: the leaf's label is its context. Acme's has one (its page's title), and the leaf's label only finds it.
    w.store.setQuery('overview');
    expect(titlesOf(w, 'goto')).toEqual(['Beta']);
    expect(rowTitled(w, 'Beta').context.text).toBe('Overview');
    w.store.setQuery('start');
    expect(titlesOf(w, 'goto')).toEqual(['Acme']);
    expect(rowTitled(w, 'Acme').context.text).toBe('Widgets');
  });

  it('finds a page by the plugin\'s name and by the groups it sits in, which the row says', () => {
    const w = build();
    w.store.open();

    w.store.setQuery('acme');
    expect(titlesOf(w, 'goto')).toEqual(['Acme', 'Gadgets']);
    w.store.setQuery('storage');
    expect(titlesOf(w, 'goto')).toEqual(['Racks']);
  });

  it('reads the nodes the plugin published over its skeleton, and says the plugin\'s name for a leaf that sits in no group; a glyph the kit lacks is passed on', () => {
    const w = build();
    w.nodes.publish('acme', [
      { id: 'gadgets', label: 'Gizmos', icon: 'not-a-glyph' as SidebarNodeV1['icon'] },
      { id: 'ghost', label: 'Ghost', icon: 'box' },
    ]);
    w.store.open({ kind: 'goto' });

    expect(rowsOf(w, 'goto').filter((row) => row.route?.plugin === 'acme').map((row) => [row.title.text, row.context.text, row.tile?.icon])).toEqual([
      ['Acme', 'Widgets', 'layers'],
      ['Gizmos', 'Acme', 'not-a-glyph'],
    ]);

    // A hook that answered nothing leaves the skeleton.
    w.nodes.publish('acme', null);
    w.store.refresh();
    expect(rowsOf(w, 'goto').filter((row) => row.route?.plugin === 'acme').map((row) => row.title.text)).toEqual(['Acme', 'Gadgets']);
  });

  it('reads the plugins and the nodes each time the palette asks, so nothing it kept can be stale', () => {
    const w = build();
    w.store.open({ kind: 'goto' });
    expect(titlesOf(w, 'goto')).toContain('Gadgets');

    w.set([GAMMA, BETA]);
    w.store.refresh();
    expect(titlesOf(w, 'goto')).toEqual(['Beta', 'Items', 'Racks', 'Gamma plugin']);

    w.set([GAMMA, ACME, BETA]);
    w.nodes.publish('acme', [{ id: 'widgets', label: 'Widgets again', icon: 'box' }]);
    w.store.refresh();
    expect(titlesOf(w, 'goto')).toEqual(['Beta', 'Items', 'Racks', 'Acme', 'Gamma plugin']);
  });

  it('answers only for the plugin the palette is narrowed to', () => {
    const w = build();
    w.store.open({ kind: 'goto', scope: seedChips({ plugin: 'beta', pluginName: 'Beta', scope: { id: 'north', label: 'north' } }) });

    expect(titlesOf(w, 'goto')).toEqual(['Beta', 'Items', 'Racks']);
    w.store.setQuery('gadgets');
    expectNoResults(w, 'gadgets');
  });

  it('draws every glyph it chooses from the kit\'s own', () => {
    const w = build();
    w.store.open({ kind: 'goto' });

    expect(rowsOf(w, 'goto')).toHaveLength(7);
    for (const row of rowsOf(w, 'goto')) {
      expect(isIconName(row.tile?.icon ?? '')).toBe(true);
    }
  });
});

describe('the tabs source', () => {
  /** Three tabs: a page of acme in a connection, a page of beta, and a deep page of beta in a connection, whose plugin says where it is. The last is on screen. */
  function strip() {
    const w = build();
    const north = w.open(at('acme', 'widgets', 'north'));
    const items = w.open(at('beta', 'items'));
    w.frames.publish(routeKey({ plugin: 'beta', contribution: 'racks', params: { connection: 'north' } }), { tab: { title: 'Racks', icon: 'server' }, path: ['Beta', 'Inventory', 'Storage', 'Racks'] });
    const racks = w.open(at('beta', 'racks', 'north'));
    return { w, north, items, racks };
  }

  it('lists the open tabs in the strip\'s order: the tab\'s title and glyph, and where it is', () => {
    const { w, north, items, racks } = strip();
    w.store.open({ kind: 'tabs' });

    expect(rowsOf(w, 'tabs').map((row) => ({ kind: row.kind, noun: row.noun, title: row.title.text, context: row.context.text, icon: row.tile?.icon, plugin: row.plugin, action: row.action.type === 'activate' ? row.action.tab : row.action.type }))).toEqual([
      { kind: 'tab', noun: 'Tab', title: 'Widgets', context: 'north', icon: 'box', plugin: 'host', action: north },
      { kind: 'tab', noun: 'Tab', title: 'Items', context: '', icon: 'box', plugin: 'host', action: items },
      { kind: 'tab', noun: 'Tab', title: 'Racks', context: 'Inventory › Storage · north · Current tab', icon: 'server', plugin: 'host', action: racks },
    ]);
  });

  it('puts the crumbs between the plugin\'s name and the page\'s own title first, then the scope, and says a place once: a connection that the path names is not told twice', () => {
    const { w } = strip();
    w.store.open({ kind: 'tabs' });
    const contexts = rowsOf(w, 'tabs').map((row) => row.context.text);

    // The first tab's path is Acme › north › Widgets and its scope is north.
    expect(contexts[0]).toBe('north');
    // The last one's path does not name its scope: it follows the crumbs.
    expect(contexts[2]).toBe('Inventory › Storage · north · Current tab');
  });

  it('draws that the tab is the one on screen and never matches it: a query for the words is not answered by the one tab that holds them', () => {
    const { w } = strip();
    w.store.open();

    w.store.setQuery('current');
    expectNoResults(w, 'current');
    w.store.setQuery('inventory');
    expect(titlesOf(w, 'tabs')).toEqual(['Racks']);
    expect(rowsOf(w, 'tabs')[0]?.context.text).toContain('Current tab');
  });

  it('finds a tab by the plugin\'s name and by the page\'s id', () => {
    const { w } = strip();
    w.store.open({ kind: 'tabs' });

    w.store.setQuery('beta');
    expect(titlesOf(w, 'tabs')).toEqual(['Items', 'Racks']);
    w.store.setQuery('widgets');
    expect(titlesOf(w, 'tabs')).toEqual(['Widgets']);
  });

  it('carries the tab\'s own route, so a tab of a plugin that did not load is Degraded', () => {
    const w = build();
    w.open(at('delta', HOME_PAGE));
    w.store.open({ kind: 'tabs' });

    expect(rowsOf(w, 'tabs').map((row) => [row.title.text, row.word, row.tile?.icon])).toEqual([['Delta plugin', 'Degraded', 'status-error']]);
    expect(rowsOf(w, 'tabs')[0]?.route).toEqual({ plugin: 'delta', contribution: HOME_PAGE, params: {} });
  });

  it('lets the user switch to a tab whose plugin is gone: its row names no destination, so it is not refused as one, and choosing it brings the tab forward', () => {
    const w = build();
    const gone = w.open(at('delta', HOME_PAGE));
    w.open(at('acme', 'widgets'));
    w.set(ENTRIES.filter((entry) => entry.id !== 'delta'));
    w.store.open({ kind: 'tabs' });
    const row = rowsOf(w, 'tabs').find((candidate) => candidate.title.text === 'Delta plugin');
    expect(row?.route).toBeUndefined();
    expect(row?.availability).toEqual({ state: 'available' });
    expect(w.store.activate(row?.id)).toMatchObject({ status: 'opened' });
    expect(w.tabs.getSnapshot().active).toBe(gone);
  });

  it('answers only for the plugin the palette is narrowed to, and has no row for a window with no tab', () => {
    const { w } = strip();
    w.store.open({ kind: 'tabs', scope: seedChips({ plugin: 'acme', pluginName: 'Acme', scope: { id: 'north', label: 'north' } }) });
    expect(titlesOf(w, 'tabs')).toEqual(['Widgets']);

    const empty = build();
    empty.store.open({ kind: 'tabs' });
    expect(titlesOf(empty, 'tabs')).toEqual([]);
  });
});

describe('the host\'s sources', () => {
  it('offer only candidates the model takes as data: it drops none, and says no source gave it something unusable', () => {
    const w = build({ platform: 'mac', panel: createPanelStore(), onCloseWindow: vi.fn() });
    w.open(at('acme', 'widgets', 'north'));
    w.open(at('beta', 'items'));
    w.open(at('delta', HOME_PAGE));

    // Each kind lists whole what its source offers, so the model reads every candidate.
    for (const [kind, section, count] of [['goto', 'goto', 7], ['tabs', 'tabs', 3], ['commands', 'commands', 5]] as const) {
      w.store.open({ kind });
      expect(rowsOf(w, section)).toHaveLength(count);
      expect(w.store.getSnapshot().sources).toEqual([]);
      w.store.close();
    }
  });

  it('are named for the status band as the host\'s own, and a source that fails takes none of the others with it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = build({
      tabs: (real) => ({
        ...real,
        selectors: {
          ...real.selectors,
          identity: () => {
            throw new Error('The tab model could not name the tab.');
          },
        },
      }),
    });
    w.open(at('acme', 'widgets'));
    // A hook that answered something that is not a list of nodes.
    w.nodes.publish('acme', 'not a list' as unknown as readonly SidebarNodeV1[]);
    w.store.open();
    w.store.setQuery('tab');

    expect(w.store.getSnapshot().runs.map((run) => [run.name, run.label])).toEqual([
      ['Omniview · Pages', 'Pages: Unavailable'],
      ['Omniview · Tabs', 'Tabs: Unavailable'],
    ]);
    expect(titlesOf(w, 'commands')).toEqual(['Close tab', 'Next tab', 'Previous tab']);
  });
});

describe('the commands', () => {
  it('offers the real commands of the host, each with its words and the chord the host binds: Command on a Mac', () => {
    const w = build({ platform: 'mac', panel: createPanelStore(), onCloseWindow: vi.fn() });
    w.open(at('acme', 'widgets'));
    w.open(at('beta', 'items'));
    w.store.open({ kind: 'commands' });

    expect(rowsOf(w, 'commands').map((row) => ({ title: row.title.text, context: row.context.text, icon: row.tile?.icon, shortcut: row.shortcut, command: row.action.type === 'run' ? row.action.command.id : row.action.type, kind: row.kind, state: row.availability.state }))).toEqual([
      { title: 'Close tab', context: 'Tabs', icon: 'close', shortcut: '⌘W', command: 'host.tab.close', kind: 'command', state: 'available' },
      { title: 'Toggle panel', context: 'Panel', icon: 'panel-bottom', shortcut: '⌘J', command: 'host.panel.toggle', kind: 'command', state: 'available' },
      { title: 'Close window', context: 'Window', icon: 'close', shortcut: '⌘⇧W', command: 'host.window.close', kind: 'command', state: 'available' },
      { title: 'Next tab', context: 'Tabs', icon: 'arrow-right', shortcut: undefined, command: 'host.tab.next', kind: 'command', state: 'available' },
      { title: 'Previous tab', context: 'Tabs', icon: 'arrow-left', shortcut: undefined, command: 'host.tab.previous', kind: 'command', state: 'available' },
    ]);
  });

  it('writes the chords with Control elsewhere, and offers no Close window there: the main window hides on Windows and Linux and nothing brings it back', () => {
    const w = build({ platform: 'other', panel: createPanelStore(), onCloseWindow: vi.fn() });
    w.open(at('acme', 'widgets'));
    w.store.open({ kind: 'commands' });
    w.store.setQuery('window');
    expectNoResults(w, 'window');

    w.store.setQuery('');
    expect(rowsOf(w, 'commands').map((row) => [row.title.text, row.shortcut])).toEqual([
      ['Close tab', 'Ctrl+W'],
      ['Toggle panel', 'Ctrl+J'],
    ]);
  });

  it('says the chords the shell binds with Control Option where the window is a browser tab and not the app\'s own, because a browser keeps Command and Control W and J for itself', () => {
    for (const [platform, close, toggle] of [['mac', '⌃⌥W', '⌃⌥J'], ['other', 'Ctrl+Alt+W', 'Ctrl+Alt+J']] as const) {
      const w = build({ platform, panel: createPanelStore() });
      w.open(at('acme', 'widgets'));
      w.store.open({ kind: 'commands' });
      expect(rowsOf(w, 'commands').map((row) => [row.title.text, row.shortcut]).slice(0, 2)).toEqual([['Close tab', close], ['Toggle panel', toggle]]);
    }
  });

  it('offers Toggle panel only when the window has a panel, and Close window only on a Mac that can close the window', () => {
    const none = build({ platform: 'mac' });
    none.open(at('acme', 'widgets'));
    none.open(at('beta', 'items'));
    none.store.open({ kind: 'commands' });
    expect(titlesOf(none, 'commands')).toEqual(['Close tab', 'Next tab', 'Previous tab']);

    const panel = build({ platform: 'mac', panel: createPanelStore(), onCloseWindow: undefined });
    panel.open(at('acme', 'widgets'));
    panel.open(at('beta', 'items'));
    panel.store.open({ kind: 'commands' });
    expect(titlesOf(panel, 'commands')).toEqual(['Close tab', 'Toggle panel', 'Next tab', 'Previous tab']);

    const window = build({ platform: 'mac', onCloseWindow: vi.fn() });
    window.open(at('acme', 'widgets'));
    window.open(at('beta', 'items'));
    window.store.open({ kind: 'commands' });
    expect(titlesOf(window, 'commands')).toEqual(['Close tab', 'Close window', 'Next tab', 'Previous tab']);
  });

  it('keeps a command the state forbids, with its reason, until a query reaches it', () => {
    const w = build();
    w.store.open({ kind: 'commands' });
    // With no tab on screen none of the three can run, and an empty list leaves them out.
    expect(titlesOf(w, 'commands')).toEqual([]);

    w.store.setQuery('tab');
    expect(rowsOf(w, 'commands').map((row) => [row.title.text, row.availability, row.word])).toEqual([
      ['Close tab', { state: 'unavailable', reason: 'There is no tab to close.' }, 'Unavailable'],
      ['Next tab', { state: 'unavailable', reason: 'There is no other tab.' }, 'Unavailable'],
      ['Previous tab', { state: 'unavailable', reason: 'There is no other tab.' }, 'Unavailable'],
    ]);

    // One tab: it can be closed, and there is no other to go to.
    w.open(at('acme', 'widgets'));
    w.store.refresh();
    expect(rowsOf(w, 'commands').map((row) => [row.title.text, row.availability.state])).toEqual([
      ['Close tab', 'available'],
      ['Next tab', 'unavailable'],
      ['Previous tab', 'unavailable'],
    ]);

    w.open(at('beta', 'items'));
    w.store.refresh();
    expect(rowsOf(w, 'commands').map((row) => row.availability.state)).toEqual(['available', 'available', 'available']);
  });

  it('answers while the palette is narrowed to a plugin: the host\'s commands stay reachable', () => {
    const w = build({ platform: 'mac', panel: createPanelStore() });
    w.open(at('acme', 'widgets'));
    w.store.open({ kind: 'commands', scope: seedChips({ plugin: 'acme', pluginName: 'Acme', scope: { id: 'north', label: 'north' } }) });

    expect(titlesOf(w, 'commands')).toEqual(['Close tab', 'Toggle panel']);
  });

  it('finds a command by the words of its title', () => {
    const w = build({ platform: 'mac', panel: createPanelStore() });
    w.open(at('acme', 'widgets'));
    w.store.open();

    w.store.setQuery('toggle');
    expect(titlesOf(w, 'commands')).toEqual(['Toggle panel']);
    w.store.setQuery('panel');
    expect(titlesOf(w, 'commands')).toEqual(['Toggle panel']);
  });

  it('draws every glyph it chooses from the kit\'s own', () => {
    const w = build({ platform: 'mac', panel: createPanelStore(), onCloseWindow: vi.fn() });
    w.open(at('acme', 'widgets'));
    w.open(at('beta', 'items'));
    w.store.open({ kind: 'commands' });

    expect(rowsOf(w, 'commands')).toHaveLength(5);
    for (const row of rowsOf(w, 'commands')) {
      expect(isIconName(row.tile?.icon ?? '')).toBe(true);
    }
  });
});

describe('running a command', () => {
  it('closes the tab on screen, and the palette closes after it', () => {
    const w = build();
    w.open(at('acme', 'widgets'));
    w.open(at('beta', 'items'));
    w.store.open({ kind: 'commands' });

    const result = w.store.activate(rowTitled(w, 'Close tab').id);

    expect(result).toMatchObject({ status: 'ran', outcome: 'done' });
    expect(stripOf(w)).toEqual(['acme/widgets']);
    expect(w.store.getSnapshot().open).toBe(false);
  });

  it('moves to the next tab and to the previous one, round the strip', () => {
    const w = build();
    const first = w.open(at('acme', 'widgets'));
    w.open(at('beta', 'items'));
    const last = w.open(at('beta', 'racks'));
    expect(w.tabs.getSnapshot().active).toBe(last);

    w.store.open({ kind: 'commands' });
    expect(w.store.activate(rowTitled(w, 'Next tab').id)).toMatchObject({ status: 'ran', outcome: 'done' });
    expect(w.tabs.getSnapshot().active).toBe(first);

    w.store.open({ kind: 'commands' });
    expect(w.store.activate(rowTitled(w, 'Previous tab').id)).toMatchObject({ status: 'ran', outcome: 'done' });
    expect(w.tabs.getSnapshot().active).toBe(last);
  });

  it('checks the command against what is true now, not what the list showed: a tab closed after the palette listed Close tab', () => {
    const w = build();
    w.open(at('acme', 'widgets'));
    w.store.open({ kind: 'commands' });
    const row = rowTitled(w, 'Close tab');
    expect(row.availability.state).toBe('available');

    // Nothing is attached, so the list still says what it said.
    w.tabs.close();
    expect(w.tabs.getSnapshot().active).toBeNull();
    const result = w.store.activate(row.id);

    expect(result).toMatchObject({ status: 'ran', outcome: 'refused' });
    expect(w.store.getSnapshot().notice).toBe('Close tab: There is no tab to close.');
    expect(w.store.getSnapshot().open).toBe(true);
    expect(w.palette.announcer.getSnapshot().text).toBe('Close tab: There is no tab to close.');
  });

  it('checks Next tab against the strip as it is now: the other tab closed after the list was made', () => {
    const w = build();
    w.open(at('acme', 'widgets'));
    const second = w.open(at('beta', 'items'));
    w.store.open({ kind: 'commands' });
    const row = rowTitled(w, 'Next tab');

    w.tabs.close(second);
    const result = w.store.activate(row.id);

    expect(result).toMatchObject({ status: 'ran', outcome: 'refused' });
    expect(w.store.getSnapshot().notice).toBe('Next tab: There is no other tab.');
  });

  it('refuses a command it does not know, with a reason', () => {
    const w = build();
    w.store.registerProvider({ id: 'beta:commands', plugin: 'beta', pluginName: 'Beta', section: 'commands', match: () => [{ id: 'zap', kind: 'command', title: 'Zap', command: { id: 'beta.zap' } }] });
    w.store.open({ kind: 'commands' });

    const result = w.store.activate(rowTitled(w, 'Zap').id);

    expect(result).toMatchObject({ status: 'ran', outcome: 'refused' });
    expect(w.store.getSnapshot().notice).toBe('Zap: This command is not available.');
    expect(w.store.getSnapshot().open).toBe(true);
  });

  it('refuses to close a tab that holds unsaved changes, and says so: the palette stays open and the tab stays', () => {
    const w = build();
    const id = w.open(at('acme', 'widgets'));
    w.tabs.setUnsaved(id, true);
    w.store.open({ kind: 'commands' });

    const result = w.store.activate(rowTitled(w, 'Close tab').id);

    expect(result).toMatchObject({ status: 'ran', outcome: 'refused' });
    expect(w.store.getSnapshot().notice).toBe('Close tab: This tab has unsaved changes.');
    expect(w.palette.announcer.getSnapshot().text).toBe('Close tab: This tab has unsaved changes.');
    expect(stripOf(w)).toEqual(['acme/widgets']);
    expect(w.store.getSnapshot().open).toBe(true);
  });

  it('refuses with the model\'s own message when the tab model refuses', () => {
    const w = build({ tabs: (real) => ({ ...real, close: () => ({ status: 'refused', reason: 'missing', message: 'The tab went away.' }) }) });
    w.open(at('acme', 'widgets'));
    w.store.open({ kind: 'commands' });

    expect(w.store.activate(rowTitled(w, 'Close tab').id)).toMatchObject({ status: 'ran', outcome: 'refused' });
    expect(w.store.getSnapshot().notice).toBe('Close tab: The tab went away.');
    expect(stripOf(w)).toEqual(['acme/widgets']);
  });

  it('toggles the panel the way the chord does, the focus included: open, and the focus goes into the panel; again, and it goes back to the page', async () => {
    document.body.innerHTML = '<div data-shell-region="island"><div id="page" tabindex="0" data-shell-focus></div></div><div data-shell-region="panel"><div id="tool" tabindex="0" data-shell-focus></div></div>';
    const panel = createPanelStore();
    const w = build({ panel });
    w.open(at('acme', 'widgets'));
    expect(panel.getSnapshot().open).toBe(false);

    w.store.open({ kind: 'commands' });
    expect(w.store.activate(rowTitled(w, 'Toggle panel').id)).toMatchObject({ status: 'ran', outcome: 'done' });
    await Promise.resolve();
    expect(panel.getSnapshot().open).toBe(true);
    expect(document.activeElement?.id).toBe('tool');

    w.store.open({ kind: 'commands' });
    expect(w.store.activate(rowTitled(w, 'Toggle panel').id)).toMatchObject({ status: 'ran', outcome: 'done' });
    await Promise.resolve();
    expect(panel.getSnapshot().open).toBe(false);
    expect(document.activeElement?.id).toBe('page');
  });

  it('closes the window through the callback the host was given', () => {
    const onCloseWindow = vi.fn();
    const w = build({ platform: 'mac', onCloseWindow });
    w.store.open({ kind: 'commands' });

    expect(w.store.activate(rowTitled(w, 'Close window').id)).toMatchObject({ status: 'ran', outcome: 'done' });
    expect(onCloseWindow).toHaveBeenCalledTimes(1);
    expect(w.store.getSnapshot().open).toBe(false);
  });
});

describe('what the palette opens with', () => {
  it('knows the route on screen, and narrows to its plugin and its scope when the plugin is ready', () => {
    const w = build();
    w.open(at('acme', 'widgets', 'north'));

    expect(w.palette.opening()).toEqual({
      current: { plugin: 'acme', contribution: 'widgets', params: { connection: 'north' } },
      scope: [
        { kind: 'plugin', id: 'acme', label: 'Acme', plugin: 'acme', noun: 'plugin', icon: 'layers' },
        { kind: 'scope', id: 'north', label: 'north', plugin: 'acme', noun: 'scope', icon: '' },
      ],
    });
  });

  it('names the plugin as the plugin does and draws it with the glyph of its rail entry, the host\'s own when it gave none', () => {
    const plain = ready('plain', 'Plain plugin', { plugin: { name: 'Plain' }, rail: true });
    const w = build({ entries: [plain] });
    w.open(at('plain', 'widgets', 'north'));

    expect(w.palette.opening().scope).toMatchObject([{ kind: 'plugin', label: 'Plain', icon: 'box' }, { kind: 'scope', id: 'north' }]);
  });

  it('takes the place and no chips from a tab that has no scope', () => {
    const w = build();
    w.open(at('acme', 'widgets'));

    expect(w.palette.opening()).toEqual({ current: { plugin: 'acme', contribution: 'widgets', params: {} }, scope: [] });
  });

  it('takes no chips from a tab whose plugin is not ready, though it has a scope: the route is still the one on screen', () => {
    const w = build();
    w.open(at('gamma', HOME_PAGE, 'north'));

    expect(w.palette.opening()).toEqual({ current: { plugin: 'gamma', contribution: HOME_PAGE, params: { connection: 'north' } }, scope: [] });
  });

  it('has nothing to say when no tab is on screen', () => {
    const w = build();

    expect(w.palette.opening()).toEqual({ current: undefined, scope: [] });
  });

  it('opens the palette on the place, without it in Recent, and narrowed to the scope', () => {
    const w = build();
    const stop = w.palette.attach();
    w.open(at('acme', 'widgets', 'north'));
    w.open(at('acme', 'gadgets', 'north'));

    w.store.open(w.palette.opening());
    expect(w.store.getSnapshot().chips.map((chip) => chip.label)).toEqual(['Acme', 'north']);
    // Recent holds the place the user was on before, and not the one they are on.
    expect(w.store.getSnapshot().recents.map((recent) => recent.route.contribution)).toEqual(['gadgets', 'widgets']);
    expect(w.store.getSnapshot().sections.find((section) => section.id === 'recent')?.rows.map((row) => row.title.text)).toEqual(['Widgets']);
    stop();
  });
});

describe('attach', () => {
  it('remembers the place the window is on, and each one the user moves to, newest first', () => {
    const w = build();
    const first = w.open(at('acme', 'widgets'));
    const stop = w.palette.attach();
    expect(w.store.getSnapshot().recents.map((recent) => recent.route.contribution)).toEqual(['widgets']);

    w.open(at('beta', 'items'));
    expect(w.store.getSnapshot().recents.map((recent) => recent.route.contribution)).toEqual(['items', 'widgets']);
    expect(w.store.getSnapshot().recents[0]).toMatchObject({ kind: 'page', title: 'Items', context: 'Beta', icon: 'box' });

    w.tabs.activate(first);
    expect(w.store.getSnapshot().recents.map((recent) => recent.route.contribution)).toEqual(['widgets', 'items']);
    stop();
  });

  it('remembers a place again when its plugin says what it is: a window restored before its plugins had loaded', () => {
    const w = build();
    w.open(at('acme', 'widgets'));
    // The tab is open, and the host knows no plugin that could describe it.
    w.set([]);
    const stop = w.palette.attach();
    expect(w.store.getSnapshot().recents).toEqual([]);

    w.set(ENTRIES);
    expect(w.store.getSnapshot().recents.map((recent) => [recent.route.contribution, recent.title])).toEqual([['widgets', 'Widgets']]);
    stop();
  });

  it('refreshes the list while the palette is open, when the tabs, the plugins or the published nodes change', () => {
    const w = build();
    w.open(at('acme', 'widgets'));
    const stop = w.palette.attach();
    w.store.open();

    w.store.setKind('tabs');
    expect(titlesOf(w, 'tabs')).toEqual(['Widgets']);
    w.open(at('beta', 'items'));
    expect(titlesOf(w, 'tabs')).toEqual(['Widgets', 'Items']);

    w.store.setKind('goto');
    expect(titlesOf(w, 'goto')).not.toContain('Gizmos');
    w.nodes.publish('acme', [{ id: 'gadgets', label: 'Gizmos', icon: 'box' }]);
    expect(titlesOf(w, 'goto')).toContain('Gizmos');

    w.set([BETA]);
    expect(titlesOf(w, 'goto')).toEqual(['Beta', 'Items', 'Racks']);
    stop();
  });

  it('does not refresh while the palette is closed: the next open makes the list from scratch', () => {
    const w = build();
    w.open(at('acme', 'widgets'));
    const refresh = vi.spyOn(w.store, 'refresh');
    const stop = w.palette.attach();

    w.open(at('beta', 'items'));
    w.nodes.publish('acme', [{ id: 'gadgets', label: 'Gizmos', icon: 'box' }]);
    w.set([BETA, ACME]);
    expect(refresh).not.toHaveBeenCalled();

    w.store.open({ kind: 'tabs' });
    expect(titlesOf(w, 'tabs')).toEqual(['Widgets', 'Items']);
    w.open(at('beta', 'racks'));
    expect(refresh).toHaveBeenCalled();
    w.store.close();
    refresh.mockClear();
    w.open(at('beta', 'overview'));
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });

  it('leaves the list as it was made without it: the list of a palette that is open is refreshed by attach and by nothing else', () => {
    const w = build();
    w.open(at('acme', 'widgets'));
    w.store.open({ kind: 'tabs' });

    w.open(at('beta', 'items'));
    expect(titlesOf(w, 'tabs')).toEqual(['Widgets']);
  });

  it('undoes everything it did when the function it returned is called: the listeners on the tabs, the plugins and the nodes go, and nothing is recorded or refreshed after', () => {
    const w = build();
    w.open(at('acme', 'widgets'));
    const tabs = w.tabListeners();
    const plugins = w.listeners.size;
    const nodes = w.nodes.live;
    const refresh = vi.spyOn(w.store, 'refresh');

    const stop = w.palette.attach();
    expect(w.tabListeners()).toBeGreaterThan(tabs);
    expect(w.listeners.size).toBeGreaterThan(plugins);
    expect(w.nodes.live).toBeGreaterThan(nodes);
    stop();

    expect(w.tabListeners()).toBe(tabs);
    expect(w.listeners.size).toBe(plugins);
    expect(w.nodes.live).toBe(nodes);

    w.store.open();
    const recents = w.store.getSnapshot().recents;
    w.open(at('beta', 'items'));
    w.nodes.publish('acme', [{ id: 'gadgets', label: 'Gizmos', icon: 'box' }]);
    w.set([ACME]);
    expect(refresh).not.toHaveBeenCalled();
    expect(w.store.getSnapshot().recents).toBe(recents);
  });

  it('can be attached again after it was undone, and twice at once: each one undoes its own', () => {
    const w = build();
    w.open(at('acme', 'widgets'));
    const tabs = w.tabListeners();
    const plugins = w.listeners.size;
    const nodes = w.nodes.live;

    const one = w.palette.attach();
    const two = w.palette.attach();
    one();
    expect(w.tabListeners()).toBeGreaterThan(tabs);
    two();
    one();
    expect(w.tabListeners()).toBe(tabs);
    expect(w.listeners.size).toBe(plugins);
    expect(w.nodes.live).toBe(nodes);

    const again = w.palette.attach();
    again();
    expect(w.tabListeners()).toBe(tabs);
  });

  it('costs nothing while the palette is closed: no timer, and no listener on the document or the window', () => {
    const onDocument = vi.spyOn(document, 'addEventListener');
    const onWindow = vi.spyOn(window, 'addEventListener');
    const w = build({ panel: createPanelStore() });
    const stop = w.palette.attach();
    w.open(at('acme', 'widgets'));
    w.open(at('beta', 'items'));
    w.nodes.publish('acme', null);
    w.set(ENTRIES);

    expect(vi.getTimerCount()).toBe(0);
    expect(onDocument).not.toHaveBeenCalled();
    expect(onWindow).not.toHaveBeenCalled();
    stop();
  });
});

describe('through the palette store', () => {
  it('opens a page by its name, and runs Close tab by its name: the palette is closed after each', () => {
    const w = build({ platform: 'mac' });
    w.open(at('acme', 'widgets'));
    w.open(at('beta', 'items'));
    const stop = w.palette.attach();

    // The page of another plugin than the tab on screen: it opens in a tab of its own, a preview.
    w.store.open(w.palette.opening());
    w.store.setQuery('gadgets');
    expect(w.store.getSnapshot().rows[0]).toMatchObject({ kind: 'page', title: { text: 'Gadgets' } });
    expect(w.store.activate()).toMatchObject({ status: 'opened' });
    expect(stripOf(w)).toEqual(['acme/widgets', 'beta/items', 'acme/gadgets']);
    expect(w.store.getSnapshot().open).toBe(false);

    w.store.open(w.palette.opening());
    w.store.setQuery('close');
    expect(w.store.getSnapshot().rows[0]).toMatchObject({ kind: 'command', title: { text: 'Close tab' } });
    expect(w.store.activate()).toMatchObject({ status: 'ran', outcome: 'done' });
    expect(stripOf(w)).toEqual(['acme/widgets', 'beta/items']);
    expect(w.store.getSnapshot().open).toBe(false);
    stop();
  });

  it('switches to a tab by its name, and lists what the user went to in Recent', () => {
    const w = build();
    const first = w.open(at('acme', 'widgets'));
    w.open(at('beta', 'items'));
    const stop = w.palette.attach();

    w.store.open(w.palette.opening());
    w.store.setQuery('widgets');
    expect(w.store.getSnapshot().rows[0]).toMatchObject({ kind: 'tab', title: { text: 'Widgets' } });
    expect(w.store.activate()).toMatchObject({ status: 'opened' });
    expect(w.tabs.getSnapshot().active).toBe(first);

    w.store.open(w.palette.opening());
    expect(w.store.getSnapshot().sections.find((section) => section.id === 'recent')?.rows.map((row) => row.title.text)).toEqual(['Items']);
    stop();
  });

  it('tells the live region what the palette says: the sentence of the results, once they have settled', () => {
    const w = build();
    w.open(at('acme', 'widgets'));
    w.store.open();
    w.store.setQuery('gadgets');
    expect(w.palette.announcer.getSnapshot().text).toBe('');

    vi.advanceTimersByTime(500);
    expect(w.palette.announcer.getSnapshot().text).toBe('1 result');
  });
});

describe('what the host keeps of the palette as the window changes', () => {
  it('closes an open palette when what keeps it current is undone: nothing of it outlives the subscriptions', () => {
    const w = build();
    w.open(at('acme', 'widgets'));
    const stop = w.palette.attach();
    w.store.open();
    expect(w.store.getSnapshot().open).toBe(true);
    stop();
    expect(w.store.getSnapshot().open).toBe(false);
  });

  it('remembers what the tab model made of an open (the page with the connection the tab was given), a background open included, and not the route its row named', () => {
    const w = build();
    const stop = w.palette.attach();
    w.open(at('acme', 'widgets', 'north'));
    w.store.open({ kind: 'goto' });
    const gadgets = rowTitled(w, 'Gadgets');
    expect(gadgets.route?.params).toEqual({});
    w.store.activate(gadgets.id, 'background');
    expect(w.store.getSnapshot().recents.map((recent) => [recent.route.contribution, recent.route.params])).toEqual([
      ['gadgets', { connection: 'north' }],
      ['widgets', { connection: 'north' }],
    ]);
    stop();
  });

  it('moves the place the user is on out of Recent when the window goes somewhere else while the palette is open', () => {
    const w = build();
    const stop = w.palette.attach();
    const first = w.open(at('acme', 'widgets'));
    w.open(at('acme', 'gadgets'));
    w.store.open(w.palette.opening());
    const recent = () => w.store.getSnapshot().sections.find((section) => section.id === 'recent')?.rows.map((row) => row.route?.contribution);
    expect(recent()).toEqual(['widgets']);
    w.tabs.activate(first);
    expect(recent()).toEqual(['gadgets']);
    stop();
  });
});
