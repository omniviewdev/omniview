// The real shell and the real host palette over the fixture plugin's providers, for the probe (palette-probe.mjs, section `plugins`): the window with its Search control, a tab model whose routes the plugin describes, and
// `createHostPalette`, the product's own wiring of the plugins' providers, over a plugin source this page changes. What is invented is the plugin (the fixture's: a `match` provider and three `search` providers that cost
// what they are told, plugins/fixture/src/palette.ts) and its pages (a list and a detail page that draw nothing): the shell, the palette's view and model, the tab model and the host's wiring are the product's.
// A second HTML entry that the probe builds on its own; `vite build` of the channel never reaches it.
//
//   ?plugins=1   how many plugins are installed: `fixture-a-ok` ("Seam Fixture") and, with 2, `fixture-b-dup` ("Seam Fixture Copy"), each with the fixture's providers
//   ?quick=0     what `quick` costs in milliseconds, then `slow=300` and `big=5000` (the rows `big` returns); `window.__fixturePalette` is the fixture's control, read and written by the probe
//   ?scoped=1    the tab on screen has a connection, so the palette opens narrowed to its plugin and that connection (S69)
//   ?aliases=1   the plugin's sidebar is Group > Widgets, Gadgets (the keyword `gz`) and Gazebo (a title that holds the keyword's letters in one word), and the plugin's own providers stay quiet: what answers is the
//                host's pages source, from the sidebar's keywords (C1e). `window.__aliasFault('ignored' | 'loose')` is the probe's negative control: the keyword is not the host's to read, or it ranks as a keyword did before
//                an alias was a name (a source of the host's own that holds the same word as a keyword, below a loose match in a title)
//   ?connection=1  (C1f; the plugin's own providers stay quiet) the tab on screen is the detail page of an item read in a connection whose KEY is `north-57a082bd74` (the shape the host's own keys have) and whose NAME, in the scope lane its
//                page published, is `north`; the sidebar has a page in a group and a page in none. `window.__connectionFault()` is the probe's negative control: a source of the host's own that says the key
//
// `window.__palette` is the model's store; `window.__tabs` the tab model; `window.__plugin` takes a plugin's interface out of the live set (`unload(id)`, `fail(id)`) and brings it back (`reload(id)`, a new contribution, as a
// reload of its bundle makes); `window.__commits` lists every commit of the tree (React's profiler: the probe builds this entry with the development build of React DOM for the counts); `window.__announced` lists what the
// live region was told; `window.__sources` is how many listeners the plugin source has.
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { ThemeProvider, TooltipHost } from '@omniviewdev/kit';
import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import type { ContributionV1, DetailPageV1, FrameV1, SidebarNodeV1 } from '../../plugins/contract/v1';
import { createFixturePalette } from '../../plugins/fixture/src/palette';
import { createContributions, routeKey, type PluginSource } from '../../plugins/host/contributions';
import { createHostPalette } from '../../plugins/host/palette';
import type { PluginEntry } from '../../plugins/host/pluginStore';
import { Published } from '../../plugins/host/published';
import { acme, answering, widgetPage } from '../../plugins/testing';
import { createTabsStore, platformOf } from '..';
import { StaticShell, STATIC_RAIL } from '../testing';

const params = new URLSearchParams(window.location.search);
const number = (name: string, fallback: number): number => Number(params.get(name) ?? fallback);
const ALIASES = params.get('aliases') === '1';
const CONNECTION = params.get('connection') === '1';
/** A connection as `?connection=1` has it: the key a route carries, and the name its page's lane says. */
const KEY = 'north-57a082bd74';
const NAME = 'north';

// What the fixture's providers cost, and what they did: the control the plugin reads (plugins/fixture/src/palette.ts). Quiet providers are not asked until it exists, and here it exists from the first frame
// (but with `?aliases=1`, where the plugin's providers stay quiet, so nothing answers but the host's own sources).
if (!ALIASES && !CONNECTION) {
  Reflect.set(window, '__fixturePalette', {
    stats: {},
    commands: [],
    quick: { delay: number('quick', 0), size: 5 },
    slow: { delay: number('slow', 300), size: 5 },
    big: { delay: 0, size: number('big', 5000) },
  });
}

