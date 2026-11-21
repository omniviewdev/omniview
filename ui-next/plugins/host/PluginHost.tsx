import { ErrorBody, LinkProvider, type PageHeaderCrumb } from '@omniviewdev/kit';
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { DetailPage, ListPage, type PageMemory } from '../../page';
import {
  createLogStreams,
  createPanelStore,
  createRailChoice,
  createTabsStore,
  dispositionOf,
  completeLogCard,
  logCardOf,
  LOGS_EMPTY,
  LOGS_TOOL,
  LOGS_TOOL_ID,
  LogsBody,
  platformOf,
  Shell,
  type Contributions,
  type LoadedNotices,
  type LoadedSession,
  type LogStreams,
  type ModifierEvent,
  type PageTab,
  type PanelBindings,
  type PanelSession,
  type PanelStore,
  type RailChoice,
  type Route,
  type ShellRail,
  type ShellRegistration,
  type ShellSidebar,
  type TabId,
  type TabsStore,
} from '../../shell';
import { openable } from '../contract/admit';
import type { ContextV1, ContributionV1, FrameV1, PanelHostV1, SidebarContextV1, SidebarNodeV1 } from '../contract/v1';
import { ContributionBoundary } from './ContributionBoundary';
import { ConnectionNames, laneNameOf } from './connectionName';
import { connectionOf, createContributions, describeDetail, HOME_PAGE, routeKey, textParamsOf, type PluginSource } from './contributions';
import { createLinkHandler } from './links';
import { homeEntriesOf, NoTabs } from './NoTabs';
import { createHostNotices, type HostNotices } from './notices';
import { createHostPalette, type HostPalette } from './palette';
import { cardOfSession, newSessionOf, panelPluginsOf, routeAddressOf, sessionV1, toolOf } from './panel';
import { panelHostsOf } from './panelHost';
import { useGuardedDefinition, useGuardedSource } from './pageFailures';
import { pageMemoryOf } from './pageMemory';
import { PlaceholderPage } from './PlaceholderPage';
import type { PluginEntry } from './pluginStore';
import { Published } from './published';
import { currentRail, failedOf, railOf, type RailEntry } from './rail';
import { NO_PARAMS, type HostRoute } from './route';

// The host of contributed pages: given what each installed plugin's interface came to (`PluginStore`), it drives the shell's tab model with them. A tab is a route in a plugin; the model asks
// the host what a route is called (`contributions.ts`) and the host draws each mounted tab's page, the list page for the plugin's contribution, or the kit's collection state where there
// is no page to draw. The registration the shell reads is built here from the contribution (the plugin never imports the shell); the contribution's hooks run here, each page's inside its
// own tab's component and its own error boundary, so a plugin that throws loses its page or its sidebar entries and the frame, the other tabs and the other plugins stay
// (docs/ui-next/slices/n19-plugin-seam.md, 2.4). The window does not wait for plugins: until one has loaded the frame is drawn with its regions reserved, and nothing moves when it registers.
//
// The window has one rail (`rail.ts`): an entry for each plugin that contributes, and the sidebar is the sidebar of the plugin the rail has current. That is not always the plugin of the tab on
// screen: choosing an entry shows another plugin's sidebar and closes no tab, and activating a tab (or moving the tab on screen to another plugin) makes its plugin current again. The island,
// the scope lane and the landmarks that name them follow the tab on screen; the rail and the sidebar follow the rail.

export type PluginHostProps = {
  /** Every installed plugin the host has started to load, by id: what `PluginStore` is. */
  readonly plugins: PluginSource;
  /** Whether the list of installed plugins itself was read. */
  readonly inventory: 'loading' | 'ready' | 'failed';
  /**
   * What the page's address names (`#/<plugin>/<page>?connection=<id>`). The window never takes one (the native window loads `/`), so this is a request from outside: a deep link at
   * load and a hash a person or a check types later. It opens a tab through the model like any destination, and is never written back: where the window is, is the tabs'.
   */
  readonly link: HostRoute;
  /** Loads a plugin's interface again from its files. */
  readonly onRetry: (id: string) => void;
  /** Asks again for the list of installed plugins. */
  readonly onRetryInventory: () => void;
  /** Closes the window, where the app has one of its own: what Command W does with no tab open, on a Mac. Absent in a browser tab. */
  readonly onCloseWindow?: (() => void) | undefined;
  /**
   * The window's bottom panel: its model. Default: the host makes one, from the panel the session saved, and it lives as long as the window does. One that is passed is the caller's as it stands:
   * the session saves it and does not restore into it.
   */
  readonly panel?: PanelStore | undefined;
  /**
   * The window's saved session, read before the window draws (`loadSession`): its tabs, the rail's choice and the panel come back, and it is saved from then on, one burst after each change and when
   * the window is hidden. Absent: the empty window, which restores nothing and saves nothing. The window opens no page by itself in either case (decision A17); a session is what puts one there.
   */
  readonly session?: LoadedSession | undefined;
  /** The window's saved notification history, read before the window draws (`loadNotices`): it comes back as the centre's history and is saved from then on. Absent: the history starts empty and is not saved. */
  readonly savedNotices?: LoadedNotices | undefined;
};

