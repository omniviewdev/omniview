import { facetsOf, nameOf, titleOf, type DetailPageDefinition } from '../../page';
import type { Contributions, Description, Route, RouteInput } from '../../shell';
import type { CustomPageV1, FrameV1, OverviewPageDefinition, PageV1, SidebarNodeV1 } from '../contract/v1';
import { failureWords } from '../loader/failure';
import { ConnectionNames, laneNameOf, pathSaid, restoredFace } from './connectionName';
import { HOME_ROUTE, hostPageOf } from './hostPages';
import type { PluginEntry } from './pluginStore';
import type { Published } from './published';

// The tab model's side of the seam (ui-next/shell/core/tabs/README.md, "The seam: Contributions"): what the model asks the plugin host, answered from what the host knows of each
// installed plugin. The model asks five pure, synchronous questions and never a plugin; each answer here is read from the loaded contributions and from the frames the mounted pages
// published, so the host runs no plugin code to answer one. A plugin that has not loaded says nothing yet, and the model keeps the face a tab has until it does.

/**
 * The page a route names when it names no page the plugin has: the plugin's own first page, whatever that is. A route is made with it where the host does not know the page yet (a link
 * to a plugin that is still loading, a plugin whose interface failed) and `complete` turns it into the plugin's `home` as soon as the plugin has one, so a tab made before that is
 * moved to the real page when the plugin loads (the model describes its tabs again when the plugins change). A character no page id has, so no page can be taken for it.
 */
export const HOME_PAGE = '$home';

/** What a route is called in a table of published values: a route is plain data, so its text is its identity. */
export const routeKey = (route: Route): string => JSON.stringify([route.plugin, route.contribution, route.params]);

/** The route a `routeKey` was made from; `undefined` when the text is not the key of a route. */
function routeOfKey(key: string): Route | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return undefined;
  }

  const items: readonly unknown[] = Array.isArray(parsed) ? parsed : [];
  const [plugin, contribution, params] = items;
  if (typeof plugin !== 'string' || typeof contribution !== 'string' || typeof params !== 'object' || params === null) {
    return undefined;
  }

  return { plugin, contribution, params: Object.fromEntries(Object.entries(params)) };
}

/** The connection a route names, the scope a plugin's tabs are told apart by. */
export function connectionOf(route: Route): string | undefined {
  const { connection } = route.params;
  return typeof connection === 'string' ? connection : undefined;
}

/**
 * The connection a page is read in, for what it asks of the bottom panel (`ctx.panel`, PF3): the one its route names, else the plugin's only connection. `complete` leaves a route of a plugin that has one connection unnamed (there is
 * nothing to choose between) and the plugin reads it in that one, so the window knows it, and a page that forwards a port needs it. With two or more connections, with none, or with a list the window has not read (`choice.state`), nothing
 * says which one the page is read in, and the panel has none: the host does not guess.
 */
export function panelConnectionOf(route: Route, choice: PluginChoice | undefined): string | undefined {
  const named = connectionOf(route);
  return named ?? (choice?.state === 'ready' && choice.keys.length === 1 ? choice.keys[0] : undefined);
}

/** The route's parameters a page's hook is told besides the connection (`RouteV1.params`): the ones that are text. For a detail page they are the object's identity. */
export const textParamsOf = (route: Route): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.entries(route.params).flatMap(([name, value]) => (name !== 'connection' && typeof value === 'string' ? [[name, value] as const] : [])));

/** What a custom page asked for with `context.setParams` (KL7): the route it asks the tab to be at, or what is wrong with the call. */
export type ParamsAsked = { readonly route: Route } | { readonly problem: string };

/**
 * The route a custom page asks for when it sets its own parameters: the route the tab is at, with `next` for its parameters (as the whole set: the ones it does not name are gone) and the connection the page is read in kept, which a call never changes. Plugin data, read as such and never trusted
 * to its type: parameters that are text, with the empty ones left out (an empty parameter names nothing, as the tab model has it). Anything else, and a parameter called `connection`, is a problem that names it, and the call is ignored. Entries, not assignments: a name such as `__proto__` is data here.
 */
