import type { Availability, Contributions, Description, Destination, Json, Route, RouteInput, Tab, TabId, TabsState } from './types';
import { createTabsStore, type TabsStore, type TabsStoreOptions } from './store';

// Test support only: nothing in the model imports this file.
//
// A small world of plugins, shaped like the demo plugins of the design lab's harness (tests/shell-model-harness/R2Store/unit.cjs) with the
// vocabulary of no real plugin: `host` (Home and the three singleton pages), `cloud` (list pages and object pages, scoped by a region),
// `stack` (object pages with two facets, scoped by a connection), `access` (users) and `broken` (every member throws).

/** A plugin of the fixture: what the host's plugin registry would hand the model. */
export type FixturePlugin = {
  readonly id: string;
  readonly name: string;
  readonly describe: (route: Route) => Description;
  readonly complete?: (route: Route, from: Route | undefined) => Route | undefined;
  readonly restore?: (route: Route) => Route | false;
  readonly availability?: (route: Route) => Availability;
  readonly home?: () => RouteInput | undefined;
};

const sentence = (text: string): string => (text === '' ? '' : text[0]?.toUpperCase() + text.slice(1));
const text = (value: Json | undefined): string => (typeof value === 'string' ? value : '');

const host: FixturePlugin = {
  id: 'host',
  name: 'Omniview',
  // A host page says no plugin name and no path (ch16 X7): its tab reads as its title alone.
  describe: (route) => {
    const titles: Record<string, string> = { home: 'Home', settings: 'Settings', plugins: 'Plugins', devtools: 'Developer Tools' };
    return { title: titles[route.contribution] ?? sentence(route.contribution), icon: 'house', path: [], singleton: route.contribution !== 'home' };
  },
  home: () => ({ plugin: 'host', contribution: 'home' }),
};

const cloud: FixturePlugin = {
  id: 'cloud',
  name: 'Cloud',
  describe: (route) => {
    const region = text(route.params.region);
    const item = text(route.params.item);
    const title = route.contribution === 'blank' ? 'Blank' : item || sentence(route.contribution);
    return {
      title,
      icon: 'server',
      pluginName: 'Cloud',
      scope: region ? { id: `acme/${region}`, label: region } : undefined,
      path: ['Cloud', 'Compute', title],
      facets: region ? [region] : [],
      identity: route.contribution === 'blank' ? 'none' : undefined,
      // The sub-tab is not identity: it is left out of the key.
      key: `${route.contribution}|${item}`,
    };
  },
  complete: (route, from) => {
    if (route.params.region !== undefined || from?.plugin !== 'cloud' || from.params.region === undefined) {
      return route;
    }

    return { ...route, params: { ...route.params, region: from.params.region } };
  },
  home: () => ({ plugin: 'cloud', contribution: 'instances' }),
};

const stack: FixturePlugin = {
  id: 'stack',
  name: 'Stack',
  describe: (route) => {
    const connection = text(route.params.connection);
    const group = text(route.params.group);
    const name = text(route.params.name);
    const isObject = route.contribution === 'service';
    const title = isObject ? `${name} · Service` : sentence(route.contribution);
    return {
      title,
      icon: isObject ? 'box' : 'boxes',
      pluginName: 'Stack',
      scope: connection ? { id: connection, label: connection } : undefined,
      path: ['Stack', ...(connection ? [connection] : []), 'Services', ...(isObject ? [name] : [])],
      facets: isObject ? [group, connection] : [connection],
      key: `${route.contribution}|${group}|${name}`,
    };
  },
  complete: (route, from) => {
    if (route.params.connection !== undefined || from?.plugin !== 'stack' || from.params.connection === undefined) {
      return route;
    }

    return { ...route, params: { ...route.params, connection: from.params.connection } };
  },
  home: () => ({ plugin: 'stack', contribution: 'services' }),
};