type Host = {
  readonly frames: Published<FrameV1>;
  /** The names this window has learned for its connections (`connectionName.ts`): from the lanes its pages publish and from the faces its tabs were saved with. */
  readonly names: ConnectionNames;
  readonly nodes: Published<readonly SidebarNodeV1[] | null>;
  /** The groups of each plugin's sidebar that are open on screen, by plugin: what the plugin's sidebar hook is told (`SidebarContextV1.open`). Nothing is held for a plugin whose tree is not on screen. */
  readonly sidebarOpen: Published<readonly string[]>;
  /** What the shell's tree tells the host: the rail entry whose tree it is, and the groups of it that are open on screen. */
  readonly reportSidebarOpen: (owner: string | undefined, open: readonly string[]) => void;
  /** The route each plugin was last shown at, by plugin: where its sidebar picks up when the rail shows it while another plugin's tab is on screen. */
  readonly routes: Published<Route>;
  readonly tabs: TabsStore;
  /** The window's bottom panel. Its tools and sessions come from the plugins that are ready (`panel.ts`). */
  readonly panel: PanelStore;
  /** The feeds of the Logs tool's sessions: the host owns each from the moment a plugin hands over a target until the session goes (`shell/panel/logs`). */
  readonly logs: LogStreams;
  /** What `ctx.panel` is for each plugin: the Logs registry, bound to the plugin that asks (`panelHost.ts`). */
  readonly panelHosts: (plugin: string) => PanelHostV1;
  /** The plugin the user chose on the rail, as the session saves it. The component's own state is the source; this is what the session listens to. */
  readonly rail: RailChoice;
  readonly contributions: Contributions;
  /** The request at the address the window last opened, by key: a link opens once, however often the plugins change. */
  readonly opened: Published<string>;
  /** The window's command palette: the shell draws it, and the window attaches it to the models once it is on screen (`palette.ts`). */
  readonly palette: HostPalette;
  /** The window's toasts: the store the shell draws, and the one source that feeds it, a plugin's command that failed (`notices.ts`). The window attaches it to the models once it is on screen. */
  readonly notices: HostNotices;
};

/**
 * The tab model, the panel, the rail's choice and the command palette of a window, over its plugins, from the session when there is one. They live as long as the window does. A part the session has
 * nothing for starts as it does with no session: no tab (the empty window), a closed panel, no rail entry chosen.
 */
function createHost(plugins: PluginSource, panel: PanelStore | undefined, session: LoadedSession | undefined, onCloseWindow: (() => void) | undefined, saved: LoadedNotices | undefined): Host {
  const frames = new Published<FrameV1>();
  const nodes = new Published<readonly SidebarNodeV1[] | null>();
  const sidebarOpen = new Published<readonly string[]>();
  const names = new ConnectionNames();
  const contributions = createContributions({ plugins, frames, names });
  const restored = session?.restore({ contributions });
  const store = panel ?? createPanelStore({ initial: restored?.panel });
  const logs = createLogStreams(store);
  const tabs = createTabsStore({ contributions, initial: restored?.tabs });
  const routes = new Published<Route>();
  const panelHosts = panelHostsOf(logs);
  const notices = createHostNotices({ tabs, plugins, contributions, platform: platformOf(navigator), saved });
  return {
    frames,
    names,
    nodes,
    sidebarOpen,
    reportSidebarOpen: (owner, open) => {
      if (owner !== undefined) {
        sidebarOpen.publish(owner, open);
      }
    },
    routes,
    tabs,
    panel: store,
    logs,
    panelHosts,
    rail: createRailChoice(restored?.rail ?? null),
    contributions,
    opened: new Published<string>(),
    palette: createHostPalette({ tabs, plugins, contributions, nodes, frames, panel: store, platform: platformOf(navigator), onCloseWindow, remembered: (plugin) => routes.get(plugin), panelHosts }),
    notices,
  };
}

/** The route of the tab on screen: the same object until the tab moves. */
function activeRoute(tabs: TabsStore): Route | undefined {
  const state = tabs.getSnapshot();
  return state.active === null ? undefined : tabs.selectors.location(state, state.active)?.route;
}

/** What the rail follows: the tab on screen and its plugin, so the user's choice stands until either changes. Nothing while there is no tab. */
const followOf = (active: string | null, route: Route | undefined): string | undefined => (active === null || route === undefined ? undefined : `${active}\u0000${route.plugin}`);

/** The sidebar as the shell reads it: the contribution's words, the nodes that open a page, and the page on screen as current, when it is this plugin's. */
function sidebarOf(contribution: ContributionV1, nodes: readonly SidebarNodeV1[], current: string | undefined): ShellSidebar {
  const { label, title } = contribution.sidebar;
  return { label, title, nodes: openable(nodes, contribution.pages), current, accent: contribution.plugin.accent };
}

