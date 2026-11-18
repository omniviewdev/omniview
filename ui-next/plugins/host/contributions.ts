import { facetsOf, nameOf, titleOf, type DetailPageDefinition } from '../../page';
import type { Contributions, Description, Route, RouteInput } from '../../shell';
import type { FrameV1, SidebarNodeV1 } from '../contract/v1';
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
  /** The frame each mounted page published, by `routeKey`. */
  readonly frames: Published<FrameV1>;
  /** True while a link at load is waiting for its plugin: the window does not open its home page over it. */
  readonly holdHome: () => boolean;
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
 * first) with the connection after them, and the path `Plugin › connection › list › name`, whose list crumb leads back to the list. It reads the route and the definition and nothing else.
 */
export function describeDetail(pluginName: string, route: Route, definition: DetailPageDefinition): Description {
  const connection = connectionOf(route);
  const name = nameOf(definition, route.params);
  const { list } = definition;
  return {
    title: titleOf(definition, route.params),
    icon: definition.tile.icon,
    pluginName,
    path: [
      pluginName,
      ...(connection === undefined ? [] : [connection]),
      ...(list === undefined ? [] : [{ label: list.label, route: { plugin: route.plugin, contribution: list.page, params: { connection } } }]),
      name === '' ? definition.kind : name,
    ],
    scope: connection === undefined ? undefined : { id: connection, label: connection },
    facets: [...facetsOf(definition, route.params), ...(connection === undefined ? [] : [connection])],
  };
}

/**
 * The model's `Contributions`, over the host's plugins. `describe` gives a tab its title, glyph and path from the page's own contribution (what its hook published, else the page's
 * definition and its sidebar entry), its scope from the connection its route names, and says the plugin's name so a tab that reads like another is told from it. `availability` opens a
 * plugin that is loading or failed to a page that says so (ch16 S65: degraded) and refuses one the host does not have. `complete` fills in the connection of the tab a destination is
 * opened from, and turns a page the plugin does not have into its home. `home` is the first plugin that is ready once every plugin has settled.
 */
export function createContributions({ plugins, frames, holdHome }: ContributionsDeps): Contributions {
  const entryOf = (plugin: string): PluginEntry | undefined => plugins.getSnapshot().find((entry) => entry.id === plugin);
  return {
    describe: (route): Description | undefined => {
      const entry = entryOf(route.plugin);
      if (entry === undefined) {
        return undefined;
      }

      const connection = connectionOf(route);
      const scope = connection === undefined ? undefined : { id: connection, label: connection };
      if (entry.phase !== 'ready') {
        return { title: entry.name, icon: entry.phase === 'failed' ? 'status-error' : 'box', pluginName: entry.name, path: [entry.name], scope, facets: connection === undefined ? [] : [connection] };
      }

      const { contribution } = entry;
      const page = Object.hasOwn(contribution.pages, route.contribution) ? route.contribution : contribution.home;
      const found = contribution.pages[page];
      if (found?.kind === 'detail') {
        // An object's face is the route's and the definition's alone: it is the same before the page's hook has run, in every state of the data, and in a tab that was never shown.
        return describeDetail(contribution.plugin.name, route, found.definition);
      }

      const frame = frames.get(routeKey(route));
      const title = frame?.tab.title ?? found?.definition.title ?? entry.name;
      return {
        title,
        icon: frame?.tab.icon ?? glyphOf(contribution.sidebar.nodes, page) ?? 'box',
        pluginName: contribution.plugin.name,
        path: frame?.path ?? [contribution.plugin.name, ...(connection === undefined ? [] : [connection]), title],
        scope,
        facets: connection === undefined ? [] : [connection],
      };
    },
    availability: (route) => {
      const entry = entryOf(route.plugin);
      if (entry === undefined) {
        return { state: 'unavailable', reason: 'This plugin is not installed, or is turned off.' };
      }

      return entry.phase === 'ready' ? { state: 'available' } : { state: 'degraded', reason: entry.phase === 'loading' ? 'This plugin is loading.' : 'This plugin did not load.' };
    },
    complete: (route, { from }) => {
      const entry = entryOf(route.plugin);
      const page = entry?.phase === 'ready' && (route.contribution === HOME_PAGE || !Object.hasOwn(entry.contribution.pages, route.contribution)) ? entry.contribution.home : route.contribution;
      // A sidebar entry names a page, not a connection: the page opens in the connection of the tab it is opened from.
      const inherited = from?.plugin === route.plugin ? from.params.connection : undefined;
      const params = route.params.connection === undefined && typeof inherited === 'string' ? { ...route.params, connection: inherited } : route.params;
      return page === route.contribution && params === route.params ? route : { plugin: route.plugin, contribution: page, params };
    },
    home: (plugin) => {
      const list = plugins.getSnapshot();
      if (plugin !== undefined) {
        const entry = list.find((candidate) => candidate.id === plugin);
        return entry === undefined ? undefined : homeOf(entry);
      }

      // The window chooses once every plugin has settled, so a plugin that happens to load faster does not flash by before the one that would be chosen.
      if (holdHome() || list.length === 0 || list.some((entry) => entry.phase === 'loading')) {
        return undefined;
      }

      const first = list.find((entry) => entry.phase === 'ready') ?? list[0];
      return first === undefined ? undefined : homeOf(first);
    },
    subscribe: (listener) => {
      const stops = [plugins.subscribe(listener), frames.subscribe(listener)];
      return () => {
        for (const stop of stops) {
          stop();
        }
      };
    },
  };
}
