// The real plugin host with invented plugins, for the probe (shell-probe.mjs): the window as it opens, where plugins load after the first frame. `PluginHost` is the product's own, around a
// `PluginStore` whose loader is injected, so the timeline of a real start (inventory read, interfaces loading, sidebar entries and the page's data arriving) is under the probe's control and the
// code under it is not a stand-in. A second HTML entry that the probe builds on its own; `vite build` of the channel never reaches it.
//
//   ?inventoryMs=100  when the inventory of installed plugins is read (the first frame is drawn before it)
//   ?loadMs=300       how long each plugin's interface takes to load, after the inventory
//   ?nodesMs=200      how long its sidebar takes to answer with its entries, once it is on screen (the contribution's skeleton stands until then)
//   ?dataMs=200       how long a page's data takes to arrive
//   ?rows=25          rows in the list page `widgets`
//   ?plugins=1        how many plugins are installed (`alpha`, `beta`)
//   ?lateMs=0         how much longer the second plugin's interface takes to load than the first's: it registers late, after the first has (S2a: the window must not move for it)
//   ?first=alpha      which plugin the rail lists first: `rail.order` 10 for that one and 20 for the other (`beta`: the plugin that registers late sorts first)
//   ?lane=1           whether the pages declare a scope lane (the plugins' frames have one by default); `0`: they declare none
//   ?panel=1          every plugin brings a tool to the bottom panel (the fixture plugin's `streams`, ../../plugins/fixture/src/panel.tsx, labelled `<Plugin> streams`, in the order the rail has the plugins); `window.__panel` is
//                     the window's panel model
//   ?session=one      the session the window starts from (S3a), kept in the page's own session storage so a reload restores what was written: `one` (a tab on `alpha`'s page `widgets`, the default),
//                     `two` (that tab and one on `beta`'s, which is on screen), `gone` (a tab of a plugin that is never installed), `none` (nothing was saved: the empty window), `bad` (a text that cannot
//                     be used). `window.__sessionNotes` lists what the session said on the console; a text kept aside is a key `host-fixture-session:session.invalid.<time>` of the session storage
//   ?logs=1           `window.__logs` opens the fixture plugin's Logs sessions (../../plugins/fixture/src/logs.ts: 0 `app` streams, 1 `migrate` ends, 2 `sync` fails, 3 `audit` makes 10,000 lines a second, 4 `pair` follows two sources) through
//                     the `ctx.panel` a plugin's page was given (`open(index, plugin = 'alpha')`, `close(n)` the n-th session opened, `ready()`); `window.__fixtureLogs` counts what the host opened, closed and listens to
//
// `window.__ticks` counts the timer of the page `clock` per plugin: a page that is hidden must not run it. `window.__commits` lists every commit of the tree (React's profiler; the probe builds
// this entry with the profiling build of React DOM). `window.__host` is the `PluginStore`.
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { ThemeProvider, type IconName } from '@omniviewdev/kit';
import { Profiler, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ContextV1, ContributionV1, ListPageViewV1, PageV1, PanelHostV1, SidebarNodeV1 } from '../../plugins/contract/v1';
import { logTargetsOf } from '../../plugins/fixture/src/logs';
import { streamsTool } from '../../plugins/fixture/src/panel';
import { PluginHost } from '../../plugins/host/PluginHost';
import { PluginStore, type LoaderDeps, type PluginDescriptor } from '../../plugins/host/pluginStore';
import { WIDGETS, widgetPage, type Widget } from '../../plugins/testing';
import { createPanelStore } from '../core/panel';
import { openSession, type SessionStorage } from '../session';

const params = new URLSearchParams(window.location.search);
const number = (name: string, fallback: number): number => Number(params.get(name) ?? fallback);
const INVENTORY_MS = number('inventoryMs', 100);
const LOAD_MS = number('loadMs', 300);
const NODES_MS = number('nodesMs', 200);
const DATA_MS = number('dataMs', 200);
const ROWS = number('rows', 25);
const PLUGINS = number('plugins', 1);
const LATE_MS = number('lateMs', 0);
const FIRST = params.get('first') === 'beta' ? 'beta' : 'alpha';
const LANE = params.get('lane') !== '0';
const PANEL = params.get('panel') === '1';
const LOGS = params.get('logs') === '1';

const IDS = ['alpha', 'beta'].slice(0, PLUGINS);
const NAMES: Readonly<Record<string, string>> = { alpha: 'Alpha', beta: 'Beta' };
const ICONS: Readonly<Record<string, IconName>> = { alpha: 'layers', beta: 'server' };
/** Where each plugin's entry sits on the rail (`rail.order`, lowest first): the plugin the probe names with `first` leads. */
const ORDER: Readonly<Record<string, number>> = FIRST === 'beta' ? { alpha: 20, beta: 10 } : { alpha: 10, beta: 20 };