type FrameInputs = {
  readonly entries: readonly PluginEntry[];
  /** The window is waiting for a plugin: the inventory, a plugin's interface, or the plugin a link names. */
  readonly coming: boolean;
  /** A link at load is waiting for its plugin: a tab is on its way. */
  readonly waiting: boolean;
  /** The plugins have not all settled yet, once: the rail and the sidebar are not chosen, and their regions are reserved empty. */
  readonly held: boolean;
  /** The route of the tab on screen. */
  readonly route: Route | undefined;
  readonly frame: FrameV1 | undefined;
  /** The plugins that contribute, in the order of the rail, and the one whose sidebar shows (none while the window is coming and has no tab: there is nothing to anchor it to yet). */
  readonly rail: readonly RailEntry[];
  /** The plugins that did not load: entries of the rail after those, with no sidebar. */
  readonly failed: readonly RailEntry[];
  readonly railPlugin: string | undefined;
  /** What the sidebar's data hook of the plugin on the rail answered: nothing until it does, and the contribution's skeleton stands. */
  readonly nodes: readonly SidebarNodeV1[] | null | undefined;
};

/** The page of a contribution a route names, as the host draws it: the plugin's own first page for one it does not have. */
const pageOf = (contribution: ContributionV1, route: Route): string => (Object.hasOwn(contribution.pages, route.contribution) ? route.contribution : contribution.home);

/**
 * What the shell draws around the tab on screen. The island, the lane and the landmarks follow the tab on screen: while its plugin is loading (or a tab is on its way, from a link, or from a
 * session whose plugin is not known yet) the frame is pending, its regions reserved, so the plugin's frame lands in the rectangles they hold; a plugin that did not load is drawn bare. The rail
 * and the sidebar follow the rail: every plugin that contributes has an entry, and the sidebar is the current entry's, with the page on screen current in it when it is that plugin's. Until every
 * plugin has settled once they are held (`held`): reserved empty, chosen when the last plugin has said what it is, so a plugin that registers late moves no entry that is drawn. With no plugin
 * that contributes there is nothing to reserve for and nothing to show: the frame is bare.
 */
function registrationOf({ entries, coming, waiting, held, route, frame, rail, failed, railPlugin, nodes }: FrameInputs): ShellRegistration {
  const active = route === undefined ? undefined : entries.find((candidate) => candidate.id === route.plugin);
  const loading = entries.find((candidate) => candidate.phase === 'loading');

  const shown = railPlugin === undefined ? undefined : entries.find((candidate) => candidate.id === railPlugin);
  const sidebar = ((): ShellSidebar | undefined => {
    if (shown?.phase !== 'ready') {
      return undefined;
    }

    const { contribution } = shown;
    // The entry that stays selected while an object is open is the list it belongs to.
    const onScreen = route?.plugin === shown.id ? contribution.pages[pageOf(contribution, route)] : undefined;
    const current = route?.plugin === shown.id ? (onScreen?.kind === 'detail' ? onScreen.definition.list?.page : pageOf(contribution, route)) : undefined;
    return sidebarOf(contribution, nodes ?? contribution.sidebar.nodes, current);
  })();
  const listed = [...rail, ...failed];
  const railData: ShellRail | undefined =
    held || listed.length === 0
      ? undefined
      : { label: 'Plugins', entries: listed.map(({ id, label, icon, problem }) => ({ id, label, icon, ...(problem === undefined ? {} : { problem }) })), current: railPlugin };

  // The rail and the sidebar wait for the plugins: their regions are reserved, and no lane is (it is the frame's, and a frame that is known says whether it has one).
  const holding = held ? { held: true as const } : {};
  if (route === undefined || active === undefined) {
    // No tab, or a tab of a plugin the host does not have (its page says so). With no tab the window is loading, or it is empty: the empty window is a document (the home content), loading is
    // a collection state (the kit's loading skeleton). A tab is on its way when a link waits for its plugin, or when the tab on screen is one whose plugin is not known yet: its frame is pending.
    // The empty window has no lane, and no tab is coming for it: only its rail and its sidebar are reserved.
    const empty = route === undefined && !coming && entries.length > 0;
    const pending = route === undefined ? waiting : coming;
    return { plugin: { name: loading?.name ?? 'Omniview' }, layout: empty ? 'document' : 'pane', ...(pending ? { pending: true as const } : holding), rail: railData, sidebar };
  }

  if (active.phase === 'loading') {
    return { plugin: { name: active.name }, layout: 'pane', pending: true, rail: railData, sidebar };
  }

  if (active.phase === 'failed') {
    return { plugin: { name: active.name }, layout: 'pane', rail: railData, sidebar, ...holding };
  }

  const { contribution } = active;
  const page = contribution.pages[pageOf(contribution, route)];
  return {
    plugin: { name: contribution.plugin.name },
    ...holding,
    rail: railData,
    // A detail page is a document: the page scrolls, header and body together (ch16 S15). A list owns its own scrolling.
    layout: page?.kind === 'detail' ? 'document' : 'pane',
    sidebar,
    scope: frame?.scope,
  };
}