/** A page that draws nothing: the palette's rows lead to it, and what is under test is that they open it. */
const itemPage: DetailPageV1 = {
  kind: 'detail',
  definition: { kind: 'Item', tile: { icon: 'box' }, identity: { name: 'name' }, tabs: [{ id: 'overview', label: 'Overview' }] },
  usePage: () => ({ source: { state: { kind: 'loading' }, view: undefined, refreshing: false, refresh: async () => undefined } }),
};

/** The sidebar of `?aliases=1`: Gadgets has a keyword, and Gazebo is a decoy whose title holds the keyword's letters (g, z) in one word, which a title match of that kind used to outrank a keyword with. */
const ALIAS_NODES: readonly SidebarNodeV1[] = [
  {
    id: 'group',
    label: 'Group',
    icon: 'layers',
    children: [
      { id: 'widgets', label: 'Widgets', icon: 'box' },
      { id: 'gadgets', label: 'Gadgets', icon: 'box', keywords: ['gz'] },
      { id: 'gazebo', label: 'Gazebo', icon: 'box' },
    ],
  },
];

/** The sidebar of `?connection=1`: a page in a group, and a page that sits in none (the design lab says "Cluster" for it; the host says the connection). */
const CONNECTION_NODES: readonly SidebarNodeV1[] = [
  { id: 'overview', label: 'Overview', icon: 'layers' },
  {
    id: 'group',
    label: 'Group',
    icon: 'layers',
    children: [
      { id: 'widgets', label: 'Widgets', icon: 'box' },
      { id: 'gadgets', label: 'Gadgets', icon: 'box' },
    ],
  },
];

const contributionOf = (name: string): ContributionV1 =>
  acme({
    plugin: { name },
    pages: {
      ...acme().pages,
      item: itemPage,
      ...(ALIASES ? { gazebo: widgetPage('Gazebo', answering([], 'Gazebo')) } : {}),
      ...(CONNECTION ? { overview: widgetPage('Overview', answering([], 'Overview')) } : {}),
    },
    ...(ALIASES ? { sidebar: { label: `${name} navigation`, title: name, nodes: ALIAS_NODES } } : {}),
    ...(CONNECTION ? { sidebar: { label: `${name} navigation`, title: name, nodes: CONNECTION_NODES } } : {}),
    palette: createFixturePalette(name, (item) => ({ page: 'item', params: { name: item } }), { page: 'widgets', params: {} }),
  });

const WEST = { id: 'fixture-a-ok', name: 'Seam Fixture' };
const EAST = { id: 'fixture-b-dup', name: 'Seam Fixture Copy' };
const INSTALLED = [WEST, EAST].slice(0, number('plugins', 1));
const readyOf = (installed: { readonly id: string; readonly name: string }): PluginEntry => ({ id: installed.id, name: `${installed.name} plugin`, phase: 'ready', contribution: contributionOf(installed.name) });

let entries: readonly PluginEntry[] = INSTALLED.map(readyOf);
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
const set = (next: readonly PluginEntry[]): void => {
  entries = next;
  for (const listener of [...heard]) {
    listener();
  }
};

const change = (id: string, make: (installed: { readonly id: string; readonly name: string }) => PluginEntry): void => {
  const installed = INSTALLED.find((candidate) => candidate.id === id);
  if (installed !== undefined) {
    set(entries.map((entry) => (entry.id === id ? make(installed) : entry)));
  }
};

Reflect.set(window, '__plugin', {
  unload: (id = WEST.id) => {
    change(id, (installed) => ({ id: installed.id, name: `${installed.name} plugin`, phase: 'loading' }));
  },
  fail: (id = WEST.id) => {
    change(id, (installed) => ({ id: installed.id, name: `${installed.name} plugin`, phase: 'failed', failure: { kind: 'broken', message: 'The plugin\'s interface could not be loaded.' } }));
  },
  reload: (id = WEST.id) => {
    change(id, readyOf);
  },
});
Reflect.set(window, '__sources', () => heard.size);

const frames = new Published<FrameV1>();
const nodes = new Published<readonly SidebarNodeV1[] | null>();
const contributions = createContributions({ plugins, frames });
const tabs = createTabsStore({ contributions });
/** The page on screen: with `?connection=1` the detail page of an item read in the connection, else a list page, in a connection with `?scoped=1`. */
const ON_SCREEN = CONNECTION
  ? { plugin: WEST.id, contribution: 'item', params: { name: 'orders-api', connection: KEY } }
  : { plugin: WEST.id, contribution: 'widgets', params: params.get('scoped') === '1' ? { connection: 'north' } : {} };