const access: FixturePlugin = {
  id: 'access',
  name: 'Access plugin',
  describe: (route) => {
    const item = text(route.params.item);
    return { title: item === 'u-9' ? 'alice.chen' : 'Users', icon: 'user', pluginName: 'Access plugin', path: ['IAM', 'Users', ...(item ? [item] : [])], key: `${route.contribution}|${item}` };
  },
};

const broken: FixturePlugin = {
  id: 'broken',
  name: 'Broken',
  describe: () => {
    throw new Error('describe');
  },
  availability: () => {
    throw new Error('availability');
  },
  restore: () => {
    throw new Error('restore');
  },
  home: () => {
    throw new Error('home');
  },
};

/** Two plugins whose pages read alike (the same title and icon), told apart by what the model derives (ch16 TI1). */
const service = (id: string, label: string): FixturePlugin => ({
  id,
  name: 'Cloud',
  describe: () => ({ title: 'Instances', icon: 'server', pluginName: 'Cloud', path: [label, 'Instances'] }),
  home: () => ({ plugin: id, contribution: 'instances' }),
});

export const FIXTURE_PLUGINS: readonly FixturePlugin[] = [host, cloud, stack, access, broken, service('compute', 'COMPUTE'), service('database', 'DATABASE')];

export type World = {
  readonly contributions: Contributions;
  /** Every question the model asked, so a test can prove an operation asks a fixed number of them. */
  readonly calls: { describe: number; availability: number; complete: number; restore: number; home: number };
  /** What a plugin reports; `undefined` clears it. */
  readonly report: (plugin: string, availability: Availability | undefined) => void;
  readonly install: (plugin: FixturePlugin) => () => void;
  readonly uninstall: (plugin: string) => void;
  /** Renames what a plugin says about a page, as a plugin that loaded late or was updated would; tell the model with `changed()`. */
  readonly retitle: (plugin: string, title: (route: Route, original: string) => string) => void;
  /** Tells the model that what the plugins say changed. */
  readonly changed: () => void;
  /** Turns the window's home page off (the strip may then be empty). */
  readonly setHome: (on: boolean) => void;
};