type EmptyInputs = Pick<FrameInputs, 'entries' | 'coming'> & Pick<PluginHostProps, 'inventory' | 'onRetryInventory'> & { readonly onOpen: (plugin: string) => void };

/** What the island shows while there is no tab: the plugins' own states, in the host's words; and once they have settled, the empty window (decision A17). */
function emptyOf({ entries, coming, inventory, onRetryInventory, onOpen }: EmptyInputs): ReactNode {
  if (entries.length === 0) {
    if (inventory === 'failed') {
      return <PlaceholderPage title="Plugins" state={{ kind: 'failed', message: 'The list of installed plugins could not be read.', retry: onRetryInventory }} />;
    }

    return <PlaceholderPage title="Plugins" state={inventory === 'loading' ? { kind: 'loading' } : { kind: 'ready' }} empty={inventory === 'ready'} />;
  }

  const loading = entries.find((entry) => entry.phase === 'loading');
  if (coming) {
    return <PlaceholderPage title={loading?.name ?? 'Plugins'} state={{ kind: 'loading' }} />;
  }

  return <NoTabs entries={homeEntriesOf(entries)} onOpen={onOpen} />;
}

type ListProps = {
  readonly entry: PluginEntry & { readonly phase: 'ready' };
  readonly route: Route;
  readonly page: string;
  readonly frames: Published<FrameV1>;
  /** What the plugin asks of the bottom panel: `ctx.panel`. */
  readonly panelHost: PanelHostV1;
  /** Where the page keeps what the person chose in it (the sort of the list), for this window to give back when the page is drawn again: the tab's own. */
  readonly memory: PageMemory;
};

/** The page's own component: its data hook runs here, in its tab's own subtree, and what the hook says about the frame is published for the frame and the tab to read. */
function ListContribution({ entry, route, page: pageId, frames, panelHost, memory }: ListProps) {
  const page = entry.contribution.pages[pageId];
  if (page?.kind !== 'list') {
    throw new Error(`The plugin has no list page "${pageId}"`);
  }

  const connection = connectionOf(route);
  // A list page's route has no parameters of its own (`RouteV1.params`): what an address adds to one is not an identity the page reads, so its hook is told none.
  const context = useMemo<ContextV1>(() => ({ plugin: entry.id, route: { page: pageId, connection, params: NO_PARAMS }, panel: panelHost }), [entry.id, pageId, connection, panelHost]);
  const { frame, source } = page.usePage(context);
  const definition = useGuardedDefinition(page.definition, entry.id);
  // Before the first paint, so the scope lane and the tab's words are there with the page; a frame equal to the one held changes nothing.
  useLayoutEffect(() => {
    frames.publish(routeKey(route), frame);
  }, [frames, route, frame]);

  return <ListPage definition={definition} source={source} memory={memory} />;
}

type DetailProps = {
  readonly entry: PluginEntry & { readonly phase: 'ready' };
  readonly route: Route;
  readonly page: string;
  readonly frames: Published<FrameV1>;
  readonly names: ConnectionNames;
  readonly tabs: TabsStore;
  /** What the plugin asks of the bottom panel: `ctx.panel`. */
  readonly panelHost: PanelHostV1;
};

/**
 * The detail page's own component, as the list's: its data hook runs here with the route's parameters, and the scope lane's faces it answers are published for the frame to read. The tab's
 * title, glyph and path are not the hook's: they are the route's and the definition's (`describeDetail`), the same before this component has run. The back path above the heading is
 * the same path, its parents links that open in place.
 */
function DetailContribution({ entry, route, page: pageId, frames, names, tabs, panelHost }: DetailProps) {
  const page = entry.contribution.pages[pageId];
  if (page?.kind !== 'detail') {
    throw new Error(`The plugin has no detail page "${pageId}"`);
  }

  const connection = connectionOf(route);
  const params = useMemo(() => textParamsOf(route), [route]);
  const context = useMemo<ContextV1>(() => ({ plugin: entry.id, route: { page: pageId, connection, params }, panel: panelHost }), [entry.id, pageId, connection, params, panelHost]);
  const { scope, source: read } = page.usePage(context);
  const source = useGuardedSource(read, entry.id);
  const { definition } = page;
  const pluginName = entry.contribution.plugin.name;
  // The header's crumbs and the tab's path say the connection by its NAME: the one this page's lane says, else the one the window has learned for the connection, else none. The key is never drawn.
  const lane = laneNameOf(scope);
  const name = lane === null ? undefined : (lane ?? (connection === undefined ? undefined : names.get(entry.id, connection)));
  const face = useMemo(() => describeDetail(pluginName, route, definition, name), [pluginName, route, definition, name]);
  // Before the first paint, so the scope lane is there with the page; a frame equal to the one held changes nothing.
  useLayoutEffect(() => {
    frames.publish(routeKey(route), { tab: { title: face.title, icon: definition.tile.icon }, path: (face.path ?? []).map((crumb) => (typeof crumb === 'string' ? crumb : crumb.label)), scope });
  }, [frames, route, face, definition.tile.icon, scope]);

  const crumbs = (face.path ?? []).map((crumb): PageHeaderCrumb => {
    if (typeof crumb === 'string') {
      return { label: crumb };
    }

    const { route: parent } = crumb;
    return {
      label: crumb.label,
      onSelect:
        parent === undefined
          ? undefined
          : () => {
            tabs.open({ route: parent }, { how: 'smart', source: 'crumb' });
          },
    };
  });
  return <DetailPage definition={definition} params={route.params} source={source} path={crumbs} />;
}