export function askedParams(route: Route, next: unknown): ParamsAsked {
  if (typeof next !== 'object' || next === null || Array.isArray(next)) {
    return { problem: 'the parameters are not an object of text values' };
  }

  const kept: Array<readonly [string, string]> = [];
  for (const [name, value] of Object.entries(next)) {
    if (typeof value !== 'string') {
      return { problem: `the parameter "${name}" is not text` };
    }

    if (name === 'connection') {
      return { problem: 'the parameters hold "connection", which is not a parameter: it is the connection the page is read in, and a call never changes it' };
    }

    if (value !== '') {
      kept.push([name, value]);
    }
  }

  const connection = connectionOf(route);
  return { route: { plugin: route.plugin, contribution: route.contribution, params: Object.fromEntries([...kept, ...(connection === undefined ? [] : [['connection', connection] as const])]) } };
}

/** What the host reads of its plugins: the entries now, and a way to hear that they changed. `PluginStore` is one. */
export type PluginSource = {
  readonly getSnapshot: () => readonly PluginEntry[];
  readonly subscribe: (listener: () => void) => () => void;
};

/** What the window knows of a plugin's connections (`ContributionsDeps.choice`). */
export type PluginChoice = {
  /**
   * What the window knows of the plugin's connections: `ready` (it read them, and `keys` are all there are, possibly none), `unread` (the first read has not come back) or `failed` (it came back failing and there is no earlier list
   * to go by). Only a `ready` list says which connection a route that names none is read in (`complete`).
   */
  readonly state: 'ready' | 'unread' | 'failed';
  /** The keys of the connections the window has read for the plugin. */
  readonly keys: readonly string[];
  /** The key of the connection the plugin was last shown in, in this window. */
  readonly last: string | undefined;
};

export type ContributionsDeps = {
  readonly plugins: PluginSource;
  /** The frame each mounted page published, by `routeKey`: the lane it published is where the name of its connection is read (`connectionName.ts`). */
  readonly frames: Published<FrameV1>;
  /** The names this window has learned for its connections, by plugin and key. Default: a set of its own. */
  readonly names?: ConnectionNames | undefined;
  /**
   * What the window knows of a plugin's connections (HM1): the keys, and the one the plugin was last used in, in this window. With it a route that names no connection, of a plugin that has two or more, is completed from what the window knows
   * instead of being left for the plugin to answer with its first one, an arbitrary one (`complete`). Absent, or `undefined` for a plugin: the window knows none, and such a route stays as it is.
   */
  readonly choice?: ((plugin: string) => PluginChoice | undefined) | undefined;
};