export function makeWorld(): World {
  const plugins = new Map<string, FixturePlugin>(FIXTURE_PLUGINS.map((plugin) => [plugin.id, plugin]));
  const reports = new Map<string, Availability>();
  const titles = new Map<string, (route: Route, original: string) => string>();
  const listeners = new Set<() => void>();
  const calls = { describe: 0, availability: 0, complete: 0, restore: 0, home: 0 };
  let hasHome = true;

  const contributions: Contributions = {
    describe: (route) => {
      calls.describe += 1;
      const plugin = plugins.get(route.plugin);
      if (!plugin) {
        return undefined;
      }

      const description = plugin.describe(route);
      const retitle = titles.get(route.plugin);
      return retitle ? { ...description, title: retitle(route, description.title) } : description;
    },
    availability: (route) => {
      calls.availability += 1;
      const plugin = plugins.get(route.plugin);
      if (!plugin) {
        return { state: 'unavailable', reason: `${route.plugin} is not installed` };
      }

      return reports.get(route.plugin) ?? plugin.availability?.(route) ?? { state: 'available' };
    },
    complete: (route, context) => {
      calls.complete += 1;
      const plugin = plugins.get(route.plugin);
      return plugin?.complete ? plugin.complete(route, context.from) : route;
    },
    restore: (route) => {
      calls.restore += 1;
      return plugins.get(route.plugin)?.restore?.(route) ?? route;
    },
    home: (plugin) => {
      calls.home += 1;
      if (plugin === undefined) {
        return hasHome ? plugins.get('host')?.home?.() : undefined;
      }

      return plugins.get(plugin)?.home?.();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    contributions,
    calls,
    report: (plugin, availability) => {
      if (availability === undefined) {
        reports.delete(plugin);
      } else {
        reports.set(plugin, availability);
      }
    },
    install: (plugin) => {
      plugins.set(plugin.id, plugin);
      return () => {
        plugins.delete(plugin.id);
      };
    },
    uninstall: (plugin) => {
      plugins.delete(plugin);
    },
    retitle: (plugin, title) => {
      titles.set(plugin, title);
    },
    changed: () => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
    setHome: (on) => {
      hasHome = on;
    },
  };
}

/** Destinations, written the short way. */
export const dest = (plugin: string, contribution: string, params?: Readonly<Record<string, Json | undefined>>, reveal?: Json): Destination => ({
  route: params ? { plugin, contribution, params } : { plugin, contribution },
  ...(reveal === undefined ? {} : { reveal }),
});
export const hostPage = (contribution: string, params?: Readonly<Record<string, Json | undefined>>, reveal?: Json): Destination => dest('host', contribution, params, reveal);
export const cloudPage = (contribution: string, params?: Readonly<Record<string, Json | undefined>>): Destination => dest('cloud', contribution, params);
export const stackPage = (contribution: string, params?: Readonly<Record<string, Json | undefined>>): Destination => dest('stack', contribution, params);

/** The id a result names; fails the test when the request did not end in `done`. */
export function doneId(result: { readonly status: string; readonly id?: TabId }): TabId {
  if (result.status !== 'done' || result.id === undefined) {
    throw new Error(`the request did not complete: ${JSON.stringify(result)}`);
  }

  return result.id;
}

/** A tab of the harness's strip; fails the test when there is none. */
export function tabOf(h: { readonly state: () => TabsState }, id: TabId): Tab {
  const found = h.state().tabs[id];
  if (!found) {
    throw new Error(`no tab ${id}`);
  }

  return found;
}

export type Harness = {
  readonly store: TabsStore;
  readonly world: World;
  /** The settings the store reads: a test changes them in place. */
  readonly preferences: { openResults: 'smart' | 'new-tab' | 'current-tab'; reusePreview: boolean };
  readonly state: () => TabsState;
  /** The strip, as tab ids. */
  readonly ids: () => readonly TabId[];
  /** The strip, as titles. */
  readonly titles: () => readonly string[];
  readonly active: () => TabId | null;
  /** The tab on screen; fails the test when there is none. */
  readonly current: () => TabId;
  /** Opens a destination and returns the id of the tab it ended in; fails the test when nothing opened. */
  readonly open: (destination: Destination, options?: Parameters<TabsStore['open']>[1]) => TabId;
  /** Opens a cloud page in a new tab for each name, and returns their ids. */
  readonly openAll: (pages: readonly string[]) => TabId[];
  readonly errors: Array<{ readonly error: unknown; readonly where: string }>;
};

/** A store over the fixture world with ids `t1`, `t2`, ...; the Home tab is open unless `home: false`. */
export function boot(options: { readonly home?: boolean; readonly keepAlive?: TabsStoreOptions['keepAlive']; readonly initial?: TabsState; readonly world?: World } = {}): Harness {
  const world = options.world ?? makeWorld();
  world.setHome(options.home ?? true);
  const preferences: Harness['preferences'] = { openResults: 'smart', reusePreview: true };
  let counter = 0;
  const errors: Harness['errors'] = [];
  const store = createTabsStore({
    contributions: world.contributions,
    preferences: () => preferences,
    newId: () => `t${++counter}`,
    onError: (error, where) => errors.push({ error, where }),
    ...(options.keepAlive ? { keepAlive: options.keepAlive } : {}),
    ...(options.initial ? { initial: options.initial } : {}),
  });
  const state = () => store.getSnapshot();
  return {
    store,
    world,
    preferences,
    state,
    errors,
    ids: () => state().order,
    titles: () => state().order.map((id) => state().tabs[id]?.face.title ?? '?'),
    active: () => state().active,
    current: () => {
      const id = state().active;
      if (id === null) {
        throw new Error('no tab is on screen');
      }

      return id;
    },
    open: (destination, openOptions) => doneId(store.open(destination, openOptions)),
    openAll: (pages) => pages.map((page) => doneId(store.open(cloudPage(page), { how: 'new' }))),
  };
}