type HostPageProps = {
  readonly entries: readonly PluginEntry[];
  readonly route: Route;
  /** The tab this page is drawn for: what the page keeps (`PageMemory`) is kept in it. */
  readonly tabId: TabId;
  /** What the tab was saved with as the plugin's name (a tab restored from a session names a plugin the host may not have yet); empty when it says none. */
  readonly pluginName: string;
  readonly frames: Published<FrameV1>;
  readonly names: ConnectionNames;
  readonly tabs: TabsStore;
  readonly platform: 'mac' | 'other';
  readonly inventory: PluginHostProps['inventory'];
  readonly onRetry: (id: string) => void;
  readonly onRetryInventory: () => void;
  /** What each plugin asks of the bottom panel: its `ctx.panel`. */
  readonly panelHosts: (plugin: string) => PanelHostV1;
};

/**
 * One tab's page: the plugin's, in its own boundary and with its links, or the state the plugin is in. A tab whose plugin the host does not have is pending while the list of plugins is on its
 * way (a tab restored from a session is drawn before any plugin is known), says the list could not be read when it could not, and says the plugin is not installed, or is turned off, when the
 * list was read and the plugin is not in it. The tab stays in every case: the plugin may come back, and the tab is the user's.
 */
function HostPage({ entries, route, tabId, pluginName, frames, names, tabs, platform, inventory, onRetry, onRetryInventory, panelHosts }: HostPageProps) {
  // The links of the page open where the page is: its plugin, and the connection it is read in. The handler changes only when the page moves.
  const connection = connectionOf(route);
  const handler = useMemo(() => createLinkHandler({ tabs, platform, plugin: route.plugin, connection }), [tabs, platform, route.plugin, connection]);
  // What a page keeps is the tab's `pageState`: the same object for as long as the tab is, so the page's own hooks may depend on it.
  const memory = useMemo(() => pageMemoryOf(tabs, tabId), [tabs, tabId]);
  const entry = entries.find((candidate) => candidate.id === route.plugin);
  if (entry === undefined) {
    const title = pluginName === '' ? route.plugin : pluginName;
    if (inventory === 'loading') {
      return <PlaceholderPage title={title} state={{ kind: 'loading' }} />;
    }

    if (inventory === 'failed') {
      return <PlaceholderPage title={title} state={{ kind: 'failed', message: 'The list of installed plugins could not be read.', retry: onRetryInventory }} />;
    }

    return <PlaceholderPage title={title} state={{ kind: 'failed', message: 'This plugin is not installed, or is turned off.' }} />;
  }

  if (entry.phase === 'loading') {
    return <PlaceholderPage title={entry.name} state={{ kind: 'loading' }} />;
  }

  if (entry.phase === 'failed') {
    // A plugin that is reloading is the mock's starting plugin (ch16 S89, PO1): nothing failed and there is nothing to retry, so its tab keeps its route and draws the loading state until the plugin runs again.
    if (entry.failure.kind === 'unloaded' && entry.failure.cause === 'reloaded') {
      return <PlaceholderPage title={entry.name} state={{ kind: 'loading' }} />;
    }

    return (
      <PlaceholderPage
        title={entry.name}
        state={{
          kind: 'failed',
          message: entry.failure.message,
          retry: () => {
            onRetry(entry.id);
          },
        }}
      />
    );
  }

  const { contribution } = entry;
  const page = pageOf(contribution, route);
  const found = contribution.pages[page];
  const title = found === undefined ? entry.name : found.kind === 'detail' ? found.definition.kind : found.definition.title;
  return (
    <LinkProvider handler={handler}>
      <ContributionBoundary
        name={`${entry.id} page ${page}`}
        resetKey={page}
        fallback={(retry) => <PlaceholderPage title={title} state={{ kind: 'failed', message: 'This page failed to display.', retry }} />}
      >
        {found?.kind === 'detail' ? (
          <DetailContribution entry={entry} route={route} page={page} frames={frames} names={names} tabs={tabs} panelHost={panelHosts(entry.id)} />
        ) : (
          <ListContribution entry={entry} route={route} page={page} frames={frames} panelHost={panelHosts(entry.id)} memory={memory} />
        )}
      </ContributionBoundary>
    </LinkProvider>
  );
}

