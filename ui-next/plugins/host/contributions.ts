import { facetsOf, nameOf, titleOf, type DetailPageDefinition } from '../../page';
import type { Contributions, Description, Route, RouteInput } from '../../shell';
import type { FrameV1, SidebarNodeV1 } from '../contract/v1';
import { failureWords } from '../loader/failure';
import { ConnectionNames, laneNameOf, pathSaid, restoredFace } from './connectionName';
import { hostPageOf } from './hostPages';
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

/** The route's parameters a page's hook is told besides the connection (`RouteV1.params`): the ones that are text. For a detail page they are the object's identity. */
export const textParamsOf = (route: Route): Readonly<Record<string, string>> =>
  Object.fromEntries(Object.entries(route.params).flatMap(([name, value]) => (name !== 'connection' && typeof value === 'string' ? [[name, value] as const] : [])));

/** What the host reads of its plugins: the entries now, and a way to hear that they changed. `PluginStore` is one. */
export type PluginSource = {
  readonly getSnapshot: () => readonly PluginEntry[];
  readonly subscribe: (listener: () => void) => () => void;
};

export type ContributionsDeps = {
  readonly plugins: PluginSource;
  /** The frame each mounted page published, by `routeKey`: the lane it published is where the name of its connection is read (`connectionName.ts`). */
  readonly frames: Published<FrameV1>;
  /** The names this window has learned for its connections, by plugin and key. Default: a set of its own. */
  readonly names?: ConnectionNames | undefined;
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

/** The route of a plugin's own first page: its `home` when it has loaded, else the stand-in that `complete` resolves. */
const homeOf = (entry: PluginEntry): RouteInput => ({ plugin: entry.id, contribution: entry.phase === 'ready' ? entry.contribution.home : HOME_PAGE });

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

/**
 * The model's `Contributions`, over the host's plugins. `describe` gives a tab its title, glyph and path from the page's own contribution (what its hook published, else the page's
 * definition and its sidebar entry), its scope from the connection its route names, and says the plugin's name so a tab that reads like another is told from it. `availability` opens a
 * plugin that is loading or failed to a page that says so (ch16 S65: degraded) and refuses one the host does not have. `complete` fills in the connection of the tab a destination is
 * opened from, and turns a page the plugin does not have into its home. `home` is a plugin's own first page; the window has none of its own.
 */
export function createContributions({ plugins, frames, names = new ConnectionNames() }: ContributionsDeps): Contributions {
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
      // A page of the host's own (the Plugins page): a singleton tab of no plugin, so it says no scope, no path and no plugin name (ch16 S9, X7).
      const hosted = hostPageOf(route);
      if (hosted !== undefined) {
        return { title: hosted.title, icon: hosted.icon, singleton: true, path: [] };
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
    complete: (route, { from }) => {
      const entry = entryOf(route.plugin);
      const page = entry?.phase === 'ready' && (route.contribution === HOME_PAGE || !Object.hasOwn(entry.contribution.pages, route.contribution)) ? entry.contribution.home : route.contribution;
      // A sidebar entry names a page, not a connection: the page opens in the connection of the tab it is opened from.
      const inherited = from?.plugin === route.plugin ? from.params.connection : undefined;
      const params = route.params.connection === undefined && typeof inherited === 'string' ? { ...route.params, connection: inherited } : route.params;
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