tabs.open({ route: ON_SCREEN }, { how: 'new' });
Reflect.set(window, '__tabs', tabs);
if (CONNECTION) {
  // What the detail page of the host publishes once it is drawn (PluginHost's DetailContribution), under the route of the tab it is drawn for: the tab, the path the host made from the route (it holds the key) and the lane the
  // plugin's hook answered, which names the connection.
  const state = tabs.getSnapshot();
  const shown = state.active === null ? undefined : state.tabs[state.active]?.location.route;
  if (shown !== undefined) {
    const face = contributions.describe(shown);
    frames.publish(routeKey(shown), {
      tab: { title: face?.title ?? 'Item', icon: 'box' },
      path: (face?.path ?? []).map((crumb) => (typeof crumb === 'string' ? crumb : crumb.label)),
      scope: [{ label: 'Connection', icon: 'server', text: NAME }],
    });
  }
}

const host = createHostPalette({
  tabs,
  plugins,
  contributions,
  nodes,
  frames,
  panel: undefined,
  platform: platformOf(navigator),
  onCloseWindow: undefined,
  // What a plugin's command is given of the bottom panel: a handle that opens nothing, so the check can see that a command is given one.
  panelHosts: () => ({ logs: { open: () => undefined } }),
});
host.attach();
Reflect.set(window, '__palette', host.store);

/** The nodes without the keywords they carry, as a plugin's sidebar that never said any. */
const withoutKeywords = (list: readonly SidebarNodeV1[]): SidebarNodeV1[] =>
  list.map(({ keywords: _keywords, children, ...rest }) => ({ ...rest, ...(children === undefined ? {} : { children: withoutKeywords(children) }) }));

/**
 * The probe's negative control for the sidebar's keywords (`?aliases=1`): the fault the check is there to see, made in the page. `ignored`: the host does not read the keyword, so the page has no name but its label.
 * `loose`: the keyword ranks as a keyword did before an alias was a name (a source of the host's own that offers the page with the word among its keywords, which weigh 3), so a loose match in a title (Gazebo) outranks it.
 */
Reflect.set(window, '__aliasFault', (fault: 'ignored' | 'loose'): void => {
  nodes.publish(WEST.id, withoutKeywords(ALIAS_NODES));
  if (fault === 'loose') {
    host.store.registerProvider({
      id: 'probe:keyword',
      plugin: 'host',
      pluginName: 'Omniview',
      title: 'Pages',
      section: 'goto',
      // The words as a plugin wrote them when they were keywords (the kind, then its short name): the start of a part of a text is 76 x 3, and a loose match in a title (Gazebo) is 39 x 6.
      match: () => [{ id: 'gadgets', kind: 'page', title: 'Gadgets', context: 'Group', keywords: 'gadget gz', route: { plugin: WEST.id, contribution: 'gadgets' } }],
    });
  }
});

/**
 * The probe's negative control for the connection a row says (`?connection=1`): a palette that says the key. A source of the host's own whose row for a page carries the route's connection parameter where the name belongs,
 * which is what the pages source did before it read the name from the page's lane.
 */
Reflect.set(window, '__connectionFault', (): void => {
  host.store.registerProvider({
    id: 'probe:key',
    plugin: 'host',
    pluginName: 'Omniview',
    title: 'Pages',
    section: 'goto',
    match: () => [{ id: 'gadgets', kind: 'page', title: 'Gadgets', context: `${KEY} · Group`, route: { plugin: WEST.id, contribution: 'gadgets', params: { connection: KEY } } }],
  });
});

const announced: string[] = [];
Reflect.set(window, '__announced', announced);
host.announcer.subscribe(() => {
  announced.push(host.announcer.getSnapshot().text);
});

// Every commit of the shell's tree. React's Profiler calls this once for each commit that rendered something under it.
const commits: Array<{ readonly phase: string; readonly actualDuration: number }> = [];
Reflect.set(window, '__commits', commits);

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <Profiler
      id="shell"
      onRender={(_id, phase, actualDuration) => {
        commits.push({ phase, actualDuration });
      }}
    >
      <StaticShell registration={{ plugin: { name: WEST.name }, rail: STATIC_RAIL }} tabs={tabs} palette={host}>
        <button type="button">A control in the page</button>
      </StaticShell>
    </Profiler>
    <TooltipHost />
  </ThemeProvider>,
);