type NodesProps = {
  readonly plugin: string;
  readonly route: Route;
  readonly useNodes: (context: SidebarContextV1) => readonly SidebarNodeV1[] | undefined;
  readonly nodes: Published<readonly SidebarNodeV1[] | null>;
  /** The groups of each plugin's sidebar that are open on screen: the plugin's own are what its hook is told. */
  readonly open: Published<readonly string[]>;
  /** What the plugin asks of the bottom panel: `ctx.panel`. */
  readonly panelHost: PanelHostV1;
};

/** The groups open on screen while the tree has told the host none, and before it has: no group is open, and the entries of no group are on screen. One list, so that nothing that reads it sees a change. */
const NONE_OPEN: readonly string[] = [];

/**
 * Runs the sidebar's data hook for the plugin on the rail, and publishes what it answers: nothing until it answers, and the skeleton stands. It draws nothing. The hook is told the context every hook of the plugin
 * gets and, as well, which groups of its tree are open on screen (the entries of a group that is closed are not on screen, and the hook has no reason to ask for what they count). The context is the same object for as long
 * as the plugin, the page, the connection and the open groups are the same, and the open groups are the same list until the set of them changes, so a hook may use either as a dependency.
 */
function NodesSource({ plugin, route, useNodes, nodes, open, panelHost }: NodesProps) {
  const page = route.contribution;
  const connection = connectionOf(route);
  const expanded = useSyncExternalStore(open.subscribe, () => open.get(plugin) ?? NONE_OPEN);
  const answer = useNodes(useMemo<SidebarContextV1>(() => ({ plugin, route: { page, connection, params: NO_PARAMS }, panel: panelHost, open: expanded }), [plugin, page, connection, panelHost, expanded]));
  useLayoutEffect(() => {
    nodes.publish(plugin, answer ?? null);
  }, [nodes, plugin, answer]);

  return null;
}

/** What the sidebar shows when its data hook fails: the skeleton, not the nodes an earlier answer published. It draws nothing. */
function NoNodes({ plugin, nodes }: { readonly plugin: string; readonly nodes: Published<readonly SidebarNodeV1[] | null> }) {
  useLayoutEffect(() => {
    nodes.publish(plugin, null);
  }, [nodes, plugin]);

  return null;
}

/**
 * The body of a session of a tool a plugin brought: the plugin's own component, in the tool's own error boundary, so a body that throws loses itself and no other (and no page, no frame). The host
 * words the failure; the plugin's words go to the log.
 */
function panelBodyOf(entries: readonly PluginEntry[], session: PanelSession, visible: boolean): ReactElement | null {
  const found = toolOf(entries, session.tool);
  if (found === undefined) {
    return null;
  }

  const { Body } = found.tool;
  return (
    <ContributionBoundary name={`${found.plugin} panel ${found.local}`} fallback={(retry) => <ErrorBody title="Couldn't show this session" onRetry={retry} />}>
      <Body session={sessionV1(session)} visible={visible} />
    </ContributionBoundary>
  );
}

/**
 * The body of a session of the host's Logs tool: the host's own log view over the stream a plugin handed over (`shell/panel/logs`), in a boundary of its own so that a stream whose status throws while
 * it renders loses that session's body and no other. What the view does while the body is not on screen is `LogsBody`'s.
 */
function logsBodyOf(streams: LogStreams, session: PanelSession, visible: boolean): ReactElement {
  return (
    <ContributionBoundary name={`${session.plugin} logs session`} fallback={(retry) => <ErrorBody title="Couldn't show this session" onRetry={retry} />}>
      <LogsBody streams={streams} session={session} visible={visible} />
    </ContributionBoundary>
  );
}

