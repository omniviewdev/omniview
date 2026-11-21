import { isIconName } from '@omniviewdev/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, createTabsStore, seedChips, type Destination, type PaletteStore, type PanelStore, type Route, type TabsStore } from '../../shell';
import type { FrameV1, PaletteCommandV1, PaletteJsonV1, PaletteMatchProviderV1, PaletteRowV1, PaletteSearchProviderV1, PaletteV1, PanelHostV1, SidebarNodeV1 } from '../contract/v1';
import { acme, answering, widgetPage } from '../testing';
import { createContributions, HOME_PAGE, routeKey, type PluginSource } from './contributions';
import { createHostPalette, type HostPalette } from './palette';
import type { PluginEntry } from './pluginStore';
import { Published } from './published';

// The host's side of the command palette (palette.ts): the three sources it registers (pages, tabs, commands), the commands it runs, what the palette opens with, and what it keeps up to date while
// the window lives. Built over a plugin source, a tab store and a contributions object made the way contributions.test.ts and PluginHost.test.tsx make theirs; the palette store is the real one
// (the model is tested in ui-next/shell/core/palette), so a row is read as the data a view would draw. Invented plugins: acme and beta contribute, gamma is loading and delta did not load.

// Keywords (C1e) are the other names a page is known by: `rk` and `shelf` are Racks (`rk` is its letters, `shelf` is not), `stuff` is Items, and the leaf that opens the plugin's home (Overview) has `ov`.
const BETA_NODES: readonly SidebarNodeV1[] = [
  { id: 'overview', label: 'Overview', icon: 'layers', keywords: ['ov'] },
  {
    id: 'inventory',
    label: 'Inventory',
    icon: 'folder-tree',
    children: [
      { id: 'items', label: 'Items', icon: 'box', keywords: ['stuff'] },
      { id: 'storage', label: 'Storage', icon: 'folder-tree', children: [{ id: 'racks', label: 'Racks', icon: 'server', keywords: ['rk', 'shelf'] }] },
    ],
  },
  // Opens nothing: no page has this id, so the sidebar draws no entry for it and neither does the palette.
  { id: 'soon', label: 'Soon', icon: 'clock', keywords: ['sn'] },
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

/** A copy of acme under another name: its Gadgets page reads as acme's does (the same title, in a group of the same name) until the rows are told apart. It has a page of its own too. Last in the rail. */
const COPY_PATCH: Parameters<typeof acme>[0] = {
  plugin: { name: 'Acme Copy' },
  rail: { icon: 'layers', order: 3 },
  sidebar: {
    label: 'Acme Copy navigation',
    title: 'Acme Copy',
    nodes: [
      {
        id: 'group',
        label: 'Group',
        icon: 'layers',
        children: [
          { id: 'widgets', label: 'Start', icon: 'box' },
          { id: 'gadgets', label: 'Gadgets', icon: 'box' },
          { id: 'sprockets', label: 'Sprockets', icon: 'box' },
        ],
      },
    ],
  },
  pages: { ...acme().pages, sprockets: widgetPage('Sprockets', answering([], 'Sprockets')) },
};
const COPY = ready('copy', 'Acme Copy plugin', COPY_PATCH);

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
  /** Hears the rows a plugin's provider answered that were left out, and why. */
  readonly report?: (problem: { readonly provider: string; readonly message: string }) => void;
  /** What each plugin may ask of the bottom panel. */
  readonly panelHosts?: (plugin: string) => PanelHostV1;
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
  const palette = createHostPalette({ tabs: watched.store, plugins, contributions, nodes, panel: setup.panel, platform: setup.platform ?? 'mac', onCloseWindow: setup.onCloseWindow, remembered: setup.remembered, report: setup.report, panelHosts: setup.panelHosts });
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

  it('lists the openable leaves of the sidebar of each plugin that is ready after its home, in the order the sidebar draws them, each saying the groups it sits in (the design lab\'s kind rows say "Workloads", never the plugin\'s name); a plugin that is not ready offers its home only', () => {
    const w = build();
    w.store.open({ kind: 'goto' });

    expect(rowsOf(w, 'goto').map((row) => [row.kind, row.title.text, row.context.text])).toEqual([
      ['home', 'Beta', 'Overview'],
      ['page', 'Items', 'Inventory'],
      ['page', 'Racks', 'Inventory › Storage'],
      ['home', 'Acme', 'Widgets'],
      ['page', 'Gadgets', 'Group'],
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

// The pages the plugin's sidebar opens, as the design lab's palette lists them (C1e). Its kind rows are rows of Go to (`shell-search.js`, `gotoCandidates`, fed by the plugin adapter's `search.entries`:
// `connectionRows`): the title is the kind, the context says where it is, `where(place) = label ? `${connectionId} · ${text}` : text` (the connection first, only when the palette offers the kind for more than one
// connection and it is not scoped to one; else the group alone: "Workloads"), and the words a row is found by are its keywords. A destination offered twice is one row (`seen` in `gotoCandidates`: "the same destination
// offered twice is one row that keeps the context and the keywords either one gave"), and an open tab is a row of Tabs besides (its screenshot shows one page under Tabs and again under Go to). What a plugin's own
// keywords add is the host's: they are names for the page, and the palette ranks a name as it ranks a title (`shell/core/palette/match.ts`).
describe('the pages source: the plugin\'s keywords, where each page says it is, and one row for a route (C1e)', () => {
  const gotoOf = (w: World, query: string): string[] => {
    w.store.setQuery(query);
    return titlesOf(w, 'goto');
  };

  /** The chain of a palette narrowed to a plugin and nothing under it: the first chip of the one a tab with a connection makes (`seedChips` makes none for a tab without one). */
  const pluginOnly = (plugin: string, name: string) => seedChips({ plugin, pluginName: name, scope: { id: 'x', label: 'x' } }).slice(0, 1);

  describe('the keywords of a leaf', () => {
    it('find the page by a name the label does not hold, and rank it as the label ranks: a keyword typed whole leads the pages whose titles only hold its letters', () => {
      const w = build();
      // `Workloads` holds `rk` inside a word, which is a substring match of a title (348), and `Racks` holds it only as the letters of two of its own (a loose match, 204): the keyword is worth an exact one (600).
      w.nodes.publish('acme', [{ id: 'gadgets', label: 'Workloads', icon: 'box' }]);
      w.store.open({ kind: 'goto' });

      expect(gotoOf(w, 'rk')).toEqual(['Racks', 'Workloads']);
      expect(rowTitled(w, 'Racks').score).toBe(100 * 6);
      expect(rowTitled(w, 'Workloads').score).toBe(58 * 6);
      // Typed as the start of a keyword, it is a prefix of a title (528).
      expect(gotoOf(w, 'shel')).toEqual(['Racks']);
      expect(rowTitled(w, 'Racks').score).toBe(88 * 6);
    });

    it('draw nothing of the keyword: the row is its label and its context, and the user sees no word that is not on it', () => {
      const w = build();
      w.store.open({ kind: 'goto' });
      expect(gotoOf(w, 'shelf')).toEqual(['Racks']);
      const racks = rowTitled(w, 'Racks');
      expect(racks.title.ranges).toEqual([]);
      expect(racks.context.ranges).toEqual([]);
      expect(racks.context.text).toBe('Inventory › Storage');
      expect(JSON.stringify(racks)).not.toContain('shelf');
    });

    it('are the names of the plugin\'s home when the leaf that opens it carries them: the home is the one row for that page', () => {
      const w = build();
      w.store.open({ kind: 'goto' });
      expect(gotoOf(w, 'ov')).toEqual(['Beta']);
      expect(rowTitled(w, 'Beta').score).toBe(100 * 6);
      expect(rowTitled(w, 'Beta').route).toEqual({ plugin: 'beta', contribution: 'overview', params: {} });
    });

    it('are read from the nodes the plugin\'s hook published, in place of the skeleton\'s: a page that is no longer named so is no longer found so', () => {
      const w = build();
      w.store.open({ kind: 'goto' });
      w.nodes.publish('beta', [
        { id: 'overview', label: 'Overview', icon: 'layers' },
        { id: 'items', label: 'Items', icon: 'box', keywords: ['thing'] },
        { id: 'racks', label: 'Racks', icon: 'server' },
      ]);
      w.store.refresh();
      expect(gotoOf(w, 'thing')).toEqual(['Items']);
      expect(gotoOf(w, 'shelf')).toEqual([]);
      expect(gotoOf(w, 'stuff')).toEqual([]);
    });

    it('are not read from a group: a group is not a page', () => {
      const w = build();
      w.nodes.publish('acme', [{ id: 'group', label: 'Group', icon: 'layers', keywords: ['grp'], children: [{ id: 'widgets', label: 'Start', icon: 'box' }] }]);
      w.store.open({ kind: 'goto' });
      expect(gotoOf(w, 'grp')).toEqual([]);
    });

    it('leave a node that has none as it was: no keywords, or an empty list, is a page found by its label, its group and its plugin\'s name', () => {
      const w = build();
      w.nodes.publish('acme', [{ id: 'gadgets', label: 'Gadgets', icon: 'box', keywords: [] }]);
      w.store.open({ kind: 'goto' });
      expect(gotoOf(w, 'gadgets')).toEqual(['Gadgets']);
      w.nodes.publish('acme', [{ id: 'gadgets', label: 'Gadgets', icon: 'box' }]);
      w.store.refresh();
      expect(gotoOf(w, 'gadgets')).toEqual(['Gadgets']);
      expect(gotoOf(w, 'acme')).toEqual(['Acme', 'Gadgets']);
    });

    it('are bounded: a keyword that is not one word of at most 32 characters, or comes after the eighth, is left out and said once to the plugin\'s author, and the page keeps its other names', () => {
      const problems: Array<{ readonly provider: string; readonly message: string }> = [];
      const w = build({ report: (problem) => problems.push(problem) });
      w.nodes.publish('acme', [{ id: 'gadgets', label: 'Gadgets', icon: 'box', keywords: ['gd', 3 as unknown as string, 'two words', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'] }]);
      w.store.open({ kind: 'goto' });

      expect(gotoOf(w, 'gd')).toEqual(['Gadgets']);
      expect(gotoOf(w, 'g7')).toEqual(['Gadgets']);
      expect(gotoOf(w, 'g8')).toEqual([]);
      expect(gotoOf(w, 'words')).toEqual([]);
      // Typed again and again, refreshed, it is said once.
      w.store.setQuery('g');
      w.store.refresh();
      w.store.setQuery('gd');
      expect(problems).toEqual([
        { provider: 'acme:sidebar', message: 'sidebar entry "gadgets": keyword 2 is not a word of 1 to 32 characters, with no white space in it: it is left out' },
        { provider: 'acme:sidebar', message: 'sidebar entry "gadgets": keyword 3 is not a word of 1 to 32 characters, with no white space in it: it is left out' },
        { provider: 'acme:sidebar', message: 'sidebar entry "gadgets": more than 8 keywords: the rest are left out' },
      ]);
    });

    it('are read where they are used, whatever a plugin\'s node does: a node whose keywords throw costs the page its keywords and the source nothing', () => {
      const problems: string[] = [];
      // The skeleton of a bundle is the plugin's own object, and admission does not read `keywords`; a node a hook answers is plain data (`Published` holds JSON), so a getter that throws can only be in the skeleton.
      const hostile = {
        id: 'gadgets',
        label: 'Gadgets',
        icon: 'box',
        get keywords(): readonly string[] {
          throw new Error('no');
        },
      } as unknown as SidebarNodeV1;
      const w = build({ entries: [ready('acme', 'Acme plugin', { sidebar: { label: 'Acme navigation', title: 'Acme', nodes: [hostile] } })], report: (problem) => problems.push(problem.message) });
      w.store.open({ kind: 'goto' });

      expect(titlesOf(w, 'goto')).toEqual(['Acme', 'Gadgets']);
      expect(problems).toEqual(['sidebar entry "gadgets": keywords could not be read: it is left out']);
    });
  });

  describe('where a page says it is', () => {
    const NORTH = (plugin: string): Route | undefined => (plugin === 'acme' ? { plugin: 'acme', contribution: 'widgets', params: { connection: 'north' } } : undefined);
    const contextOf = (w: World, title: string): string => rowTitled(w, title).context.text;

    it('is the group alone when no connection is known: the plugin\'s name is said only for a page that sits in no group', () => {
      const w = build();
      w.store.open({ kind: 'goto' });
      expect(contextOf(w, 'Gadgets')).toBe('Group');
      expect(contextOf(w, 'Racks')).toBe('Inventory › Storage');

      w.nodes.publish('acme', [{ id: 'gadgets', label: 'Gizmos', icon: 'box' }]);
      w.store.refresh();
      expect(contextOf(w, 'Gizmos')).toBe('Acme');
    });

    it('is the connection alone for a page that sits in no group, whether or not a chip says it: the host makes no group up (the design lab says "Cluster" for such a page, which only its plugin can say)', () => {
      const w = build({ remembered: NORTH });
      w.nodes.publish('acme', [{ id: 'gadgets', label: 'Gizmos', icon: 'box' }]);
      w.store.open({ kind: 'goto' });
      expect(contextOf(w, 'Gizmos')).toBe('north');
      w.store.close();

      w.open(at('acme', 'widgets', 'south'));
      w.store.open({ kind: 'goto', scope: seedChips({ plugin: 'acme', pluginName: 'Acme', scope: { id: 'south', label: 'south' } }) });
      expect(contextOf(w, 'Gizmos')).toBe('south');
      // A page with a group says the group alone under the same chip.
      w.nodes.publish('acme', null);
      w.store.refresh();
      expect(contextOf(w, 'Gadgets')).toBe('Group');
    });

    it('is the connection first and then the group when the page opens in a connection and the palette is not narrowed to it: the connection of the tab on screen, or else the one the plugin was last used in', () => {
      const w = build({ remembered: NORTH });
      w.open(at('beta', 'items'));
      w.store.open({ kind: 'goto' });
      // Acme is not on screen: it opens at the connection it was last used in.
      expect(contextOf(w, 'Gadgets')).toBe('north · Group');
      expect(rowTitled(w, 'Gadgets').route).toEqual({ plugin: 'acme', contribution: 'gadgets', params: { connection: 'north' } });
      // Beta has none.
      expect(contextOf(w, 'Racks')).toBe('Inventory › Storage');
      w.store.close();

      // Acme on screen, in another connection: the tab model opens its pages there, and the row says so.
      w.open(at('acme', 'widgets', 'south'));
      w.store.open({ kind: 'goto' });
      expect(contextOf(w, 'Gadgets')).toBe('south · Group');
      expect(rowTitled(w, 'Gadgets').route).toEqual({ plugin: 'acme', contribution: 'gadgets', params: {} });
    });

    it('is the group alone when the palette is narrowed to the connection: the chip says it, as the design lab\'s rows do when it is scoped to one connection', () => {
      const w = build();
      w.open(at('acme', 'widgets', 'south'));
      w.store.open({ kind: 'goto', scope: seedChips({ plugin: 'acme', pluginName: 'Acme', scope: { id: 'south', label: 'south' } }) });
      expect(titlesOf(w, 'goto')).toEqual(['Acme', 'Gadgets']);
      expect(contextOf(w, 'Gadgets')).toBe('Group');

      // Narrowed to the plugin alone, the connection is still not said by a chip: the row says it.
      w.store.close();
      w.store.open({ kind: 'goto', scope: pluginOnly('acme', 'Acme') });
      expect(contextOf(w, 'Gadgets')).toBe('south · Group');
    });

    it('says the connection when the chip that narrows the palette names another one: the tab moved after the palette opened, and the page opens where the tab is now', () => {
      const w = build();
      w.open(at('acme', 'widgets', 'south'));
      w.store.open({ kind: 'goto', scope: seedChips({ plugin: 'acme', pluginName: 'Acme', scope: { id: 'north', label: 'north' } }) });
      expect(contextOf(w, 'Gadgets')).toBe('south · Group');
    });

    it('names a place once: a group that is the connection\'s name is not said twice', () => {
      const w = build({ remembered: NORTH });
      w.nodes.publish('acme', [{ id: 'group', label: 'North', icon: 'layers', children: [{ id: 'gadgets', label: 'Gadgets', icon: 'box' }] }]);
      w.store.open({ kind: 'goto' });
      expect(contextOf(w, 'Gadgets')).toBe('north');
    });

    it('finds a page by its connection, which the row says, as the design lab finds a kind by the connection its row names', () => {
      const w = build({ remembered: NORTH });
      w.store.open({ kind: 'goto' });
      expect(gotoOf(w, 'north')).toEqual(['Gadgets']);
    });
  });

  describe('one row for a route', () => {
    it('lists a page the sidebar names twice once, with the words either said: the first label and context, and the keywords of both', () => {
      const w = build();
      w.nodes.publish('acme', [
        { id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'gadgets', label: 'Gadgets', icon: 'box', keywords: ['gd'] }] },
        { id: 'other', label: 'Other', icon: 'layers', children: [{ id: 'gadgets', label: 'Gadgets again', icon: 'box', keywords: ['gz'] }] },
      ]);
      w.store.open({ kind: 'goto' });

      expect(rowsOf(w, 'goto').filter((row) => row.route?.contribution === 'gadgets').map((row) => [row.title.text, row.context.text])).toEqual([['Gadgets', 'Group']]);
      expect(gotoOf(w, 'gd')).toEqual(['Gadgets']);
      expect(gotoOf(w, 'gz')).toEqual(['Gadgets']);
      expect(gotoOf(w, 'again')).toEqual([]);
    });

    it('keeps the groups of every entry that names the page as words the page is found by, while the row says the groups of one: a page named in two groups is found by either', () => {
      const w = build();
      w.nodes.publish('acme', [
        { id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'gadgets', label: 'Gadgets', icon: 'box' }] },
        { id: 'other', label: 'Other', icon: 'layers', children: [{ id: 'gadgets', label: 'Gadgets', icon: 'box' }] },
      ]);
      w.store.open({ kind: 'goto' });

      expect(rowsOf(w, 'goto').filter((row) => row.route?.contribution === 'gadgets').map((row) => [row.title.text, row.context.text])).toEqual([['Gadgets', 'Group']]);
      expect(gotoOf(w, 'other')).toEqual(['Gadgets']);
    });

    it('says the first group an entry gave: a page named at the top and again in a group is in that group, and not the plugin\'s own', () => {
      const w = build();
      w.nodes.publish('acme', [
        { id: 'gadgets', label: 'Gadgets', icon: 'box' },
        { id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'gadgets', label: 'Gadgets', icon: 'box' }] },
      ]);
      w.store.open({ kind: 'goto' });

      expect(rowsOf(w, 'goto').filter((row) => row.route?.contribution === 'gadgets').map((row) => [row.title.text, row.context.text])).toEqual([['Gadgets', 'Group']]);
    });

    it('lists the page that a tab has open under Tabs and under Go to, as the design lab does: they are two sources, and the tab is not the page', () => {
      const w = build();
      w.open(at('beta', 'items'));
      w.store.open();
      w.store.setQuery('items');

      const sections = w.store.getSnapshot().sections.map((section) => [section.id, section.rows.map((row) => `${row.kind}:${row.title.text}`)]);
      expect(sections).toEqual([
        ['tabs', ['tab:Items']],
        ['goto', ['page:Items']],
      ]);
      expect(rowTitled(w, 'Items').route).toEqual({ plugin: 'beta', contribution: 'items', params: {} });
    });

    it('lists no page of a plugin twice because it brings the same word twice, or because the plugin is listed twice', () => {
      const w = build({ entries: [BETA, BETA] });
      w.store.open({ kind: 'goto' });
      expect(titlesOf(w, 'goto')).toEqual(['Beta', 'Items', 'Racks']);
    });
  });

  // Two rows that would READ ALIKE (the same title and the same words under it) from different plugins are told apart by the plugin's name, on those rows only (C1e, the lead's ruling): the rule a session tab's scope
  // follows when two tabs read alike, "shown only when needed". It is in the text the row draws and so in the name a screen reader reads, and it is judged on the rows the source lists, never on the query.
  describe('two rows that would read alike', () => {
    const twins = (extra: Setup = {}): World => build({ entries: [ACME, COPY], ...extra });
    const gadgetsOf = (w: World) => rowsOf(w, 'goto').filter((row) => row.title.text === 'Gadgets');

    it('are told apart by the plugin\'s name, first, on those rows only: in the text drawn and in the name a screen reader reads', () => {
      const w = twins();
      w.store.open({ kind: 'goto' });
      expect(gadgetsOf(w).map((row) => [row.context.text, row.name])).toEqual([
        ['Acme · Group', 'Page: Gadgets, Acme · Group'],
        ['Acme Copy · Group', 'Page: Gadgets, Acme Copy · Group'],
      ]);
      // The page only one of them has reads as it did, and so do the homes.
      expect(rowTitled(w, 'Sprockets').context.text).toBe('Group');
      expect(rowsOf(w, 'goto').filter((row) => row.kind === 'home').map((row) => [row.title.text, row.context.text])).toEqual([['Acme', 'Widgets'], ['Acme Copy', 'Widgets']]);
    });

    it('is judged on the rows the source lists and not on the query: a query that leaves one of them out does not change what the other reads', () => {
      const w = twins();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('copy');
      expect(gadgetsOf(w).map((row) => row.context.text)).toEqual(['Acme Copy · Group']);
      w.store.setQuery('gadgets');
      expect(gadgetsOf(w).map((row) => row.context.text)).toEqual(['Acme · Group', 'Acme Copy · Group']);
    });

    it('is not needed when the palette is narrowed to one plugin: only its rows are listed, and the chip says whose they are', () => {
      const w = twins();
      w.store.open({ kind: 'goto', scope: pluginOnly('copy', 'Acme Copy') });
      expect(gadgetsOf(w).map((row) => row.context.text)).toEqual(['Group']);
    });

    it('is not needed when they already differ: another connection tells them apart', () => {
      const w = twins({ remembered: (plugin) => ({ plugin, contribution: 'widgets', params: { connection: plugin === 'acme' ? 'north' : 'south' } }) });
      w.store.open({ kind: 'goto' });
      expect(gadgetsOf(w).map((row) => row.context.text)).toEqual(['north · Group', 'south · Group']);
    });

    it('comes before the connection when they read alike there too', () => {
      const w = twins({ remembered: (plugin) => ({ plugin, contribution: 'widgets', params: { connection: 'north' } }) });
      w.store.open({ kind: 'goto' });
      expect(gadgetsOf(w).map((row) => row.context.text)).toEqual(['Acme · north · Group', 'Acme Copy · north · Group']);
    });

    it('is not made of a name they share, and not for two pages of one plugin: the name would not tell them apart, so they read as they did', () => {
      const same = ready('copy', 'Acme Copy plugin', { ...COPY_PATCH, plugin: { name: 'Acme' } });
      const w = build({ entries: [ACME, same] });
      w.store.open({ kind: 'goto' });
      expect(gadgetsOf(w).map((row) => row.context.text)).toEqual(['Group', 'Group']);

      const one = build({ entries: [COPY] });
      one.nodes.publish('copy', [{ id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'gadgets', label: 'Same', icon: 'box' }, { id: 'sprockets', label: 'Same', icon: 'box' }] }]);
      one.store.open({ kind: 'goto' });
      expect(rowsOf(one, 'goto').filter((row) => row.title.text === 'Same').map((row) => row.context.text)).toEqual(['Group', 'Group']);
    });
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

// What the plugins bring to the palette (C1c): the providers each declares, registered when the plugin is ready and taken away, with their pending requests and rows, when it is not. The provider's own behaviour is
// tested in paletteProviders.test.ts; what is tested here is what the host does with the plugins: when it registers, when it removes, what is asked of whom, how a row opens and how a command runs.
describe('the providers the plugins bring', () => {
  const widgetsRow = (id: string, label = id, page = 'widgets'): PaletteRowV1 => ({ id, label, icon: 'box', route: { page, params: {} } });
  const matching = (rows: readonly PaletteRowV1[], patch: Partial<Omit<PaletteMatchProviderV1, 'kind'>> = {}): PaletteMatchProviderV1 => ({ kind: 'match', section: 'Things', match: () => rows, ...patch });
  const searching = (answer: (query: string, signal: AbortSignal) => Promise<readonly PaletteRowV1[]>, patch: Partial<Omit<PaletteSearchProviderV1, 'kind'>> = {}): PaletteSearchProviderV1 => ({
    kind: 'search',
    section: 'Lookups',
    search: async (query, _scope, signal) => answer(query, signal),
    ...patch,
  });
  /** A plugin that is ready with `palette`. */
  const bringing = (id: string, name: string, palette: PaletteV1 | undefined, patch: Parameters<typeof acme>[0] = {}): PluginEntry => ready(id, name, { plugin: { name }, palette, ...patch });

  const sectionOf = (w: World, id: string) => w.store.getSnapshot().sections.find((candidate) => candidate.id === id);
  /** The sections plugins bring: the model names each `<plugin>:<section>`, and its own sections have no colon. */
  const idsOf = (w: World): string[] => w.store.getSnapshot().sections.map((candidate) => candidate.id).filter((id) => id.includes(':'));

  describe('when they are registered', () => {
    it('are the providers of every plugin that is ready and has a palette, in a section of its own after the host\'s, headed by the plugin\'s name; a plugin that is loading, failed or brings none has none', () => {
      const w = build({ entries: [GAMMA, DELTA, bringing('west', 'West', { providers: { things: matching([widgetsRow('w1', 'west one')]) } }), BETA, bringing('east', 'East', { providers: { things: matching([widgetsRow('e1', 'east one')], { section: 'Items' }) } })] });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');

      // The sections of plugins that match equally keep the rail's order (East before West: the rail orders by name), whatever order the plugins were listed in.
      expect(idsOf(w)).toEqual(['east:things', 'west:things']);
      expect(w.store.getSnapshot().sections.map((section) => [section.title, section.rows.map((row) => row.title.text)])).toEqual([
        ['East · Items', ['east one']],
        ['West · Things', ['west one']],
      ]);
      stop();
    });

    it('keeps the sections of plugins that match equally in the rail\'s order, whichever of them turned ready first: what Enter opens does not depend on which plugin loaded first', () => {
      const loading = (id: string, name: string): PluginEntry => ({ id, name, phase: 'loading' });
      const west = bringing('west', 'West', { providers: { things: matching([widgetsRow('same-w', 'same one')]) } });
      const east = bringing('east', 'East', { providers: { things: matching([widgetsRow('same-e', 'same one')]) } });
      const w = build({ entries: [loading('west', 'West'), loading('east', 'East')] });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('same');
      expect(idsOf(w)).toEqual([]);

      // West loads first and has its section; East, which the rail puts before it, loads next.
      w.set([west, loading('east', 'East')]);
      expect(idsOf(w)).toEqual(['west:things']);
      w.set([west, east]);
      expect(idsOf(w)).toEqual(['east:things', 'west:things']);
      expect(w.store.getSnapshot().rows[w.store.getSnapshot().activeIndex]?.title.text).toBe('same one');
      expect(w.store.getSnapshot().rows[w.store.getSnapshot().activeIndex]?.id).toContain('east:things');

      // The other way round, from the start.
      w.set([loading('west', 'West'), loading('east', 'East')]);
      expect(idsOf(w)).toEqual([]);
      w.set([loading('west', 'West'), east]);
      w.set([west, east]);
      expect(idsOf(w)).toEqual(['east:things', 'west:things']);
      stop();
    });

    it('leaves the order of the others as it was when a plugin leaves, and puts a plugin that reloads back where the rail has it', () => {
      const make = (id: string, name: string): PluginEntry => bringing(id, name, { providers: { things: matching([widgetsRow(`same-${id}`, 'same one')]) } });
      const [north, east, west] = [make('north', 'North'), make('east', 'East'), make('west', 'West')];
      const w = build({ entries: [west, north, east] });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('same');
      expect(idsOf(w)).toEqual(['east:things', 'north:things', 'west:things']);

      w.set([west, east]);
      expect(idsOf(w)).toEqual(['east:things', 'west:things']);
      w.set([west, make('north', 'North'), east]);
      expect(idsOf(w)).toEqual(['east:things', 'north:things', 'west:things']);
      stop();
    });

    it('registers nothing until the palette is attached: a palette nobody attached lists the host\'s sources and no plugin\'s', () => {
      const w = build({ entries: [bringing('west', 'West', { providers: { things: matching([widgetsRow('w1', 'west one')]) } })] });
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');

      expect(idsOf(w)).toEqual([]);
    });

    it('registers a plugin that turns ready later, and asks it at once when the palette is open: its section comes without a keystroke', async () => {
      const lookup = vi.fn(async () => [widgetsRow('l1', 'lookup one')]);
      const w = build({ entries: [{ id: 'west', name: 'West plugin', phase: 'loading' }] });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      await vi.advanceTimersByTimeAsync(400);
      expect(idsOf(w)).toEqual([]);

      w.set([bringing('west', 'West', { providers: { lookups: searching(lookup) } })]);
      await vi.advanceTimersByTimeAsync(10);

      expect(lookup).toHaveBeenCalledTimes(1);
      expect(sectionOf(w, 'west:lookups')?.rows.map((row) => row.title.text)).toEqual(['lookup one']);
      stop();
    });

    it('refuses to register the providers of a plugin that is called host: that is the name of the palette\'s own sources, which are asked whatever the palette is narrowed to', () => {
      const problems: Array<{ provider: string; message: string }> = [];
      const w = build({ entries: [bringing('host', 'Host', { providers: { things: matching([widgetsRow('h1', 'host one')]) } })], report: (problem) => problems.push(problem) });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');

      expect(idsOf(w)).toEqual([]);
      expect(problems).toEqual([{ provider: 'host:things', message: 'the plugin\'s id is "host", which names the palette\'s own sources: its providers are not registered' }]);
      stop();
    });

    it('is attached twice at once and undone one at a time: the providers stay until the last is undone, and none outlives it', () => {
      const w = build({ entries: [bringing('west', 'West', { providers: { things: matching([widgetsRow('w1', 'west one')]) } })] });
      const one = w.palette.attach();
      const two = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      expect(idsOf(w)).toEqual(['west:things']);

      one();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      expect(idsOf(w)).toEqual(['west:things']);
      two();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      expect(idsOf(w)).toEqual([]);

      const again = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      expect(idsOf(w)).toEqual(['west:things']);
      again();
    });
  });

  describe('when they are removed', () => {
    const slow = () => {
      const state = { asked: 0, signal: undefined as AbortSignal | undefined, release: (_rows: readonly PaletteRowV1[]): void => undefined };
      const provider = searching(async (_query, signal) => {
        state.asked += 1;
        state.signal = signal;
        return new Promise((resolve) => {
          state.release = resolve;
        });
      });
      return { state, provider };
    };

    it.each([
      ['turns into a plugin that is loading again (an upgrade, a retry)', (entry: PluginEntry): PluginEntry => ({ id: entry.id, name: entry.name, phase: 'loading' })],
      ['fails', (entry: PluginEntry): PluginEntry => ({ id: entry.id, name: entry.name, phase: 'failed', failure: { kind: 'broken', message: 'The plugin\'s interface could not be loaded.' } })],
    ])('takes a plugin\'s providers, its rows and its pending request away together, in the change in which it %s; the host\'s rows and the other plugins\' stay', async (_name, leave) => {
      const { state, provider } = slow();
      const west = bringing('west', 'West', { providers: { lookups: provider, things: matching([widgetsRow('w1', 'west one')]) } });
      const east = bringing('east', 'East', { providers: { things: matching([widgetsRow('e1', 'east one')]) } });
      const w = build({ entries: [west, east] });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      await vi.advanceTimersByTimeAsync(200);
      expect(state.asked).toBe(1);
      expect(idsOf(w)).toEqual(['east:things', 'west:things']);
      expect(w.store.getSnapshot().searching).toBe(true);
      const changes: number[] = [];
      w.store.subscribe(() => changes.push(w.store.getSnapshot().sections.length));

      w.set([leave(west), east]);

      expect(state.signal?.aborted).toBe(true);
      expect(idsOf(w)).toEqual(['east:things']);
      expect(w.store.getSnapshot().searching).toBe(false);
      expect(w.store.getSnapshot().sources.map((source) => source.id)).not.toContain('west:lookups');
      // One change, not one for each thing it took: the plugin is gone from the list in the very notification that said it left.
      expect(changes).toEqual([1]);
      // Its answer, if it comes, is not shown, and the plugin is asked nothing again.
      state.release([widgetsRow('late')]);
      await vi.advanceTimersByTimeAsync(400);
      expect(idsOf(w)).toEqual(['east:things']);
      expect(state.asked).toBe(1);
      stop();
    });

    it('takes a plugin away that is no longer in the list of plugins at all', async () => {
      const west = bringing('west', 'West', { providers: { things: matching([widgetsRow('w1', 'west one')]) } });
      const w = build({ entries: [west, BETA] });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      expect(idsOf(w)).toEqual(['west:things']);

      w.set([BETA]);

      expect(idsOf(w)).toEqual([]);
      stop();
    });

    it('takes the chips that narrowed the search to a plugin away with it: the palette goes back to searching everywhere', async () => {
      const west = bringing('west', 'West', { providers: { things: matching([widgetsRow('w1', 'west one')]) } });
      const w = build({ entries: [west, BETA] });
      const stop = w.palette.attach();
      w.open(at('west', 'widgets', 'north'));
      w.store.open(w.palette.opening());
      expect(w.store.getSnapshot().chips.map((chip) => chip.plugin)).toEqual(['west', 'west']);

      w.set([{ id: 'west', name: 'West plugin', phase: 'loading' }, BETA]);

      expect(w.store.getSnapshot().chips).toEqual([]);
      expect(w.store.getSnapshot().open).toBe(true);
      stop();
    });

    it('asks a plugin whose contribution was replaced (a reload) for its new providers only: the old ones go with their rows and their request', async () => {
      const { state, provider } = slow();
      const before = bringing('west', 'West', { providers: { lookups: provider, things: matching([widgetsRow('w1', 'west one')]) } });
      const after = bringing('west', 'West', { providers: { things: matching([widgetsRow('w2', 'west two one')]) } });
      const w = build({ entries: [before] });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      await vi.advanceTimersByTimeAsync(200);

      w.set([after]);
      await vi.advanceTimersByTimeAsync(400);

      expect(state.signal?.aborted).toBe(true);
      expect(w.store.getSnapshot().sections.map((section) => [section.id, section.rows.map((row) => row.title.text)])).toEqual([['west:things', ['west two one']]]);
      stop();
    });

    it('leaves a plugin\'s providers as they are when something else changes: the same registration, not asked again', async () => {
      const match = vi.fn(() => [widgetsRow('w1', 'west one')]);
      const west = bringing('west', 'West', { providers: { things: matching([], { match }) } });
      const w = build({ entries: [west, BETA] });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      const before = match.mock.calls.length;

      w.set([west, { ...BETA, name: 'Beta renamed' }]);
      expect(match.mock.calls.length).toBe(before + 1);
      expect(idsOf(w)).toEqual(['west:things']);
      stop();
    });

    it('takes every plugin\'s providers away when it is undone, with the pending requests and the rows: nothing of the plugins outlives the subscriptions', async () => {
      const { state, provider } = slow();
      const w = build({ entries: [bringing('west', 'West', { providers: { lookups: provider, things: matching([widgetsRow('w1', 'west one')]) } })] });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      await vi.advanceTimersByTimeAsync(200);
      expect(state.asked).toBe(1);

      stop();

      expect(state.signal?.aborted).toBe(true);
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      await vi.advanceTimersByTimeAsync(400);
      expect(idsOf(w)).toEqual([]);
      expect(state.asked).toBe(1);
    });
  });

  describe('what is asked of whom', () => {
    it('asks only the providers of the plugin the palette is narrowed to, and the host\'s: another plugin\'s providers are not called', () => {
      const westMatch = vi.fn(() => [widgetsRow('w1', 'west one')]);
      const eastMatch = vi.fn(() => [widgetsRow('e1', 'east one')]);
      const w = build({
        entries: [bringing('west', 'West', { providers: { things: matching([], { match: westMatch }) } }), bringing('east', 'East', { providers: { things: matching([], { match: eastMatch }) } })],
      });
      const stop = w.palette.attach();
      w.open(at('west', 'widgets', 'north'));
      w.store.open(w.palette.opening());
      w.store.setQuery('one');

      expect(westMatch).toHaveBeenCalled();
      expect(eastMatch).not.toHaveBeenCalled();
      expect(idsOf(w)).toEqual(['west:things']);
      stop();
    });

    it('honours a provider\'s own scope test: a provider that has nothing to say in this scope is not asked', () => {
      const match = vi.fn(() => [widgetsRow('w1', 'west one')]);
      const w = build({ entries: [bringing('west', 'West', { providers: { things: matching([], { match, supports: (scope: { readonly plugin: string | null }) => scope.plugin === 'west' }) } })] });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      expect(match).not.toHaveBeenCalled();
      expect(idsOf(w)).toEqual([]);

      w.store.close();
      w.open(at('west', 'widgets', 'north'));
      w.store.open(w.palette.opening());
      w.store.setQuery('one');
      expect(match).toHaveBeenCalled();
      expect(idsOf(w)).toEqual(['west:things']);
      stop();
    });
  });

  describe('opening a row', () => {
    /** The window as a person has it: a tab of the first plugin on screen, the palette open on a query that finds one row of each plugin. */
    function setup() {
      const w = build({
        entries: [
          bringing('west', 'West', { providers: { things: matching([widgetsRow('w1', 'west one', 'gadgets')]) } }),
          bringing('east', 'East', { providers: { things: matching([widgetsRow('e1', 'east one', 'gadgets')]) } }),
        ],
      });
      const stop = w.palette.attach();
      w.open(at('west', 'widgets', 'north'));
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      const row = (plugin: string) => w.store.getSnapshot().rows.find((candidate) => candidate.plugin === plugin);
      return { w, row, stop };
    }

    it('opens a page of the plugin the tab on screen is of in that tab, as a host row does, at the connection the tab has', () => {
      const { w, row, stop } = setup();
      const before = w.tabs.getSnapshot().order;

      expect(w.store.activate(row('west')?.id)).toMatchObject({ status: 'opened' });

      expect(w.tabs.getSnapshot().order).toEqual(before);
      expect(stripOf(w)).toEqual(['west/gadgets']);
      expect(w.tabs.getSnapshot().tabs[before[0] ?? '']?.location.route.params).toEqual({ connection: 'north' });
      expect(w.store.getSnapshot().open).toBe(false);
      stop();
    });

    it('opens a page of another plugin in a tab of its own', () => {
      const { w, row, stop } = setup();

      w.store.activate(row('east')?.id);

      expect(stripOf(w)).toEqual(['west/widgets', 'east/gadgets']);
      expect(w.tabs.getSnapshot().active).toBe(w.tabs.getSnapshot().order[1]);
      stop();
    });

    it('opens it here with Alt Enter: the tab on screen goes to the page, whatever plugin it is of', () => {
      const { w, row, stop } = setup();

      w.store.activate(row('east')?.id, { altKey: true });

      expect(stripOf(w)).toEqual(['east/gadgets']);
      stop();
    });

    it('opens it in a new tab and shows it with Command Shift Enter, even when the tab on screen already is the page', () => {
      const { w, row, stop } = setup();

      w.store.activate(row('west')?.id, { metaKey: true, shiftKey: true });

      expect(stripOf(w)).toEqual(['west/widgets', 'west/gadgets']);
      expect(w.tabs.getSnapshot().active).toBe(w.tabs.getSnapshot().order[1]);
      stop();
    });

    it('opens it in a background tab with Command Enter: the tab on screen stays', () => {
      const { w, row, stop } = setup();
      const shown = w.tabs.getSnapshot().active;

      w.store.activate(row('east')?.id, { metaKey: true });

      expect(stripOf(w)).toEqual(['west/widgets', 'east/gadgets']);
      expect(w.tabs.getSnapshot().active).toBe(shown);
      stop();
    });

    it('remembers where it went in Recent, as a host row does', () => {
      const { w, row, stop } = setup();

      w.store.activate(row('east')?.id);

      expect(w.store.getSnapshot().recents.map((recent) => [recent.route.plugin, recent.route.contribution])).toEqual([['east', 'gadgets'], ['west', 'widgets']]);
      stop();
    });
  });

  describe('running a command a row names', () => {
    const commandRow = (id: string, label: string, command: string, arg?: PaletteJsonV1): PaletteRowV1 => ({ id, label, icon: 'refresh', command: { id: command, ...(arg === undefined ? {} : { arg }) } });

    function setup(run: PaletteCommandV1['run'], over: { readonly panelHosts?: (plugin: string) => PanelHostV1 } = {}) {
      const west = bringing('west', 'West', { providers: { things: matching([commandRow('c1', 'Reset west', 'reset', { all: true })], { filter: 'commands' }) }, commands: { reset: { run } } });
      const w = build({ entries: [west], ...over });
      const stop = w.palette.attach();
      w.open(at('west', 'widgets', 'north'));
      w.store.open({ kind: 'commands' });
      w.store.setQuery('reset west');
      return { w, west, stop };
    }

    it('runs the plugin\'s own function with the argument the row carried, and what the plugin may use of the host, and closes the palette: a command ignores the modifiers', () => {
      const run = vi.fn<PaletteCommandV1['run']>(() => undefined);
      const panel: PanelHostV1 = { logs: { open: vi.fn() } };
      const { w, stop } = setup(run, { panelHosts: (plugin) => (plugin === 'west' ? panel : { logs: { open: vi.fn() } }) });
      const row = w.store.getSnapshot().rows[0];
      expect(row).toMatchObject({ kind: 'command', title: { text: 'Reset west' } });

      expect(w.store.activate(row?.id, { metaKey: true, shiftKey: true })).toMatchObject({ status: 'ran', outcome: 'done' });

      expect(run).toHaveBeenCalledWith({ all: true }, { plugin: 'west', panel });
      expect(w.store.getSnapshot().open).toBe(false);
      expect(stripOf(w)).toEqual(['west/widgets']);
      stop();
    });

    it('keeps the palette open and says why when the command refuses, in the plugin\'s sentence', () => {
      const { w, stop } = setup(() => ({ ok: false, reason: 'Nothing is selected.' }));

      expect(w.store.activate()).toMatchObject({ status: 'ran', outcome: 'refused' });
      expect(w.store.getSnapshot().open).toBe(true);
      expect(w.store.getSnapshot().notice).toBe('Reset west: Nothing is selected.');
      stop();
    });

    it('says the command failed, in the host\'s words, when it throws, and keeps the plugin\'s own in the console', () => {
      const boom = new Error('private detail');
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { w, stop } = setup(() => {
        throw boom;
      });

      expect(w.store.activate()).toMatchObject({ status: 'ran', outcome: 'refused' });
      expect(w.store.getSnapshot().notice).toBe('Reset west: This command failed.');
      expect(JSON.stringify(w.store.getSnapshot())).not.toContain('private detail');
      expect(error.mock.calls.flat()).toContain(boom);
      stop();
    });

    it('looks the command up again immediately before it runs: a command the plugin removed from its own registry after the row was listed is not run, and the palette says so', () => {
      const run = vi.fn<PaletteCommandV1['run']>();
      const { w, west, stop } = setup(run);
      const row = w.store.getSnapshot().rows[0];
      // The plugin changes its own registry; the list on screen is the one it was before.
      const commands = (west as Extract<PluginEntry, { phase: 'ready' }>).contribution.palette?.commands as Record<string, PaletteCommandV1>;
      Reflect.deleteProperty(commands, 'reset');

      expect(w.store.activate(row?.id)).toMatchObject({ status: 'ran', outcome: 'refused' });
      expect(w.store.getSnapshot().notice).toBe('Reset west: This command is not available.');
      expect(run).not.toHaveBeenCalled();
      stop();
    });

    it('does not offer a row whose command the plugin does not have: it is left out at the plugin\'s answer, with a problem, and no other row is lost', () => {
      const problems: Array<{ provider: string; message: string }> = [];
      const west = bringing('west', 'West', { providers: { things: matching([commandRow('c1', 'Reset west', 'launch'), widgetsRow('w1', 'west one')], { filter: 'commands' }) }, commands: { reset: { run: () => undefined } } });
      const w = build({ entries: [west], report: (problem) => problems.push(problem) });
      const stop = w.palette.attach();
      w.store.open({ kind: 'commands' });
      w.store.setQuery('west');

      expect(titlesOf(w, 'west:things')).toEqual(['west one']);
      expect(problems).toEqual([{ provider: 'west:things', message: 'row "c1": command.id "launch" is not one of the plugin\'s commands' }]);
      stop();
    });
  });

  describe('what a provider that fails does to the palette', () => {
    it('says which source did not answer in a line of its own, with a Retry, while the other providers answer: a match that throws, a search that rejects', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const west = bringing('west', 'West', {
        providers: {
          broken: matching([], { section: 'Broken', match: () => {
            throw new Error('connect ECONNREFUSED'); 
          } }),
          rejected: searching(async () => {
            throw new Error('403'); 
          }, { section: 'Rejected' }),
          fine: matching([widgetsRow('w1', 'west one')], { section: 'Fine' }),
        },
      });
      const w = build({ entries: [west] });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      await vi.advanceTimersByTimeAsync(200);

      expect(w.store.getSnapshot().runs.map((run) => [run.label, run.retry])).toEqual([['Broken: Unavailable', true], ['Rejected: Unavailable', true]]);
      expect(titlesOf(w, 'west:fine')).toEqual(['west one']);
      expect(JSON.stringify(w.store.getSnapshot())).not.toMatch(/ECONNREFUSED|403/);
      expect(error).toHaveBeenCalled();
      stop();
    });

    it('says a provider that never answers has failed five seconds after it was asked, and the other providers have answered meanwhile', async () => {
      const west = bringing('west', 'West', { providers: { lookups: searching(async () => new Promise<never>(() => undefined)), fine: matching([widgetsRow('w1', 'west one')], { section: 'Fine' }) } });
      const w = build({ entries: [west] });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      // The request starts after the typing has been still for 150 ms, and has five seconds from then.
      await vi.advanceTimersByTimeAsync(150 + 4999);
      expect(w.store.getSnapshot().runs).toEqual([]);
      await vi.advanceTimersByTimeAsync(2);

      expect(w.store.getSnapshot().runs.map((run) => [run.label, run.message])).toEqual([['Lookups: Timed out', 'Lookups didn\'t answer in 5 seconds.']]);
      expect(titlesOf(w, 'west:fine')).toEqual(['west one']);
      stop();
    });
  });

  describe('what it tells of the rows it left out', () => {
    it('tells the problem to the host\'s report once, with the provider\'s id, and shows the rows that are valid', () => {
      const problems: Array<{ provider: string; message: string }> = [];
      const bad = { id: 'b', label: 'bad one', icon: 'no-such-glyph', route: { page: 'widgets', params: {} } } as unknown as PaletteRowV1;
      const w = build({ entries: [bringing('west', 'West', { providers: { things: matching([widgetsRow('w1', 'west one'), bad]) } })], report: (problem) => problems.push(problem) });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      w.store.setQuery('on');
      w.store.setQuery('one');

      expect(titlesOf(w, 'west:things')).toEqual(['west one']);
      expect(problems).toEqual([{ provider: 'west:things', message: 'row "b": the glyph "no-such-glyph" is not one the kit has' }]);
      stop();
    });

    it('says it to the console when the host was given no report of its own', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const bad = { id: 'b', label: 'bad one', icon: 'box' } as unknown as PaletteRowV1;
      const w = build({ entries: [bringing('west', 'West', { providers: { things: matching([bad]) } })] });
      const stop = w.palette.attach();
      w.store.open({ kind: 'goto' });
      w.store.setQuery('bad');

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toBe('[palette] west:things: row "b": it opens neither a route nor a command');
      stop();
    });
  });

  describe('a closed palette', () => {
    it('does no provider work at all: no provider is called, no request is made and no timer is held, however often the plugins change, a plugin leaves or one arrives', async () => {
      const match = vi.fn(() => [widgetsRow('w1', 'west one')]);
      const lookup = vi.fn(async () => [widgetsRow('l1', 'lookup one')]);
      const west = bringing('west', 'West', { providers: { things: matching([], { match }), lookups: searching(lookup) } });
      const w = build({ entries: [west] });
      const stop = w.palette.attach();
      w.set([west, BETA]);
      w.set([{ id: 'west', name: 'West plugin', phase: 'loading' }, BETA]);
      w.set([west, BETA]);
      w.open(at('west', 'widgets'));
      await vi.advanceTimersByTimeAsync(2000);

      expect(match).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);

      w.store.open({ kind: 'goto' });
      w.store.setQuery('one');
      await vi.advanceTimersByTimeAsync(200);
      expect(match).toHaveBeenCalled();
      expect(lookup).toHaveBeenCalledTimes(1);
      w.store.close();
      const [matched, looked] = [match.mock.calls.length, lookup.mock.calls.length];
      w.set([west, { ...BETA, name: 'Beta renamed' }]);
      await vi.advanceTimersByTimeAsync(2000);

      expect([match.mock.calls.length, lookup.mock.calls.length]).toEqual([matched, looked]);
      expect(vi.getTimerCount()).toBe(0);
      stop();
    });
  });
});