/** The glyph of the sidebar entry that opens a page: the page's own glyph before its hook has said another. */
function glyphOf(nodes: readonly SidebarNodeV1[], page: string): string | undefined {
  for (const node of nodes) {
    const found = node.children === undefined ? (node.id === page ? node.icon : undefined) : glyphOf(node.children, page);
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

/**
 * The route of a plugin's own first page, for every place that opens a plugin and names no connection (the rail, Home's row, `+`, the palette's row for the plugin): its `landing` when it declares one, else its `home`, when it has loaded; else the stand-in that `complete` resolves.
 * A connection chosen opens the plugin's `home` (`connections/actions.ts`), never this.
 */
const homeOf = (entry: PluginEntry): RouteInput => ({ plugin: entry.id, contribution: entry.phase === 'ready' ? (entry.contribution.landing ?? entry.contribution.home) : HOME_PAGE });

/** Whether a page is read in no connection (KL2): a custom page of scope `plugin`, such as a plugin's landing. No connection is carried to it, no lane says one for it, and the panel handle it is given has none. */
export const readsNoConnection = (page: PageV1 | undefined): boolean => page?.kind === 'custom' && page.scope === 'plugin';

/**
 * What a detail route says about its tab (design 16 TI1, DM1, S61): the title `{name} · {Kind}`, the kind's glyph, the plugin's qualifiers (the parameters the definition lists: a group
 * first) with the connection after them, and the path `Plugin › connection › list › name`, whose list crumb leads back to the list. The connection is said by its NAME (`connectionName.ts`), or not at all when none
 * is known: the key a route carries is the scope's id and the parameter of the list crumb's route, and is drawn nowhere. It reads the route, the definition and the name, and nothing else.
 */
export function describeDetail(pluginName: string, route: Route, definition: DetailPageDefinition, connectionName?: string): Description {
  const connection = connectionOf(route);
  const name = nameOf(definition, route.params);
  const { list } = definition;
  return {
    title: titleOf(definition, route.params),
    icon: definition.tile.icon,
    pluginName,
    path: [
      pluginName,
      ...(connectionName === undefined ? [] : [connectionName]),
      ...(list === undefined ? [] : [{ label: list.label, route: { plugin: route.plugin, contribution: list.page, params: { connection } } }]),
      name === '' ? definition.kind : name,
    ],
    scope: connection === undefined ? undefined : { id: connection, label: connectionName ?? '' },
    facets: [...facetsOf(definition, route.params), ...(connectionName === undefined ? [] : [connectionName])],
  };
}

/** The one route parameter the detail page of an overview is drawn with: it holds the connection's NAME, and the synthesized definition (`overviewAsDetail`) names it as the page's subject. Internal to the host: no route carries it. */
export const OVERVIEW_SUBJECT = 'scope';

/**
 * The detail definition an overview page is drawn with (HM3): the overview is the detail page's anatomy for a scope and not for an object, so the page header, the strip and the Overview are the detail page's own, unchanged, given a definition made from the
 * overview's. Its kind is the page's title (the word of the page's states and the heading while nothing names the connection), its tile and tabs are the overview's, and the one parameter that names its subject is `OVERVIEW_SUBJECT`, which the host fills with the connection's name.
 */
export const overviewAsDetail = (definition: OverviewPageDefinition): DetailPageDefinition => ({ kind: definition.title, tile: definition.tile, identity: { name: OVERVIEW_SUBJECT }, tabs: definition.tabs });

/**
 * What an overview route says about its tab (HM3): the page's title, the tile's glyph, the path `Plugin › connection` (the plugin alone while no connection is known), the scope, and the connection's name as the qualifier that tells two overviews apart. The page
 * is the page of a scope, so its face is the definition's, the plugin's and the connection's NAME alone, as an object's is (`describeDetail`): the same before the page's hook has run (a tab restored in the background, never drawn) and after it, and the key a route
 * carries is drawn nowhere.
 */
export function describeOverview(pluginName: string, route: Route, definition: OverviewPageDefinition, connectionName?: string): Description {
  const connection = connectionOf(route);
  return {
    title: definition.title,
    icon: definition.tile.icon,
    pluginName,
    path: [pluginName, ...(connectionName === undefined ? [] : [connectionName])],
    scope: connection === undefined ? undefined : { id: connection, label: connectionName ?? '' },
    facets: connectionName === undefined ? [] : [connectionName],
  };
}

/**
 * What a custom page's route says about its tab (KL2): the page's title and glyph, the path `Plugin › connection › title` (the plugin and the title alone for a page read in no connection, and the plugin alone when the page is called as the plugin is), the scope for a page of a
 * connection, and the connection's name as the qualifier that tells two of its tabs apart. The Body draws the whole page, so the face is the definition's, the plugin's and the connection's NAME alone, the same before the Body has run (a tab restored in the background) and after it. A page
 * read in no connection has no scope, whatever its route carries: the lane never claims a connection for it.
 */
export function describeCustom(pluginName: string, route: Route, page: CustomPageV1, connectionName?: string): Description {
  const connection = page.scope === 'plugin' ? undefined : connectionOf(route);
  const named = connection === undefined ? undefined : connectionName;
  return {
    title: page.title,
    icon: page.icon,
    pluginName,
    path: [pluginName, ...(named === undefined ? [] : [named]), ...(page.title.trim().toLowerCase() === pluginName.trim().toLowerCase() ? [] : [page.title])],
    scope: connection === undefined ? undefined : { id: connection, label: named ?? '' },
    facets: named === undefined ? [] : [named],
  };
}

/**
 * The model's `Contributions`, over the host's plugins. `describe` gives a tab its title, glyph and path from the page's own contribution (what its hook published, else the page's
 * definition and its sidebar entry), its scope from the connection its route names, and says the plugin's name so a tab that reads like another is told from it. `availability` opens a
 * plugin that is loading or failed to a page that says so (ch16 S65: degraded) and refuses one the host does not have. `complete` fills in the connection of the tab a destination is
 * opened from, and turns a page the plugin does not have into its home. `home` is a plugin's own first page; the window has none of its own.
 */
export function createContributions({ plugins, frames, names = new ConnectionNames(), choice }: ContributionsDeps): Contributions {
  const entryOf = (plugin: string): PluginEntry | undefined => plugins.getSnapshot().find((entry) => entry.id === plugin);
  // What every page published says of its connection is learned when a page publishes, before the tabs are described again: a tab described before the tab whose page names the connection (a background tab earlier in the
  // strip) has the name in the same pass.
  const learnFrames = (): void => {
    for (const [key, frame] of frames.entries()) {
      const route = routeOfKey(key);
      const connection = route === undefined ? undefined : connectionOf(route);
      const lane = laneNameOf(frame.scope);
      if (route !== undefined && connection !== undefined && typeof lane === 'string') {
        names.learn(route.plugin, connection, lane);
      }
    }
  };

  return {
    describe: (route): Description | undefined => {
      // A page of the host's own (the Plugins page, Home): no scope, no path and no plugin name (ch16 X7). Plugins is a singleton tab of the whole window (ch16 S9); Home is an ordinary tab, and several may exist.
      const hosted = hostPageOf(route);
      if (hosted !== undefined) {
        return { title: hosted.title, icon: hosted.icon, singleton: hosted.singleton !== false, path: [] };
      }

      const entry = entryOf(route.plugin);
      if (entry === undefined) {
        return undefined;
      }

      // The connection a route names is a KEY, and a tab says it by the NAME its page said: this is the one place a face is made from a route, so no surface of the shell can draw the key. Where no name is known the
      // face says no connection: the scope keeps the key as its id (it tells places apart, and is never drawn) with an empty label. A name a page's lane says is learned, so another page of the connection has it.
      const frame = frames.get(routeKey(route));
      const connection = connectionOf(route);
      const lane = laneNameOf(frame?.scope);
      if (connection !== undefined && typeof lane === 'string') {
        names.learn(route.plugin, connection, lane);
      }

      // `null`: the page's lane says it has no name for the connection (a face marked as it, with no text), and a name learned before is not put in its place.
      const name = connection === undefined || lane === null ? undefined : (lane ?? names.get(route.plugin, connection));
      const scope = connection === undefined ? undefined : { id: connection, label: name ?? '' };
      const facets = name === undefined ? [] : [name];
      if (entry.phase !== 'ready') {
        // A plugin that is loading has said nothing yet: the stand-in names a tab opened at it, and is never taken for what the plugin says, so a tab restored from a session keeps the face it was
        // saved with until the plugin registers. A plugin that did not load has said what it is: its tab says so, with the error glyph; one that is starting again after a reload is the mock's
        // starting plugin (ch16 S89, PO1), where nothing failed, and keeps the plugin's own.
        const standIn = entry.phase === 'loading' ? { provisional: true as const } : {};
        const faulted = entry.phase === 'failed' && failureWords(entry.failure).faulted;
        return { title: entry.name, icon: faulted ? 'status-error' : 'box', pluginName: entry.name, path: [entry.name], scope, facets, ...standIn };
      }

      const { contribution } = entry;
      const page = Object.hasOwn(contribution.pages, route.contribution) ? route.contribution : contribution.home;
      const found = contribution.pages[page];
      if (found?.kind === 'detail') {
        // An object's face is the route's, the definition's and the connection's name alone: it is the same before the page's hook has run (the name is the one this window has learned, if any), in every state of the data, and in a tab that was never shown.
        return describeDetail(contribution.plugin.name, route, found.definition, name);
      }

      if (found?.kind === 'overview') {
        // A scope's face is the same, from the definition, the plugin and the connection's name alone: what the page publishes says the same words, so a tab that was never shown names its place as the tab on screen does.
        return describeOverview(contribution.plugin.name, route, found.definition, name);
      }

      if (found?.kind === 'custom') {
        // The plugin draws the whole page, so its face is the definition's, the plugin's and the connection's name alone, as a scope's is.
        return describeCustom(contribution.plugin.name, route, found, name);
      }

      const title = frame?.tab.title ?? found?.definition.title ?? entry.name;
      return {
        title,
        icon: frame?.tab.icon ?? glyphOf(contribution.sidebar.nodes, page) ?? 'box',
        pluginName: contribution.plugin.name,
        path: pathSaid(frame?.path ?? [contribution.plugin.name, ...(name === undefined ? [] : [name]), title], connection, name),
        scope,
        facets,
      };
    },
    availability: (route) => {
      if (hostPageOf(route) !== undefined) {
        return { state: 'available' };
      }

      const entry = entryOf(route.plugin);
      if (entry === undefined) {
        return { state: 'unavailable', reason: 'This plugin is not installed, or is turned off.' };
      }

      if (entry.phase === 'ready') {
        return { state: 'available' };
      }

      if (entry.phase === 'loading') {
        return { state: 'degraded', reason: 'This plugin is loading.' };
      }

      // A plugin that stopped says why, in the host's words; one whose bundle failed says it did not load.
      return { state: 'degraded', reason: entry.failure.kind === 'unloaded' ? entry.failure.message : 'This plugin did not load.' };
    },
    complete: (route, { from, source }) => {
      const entry = entryOf(route.plugin);
      const loaded = entry?.phase === 'ready' ? entry.contribution : undefined;
      // A route that names no page the plugin has is its first page, the plugin's `home`: what a connection opens.
      const asksHome = loaded !== undefined && (route.contribution === HOME_PAGE || !Object.hasOwn(loaded.pages, route.contribution));
      const page = asksHome ? loaded.home : route.contribution;
      // A page that is read in no connection (the landing) keeps none (KL2): the connection of the tab it is opened from is not carried to it, and the one a link or an entry names is dropped, so the page is one place whoever opens it.
      if (loaded !== undefined && readsNoConnection(Object.hasOwn(loaded.pages, page) ? loaded.pages[page] : undefined)) {
        return page === route.contribution && route.params.connection === undefined
          ? route
          : { plugin: route.plugin, contribution: page, params: Object.fromEntries(Object.entries(route.params).filter(([name]) => name !== 'connection')) };
      }

      // A sidebar entry names a page, not a connection: the page opens in the connection of the tab it is opened from.
      const inherited = from?.plugin === route.plugin ? from.params.connection : undefined;
      let params = route.params.connection === undefined && typeof inherited === 'string' ? { ...route.params, connection: inherited } : route.params;
      // A plugin that declares a landing (KL2) says what a route that names no connection is: the landing, in place of every choice the window would make below (Home, the connection last used, the plugin's first). The landing says nothing of the page
      // the route named, which needs a connection it does not have. A tab that is already open keeps the route it has (`refresh`), but for the stand-in of a first page, which is the landing as it is Home's.
      if (loaded?.landing !== undefined && params.connection === undefined && (asksHome || source !== 'refresh')) {
        return { plugin: route.plugin, contribution: loaded.landing, params: {} };
      }

      // A route that still names no connection is read by the plugin in its first one, which with two or more is an arbitrary one: the window chooses instead (HM1). The connection the plugin was last used in; with none used there is nothing
      // to choose from, and the destination is Home, where they are listed. With one connection (or none) there is nothing to choose between and the route stays as it is. While the list is not known (HM2: not read yet, or the read failed and
      // there is no earlier list) nothing can be chosen either, and the destination is Home too: the plugin is never opened on a connection that nobody chose. A tab that is already open keeps the route it has (`refresh`): this is for what
      // the person opens.
      if (params.connection === undefined && entry?.phase === 'ready' && source !== 'refresh') {
        const known = choice?.(route.plugin);
        if (known !== undefined && known.state !== 'ready') {
          return HOME_ROUTE;
        }

        if (known !== undefined && known.keys.length > 1) {
          if (known.last === undefined || !known.keys.includes(known.last)) {
            return HOME_ROUTE;
          }

          params = { ...params, connection: known.last };
        }
      }

      return page === route.contribution && params === route.params ? route : { plugin: route.plugin, contribution: page, params };
    },
    // A saved tab's face, as the host lets it stand: a build before the names saved the key in it, and a tab drawn while its plugin loads must say none (`restoredFace`).
    restoreFace: (face, route) => restoredFace(face, route, names),
    // The window opens no page of its own (decision A17: it is empty, and the session brings back what the user had): a home is a plugin's, asked for by its id.
    home: (plugin) => {
      const entry = plugin === undefined ? undefined : entryOf(plugin);
      return entry === undefined ? undefined : homeOf(entry);
    },
    subscribe: (listener) => {
      const stops = [plugins.subscribe(listener), frames.subscribe(learnFrames), frames.subscribe(listener)];
      return () => {
        for (const stop of stops) {
          stop();
        }
      };
    },
  };
}