export function PluginHost({ plugins, inventory, link, onRetry, onRetryInventory, onCloseWindow, panel: given, session, savedNotices }: PluginHostProps) {
  const entries = useSyncExternalStore(plugins.subscribe, plugins.getSnapshot);
  const [host] = useState(() => createHost(plugins, given, session, onCloseWindow, savedNotices));
  const [platform] = useState(() => platformOf(navigator));
  // A link at load waits for its plugin; each distinct link opens once. Where it stands is the host's (an external store), not state of this component: opening it is the effect's whole job.
  const { tabs, frames, names, nodes, routes, opened } = host;
  const linkKey = link.plugin === undefined ? undefined : JSON.stringify([link.plugin, link.page, link.connection, link.params]);
  const waiting = useSyncExternalStore(opened.subscribe, () => linkKey !== undefined && opened.get('link') !== linkKey);
  const known = link.plugin !== undefined && entries.some((entry) => entry.id === link.plugin);
  // Whether the screen has had its turn since the inventory came in: its effect hands the plugins to the store after this component's, so a link looked at in the commit the inventory
  // arrives in would find its plugin missing and be refused for good.
  const settled = useSyncExternalStore(opened.subscribe, () => opened.get('settled') === 'yes');

  useEffect(() => {
    if (link.plugin === undefined || linkKey === undefined) {
      return;
    }

    if (opened.get('link') === linkKey || (!known && inventory === 'loading')) {
      return;
    }

    if (!known && !settled) {
      opened.publish('settled', 'yes');
      return;
    }

    opened.publish('link', linkKey);
    // A link to a plugin the host does not have is refused by the model, and the window stays as it is: it opens no page of its own.
    tabs.open({ route: { plugin: link.plugin, contribution: link.page ?? HOME_PAGE, params: { ...link.params, connection: link.connection } } }, { how: 'smart', source: 'link' });
  }, [tabs, opened, link.plugin, link.page, link.connection, link.params, linkKey, known, inventory, settled]);

  // The session is saved from the first commit to the last: the tabs, the panel and the rail's choice, one burst after each change and when the window is hidden. What the session restored is what
  // the models were made with; this only starts the saving.
  useEffect(() => session?.attach({ tabs, panel: host.panel, rail: host.rail }), [session, tabs, host]);

  // The palette remembers the places the user goes to and keeps its list up to date while it is open, for as long as the window is on screen. Closed, it costs nothing.
  useEffect(() => host.palette.attach(), [host]);

  // The toasts follow the window: a modal (the palette) holds them back, and a plugin that leaves or a tab that moves makes every notice ask again what its actions can do. Nothing runs while nothing changes.
  useEffect(() => host.notices.attach({ subscribe: host.palette.store.subscribe, open: () => host.palette.store.getSnapshot().open }), [host]);

  const route = useSyncExternalStore(tabs.subscribe, () => activeRoute(tabs));
  const activeId = useSyncExternalStore(tabs.subscribe, () => tabs.getSnapshot().active);
  const rail = railOf(entries);
  const failed = failedOf(entries);

  // The rail's current entry. The user's choice stands until the tab on screen changes: activating another tab, or moving the tab on screen to another plugin, makes that plugin current
  // (state kept from the render before, the way React keeps a value derived from what changed). With no tab on screen the choice stands as it was. A window that was saved starts from the
  // choice it was saved with and from the tab it was saved on, so the first render does not take the choice for a change of tab.
  const [chosen, setChosen] = useState<string | undefined>(() => host.rail.getSnapshot() ?? undefined);
  const [followed, setFollowed] = useState<string | undefined>(() => followOf(tabs.getSnapshot().active, activeRoute(tabs)));
  const follow = followOf(activeId, route);
  if (follow !== followed) {
    setFollowed(follow);
    if (route !== undefined) {
      setChosen(route.plugin);
    }
  }

  const { rail: choice } = host;
  useEffect(() => {
    choice.set(chosen ?? null);
  }, [choice, chosen]);

  // Until every plugin has settled once, there is nothing to anchor a sidebar to and no rail to list: a plugin chosen by guess would run its hooks and then be replaced, and an entry drawn before
  // a plugin that registers late and sorts first would be pushed down by it. They wait (`held`), reserved empty, and come all at once; after that a plugin that loads again (a retry) takes
  // nothing away. State kept from the render before, as the rail's choice is.
  const coming = inventory === 'loading' || entries.some((entry) => entry.phase === 'loading') || waiting;
  const [settledOnce, setSettledOnce] = useState(false);
  if (!settledOnce && !coming) {
    setSettledOnce(true);
  }

  const held = !settledOnce;
  const railPlugin = held ? undefined : currentRail(rail, chosen, route?.plugin);
  const shown = railPlugin === undefined ? undefined : entries.find((candidate) => candidate.id === railPlugin);

  // Where each plugin was last shown, so the sidebar of a plugin the rail shows beside another plugin's tab, and what is opened from it, pick up at its connection.
  useLayoutEffect(() => {
    if (route !== undefined) {
      routes.publish(route.plugin, route);
    }
  }, [routes, route]);
  const remembered = useSyncExternalStore(routes.subscribe, () => (railPlugin === undefined ? undefined : routes.get(railPlugin)));
  const railRoute = ((): Route | undefined => {
    if (railPlugin === undefined) {
      return undefined;
    }

    if (route?.plugin === railPlugin) {
      return route;
    }

    const home = host.contributions.home?.(railPlugin);
    return remembered ?? (home === undefined ? undefined : { plugin: home.plugin, contribution: home.contribution, params: NO_PARAMS });
  })();
  // What a page of the plugin on the rail opens at when the tab on screen is another plugin's: the connection that plugin was last used in.
  const carried = route?.plugin === railPlugin || remembered === undefined ? undefined : connectionOf(remembered);

  const key = route === undefined ? undefined : routeKey(route);
  const frame = useSyncExternalStore(frames.subscribe, () => (key === undefined ? undefined : frames.get(key)));
  const published = useSyncExternalStore(nodes.subscribe, () => (shown === undefined ? undefined : nodes.get(shown.id)));

  const choose = (id: string, event: ModifierEvent | undefined): void => {
    if (railPlugin !== undefined) {
      // The model's result is the answer: a destination that wants a window of its own (there is none) or that would discard unsaved changes (no page reports a draft yet) changes nothing.
      tabs.open({ route: { plugin: railPlugin, contribution: id, params: carried === undefined ? undefined : { connection: carried } } }, { how: dispositionOf(event, { platform }), source: 'sidebar' });
    }
  };

  const newTab =
    railPlugin === undefined
      ? undefined
      : () => {
        const home = host.contributions.home?.(railPlugin);
        if (home !== undefined) {
          tabs.open({ route: carried === undefined ? home : { ...home, params: { ...home.params, connection: carried } } }, { how: 'new', source: 'new-tab' });
        }
      };

  const open = (plugin: string): void => {
    const home = host.contributions.home?.(plugin);
    if (home !== undefined) {
      tabs.open({ route: home }, { how: 'smart', source: 'home' });
    }
  };

  // A plugin that did not load has no sidebar to show: choosing its entry opens its page, which names what happened and offers the Retry (as its row of the empty window does), and the rail's current
  // entry and the sidebar stay. Any other entry shows its plugin's sidebar.
  const selectRail = (id: string): void => {
    if (entries.some((candidate) => candidate.id === id && candidate.phase === 'failed')) {
      open(id);
    } else {
      setChosen(id);
    }
  };

  // The panel. What each plugin that is ready brings to it is registered in a layout effect, in the commit the plugin turned ready in, so a tool does not arrive a frame after the interface it
  // belongs to; a plugin that goes away takes its tools and sessions with it in the same transaction (PO1).
  const { panel, logs, panelHosts } = host;
  // The Logs tool is the host's: it is in the strip whatever the plugins are (the sessions that plugins open in it show when their plugin is ready). Registered before the plugins are, in the
  // first layout effect, so the strip is never drawn without it; registering it again changes nothing.
  useLayoutEffect(() => {
    panel.registerTool(LOGS_TOOL);
  }, [panel]);
  useLayoutEffect(() => {
    panel.syncPlugins(panelPluginsOf(entries));
  }, [panel, entries]);
  // The feeds of the Logs sessions belong to the host from the moment a plugin hands over a target: they are released with the session, with the plugin, and with the window.
  useEffect(() => logs.attach(), [logs]);
  const bindings = useMemo<PanelBindings>(
    () => ({
      store: panel,
      renderBody: (session, visible) => (session.tool === LOGS_TOOL_ID ? logsBodyOf(logs, session, visible) : panelBodyOf(entries, session, visible)),
      // The Logs card is the host's, completed member by member by what the plugin says for the sessions it opens there (`panel.sessions.logs.card`): the plugin's words win over the host's.
      cardOf: (session) => {
        const given = cardOfSession(entries, session);
        return session.tool === LOGS_TOOL_ID ? completeLogCard(logCardOf(session, logs.recordOf(session.id)), given) : given;
      },
      emptyOf: (toolId) => (toolId === LOGS_TOOL_ID ? LOGS_EMPTY : undefined),
      newSessionOf: (toolId) =>
        newSessionOf(entries, toolId, (input) => {
          const opened = panel.openSession(input);
          if (opened.status === 'refused') {
            console.warn(`[panel] a session was refused: ${opened.message}`);
          }
        }),
      linkOf: (route) => ({
        href: routeAddressOf(route),
        open: (activation) => {
          // The model's answer is not the card's to report: a refusal changes nothing, and the card closes on the click either way.
          tabs.open({ route }, { how: dispositionOf(activation, { platform }), source: 'panel' });
        },
      }),
    }),
    [panel, logs, entries, tabs, platform],
  );

  const sidebar = shown?.phase === 'ready' ? shown.contribution.sidebar : undefined;
  return (
    <>
      {shown?.phase === 'ready' && railRoute !== undefined && sidebar?.useNodes !== undefined ? (
        <ContributionBoundary key={shown.id} name={`${shown.id} sidebar`} fallback={() => <NoNodes plugin={shown.id} nodes={nodes} />}>
          <NodesSource plugin={shown.id} route={railRoute} useNodes={sidebar.useNodes} nodes={nodes} open={host.sidebarOpen} panelHost={panelHosts(shown.id)} />
        </ContributionBoundary>
      ) : null}
      <Shell
        registration={registrationOf({ entries, coming, waiting, held, route, frame, rail, failed, railPlugin, nodes: published })}
        tabs={tabs}
        renderPage={(tab: PageTab) => (
          <HostPage
            entries={entries}
            route={tab.location.route}
            tabId={tab.id}
            pluginName={tabs.selectors.face(tabs.getSnapshot(), tab.id)?.pluginName ?? ''}
            frames={frames}
            names={names}
            tabs={tabs}
            platform={platform}
            inventory={inventory}
            onRetry={onRetry}
            onRetryInventory={onRetryInventory}
            panelHosts={panelHosts}
          />
        )}
        empty={emptyOf({ entries, coming, inventory, onRetryInventory, onOpen: open })}
        onChoose={choose}
        onSidebarOpen={host.reportSidebarOpen}
        onSelectRail={selectRail}
        onNewTab={newTab}
        onCloseWindow={onCloseWindow}
        panel={bindings}
        palette={host.palette}
        notices={host.notices}
      />
    </>
  );
}