const panelStore = createPanelStore();
Reflect.set(window, '__panel', panelStore);

// The session the window starts from, in the page's own session storage: a reload of the page restores what the window wrote, as a reload of the app's window restores what its Go side holds.
const SESSION_KEY = 'host-fixture-session';
const SESSION = params.get('session') ?? 'one';

/** A tab as a previous run saved it: the route and the face its plugin gives it, so the strip draws it before the plugin has loaded. */
function savedTab(id: string, plugin: string, page: string, title: string) {
  const route = { plugin, contribution: page, params: {} };
  const name = NAMES[plugin] ?? plugin;
  return {
    id,
    route,
    key: `${plugin}:${page}`,
    face: { title, icon: 'box', path: [{ label: name }, { label: title }], facets: [], pluginName: name, singleton: false, identity: 'key' },
    pinned: false,
    preview: false,
    history: { entries: [route], index: 0 },
  };
}

const savedWindow = (tabs: readonly unknown[], active: string): string => JSON.stringify({ version: 1, tabs: { version: 1, active, tabs }, rail: null, panel: { version: 1 } });
const PRESETS: Readonly<Record<string, string | undefined>> = {
  none: undefined,
  one: savedWindow([savedTab('t1', 'alpha', 'widgets', 'Widgets')], 't1'),
  two: savedWindow([savedTab('t1', 'alpha', 'widgets', 'Widgets'), savedTab('t2', 'beta', 'widgets', 'Widgets')], 't2'),
  gone: savedWindow([savedTab('t1', 'ghost', 'items', 'Items')], 't1'),
  bad: '{"version":1,"tabs":',
};
const preset = PRESETS[SESSION];
if (window.sessionStorage.getItem(SESSION_KEY) === null && preset !== undefined) {
  window.sessionStorage.setItem(SESSION_KEY, preset);
}

const place: SessionStorage = {
  read: async () => window.sessionStorage.getItem(SESSION_KEY) ?? undefined,
  write: async (text) => {
    window.sessionStorage.setItem(SESSION_KEY, text);
  },
  keep: async (name, text) => {
    window.sessionStorage.setItem(`${SESSION_KEY}:${name}`, text);
  },
};
const sessionNotes: string[] = [];
Reflect.set(window, '__sessionNotes', sessionNotes);
const session = openSession(place, window.sessionStorage.getItem(SESSION_KEY) ?? undefined, {
  log: (message) => {
    sessionNotes.push(message);
  },
});

const ticks: Record<string, number> = {};
const commits: Array<{ readonly phase: string; readonly actualDuration: number }> = [];
Reflect.set(window, '__ticks', ticks);
Reflect.set(window, '__commits', commits);

// The handle each plugin's page was given, kept by the page's hook (an effect: nothing is written while a page renders), and what the probe opens the fixture's Logs sessions through.
const handles: Record<string, PanelHostV1 | undefined> = {};
if (LOGS) {
  const targets = logTargetsOf({ name: 'orders-api', group: 'north-yard' });
  const opened: Array<{ readonly close: () => void } | undefined> = [];
  Reflect.set(window, '__logs', {
    ready: (plugin = 'alpha'): boolean => handles[plugin] !== undefined,
    open: (index: number, plugin = 'alpha'): string | undefined => {
      const target = targets[index];
      const session = target === undefined ? undefined : handles[plugin]?.logs.open(target);
      opened.push(session);
      return session?.id;
    },
    close: (n: number): void => {
      opened[n]?.close();
    },
  });
}

const many: readonly Widget[] = Array.from({ length: ROWS }, (_, index) => ({ key: `w${String(index)}`, name: `widget-${String(index).padStart(4, '0')}` }));

/** What a page says about its frame: the tab, the path, and (by default) a scope lane. */
const frameOf = (plugin: string, title: string, context: ContextV1): ListPageViewV1<Widget>['frame'] => ({
  tab: { title, icon: 'box' },
  path: [NAMES[plugin] ?? plugin, title],
  scope: LANE ? [{ label: 'Connection', icon: 'server', text: context.route.connection ?? 'north' }] : undefined,
});

/** A page whose rows arrive `DATA_MS` after it mounts. */
function listPage(plugin: string, title: string, rows: readonly Widget[]): PageV1 {
  return widgetPage(title, (context): ListPageViewV1<Widget> => {
    const { panel: handle } = context;
    useEffect(() => {
      handles[plugin] = handle;
    }, [handle]);
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
      const timer = setTimeout(() => {
        setLoaded(true);
      }, DATA_MS);
      return () => {
        clearTimeout(timer);
      };
    }, []);
    return {
      frame: frameOf(plugin, title, context),
      source: { state: { kind: loaded ? 'ready' : 'loading' }, rows: loaded ? rows : [], complete: loaded, refreshing: false, refresh: async () => undefined },
    };
  });
}

/** A page whose hook runs a timer for as long as it is mounted and not hidden: `__ticks[plugin]` counts it. */
function clockPage(plugin: string): PageV1 {
  return widgetPage('Clock', (context): ListPageViewV1<Widget> => {
    useEffect(() => {
      const timer = setInterval(() => {
        ticks[plugin] = (ticks[plugin] ?? 0) + 1;
      }, 20);
      return () => {
        clearInterval(timer);
      };
    }, []);
    return { frame: frameOf(plugin, 'Clock', context), source: { state: { kind: 'ready' }, rows: WIDGETS, complete: true, refreshing: false, refresh: async () => undefined } };
  });
}

const SKELETON: readonly SidebarNodeV1[] = [
  {
    id: 'group',
    label: 'Group',
    icon: 'layers',
    children: [
      { id: 'widgets', label: 'Widgets', icon: 'box' },
      { id: 'gadgets', label: 'Gadgets', icon: 'box' },
      { id: 'clock', label: 'Clock', icon: 'clock' },
    ],
  },
];

const WITH_COUNTS: readonly SidebarNodeV1[] = [
  {
    id: 'group',
    label: 'Group',
    icon: 'layers',
    children: [
      { id: 'widgets', label: 'Widgets', icon: 'box', count: ROWS },
      { id: 'gadgets', label: 'Gadgets', icon: 'box', count: 1 },
      { id: 'clock', label: 'Clock', icon: 'clock' },
    ],
  },
];

/** The sidebar's data hook: the skeleton stands until it answers. */
function useCounts(): readonly SidebarNodeV1[] | undefined {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setReady(true);
    }, NODES_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return ready ? WITH_COUNTS : undefined;
}

function contribution(plugin: string): ContributionV1 {
  const name = NAMES[plugin] ?? plugin;
  return {
    plugin: { name, accent: plugin === 'alpha' ? 'blue' : 'teal' },
    rail: { icon: ICONS[plugin] ?? 'box', order: ORDER[plugin] },
    sidebar: { label: `${name} navigation`, title: name, nodes: SKELETON, useNodes: useCounts },
    pages: { widgets: listPage(plugin, 'Widgets', many), gadgets: listPage(plugin, 'Gadgets', WIDGETS), clock: clockPage(plugin) },
    home: 'widgets',
    // The tool sorts after the host's own Logs tool (order 20), in the order the rail has the plugins: 40 + the rail's 10 or 20.
    ...(PANEL ? { panel: { tools: { streams: { ...streamsTool, label: `${name} streams`, order: streamsTool.order + (ORDER[plugin] ?? 0) } } } } : {}),
  };
}

const deps: LoaderDeps = {
  importBundle: async (id) => {
    // The second plugin registers `LATE_MS` after the first.
    await new Promise((resolve) => setTimeout(resolve, LOAD_MS + (id === 'beta' ? LATE_MS : 0)));
    return { contributionV1: contribution(id) };
  },
  clearBundle: () => undefined,
  log: () => undefined,
};

const store = new PluginStore(deps);
Reflect.set(window, '__host', store);

const descriptors: readonly PluginDescriptor[] = IDS.map((id) => ({ id, name: NAMES[id] ?? id }));

function Screen() {
  const [inventory, setInventory] = useState<'loading' | 'ready'>('loading');
  useEffect(() => {
    // The first frame is drawn with nothing known; the inventory is read after it, as the real window's is, and each plugin starts loading when it is.
    const timer = setTimeout(() => {
      setInventory('ready');
      for (const descriptor of descriptors) {
        void store.load(descriptor);
      }
    }, INVENTORY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);

  return (
    <PluginHost
      plugins={store}
      inventory={inventory}
      link={{ plugin: params.get('plugin') ?? undefined, page: params.get('page') ?? undefined, connection: params.get('connection') ?? undefined, params: {} }}
      onRetry={() => undefined}
      onRetryInventory={() => undefined}
      panel={panelStore}
      session={session}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <Profiler
      id="host"
      onRender={(_id, phase, actualDuration) => {
        commits.push({ phase, actualDuration });
      }}
    >
      <Screen />
    </Profiler>
  </ThemeProvider>,
);
