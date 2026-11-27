import { ErrorBody, LinkProvider } from '@omniviewdev/kit';
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import { DetailPage, ListPage, type PageMemory } from '../../page';
import {
  createLogStreams,
  createTerminals,
  createPanelStore,
  createPorts,
  createRailChoice,
  createSettingsControl,
  createTabsStore,
  dispositionOf,
  completeLogCard,
  logCardOf,
  LOGS_EMPTY,
  LOGS_TOOL,
  LOGS_TOOL_ID,
  LogsBody,
  normaliseRoute,
  platformOf,
  PORTS_TOOL,
  PORTS_TOOL_ID,
  revealPortsTool,
  TERMINAL_TOOL,
  TERMINAL_TOOL_ID,
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
  type Ports,
  type PortsDeps,
  type RailChoice,
  type Route,
  type SettingsControl,
  type ShellLaneFace,
  type ShellRail,
  type ShellRegistration,
  type ShellSidebar,
  type TabId,
  type Terminals,
  type TerminalsOptions,
  type TabsStore,
} from '../../shell';
import type { ExtensionViewRoute, History, NavigationOrigin, TabRoute } from '../../shell/core/tabs';
import { createActivityFeed, type ActivityFeed, type SourceResolver } from '../../shell/panel/activity';
import type { ToolBadges } from '../../shell/panel/badge';
import { createOperations, OperationsBody, OPERATIONS_TOOL, OPERATIONS_TOOL_ID, type Operations } from '../../shell/panel/operations';
import { createProblems, ProblemsBody, PROBLEMS_TOOL, PROBLEMS_TOOL_ID, type Problems } from '../../shell/panel/problems';
import type { OpenSubject } from '../../shell/panel/subject';
import { pluginsPage } from '../../shell/plugins-page';
import { openable } from '../contract/admit';
import { currentOf, leafOf, readTarget } from '../contract/sidebarTargets';
import type { ConnectionsHostV1, ContextV1, ContributionV1, CustomPageContextV1, CustomPageV1, FrameV1, PanelHostV1, SidebarContextV1, SidebarNodeV1 } from '../contract/v1';
import { canRetry } from '../loader/failure';
import { ContributionBoundary } from './ContributionBoundary';
import { DetailOutlets } from './DetailOutlets';
import { ConnectionNames, connectionNameOf, laneFor } from './connectionName';
import { ConnectionQuestion, createConnectionActions, createConnectionsStore, createConnectionVerbs, createRecents, pickerOf, reachOf, usesOf, type ConnectionsApi, type ConnectionVerbs, type HostConnections } from './connections';
import { connectionsHostsOf } from './connectionsHost';
import { askedParams, connectionOf, createContributions, describeCustom, describeDetail, describeOverview, HOME_PAGE, OVERVIEW_SUBJECT, overviewAsDetail, panelConnectionOf, readsNoConnection, routeKey, textParamsOf, type PluginChoice, type PluginSource } from './contributions';
import type { ExtensionAuthority, ExtensionBinding } from './extensionAuthority';
import { ExtensionAuthorityContext } from './extensionAuthorityContext';
import { leafRoute, sidebarScope, useSidebarMount, VIEW_NODE_PREFIX, viewFace, viewLeaf, watchViewFaces, type SidebarGroup, type SidebarMount } from './sidebarMount';
import { ExtensionView } from './ExtensionView';
import { ExtensionMenuNavigationContext, menuDestination, useDetailMenuNavigation, type ExtensionMenuNavigation } from './extensionMenuNavigation';
import { useViewNavigation, type OpenView } from './useViewNavigation';
import { homePage } from './homePage';
import { HOME_PAGE_ID, HOST_PLUGIN, hostPageOf, registerHostPage } from './hostPages';
import { createLinkHandler } from './links';
import { NoTabs } from './NoTabs';
import { createHostNotices, type HostNotices } from './notices';
import { createHostPalette, type HostPalette } from './palette';
import { cardOfSession, newSessionOf, panelPluginsOf, routeAddressOf, sessionV1, toolOf } from './panel';
import { panelHostsOf } from './panelHost';
import { createResourceShells } from './resourceShells';
import { createTerminalExtensionMenu, type TerminalExtensionMenu } from './terminalExtensionMenu';
import { TerminalMenuContent } from './TerminalMenuContent';
import { attachPanelTools, badgesOf, cancelFailed, resolverOf, subjectOpener } from './panelTools';
import { openExternal } from './openExternal';
import { portNamesOf } from './portNames';
import { windowActivation, type PortForwardNetwork, type PortForwarding } from './portForward';
import { useGuardedDefinition, useGuardedHeader } from './pageFailures';
import { pageMemoryOf } from './pageMemory';
import { PlaceholderPage } from './PlaceholderPage';
import type { PluginEntry } from './pluginStore';
import { Published } from './published';
import { currentRail, failedOf, railOf, type RailEntry } from './rail';
import { NO_PARAMS, type HostRoute } from './route';
import { withWindows, type WindowService } from './windows';

// The Plugins page is the host's own page (ch16 S9): one registration, and a test or a probe registers another in its place.
registerHostPage(pluginsPage);
registerHostPage(homePage);

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
  /** Shows the host's own Settings window, where the app has native windows: the gear, the palette's Settings and the chord ask it. Absent in a browser tab, where Settings is a sheet in the window. */
  readonly openSettingsWindow?: (() => Promise<unknown>) | undefined;
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
  /** What the Terminal tool starts and loads. Default: the host's own shell and the emulator's lazy chunk; a probe or a test gives a synthetic shell and a fake emulator (`shell/panel/terminal`). */
  readonly terminals?: TerminalsOptions | undefined;
  /** What the window reads and starts of its plugins' connections: the runtime's calls and events (`connections/`). Absent: the window has no connection data, the scope chip stays text, and Home and the palette list no connection (a test of another part). */
  readonly connections?: ConnectionsApi | undefined;
  /**
   * The records of the host's activity service, as the window holds them (`shell/panel/activity.ts`): what the Problems tool reads for the alerts plugins report and the Operations tool for their tasks, and how Operations
   * asks the host to cancel a task and keeps that a record was read. The screen gives it the runtime provider's records. Absent: no plugin reports anything, and both tools list only what the window itself knows.
   */
  readonly activity?: ActivityFeed | undefined;
  /**
   * How the window reaches the host's networker for a page's port forward, `ctx.panel.ports.forward`, and for the `stop` of the forward it answers (`portForward.ts`): the runtime's typed start and its close of a forward by its id, which the screen
   * binds. Absent: the window has no port-forward service, and the handle a page is given has no `ports` member, as a host that predates it (a test of another part).
   */
  readonly networker?: PortForwardNetwork | undefined;
  /**
   * Whether a user action (a click, a key press) is under way now, as a page's `ctx.panel.ports.forward` asks it at the call: a forward is started from a user action only (`portForward.ts`). `true` inside one, `false` outside, and `undefined` when
   * the engine cannot tell, which refuses too. Absent: the window's own engine is asked (`navigator.userActivation`); a test or a probe that has no real input gives its own.
   */
  readonly userActivation?: (() => boolean | undefined) | undefined;
  /**
   * What the Ports tool is given beyond what the runtime gives it itself (`shell/panel/ports`): the host's calls and events, the clipboard, the names of connections, the way to open an address. Absent: the runtime's own, the names the window
   * knows for its connections, and the host's own way of opening an address (`openExternal.ts`). A test or a probe gives a fake host.
   */
  readonly ports?: Partial<PortsDeps> | undefined;
  /** The host's window service, where the app has native windows: a destination can open a window (`how: 'window'`), a tab can move to another window or be dragged out into one, and a secondary window closes when its last tab leaves. Absent in a browser tab, which has one window and refuses the request. */
  readonly windows?: WindowService | undefined;
};

type Host = {
  readonly frames: Published<FrameV1>;
  /** The names this window has learned for its connections (`connectionName.ts`): from the lanes its pages publish and from the faces its tabs were saved with. */
  readonly names: ConnectionNames;
  readonly nodes: Published<readonly SidebarNodeV1[] | null>;
  /** What each plugin's sidebar hook answered for a page that is read in no connection (KL5), by plugin: its navigator on a landing. Kept apart from `nodes`, which is the plugin's pages and what the palette lists them from: a navigator is not a list of pages. */
  readonly pluginScopeNodes: Published<readonly SidebarNodeV1[] | null>;
  /** The groups of each plugin's sidebar that are open on screen, by plugin: what the plugin's sidebar hook is told (`SidebarContextV1.open`). Nothing is held for a plugin whose tree is not on screen. */
  readonly sidebarOpen: Published<readonly string[]>;
  /** What the shell's tree tells the host: the rail entry whose tree it is, and the groups of it that are open on screen. */
  readonly reportSidebarOpen: (owner: string | undefined, open: readonly string[]) => void;
  /** The route each plugin was last shown at, by plugin: where its sidebar picks up when the rail shows it while another plugin's tab is on screen. */
  readonly routes: Published<TabRoute>;
  readonly tabs: TabsStore;
  /** The window's bottom panel. Its tools and sessions come from the plugins that are ready (`panel.ts`). */
  readonly panel: PanelStore;
  /** The feeds of the Logs tool's sessions: the host owns each from the moment a plugin hands over a target until the session goes (`shell/panel/logs`). */
  readonly logs: LogStreams;
  /** The Terminal tool: the feeds of its sessions, the dialog of its close question and the panel's answers for it (`shell/panel/terminal`). */
  readonly terminals: Terminals;
  readonly terminalMenu: TerminalExtensionMenu | undefined;
  /** The Ports tool: the store of the forwards the host reports, its body, and the way to show it (`shell/panel/ports`). It asks the host for nothing until its body is on screen. */
  readonly ports: Ports;
  /** What `ctx.panel` is for each plugin and each connection a page of it is read in: the Logs registry and the port-forward start, bound to the plugin that asks and to the page's connection (`panelHost.ts`). */
  readonly panelHosts: (plugin: string, connection?: string) => PanelHostV1;
  /** The plugin the user chose on the rail, as the session saves it. The component's own state is the source; this is what the session listens to. */
  readonly rail: RailChoice;
  readonly contributions: Contributions;
  /** The request at the address the window last opened, by key: a link opens once, however often the plugins change. */
  readonly opened: Published<string>;
  /** The window's command palette: the shell draws it, and the window attaches it to the models once it is on screen (`palette.ts`). */
  readonly palette: HostPalette;
  /** The window's toasts: the store the shell draws, and the one source that feeds it, a plugin's command that failed (`notices.ts`). The window attaches it to the models once it is on screen. */
  readonly notices: HostNotices;
  /** Settings: whether the sheet is open and where it was left. The sheet's code is a lazy chunk, fetched when it is first asked for (`shell/settings/host.ts`). */
  readonly settings: SettingsControl;
  /** The connections of the plugins and what choosing one does (HM1; `connections/`). Absent: the window has no connection API. */
  readonly connections: HostConnections | undefined;
  /** What `context.connections` is for each plugin: the window's connections cut to the plugin, with the way to open one and to read them again (`connectionsHost.ts`). A custom page is given it (KL2). */
  readonly connectionsHosts: (plugin: string) => ConnectionsHostV1;
  /** What the verbs of `context.connections` do and the question they ask (KL4; `connections/verbs.ts`): made with the connections, so absent when the window has none. The window draws the question (`ConnectionQuestion`). */
  readonly verbs: ConnectionVerbs | undefined;
  /** The Problems and Operations tools of the bottom panel: their models, fed by what the window already holds (`panelTools.ts`), the badges their tabs carry, and the answer to "what is this plugin or connection called". */
  readonly problems: Problems;
  readonly operations: Operations;
  readonly toolBadges: ToolBadges;
  readonly feed: ActivityFeed;
  readonly resolve: SourceResolver;
  /** What choosing a row of each tool does: it opens the thing the row is about (`subjectOpener`). */
  readonly openers: { readonly problems: OpenSubject; readonly operations: OpenSubject; readonly sidebar: OpenSubject };
};

/**
 * The window's connections: the store over the runtime's calls (kept current for as long as the window is on screen: `attach`), the connections used last (HM2: made from the tabs the window came back with, and kept current by the route of
 * the tab on screen, `connections/recents.ts`), and the actions that choose one. The store lists the plugins that are ready.
 */
function makeConnections(api: ConnectionsApi | undefined, tabs: TabsStore, plugins: PluginSource, viewBinding: (route: ExtensionViewRoute) => ExtensionBinding | undefined): HostConnections | undefined {
  if (api === undefined) {
    return undefined;
  }

  const store = createConnectionsStore(api, { plugins: () => plugins.getSnapshot().flatMap((entry) => (entry.phase === 'ready' ? [entry.id] : [])) });
  const recents = createRecents();
  recents.seed(usesOf(tabs.getSnapshot()));
  return { store, recents, actions: createConnectionActions({ tabs, plugins, connections: store, viewBinding }) };
}

/**
 * What a route of a plugin that names no connection is completed from (HM1; `contributions.ts`, `complete`): whether the window knows the connections, their keys for the plugin, and the one the plugin was last used in in this window.
 * Absent: the window has no connection data.
 */
function choiceOf(connections: HostConnections | undefined, plugin: string): PluginChoice | undefined {
  if (connections === undefined) {
    return undefined;
  }

  const { loaded, failed, connections: listed } = connections.store.getSnapshot();
  return {
    // A first read that failed leaves no list: nothing is known. A read that failed after one that worked leaves the earlier list, which is what the window goes by.
    state: !loaded ? 'unread' : failed && listed.length === 0 ? 'failed' : 'ready',
    keys: listed.flatMap((connection) => (connection.plugin === plugin ? [connection.key] : [])),
    last: connections.recents.getSnapshot().find((use) => use.plugin === plugin)?.key,
  };
}

/**
 * The connection a page, or the sidebar of the plugin on the rail, is read in for what it asks of the bottom panel (`panelConnectionOf`, `contributions.ts`): the route's, else the plugin's only connection. It follows the window's list of
 * connections, so a page whose only connection is replaced, removed or joined by another is given the handle of the connection it is read in now, or none. It is the one place the panel's connection is decided: every member of `ctx.panel`
 * that needs one (`ports`) takes it from the handle this makes. The answer is a string or nothing, so a change of the list that leaves it as it was draws nothing again.
 */
function usePanelConnection(connections: HostConnections | undefined, route: Route | undefined): string | undefined {
  return useSyncExternalStore(connections?.store.subscribe ?? ABSENT.subscribe, () => (route === undefined ? undefined : panelConnectionOf(route, choiceOf(connections, route.plugin))));
}

/**
 * Where each plugin was last shown, from the tabs a restored session brought back, in strip order and with the tab that was on screen last so that it wins. A saved tab holds its connection in its route, which is where the session already
 * keeps the scope of a window (`shell/session`, the `tabs` part of the document), so the connection a plugin was last used in comes back with the window and nothing else is saved for it.
 */
function seedRoutes(tabs: TabsStore, routes: Published<TabRoute>): void {
  const state = tabs.getSnapshot();
  for (const id of [...state.order, ...(state.active === null ? [] : [state.active])]) {
    const route = state.tabs[id]?.location.route;
    if (route !== undefined && route.plugin !== HOST_PLUGIN) {
      routes.publish(route.plugin, route);
    }
  }
}

/** The ordinary owner sidebar keeps its node source. Never put a peer ID, tagged location or another tab's params into SidebarContextV1. */
function sidebarPageRoute(entry: PluginEntry | undefined, route: TabRoute | undefined, history?: History): Route | undefined {
  if (route?.kind !== 'extension-view') {
    return route;
  }

  if (entry?.phase !== 'ready' || route.plugin !== entry.id) {
    return undefined;
  }

  // Continue the ordinary node hook in exactly the owner context this document left. A different document or scope contributes no params.
  for (let i = (history?.index ?? 0) - 1; i >= 0; i--) {
    const before = history?.entries[i];
    if (before?.plugin !== entry.id || connectionOf(before) !== route.connection) {
      break;
    }

    if (before.kind === 'extension-view') {
      continue;
    }

    const page = entry.contribution.pages[before.contribution];
    if (page && readsNoConnection(page) === (route.connection === undefined)) {
      return before;
    }

    break;
  }

  if (readsNoConnection(entry.contribution.pages[entry.contribution.home]) !== (route.connection === undefined)) {
    return undefined;
  }

  return { plugin: entry.id, contribution: entry.contribution.home, params: route.connection === undefined ? NO_PARAMS : { connection: route.connection } };
}

/**
 * The tab model, the panel, the rail's choice and the command palette of a window, over its plugins, from the session when there is one. They live as long as the window does. A part the session has
 * nothing for starts as it does with no session: no tab (the empty window), a closed panel, no rail entry chosen.
 */
function createHost(plugins: PluginSource, panel: PanelStore | undefined, session: LoadedSession | undefined, onCloseWindow: (() => void) | undefined, saved: LoadedNotices | undefined, openSettingsWindow: (() => Promise<unknown>) | undefined, terminalOptions: TerminalsOptions | undefined, connectionsApi: ConnectionsApi | undefined, activity: ActivityFeed | undefined, networker: PortForwardNetwork | undefined, userActivation: (() => boolean | undefined) | undefined, portsOptions: Partial<PortsDeps> | undefined, windows: WindowService | undefined, authority: ExtensionAuthority | null): Host {
  const frames = new Published<FrameV1>();
  const nodes = new Published<readonly SidebarNodeV1[] | null>();
  const pluginScopeNodes = new Published<readonly SidebarNodeV1[] | null>();
  const sidebarOpen = new Published<readonly string[]>();
  const names = new ConnectionNames();
  const routes = new Published<TabRoute>();
  // The connections are made after the tab model, whose open they drive, and the contributions the model asks read them: a reference closes the circle.
  const known: { current: HostConnections | undefined } = { current: undefined };
  const ownerOf = (id: string) => plugins.getSnapshot().find(entry => entry.id === id);
  const mountNodes = (route: ExtensionViewRoute) => (route.connection === undefined ? pluginScopeNodes : nodes).get(route.plugin);
  const contributions = createContributions({ plugins, frames, names, choice: (plugin) => choiceOf(known.current, plugin), describeView: route => {
    const owner = ownerOf(route.plugin);
    return viewFace(authority, owner, route, known.current?.store.getSnapshot(), mountNodes(route));
  } });
  const restored = session?.restore({ contributions });
  const store = panel ?? createPanelStore({ initial: restored?.panel });
  const logs = createLogStreams(store);
  const tabs = withWindows(createTabsStore({ contributions, initial: restored?.tabs }), store, windows);
  // A page forwards a port where the window has a networker to ask, from a user action: the Ports tool is shown once a forward has started, and a plugin that stops has no forwards left (the host says nothing of it, the window's own store does).
  const forwarding: PortForwarding | undefined =
    networker === undefined
      ? undefined
      : {
        ...networker,
        revealPortsTool: () => {
          revealPortsTool(store);
        },
        userActivation: userActivation ?? windowActivation,
        plugins: {
          running: (id) => plugins.getSnapshot().some((entry) => entry.id === id && entry.phase === 'ready'),
          subscribe: plugins.subscribe,
        },
      };
  const connections = makeConnections(connectionsApi, tabs, plugins, route => {
    const owner = ownerOf(route.plugin);
    return owner?.phase === 'ready' && sidebarScope(owner, route, known.current?.store.getSnapshot()) !== undefined
      ? viewLeaf(authority, owner, route, mountNodes(route))?.binding : undefined;
  });
  known.current = connections;
  const verbs = connections === undefined || connectionsApi === undefined ? undefined : createConnectionVerbs({ store: connections.store, api: connectionsApi, reach: reachOf(tabs, store) });
  // A forward's connection is named by what the window knows of its connections, and an address is opened with the window's own way; what a test gives wins.
  const ports = createPorts(store, { openExternal, names: portNamesOf(connections?.store, names), ...portsOptions });
  seedRoutes(tabs, routes);
  const notices = createHostNotices({ tabs, plugins, contributions, platform: platformOf(navigator), saved });
  // The Terminal's screen reader choice is the window's: it comes back from the session as the person left it (off when the session says nothing), and the session saves it again. A command that ran long in a terminal that is not in front is
  // told to the window's notices (the tool's own rule); what a test gives as the options wins.
  const terminals = createTerminals(store, { notices: notices.store, ...terminalOptions }, { screenReader: restored?.terminalScreenReader });
  const shells = connections && createResourceShells({ plugins, connections: connections.store, sessions: terminals.sessions, activated: userActivation ?? windowActivation });
  const panelHosts = panelHostsOf(logs, forwarding, shells);
  const terminalMenu = shells && authority ? createTerminalExtensionMenu({ shells, panel: store, sessions: terminals.sessions, authority, tabs }) : undefined;
  // The Problems and Operations tools read the window's producers: its plugins, its connections and the activity service's records. Without a feed there are none of the last (a window of a test, or of a part that reports nothing).
  const feed = activity ?? createActivityFeed({ cancel: async () => undefined, markRead: async () => undefined }).feed;
  const resolve = resolverOf(plugins, connections?.store);
  const problems = createProblems();
  const operations = createOperations({ feed, resolve, fail: (failure) => {
    cancelFailed(notices.store, failure);
  } });
  const settings = createSettingsControl({ load: async () => import('../../shell/settings/surface'), openWindow: openSettingsWindow });
  return {
    frames,
    names,
    nodes,
    pluginScopeNodes,
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
    terminals,
    terminalMenu,
    ports,
    panelHosts,
    rail: createRailChoice(restored?.rail ?? null),
    contributions,
    opened: new Published<string>(),
    palette: createHostPalette({ tabs, plugins, contributions, nodes, frames, connections, panel: store, platform: platformOf(navigator), onCloseWindow, openSettings: settings.open, remembered: (plugin) => sidebarPageRoute(ownerOf(plugin), routes.get(plugin)), panelHosts, terminalScreenReader: { toggle: terminals.screenReader.toggle, say: notices.announcer.polite.announce }, newTerminal: terminals.newSession.start }),
    notices,
    settings,
    connections,
    connectionsHosts: connectionsHostsOf(connections, verbs),
    verbs,
    problems,
    operations,
    toolBadges: badgesOf(problems, operations),
    feed,
    resolve,
    openers: {
      problems: subjectOpener({ tabs, contributions, connections, notices: notices.store, resolve, platform: platformOf(navigator) }, 'problems'),
      operations: subjectOpener({ tabs, contributions, connections, notices: notices.store, resolve, platform: platformOf(navigator) }, 'operations'),
      sidebar: subjectOpener({ tabs, contributions, connections, notices: notices.store, resolve, platform: platformOf(navigator) }, 'sidebar'),
    },
  };
}

/** What the rail follows: the tab on screen and its plugin, so the user's choice stands until either changes. Nothing while there is no tab. */
const followOf = (active: string | null, route: TabRoute | undefined, selection: number): string | undefined =>
  active === null || route === undefined ? undefined : `${active}\u0000${route.kind === 'extension-view' ? `${routeKey(route)}:${selection}` : route.plugin}`;

/**
 * The sidebar as the shell reads it: the contribution's words, the nodes that open something (`openable`), and the entry of the page on screen as current, when it is this plugin's. On a page that is read in no connection (`bare`) the sidebar may be called something else (`pluginScope`,
 * KL7): each of its members that is left out is the sidebar's own.
 */
function sidebarOf(contribution: ContributionV1, nodes: readonly SidebarNodeV1[], current: string | undefined, bare: boolean, group: SidebarGroup | undefined): ShellSidebar {
  const { label, title, pluginScope } = contribution.sidebar;
  return { label: (bare ? pluginScope?.label : undefined) ?? label, title: (bare ? pluginScope?.title : undefined) ?? title,
    nodes: group ? [...nodes, group.node] : nodes,
    auxiliary: group && { group: group.node.id, leaves: group.leaves.map(leaf => leaf.node.id) }, current, accent: contribution.plugin.accent };
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
  readonly route: TabRoute | undefined;
  readonly group: SidebarGroup | undefined;
  readonly frame: FrameV1 | undefined;
  /** The plugins that contribute, in the order of the rail, and the one whose sidebar shows (none while the window is coming and has no tab: there is nothing to anchor it to yet). */
  readonly rail: readonly RailEntry[];
  /** The plugins that did not load: entries of the rail after those, with no sidebar. */
  readonly failed: readonly RailEntry[];
  readonly railPlugin: string | undefined;
  /** What the sidebar's data hook of the plugin on the rail answered: nothing until it does, and the contribution's skeleton stands (but for a page read in no connection: `bare`). */
  readonly nodes: readonly SidebarNodeV1[] | null | undefined;
  /** The sidebar is that of a page read in no connection (KL5): what the hook answered for it is the whole sidebar, with no skeleton under it, and none is drawn while it answers none. */
  readonly bare: boolean;
  /** The scope lane the page on screen published, as the shell draws it: its connection face a control when the window knows the plugin's connections (HM1; `connectionName.ts`, `laneFor`). */
  readonly lane: readonly ShellLaneFace[] | undefined;
};

/** The page of a contribution a route names, as the host draws it: the plugin's own first page for one it does not have. */
const pageOf = (contribution: ContributionV1, route: Route): string => (Object.hasOwn(contribution.pages, route.contribution) ? route.contribution : contribution.home);

/**
 * What a tab's page is drawn from scratch for (`Shell`'s `pageKey`, KL7): the tab's place, which holds the route's parameters, except for a custom page, whose Body keeps what it keeps in state across a change of its own parameters (`context.setParams`, a link or an entry of the sidebar to the same
 * page, Back and Forward). It is another page when its plugin, its page or the connection it is read in changes, and the same page, given the new parameters, when they alone do; a reload and another tab draw it again as they always did (the tab's generation and its slot are not here). Keep-alive is by
 * tab (`state.mounted`), and a tab's page memory (`pageState`) by tab and history entry, so neither depends on the parameters: two tabs of one page with different parameters keep a Body each. A tab whose plugin is not ready draws a state and not a page, and its place stands.
 */
function pageKeyOf(entries: readonly PluginEntry[], { location }: PageTab): string {
  const { route, key } = location;
  if (route.kind === 'extension-view') {
    return key;
  }

  const entry = entries.find((candidate) => candidate.id === route.plugin);
  if (entry?.phase !== 'ready') {
    return key;
  }

  const page = pageOf(entry.contribution, route);
  const connection = connectionOf(route);
  return entry.contribution.pages[page]?.kind === 'custom' ? routeKey({ plugin: route.plugin, contribution: page, params: connection === undefined ? {} : { connection } }) : key;
}

/** Whether a plugin that is ready declares a landing (KL2): what it opens when it is opened and no connection is named is the landing, which needs no list of connections to be chosen from. */
const hasLanding = (entries: readonly PluginEntry[], plugin: string | undefined): boolean => entries.some((entry) => entry.id === plugin && entry.phase === 'ready' && entry.contribution.landing !== undefined);

/** What the window reads where it has no connection API: nothing, ever. */
const ABSENT = { subscribe: (): (() => void) => () => undefined, getSnapshot: (): undefined => undefined };

/**
 * What the shell draws around the tab on screen. The island, the lane and the landmarks follow the tab on screen: while its plugin is loading (or a tab is on its way, from a link, or from a
 * session whose plugin is not known yet) the frame is pending, its regions reserved, so the plugin's frame lands in the rectangles they hold; a plugin that did not load is drawn bare. The rail
 * and the sidebar follow the rail: every plugin that contributes has an entry, and the sidebar is the current entry's, with the page on screen current in it when it is that plugin's. Until every
 * plugin has settled once they are held (`held`): reserved empty, chosen when the last plugin has said what it is, so a plugin that registers late moves no entry that is drawn. With no plugin
 * that contributes there is nothing to reserve for and nothing to show: the frame is bare.
 */
function registrationOf({ entries, coming, waiting, held, route, lane, rail, failed, railPlugin, nodes, bare, group }: FrameInputs): ShellRegistration {
  const active = route === undefined ? undefined : entries.find((candidate) => candidate.id === route.plugin);
  const loading = entries.find((candidate) => candidate.phase === 'loading');

  const shown = railPlugin === undefined ? undefined : entries.find((candidate) => candidate.id === railPlugin);
  const sidebar = ((): ShellSidebar | undefined => {
    if (shown?.phase !== 'ready') {
      return undefined;
    }

    const { contribution } = shown;
    // The entry that stays selected while an object is open is the list it belongs to.
    const ordinary = route?.kind !== 'extension-view' && route?.plugin === shown.id ? route : undefined;
    const onScreen = ordinary && contribution.pages[pageOf(contribution, ordinary)];
    // A page that is read in no connection (the landing) has no skeleton under its sidebar (KL5): the skeleton's entries are pages of a connection and there is none to open them in, so what the plugin's hook answers for the page is the sidebar, and the window draws the page with the rail and no
    // tree (an empty `role=tree` is an axe fault) while it answers none.
    const opened = openable(bare ? (nodes ?? []) : (nodes ?? contribution.sidebar.nodes), contribution.pages);
    if (bare && opened.length === 0 && !group) {
      return undefined;
    }

    // The entry of the page on screen: the leaf that opens that page with the parameters the route carries, else the page's leaf that names none. An object's page selects the list it belongs to (its parameters are the object's, and no leaf is made of them).
    const asked = ordinary ? (onScreen?.kind === 'detail' ? { page: onScreen.definition.list?.page, params: NO_PARAMS } : { page: pageOf(contribution, ordinary), params: textParamsOf(ordinary) }) : undefined;
    const current = route?.kind === 'extension-view' && route.plugin === shown.id && route.point === contribution.sidebar.outlet
      ? group?.leaves.find(leaf => leaf.binding.offer === route.offer)?.node.id
      : asked?.page === undefined ? undefined : currentOf(opened, asked.page, asked.params);
    return sidebarOf(contribution, opened, current, bare, group);
  })();
  const listed = [...rail, ...failed];
  const railData: ShellRail | undefined =
    held || listed.length === 0
      ? undefined
      : { label: 'Plugins', entries: listed.map(({ id, label, icon, problem }) => ({ id, label, icon, ...(problem === undefined ? {} : { problem }) })), current: railPlugin };

  // The rail and the sidebar wait for the plugins: their regions are reserved, and no lane is (it is the frame's, and a frame that is known says whether it has one).
  const holding = held ? { held: true as const } : {};
  if (route?.kind !== 'extension-view' && route?.plugin === HOST_PLUGIN) {
    // A page of the host's own (the Plugins page) draws its own list beside its detail: the frame has the rail, no sidebar track and no scope lane, and the page is its own scroll owner. It is no plugin's, so no entry of the rail is current.
    return { plugin: { name: 'Omniview' }, layout: hostPageOf(route)?.layout ?? 'pane', rail: railData === undefined ? undefined : { ...railData, current: undefined }, ...holding };
  }

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
  if (route.kind === 'extension-view') {
    return { plugin: { name: contribution.plugin.name }, ...holding, rail: railData, layout: 'document', sidebar, scope: lane };
  }

  const page = contribution.pages[pageOf(contribution, route)];
  return {
    plugin: { name: contribution.plugin.name },
    ...holding,
    rail: railData,
    // A detail page is a document: the page scrolls, header and body together (ch16 S15), and so is an overview page, which draws the same anatomy for a scope, and a custom page unless it says it owns its scrolling (`layout`). A list owns its own scrolling.
    layout: page?.kind === 'detail' || page?.kind === 'overview' ? 'document' : page?.kind === 'custom' ? (page.layout ?? 'document') : 'pane',
    sidebar,
    scope: lane,
  };
}

type EmptyInputs = Pick<FrameInputs, 'entries' | 'coming'> &
  Pick<PluginHostProps, 'inventory' | 'onRetryInventory'> & {
    readonly onOpen: (plugin: string) => void;
    /** The window's plugin store and what it knows of the connections of its plugins (HM1, HM2): the empty window is Home, which reads them itself, as the Home tab does. Absent connections: the window has no connection API, and Home lists none. */
    readonly plugins: PluginSource;
    readonly connections: HostConnections | undefined;
  };

/** What the island shows while there is no tab: the plugins' own states, in the host's words; and once they have settled, the empty window (decision A17). */
function emptyOf({ entries, coming, inventory, onRetryInventory, onOpen, plugins, connections }: EmptyInputs): ReactNode {
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

  return <NoTabs plugins={plugins} connections={connections} onOpen={onOpen} />;
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

type OverviewProps = {
  readonly entry: PluginEntry & { readonly phase: 'ready' };
  readonly route: Route;
  readonly page: string;
  readonly frames: Published<FrameV1>;
  readonly names: ConnectionNames;
  readonly memory: PageMemory;
  /** What the plugin asks of the bottom panel: `ctx.panel`. */
  readonly panelHost: PanelHostV1;
};

type DetailProps = OverviewProps & {
  readonly tabs: TabsStore;
  readonly tabId: TabId;
  readonly connections: HostConnections | undefined;
};

/**
 * The detail page's own component, as the list's: its data hook runs here with the route's parameters, and the scope lane's faces it answers are published for the frame to read. The tab's
 * title, glyph and path are not the hook's: the tab model gets them from the route and the definition (`describeDetail`), even before this component mounts.
 */
function DetailContribution({ entry, route, page: pageId, frames, names, tabs, tabId, connections, panelHost, memory }: DetailProps) {
  const page = entry.contribution.pages[pageId];
  if (page?.kind !== 'detail') {
    throw new Error(`The plugin has no detail page "${pageId}"`);
  }

  const connection = connectionOf(route);
  const params = useMemo(() => textParamsOf(route), [route]);
  const context = useMemo<ContextV1>(() => ({ plugin: entry.id, route: { page: pageId, connection, params }, panel: panelHost }), [entry.id, pageId, connection, params, panelHost]);
  const { scope, source } = page.usePage(context);
  const guardedCommands = useGuardedHeader(source.view?.commands, entry.id);
  const { definition } = page;
  const pluginName = entry.contribution.plugin.name;
  // Published frames carry labels. The footer reads the tab's description instead, which retains the list crumb's actual route.
  const name = connectionNameOf(scope, names, entry.id, connection);
  const face = useMemo(() => describeDetail(pluginName, route, definition, name), [pluginName, route, definition, name]);
  // Before the first paint, so the scope lane is there with the page; a frame equal to the one held changes nothing.
  useLayoutEffect(() => {
    frames.publish(routeKey(route), { tab: { title: face.title, icon: definition.tile.icon }, path: (face.path ?? []).map((crumb) => (typeof crumb === 'string' ? crumb : crumb.label)), scope });
  }, [frames, route, face, definition.tile.icon, scope]);

  return (
    <DetailPage
      definition={definition}
      params={route.params}
      source={source}
      memory={memory}
      guardedCommands={guardedCommands}
      renderStrip={entry.artifact ? (strip) => <DetailOutlets strip={strip} entry={entry} source={source} route={route} tabs={tabs} tabId={tabId} connections={connections?.store} /> : undefined}
    />
  );
}

/**
 * The overview page's own component (HM3), as the detail's: its data hook runs here, for the route's connection and with no parameters (the page is the page of a scope, and a route to it names no object), and the faces of the scope lane it answers are published for the
 * frame to read. It draws the detail page unchanged, from a definition made from the overview's (`overviewAsDetail`) and the connection's NAME as the one parameter that definition names its subject by, so the heading is the connection's name (the one this page's lane says,
 * else the one the window has learned; the key is never drawn) and the page's title while the route names none. The tab model gets its title, glyph and path from the route and the definition (`describeOverview`).
 */
function OverviewContribution({ entry, route, page: pageId, frames, names, panelHost, memory }: OverviewProps) {
  const page = entry.contribution.pages[pageId];
  if (page?.kind !== 'overview') {
    throw new Error(`The plugin has no overview page "${pageId}"`);
  }

  const connection = connectionOf(route);
  // The page of a scope has no parameters of its own (`RouteV1.params`): what an address adds to a route to it is not an identity the page reads, so its hook is told none.
  const context = useMemo<ContextV1>(() => ({ plugin: entry.id, route: { page: pageId, connection, params: NO_PARAMS }, panel: panelHost }), [entry.id, pageId, connection, panelHost]);
  const { scope, source } = page.usePage(context);
  const guardedCommands = useGuardedHeader(source.view?.commands, entry.id);
  const { definition } = page;
  const detail = useMemo(() => overviewAsDetail(definition), [definition]);
  const pluginName = entry.contribution.plugin.name;
  // The name the header's heading and the path say the connection by: the one this page's lane says, else the one the window has learned for the connection, else none.
  const name = connectionNameOf(scope, names, entry.id, connection);
  const face = useMemo(() => describeOverview(pluginName, route, definition, name), [pluginName, route, definition, name]);
  const path = useMemo(() => (face.path ?? []).map((crumb) => (typeof crumb === 'string' ? crumb : crumb.label)), [face]);
  // Before the first paint, so the scope lane is there with the page; a frame equal to the one held changes nothing.
  useLayoutEffect(() => {
    frames.publish(routeKey(route), { tab: { title: face.title, icon: definition.tile.icon }, path, scope });
  }, [frames, route, face, definition.tile.icon, path, scope]);

  const params = useMemo(() => ({ [OVERVIEW_SUBJECT]: name ?? '' }), [name]);
  return <DetailPage definition={detail} params={params} source={source} memory={memory} guardedCommands={guardedCommands} />;
}

type ConnectionFaceProps = {
  readonly pluginId: string;
  readonly pluginName: string;
  readonly route: Route;
  readonly page: CustomPageV1;
  readonly frames: Published<FrameV1>;
  readonly names: ConnectionNames;
  readonly connections: ConnectionsHostV1;
};

/**
 * The face and the scope lane of a custom page that is read in a connection (KL2), published as a list page's frame is: the connection's NAME, from the window's own list of connections (else the one this window has learned for it), as the face that says the connection, which the host makes
 * the control of the picker every lane has. It draws nothing, and it is mounted for a page of a connection alone: a page that is read in no connection publishes none, so no lane claims a connection for it.
 */
function ConnectionFace({ pluginId, pluginName, route, page, frames, names, connections }: ConnectionFaceProps) {
  const connection = connectionOf(route);
  const listed = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const name = connection === undefined ? undefined : (listed.connections.find((candidate) => candidate.key === connection)?.name ?? names.get(pluginId, connection));
  const face = useMemo(() => describeCustom(pluginName, route, page, name), [pluginName, route, page, name]);
  const path = useMemo(() => (face.path ?? []).map((crumb) => (typeof crumb === 'string' ? crumb : crumb.label)), [face]);
  // Before the first paint, so the scope lane is there with the page; a frame equal to the one held changes nothing.
  useLayoutEffect(() => {
    frames.publish(routeKey(route), { tab: { title: page.title, icon: page.icon }, path, scope: name === undefined ? undefined : [{ label: 'Connection', icon: 'server', text: name, role: 'connection' }] });
  }, [frames, route, page, path, name]);

  return null;
}

type CustomProps = {
  readonly entry: PluginEntry & { readonly phase: 'ready' };
  readonly route: Route;
  readonly page: string;
  readonly frames: Published<FrameV1>;
  readonly names: ConnectionNames;
  /** The tab model and the tab this page is drawn for: `context.setParams` changes the route of that tab. */
  readonly tabs: TabsStore;
  readonly tabId: TabId;
  /** What the plugin asks of the bottom panel: `ctx.panel`. */
  readonly panelHost: PanelHostV1;
  /** What the plugin asks of the window about its connections: `context.connections`. */
  readonly connections: ConnectionsHostV1;
};

/**
 * The custom page's own component (KL2): the plugin's Body runs here, in its tab's own subtree and the page's own boundary, and is told its context. The host draws nothing around it: no header, no heading, and for a page read in no connection no lane. The page is told its route's
 * parameters (KL5, `RouteV1.params`, as a detail page is: the route's, as text) and, for a page read in no connection, no connection, whatever its route carries. The place a tab is at is its page and its parameters, but the page is drawn again from scratch only when its page or its connection
 * changes (`pageKeyOf`, KL7): a change of the parameters alone, by `setParams`, a link, an entry of the sidebar, Back or Forward, gives the same Body a new context. `setParams` changes the parameters of the route of the tab this page is in, as a link to the same page would, and does it in place:
 * `replace` (the default) takes the tab's history entry, `push` adds one (`navigate` and `replace` of the tab model, which decide the rest: the unsaved-changes question, the singleton rule, the page memory). A call is held to the page instance that made it: this plugin, this page and this connection of this tab, from the commit that draws the instance to the commit that takes it away, so a callback a page left behind (the page of another connection, a page drawn again by a reload of the tab or a return to it, a plugin that came back) changes nothing, and neither does a call from a page that is not on screen (a hidden page's effects are released).
 * The tab's face is the route's and the definition's (`describeCustom`), the same before this component has run.
 */
function CustomContribution({ entry, route, page: pageId, frames, names, tabs, tabId, panelHost, connections }: CustomProps) {
  const page = entry.contribution.pages[pageId];
  if (page?.kind !== 'custom') {
    throw new Error(`The plugin has no custom page "${pageId}"`);
  }

  const connection = page.scope === 'plugin' ? undefined : connectionOf(route);
  const params = useMemo(() => textParamsOf(route), [route]);
  const { contribution } = entry;
  // The connection the route names, which this page was drawn for: the page is another page when it changes (`pageKeyOf`), and a call that finds the tab in another is not this page's.
  const drawnFor = connectionOf(route);
  // Whether this instance of the page is the one that is drawn: from the commit that draws it to the commit that takes it away (a page is drawn again for another page, another connection, a reload of the tab, a return to the page and a plugin that came back), and not while its effects are released (a hidden page).
  const drawn = useRef(true);
  useLayoutEffect(() => {
    drawn.current = true;
    return () => {
      drawn.current = false;
    };
  }, []);
  const setParams = useMemo<CustomPageContextV1['setParams']>(
    () => (next, options) => {
      // A callback the page left behind is not this page's: its instance is gone, or the tab is at another plugin, page or connection now. The route the tab is at now, not the one this render was made for, is the one that changes.
      const at = tabs.selectors.tab(tabs.getSnapshot(), tabId)?.location.route;
      if (!drawn.current || at?.plugin !== entry.id || at.kind === 'extension-view' || pageOf(contribution, at) !== pageId || connectionOf(at) !== drawnFor) {
        return;
      }

      const asked = askedParams(at, next);
      if ('problem' in asked) {
        console.warn(`[plugins] ${entry.id} page ${pageId}: setParams was ignored: ${asked.problem}`);
        return;
      }

      if (options?.history === 'push') {
        tabs.navigate(tabId, { route: asked.route }, { history: 'push', source: 'page' });
      } else {
        tabs.replace(tabId, asked.route);
      }
    },
    [tabs, tabId, entry.id, contribution, pageId, drawnFor],
  );
  const context = useMemo<CustomPageContextV1>(
    () => ({ plugin: entry.id, route: { page: pageId, connection, params }, panel: panelHost, connections, setParams }),
    [entry.id, pageId, connection, params, panelHost, connections, setParams],
  );
  const { Body } = page;
  return (
    <>
      {page.scope === 'connection' ? <ConnectionFace pluginId={entry.id} pluginName={entry.contribution.plugin.name} route={route} page={page} frames={frames} names={names} connections={connections} /> : null}
      <Body context={context} />
    </>
  );
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
  /** What each plugin asks of the bottom panel in the connection the page is read in: its `ctx.panel`. */
  readonly panelHosts: (plugin: string, connection?: string) => PanelHostV1;
  /** The window's plugin store, for a page of the host's own (`hostPages.ts`). */
  readonly source: PluginSource;
  /** The window's connections: what it knows of them and what choosing one does. Absent: it has no connection API. */
  readonly connections: HostConnections | undefined;
  /** What each plugin is told of the window's connections: its `context.connections` on a custom page (KL2). */
  readonly connectionsHosts: (plugin: string) => ConnectionsHostV1;
  /** Opens a plugin at its first page, for the Home page's rows. */
  readonly openPlugin: (plugin: string, event: ModifierEvent | undefined) => void;
};

type OwnerStateProps = Pick<HostPageProps, 'inventory' | 'pluginName' | 'onRetry' | 'onRetryInventory'> & {
  readonly entry: PluginEntry | undefined; readonly plugin: string;
};

/** A foreground location keeps its own visit across owner loss. The ordinary unavailable-owner surface takes precedence. */
function MountedLocation({ entry, route, host, tabId, inventory, pluginName, onRetry, onRetryInventory }: Omit<OwnerStateProps, 'plugin'> & {
  readonly route: ExtensionViewRoute; readonly host: Host; readonly tabId: TabId;
}) {
  const authority = useContext(ExtensionAuthorityContext);
  const { tabs } = host;
  const state = tabs.getSnapshot();
  const location = state.tabs[tabId]?.location;
  const focus = state.activeVisit;
  const [renewal, renew] = useState(0);
  const visit = useMemo(() => ({ id: tabId, location, visit: focus, renewal }), [tabId, location, focus, renewal]);
  const known = useSyncExternalStore(host.connections?.store.subscribe ?? ABSENT.subscribe, host.connections?.store.getSnapshot ?? ABSENT.getSnapshot);
  const nodes = route.connection === undefined ? host.pluginScopeNodes : host.nodes;
  const published = useSyncExternalStore(nodes.subscribe, () => nodes.get(route.plugin));
  const owner = inventory === 'ready' && entry?.phase === 'ready' && entry.contribution.sidebar.outlet === route.point ? entry : undefined;
  const { placement, group } = useSidebarMount(authority, owner, route, known, published, visit);
  const binding = group?.leaves.find(leaf => leaf.binding.offer === route.offer)?.binding;
  useLayoutEffect(() => {
    if (!authority || !placement || !owner || !binding) {
      return;
    }

    // Native replies and promise continuations must not await React's next commit to learn a visit has ended.
    let live = true;
    const withdraw = () => {
      if (!live) {
        return;
      }

      live = false;
      authority.endPlacement(placement);
      renew(n => n + 1);
    };

    const checkTab = () => {
      const now = tabs.getSnapshot();
      if (now.active !== tabId || now.activeVisit !== focus || now.tabs[tabId]?.location !== location) {
        withdraw();
      }
    };

    const store = host.connections?.store;
    const checkScope = () => {
      if (sidebarScope(owner, route, store?.getSnapshot()) === undefined) {
        withdraw();
      }
    };

    const checkNodes = () => {
      if (viewLeaf(authority, owner, route, nodes.get(owner.id))?.binding !== binding) {
        withdraw();
      }
    };

    const stopTab = tabs.subscribe(checkTab);
    const stopScope = store?.subscribe(checkScope);
    const stopNodes = nodes.subscribe(checkNodes);
    checkTab(); checkScope(); checkNodes();
    return () => {
      live = false; stopTab(); stopScope?.(); stopNodes();
    };
  }, [authority, placement, owner, binding, tabs, tabId, focus, location, host, route, nodes]);
  return <>
    <div hidden={entry?.phase !== 'ready'}>
      <ExtensionView surface="sidebar" placement={placement} binding={binding} onBack={tabs.canBack(tabId) ? () => {
        tabs.back(tabId, { origin: visit });
      } : undefined} />
    </div>
    {entry?.phase === 'ready' ? null : <UnavailableOwner entry={entry} plugin={route.plugin} pluginName={pluginName} inventory={inventory} onRetry={onRetry} onRetryInventory={onRetryInventory} />}
  </>;
}

/**
 * One tab's page: the plugin's, in its own boundary and with its links, or the state the plugin is in. A tab whose plugin the host does not have is pending while the list of plugins is on its
 * way (a tab restored from a session is drawn before any plugin is known), says the list could not be read when it could not, and says the plugin is not installed, or is turned off, when the
 * list was read and the plugin is not in it. The tab stays in every case: the plugin may come back, and the tab is the user's.
 */
function HostPage({ entries, route, tabId, pluginName, frames, names, tabs, platform, inventory, onRetry, onRetryInventory, panelHosts, connectionsHosts, source, connections, openPlugin }: HostPageProps) {
  // What the page asks of the bottom panel is bound to the connection it is read in, which is the route's or, when the route names none, the plugin's only one (`usePanelConnection`).
  const panelConnection = usePanelConnection(connections, route);
  // The links of the page open where the page is: its plugin, and the connection it is read in. The handler changes only when the page moves.
  const connection = connectionOf(route);
  const handler = useMemo(() => createLinkHandler({ tabs, platform, plugin: route.plugin, connection }), [tabs, platform, route.plugin, connection]);
  // What a page keeps is the tab's `pageState`: the same object for as long as the tab is, so the page's own hooks may depend on it.
  const memory = useMemo(() => pageMemoryOf(tabs, tabId), [tabs, tabId]);
  // A page of the host's own, in a boundary of its own so that a page that throws loses itself and nothing of the window.
  const hosted = hostPageOf(route);
  if (hosted !== undefined) {
    return (
      <ContributionBoundary name={`host page ${hosted.id}`} resetKey={hosted.id} fallback={(retry) => <PlaceholderPage title={hosted.title} state={{ kind: 'failed', message: 'This page failed to display.', retry }} />}>
        <hosted.Page tabs={tabs} tabId={tabId} plugins={source} onRetry={onRetry} connections={connections} openPlugin={openPlugin} />
      </ContributionBoundary>
    );
  }

  const entry = entries.find((candidate) => candidate.id === route.plugin);
  if (entry?.phase !== 'ready') {
    return <UnavailableOwner entry={entry} plugin={route.plugin} pluginName={pluginName} inventory={inventory} onRetry={onRetry} onRetryInventory={onRetryInventory} />;
  }

  const { contribution } = entry;
  const page = pageOf(contribution, route);
  const found = contribution.pages[page];
  const title = found === undefined ? entry.name : found.kind === 'detail' ? found.definition.kind : found.kind === 'custom' ? found.title : found.definition.title;
  return (
    <LinkProvider handler={handler}>
      <ContributionBoundary name={`${entry.id} page ${page}`} resetKey={page} fallback={(retry) => <PlaceholderPage title={title} state={{ kind: 'failed', message: 'This page failed to display.', retry }} />}>
        {found?.kind === 'detail' ? (
          <DetailContribution entry={entry} route={route} page={page} frames={frames} names={names} tabs={tabs} tabId={tabId} connections={connections} panelHost={panelHosts(entry.id, panelConnection)} memory={memory} />
        ) : found?.kind === 'overview' ? (
          <OverviewContribution entry={entry} route={route} page={page} frames={frames} names={names} panelHost={panelHosts(entry.id, panelConnection)} memory={memory} />
        ) : found?.kind === 'custom' ? (
          // A page read in no connection has no connection-bound panel handle.
          <CustomContribution entry={entry} route={route} page={page} frames={frames} names={names} tabs={tabs} tabId={tabId} panelHost={panelHosts(entry.id, readsNoConnection(found) ? undefined : panelConnection)} connections={connectionsHosts(entry.id)} />
        ) : (
          <ListContribution entry={entry} route={route} page={page} frames={frames} panelHost={panelHosts(entry.id, panelConnection)} memory={memory} />
        )}
      </ContributionBoundary>
    </LinkProvider>
  );
}

function UnavailableOwner({ entry, plugin, pluginName, inventory, onRetry, onRetryInventory }: OwnerStateProps) {
  if (entry === undefined) {
    const title = pluginName === '' ? plugin : pluginName;
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
          // A plugin the host refused for the protocol it speaks gets no Retry: asking again cannot help, and the page says why instead.
          retry: canRetry(entry.failure)
            ? () => {
              onRetry(entry.id);
            }
            : undefined,
        }}
      />
    );
  }

  return null;
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
  /** What the plugin asks of the window about its connections: `context.connections`, as a custom page is given it (KL5). */
  readonly connections: ConnectionsHostV1;
};

/** The groups open on screen while the tree has told the host none, and before it has: no group is open, and the entries of no group are on screen. One list, so that nothing that reads it sees a change. */
const NONE_OPEN: readonly string[] = [];

/**
 * Runs the sidebar's data hook for the plugin on the rail, and publishes what it answers: nothing until it answers, and the skeleton stands (a page read in no connection has none). It draws nothing. The hook is told the context every hook of the plugin
 * gets and, as well, which groups of its tree are open on screen (the entries of a group that is closed are not on screen, and the hook has no reason to ask for what they count) and the plugin's connections (KL5). Its route is the route of the page it is called for, with that route's own
 * parameters as text (KL7: they were none, so a navigator could not tell which of the places of a page was on screen, nor carry what the page keeps in its route to the place an entry opens). The context is the same object for as long as the plugin, the page, the connection, the parameters (by their
 * text), the connections handle and the open groups are the same, and the open groups are the same list until the set of them changes, so a hook may use either as a dependency.
 */
function NodesSource({ plugin, route, useNodes, nodes, open, panelHost, connections }: NodesProps) {
  const page = route.contribution;
  const connection = connectionOf(route);
  // The route a hook is called for is the tab's, or the one the plugin was last shown at, or its first page made anew on every render: the parameters are the same object while their text is, so none of them runs the hook again.
  const paramsText = JSON.stringify(textParamsOf(route));
  const params = useMemo(() => (paramsText === '{}' ? NO_PARAMS : (JSON.parse(paramsText) as Readonly<Record<string, string>>)), [paramsText]);
  const expanded = useSyncExternalStore(open.subscribe, () => open.get(plugin) ?? NONE_OPEN);
  const answer = useNodes(useMemo<SidebarContextV1>(() => ({ plugin, route: { page, connection, params }, panel: panelHost, open: expanded, connections }), [plugin, page, connection, params, panelHost, expanded, connections]));
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

/** The body of a session of the host's Terminal tool, in a boundary of its own so that a terminal whose view throws loses that session's body and no other (`shell/panel/terminal`). */
function terminalBodyOf(terminals: Terminals, session: PanelSession, visible: boolean): ReactElement {
  return (
    <ContributionBoundary name="terminal session" fallback={(retry) => <ErrorBody title="Couldn't show this session" onRetry={retry} />}>
      {terminals.bodyOf(session, visible)}
    </ContributionBoundary>
  );
}

/** The body of the host's Ports tool, in a boundary of its own so that a body that throws loses that tool and no other (`shell/panel/ports`). */
function portsBodyOf(ports: Ports): ReactElement {
  return (
    <ContributionBoundary name="ports tool" fallback={(retry) => <ErrorBody title="Couldn't show Ports" onRetry={retry} />}>
      {ports.bodyOf()}
    </ContributionBoundary>
  );
}

/** Keep one navigation context for the committed rail and document, independent of the rest of the window's renders. */
function useSidebarMenuNavigation(
  host: Host, plugins: PluginSource, authority: ExtensionAuthority | null, mount: SidebarMount,
  shown: PluginEntry | undefined, sidebarLocation: TabRoute | undefined, sidebarNodes: Host['nodes'],
  openView: OpenView, origin: NavigationOrigin,
) {
  const { placement: sidebarPlacement, scope: mountedScopeKey, group } = mount;
  const { connections: hostConnections, tabs } = host;
  const detailNavigation = useDetailMenuNavigation(tabs, authority, openView);
  return useMemo<ExtensionMenuNavigation>(() => {
    function destination(menu: ExtensionBinding, connection: string | undefined) {
      if (!authority || !sidebarPlacement || mountedScopeKey === undefined || (connection ?? null) !== mountedScopeKey ||
          shown?.phase !== 'ready' || !sidebarLocation || !authority.point(menu.point).includes(menu) ||
          plugins.getSnapshot().find(entry => entry.id === shown.id) !== shown ||
          sidebarScope(shown, sidebarLocation, hostConnections?.store.getSnapshot()) !== mountedScopeKey) {
        return undefined;
      }

      const binding = menuDestination(menu, authority.eligible(sidebarPlacement), 'sidebar');
      const leaf = group?.leaves.find(candidate => candidate.binding === binding);
      if (!binding || !leaf) {
        return undefined;
      }

      const target = leafRoute(shown, leaf, mountedScopeKey);
      return viewLeaf(authority, shown, target, sidebarNodes.get(shown.id))?.binding === binding ? { binding, target } : undefined;
    }

    return {
      ...detailNavigation,
      canOpenSidebar: (menu, connection) => destination(menu, connection) !== undefined,
      openSidebar(menu, connection, current) {
        const found = current() ? destination(menu, connection) : undefined;
        if (!found) {
          return false;
        }

        openView(found.target, 'here', 'sidebar', () => current() && destination(menu, connection)?.binding === found.binding, origin);
        return true;
      },
    };
  }, [authority, sidebarPlacement, mountedScopeKey, shown, sidebarLocation, group, plugins, hostConnections, sidebarNodes, openView, origin, detailNavigation]);
}

export function PluginHost({ plugins, inventory, link, onRetry, onRetryInventory, onCloseWindow, openSettingsWindow, panel: given, session, savedNotices, terminals: terminalOptions, connections: connectionsApi, activity, networker, userActivation, ports: portsOptions, windows }: PluginHostProps) {
  const entries = useSyncExternalStore(plugins.subscribe, plugins.getSnapshot);
  const authority = useContext(ExtensionAuthorityContext);
  const [host] = useState(() => createHost(plugins, given, session, onCloseWindow, savedNotices, openSettingsWindow, terminalOptions, connectionsApi, activity, networker, userActivation, portsOptions, windows, authority));
  const [platform] = useState(() => platformOf(navigator));
  // A link at load waits for its plugin; each distinct link opens once. Where it stands is the host's (an external store), not state of this component: opening it is the effect's whole job.
  const { tabs, frames, names, nodes, routes, opened } = host;
  const { open: openView, selection, dialog: navigationDialog } = useViewNavigation(tabs, host.notices.store);
  useLayoutEffect(() => authority ? watchViewFaces(tabs, authority, [host.connections?.store, nodes, host.pluginScopeNodes]) : undefined, [tabs, authority, host, nodes]);
  // The connections the window knows (HM1): the scope lane's picker, Home and the palette are made from them, and a link that names no connection waits for them (below).
  const hostConnections = host.connections;
  const knownConnections = useSyncExternalStore(hostConnections?.store.subscribe ?? ABSENT.subscribe, hostConnections?.store.getSnapshot ?? ABSENT.getSnapshot);
  const ordinaryLink = link.kind === undefined ? link : undefined;
  const linkKey = link.kind === 'extension-view' ? routeKey(link) : ordinaryLink?.plugin === undefined ? undefined : JSON.stringify([ordinaryLink.plugin, ordinaryLink.page, ordinaryLink.connection, ordinaryLink.params]);
  const linkWaiting = useSyncExternalStore(opened.subscribe, () => linkKey !== undefined && opened.get('link') !== linkKey);
  // A link that names no connection is read in one the window chooses (rule R4), so it waits for the list of connections: the plugin is never opened on a connection that nobody chose. A first read that failed leaves nothing to choose
  // from: the window shows what it shows with no tab (Home, with its Retry) and the link keeps waiting for a read that works, which completes it. A plugin that declares a landing (KL2) opens it for such a link, which needs no list.
  const naming = ordinaryLink !== undefined && ordinaryLink.connection === undefined && knownConnections !== undefined && !hasLanding(entries, ordinaryLink.plugin);
  const unread = naming && !knownConnections.loaded;
  const unreadable = naming && knownConnections.loaded && knownConnections.failed && knownConnections.connections.length === 0;
  const waiting = linkWaiting && !unreadable;
  const known = ordinaryLink?.plugin !== undefined && entries.some((entry) => entry.id === ordinaryLink.plugin);
  // Whether the screen has had its turn since the inventory came in: its effect hands the plugins to the store after this component's, so a link looked at in the commit the inventory
  // arrives in would find its plugin missing and be refused for good.
  const settled = useSyncExternalStore(opened.subscribe, () => opened.get('settled') === 'yes');

  useEffect(() => {
    if (linkKey === undefined) {
      if (opened.get('link')) {
        opened.publish('link', '');
      }

      return;
    }

    if (opened.get('link') === linkKey) {
      return;
    }

    if (link.kind === 'extension-view') {
      opened.publish('link', linkKey);
      openView(link, 'here', 'link');
      return;
    }

    if (link.kind !== undefined || link.plugin === undefined) {
      return;
    }

    if (!known && inventory === 'loading') {
      return;
    }

    if (!known && !settled) {
      opened.publish('settled', 'yes');
      return;
    }

    // The list is not known yet, or the first read failed: the window stays as it is, and with no tab open that is Home, which says so and offers the Retry. The link opens when a read that worked says which connection it is read in.
    if (unread || unreadable) {
      return;
    }

    opened.publish('link', linkKey);
    // A link to a plugin the host does not have is refused by the model, and the window stays as it is: it opens no page of its own.
    tabs.open({ route: { plugin: link.plugin, contribution: link.page ?? HOME_PAGE, params: { ...link.params, connection: link.connection } } }, { how: 'smart', source: 'link' });
  }, [tabs, opened, link, openView, linkKey, known, inventory, settled, unread, unreadable]);

  // The session is saved from the first commit to the last: the tabs, the panel, the rail's choice and the Terminal's screen reader choice, one burst after each change and when the window is hidden. What the session restored
  // is what the models were made with; this only starts the saving.
  useEffect(() => session?.attach({ tabs, panel: host.panel, rail: host.rail, terminalScreenReader: host.terminals.screenReader }), [session, tabs, host]);

  // The palette remembers the places the user goes to and keeps its list up to date while it is open, for as long as the window is on screen. Closed, it costs nothing.
  useEffect(() => host.palette.attach(), [host]);

  // The connections stay current for as long as the window is on screen: read once, then again when the host says one changed or one started (`connections/store.ts`). Absent: nothing is read.
  useEffect(() => host.connections?.store.attach(), [host]);

  // The toasts follow the window: a modal (the palette) holds them back, and a plugin that leaves or a tab that moves makes every notice ask again what its actions can do. Nothing runs while nothing changes.
  // The toasts' timers are held while a modal dialog is open: the palette, and the question a close of a running terminal asks.
  useEffect(
    () =>
      host.notices.attach({
        subscribe: (listener) => {
          const stops = [host.palette.store.subscribe(listener), host.terminals.modal.subscribe(listener)];
          return () => {
            for (const stop of stops) {
              stop();
            }
          };
        },
        open: () => host.palette.store.getSnapshot().open || host.terminals.modal.open(),
      }),
    [host],
  );

  const location = useSyncExternalStore(tabs.subscribe, () => {
    const state = tabs.getSnapshot();
    return state.active === null ? undefined : state.tabs[state.active]?.location;
  });
  const route = location?.route;
  const activeId = useSyncExternalStore(tabs.subscribe, () => tabs.getSnapshot().active);
  const rail = railOf(entries);
  const failed = failedOf(entries);

  // The rail's current entry. The user's choice stands until the tab on screen changes: activating another tab, or moving the tab on screen to another plugin, makes that plugin current
  // (state kept from the render before, the way React keeps a value derived from what changed). With no tab on screen the choice stands as it was. A window that was saved starts from the
  // choice it was saved with and from the tab it was saved on, so the first render does not take the choice for a change of tab.
  const [chosen, setChosen] = useState<string | undefined>(() => route?.kind === 'extension-view' ? route.plugin : host.rail.getSnapshot() ?? undefined);
  const [followed, setFollowed] = useState<string | undefined>(() => followOf(activeId, route, selection));
  const follow = followOf(activeId, route, selection);
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
  const missingOwner = route?.kind === 'extension-view' && chosen === route.plugin && !rail.some(row => row.id === route.plugin);
  const railPlugin = held || missingOwner ? undefined : currentRail(rail, chosen, route?.plugin);
  const shown = railPlugin === undefined ? undefined : entries.find((candidate) => candidate.id === railPlugin);

  // Where each plugin was last shown, so the sidebar of a plugin the rail shows beside another plugin's tab, and what is opened from it, pick up at its connection.
  useLayoutEffect(() => {
    if (route !== undefined) {
      routes.publish(route.plugin, route);
      const used = connectionOf(route);
      if (used !== undefined) {
        host.connections?.recents.touch(route.plugin, used);
      }
    }
  }, [routes, route, host]);
  const remembered = useSyncExternalStore(routes.subscribe, () => (railPlugin === undefined ? undefined : routes.get(railPlugin)));
  const sidebarLocation = ((): TabRoute | undefined => {
    if (railPlugin === undefined) {
      return undefined;
    }

    if (route?.plugin === railPlugin) {
      return route;
    }

    const home = host.contributions.home?.(railPlugin);
    return remembered ?? (home === undefined ? undefined : { plugin: home.plugin, contribution: home.contribution, params: NO_PARAMS });
  })();
  const ownHistory = route === sidebarLocation && route?.kind === 'extension-view' && activeId !== null ? tabs.getSnapshot().tabs[activeId]?.history : undefined;
  const railRoute = sidebarPageRoute(shown, sidebarLocation, ownHistory);
  const railConnection = usePanelConnection(hostConnections, railRoute);
  // The sidebar of a page read in no connection (KL5), by the page of the route the sidebar's hook is called for: what the hook answers for it is a navigator and not a list of the plugin's pages, so it is kept apart (`pluginScopeNodes`, which the palette does not list pages from),
  // and the panel handle the hook is given has no connection, as a page's has none.
  const bare = sidebarLocation?.kind === 'extension-view' ? sidebarLocation.connection === undefined
    : readsNoConnection(shown?.phase === 'ready' && railRoute !== undefined ? shown.contribution.pages[pageOf(shown.contribution, railRoute)] : undefined);
  const sidebarNodes = bare ? host.pluginScopeNodes : nodes;
  // What a page of the plugin on the rail opens at when the tab on screen is another plugin's: the connection that plugin was last used in.
  const carried = route?.plugin === railPlugin || remembered === undefined ? undefined : connectionOf(remembered);

  const key = route === undefined ? undefined : routeKey(route);
  const frame = useSyncExternalStore(frames.subscribe, () => (key === undefined ? undefined : frames.get(key)));
  const published = useSyncExternalStore(sidebarNodes.subscribe, () => (shown === undefined ? undefined : sidebarNodes.get(shown.id)));
  const activeVisit = useSyncExternalStore(tabs.subscribe, () => tabs.getSnapshot().activeVisit);
  // A different rail owner gets a different lease holder in useSidebarMount, even with the same active document.
  const origin = useMemo(() => ({ id: activeId, location, visit: activeVisit }), [activeId, location, activeVisit]);
  const mount = useSidebarMount(authority, inventory === 'ready' ? shown : undefined, sidebarLocation, knownConnections, published, origin);
  const menuNavigation = useSidebarMenuNavigation(host, plugins, authority, mount, shown, sidebarLocation, sidebarNodes, openView, origin);
  const verifiedTree = sidebarLocation?.kind !== 'extension-view' || (shown?.phase === 'ready' && sidebarScope(shown, sidebarLocation, knownConnections) !== undefined);
  const mountedScope: FrameV1['scope'] = route?.kind === 'extension-view' && route.connection !== undefined
    ? [{ label: 'Connection', role: 'connection', icon: 'server', text: knownConnections?.connections.find(row => row.plugin === route.plugin && row.key === route.connection)?.name ?? 'Choose connection' }]
    : undefined;

  // The scope lane of the page on screen, with its connection face made a control (HM1): the picker is the host's, made from the state of the plugin's connections, and what it chooses is the tab's change of connection (`actions.switchTab`).
  const lane = laneFor(
    route?.kind === 'extension-view' ? mountedScope : frame?.scope,
    hostConnections === undefined || knownConnections === undefined || route === undefined || activeId === null
      ? undefined
      : (face) =>
        pickerOf({
          plugin: route.plugin,
          connections: knownConnections.connections,
          named: connectionOf(route),
          text: face.text.trim() === '' ? undefined : face.text,
          icon: face.icon,
          onOpen: () => {
            void hostConnections.store.refresh();
          },
          onChoose: (key) => {
            const now = tabs.getSnapshot();
            if ((route.kind === 'extension-view' || now.tabs[activeId]?.location.route.kind === 'extension-view') &&
                (now.active !== activeId || now.activeVisit !== activeVisit || now.tabs[activeId]?.location !== location)) {
              return;
            }

            void hostConnections.actions.switchTab(activeId, key);
          },
        }),
  );

  const choose = (id: string, event: ModifierEvent | undefined): void => {
    if (railPlugin === undefined) {
      return;
    }

    const extension = mount.group?.leaves.find(leaf => leaf.node.id === id);
    if (extension) {
      const { placement, scope } = mount;
      if (!authority || !placement || scope === undefined || shown?.phase !== 'ready' || !sidebarLocation) {
        return;
      }

      const target = leafRoute(shown, extension, scope);
      openView(target, dispositionOf(event, { platform, plain: 'here' }), 'sidebar', () =>
        plugins.getSnapshot().find(entry => entry.id === railPlugin) === shown &&
        sidebarScope(shown, sidebarLocation, hostConnections?.store.getSnapshot()) === scope &&
        authority.eligible(placement).includes(extension.binding) &&
        viewLeaf(authority, shown, target, sidebarNodes.get(shown.id))?.binding === extension.binding, origin);
      return;
    }

    // What the entry opens (KL5): the page its id names, as it always did, or the page and the parameters it names, or one of the plugin's connections. It is read among what the sidebar draws: what the hook answered, else the skeleton.
    const leaf = leafOf(published ?? (shown?.phase === 'ready' ? shown.contribution.sidebar.nodes : []), id);
    const read = leaf && readTarget(leaf);
    if ((!read || !('target' in read)) && id.startsWith(VIEW_NODE_PREFIX)) {
      return;
    }

    const target = read && 'target' in read ? read.target : { kind: 'page' as const, page: id, params: NO_PARAMS };
    if (target.kind === 'connection') {
      // As Home's rows and the palette open one: the host starts the connection first, and a start that fails or an open the window refuses is told in a notice. The modifiers of the click pick the tab as they do for a page.
      host.openers.sidebar({ kind: 'connection', plugin: railPlugin, connection: target.key }, event);
      return;
    }

    // The model's result is the answer: a destination that wants a window of its own (there is none) or that would discard unsaved changes (no page reports a draft yet) changes nothing.
    tabs.open({ route: { plugin: railPlugin, contribution: target.page, params: carried === undefined ? target.params : { ...target.params, connection: carried } } }, { how: dispositionOf(event, { platform }), source: 'sidebar' });
  };

  // An open that names no connection waits for the list of connections when it has not come back (rule R4): the plugin is never opened on a connection nobody chose, and a press that comes first is answered when the list is known. A plugin that
  // declares a landing (KL2) opens it with no list: the landing is what it opens, and says itself that it is reading the connections.
  const whenListed = (plugin: string, run: () => void): void => {
    const store = hostConnections?.store;
    if (store === undefined || store.getSnapshot().loaded || hasLanding(entries, plugin)) {
      run();
      return;
    }

    const stop = store.subscribe(() => {
      if (store.getSnapshot().loaded) {
        stop();
        run();
      }
    });
  };

  const newTab =
    railPlugin === undefined
      ? undefined
      : (after?: TabId) => {
        const home = host.contributions.home?.(railPlugin);
        if (home !== undefined) {
          whenListed(railPlugin, () => {
            tabs.open({ route: carried === undefined ? home : { ...home, params: { ...home.params, connection: carried } } }, { how: 'new', after, source: 'new-tab' });
          });
        }
      };

  const open = (plugin: string): void => {
    const home = host.contributions.home?.(plugin);
    if (home !== undefined) {
      whenListed(plugin, () => {
        tabs.open({ route: home }, { how: 'smart', source: 'home' });
      });
    }
  };

  // Home's rows: a plugin opens at its first page. A plugin with two or more connections and none used opens Home (`contributions.ts`, `complete`): when Home is already what is on screen that would change nothing, so the person is taken to the
  // plugin's connections instead, which is what the row was for, and told so; when the connections could not be read there is nothing to take them to, and they are told that.
  const openPlugin = (plugin: string, event: ModifierEvent | undefined): void => {
    const input = host.contributions.home?.(plugin);
    const home = input === undefined ? undefined : normaliseRoute(input);
    if (home === undefined) {
      return;
    }

    const how = dispositionOf(event, { platform });
    whenListed(plugin, () => {
      const target = host.contributions.complete?.(home, { from: route, source: 'home' }) ?? home;
      if (target.plugin === HOST_PLUGIN && route?.kind !== 'extension-view' && route?.plugin === HOST_PLUGIN && route.contribution === HOME_PAGE_ID) {
        const name = entries.find((candidate) => candidate.id === plugin)?.name ?? plugin;
        const listed = hostConnections?.store.getSnapshot();
        if (listed?.failed === true && listed.connections.length === 0) {
          host.notices.announcer.polite.announce(`The connections of ${name} could not be read.`);
        } else {
          // The rows of a Home that is kept but not on screen are drawn too, under a page that is not displayed: the first row of the page that is.
          [...document.querySelectorAll<HTMLElement>('[data-home-part="connection"]')].find((row) => row.dataset.homePlugin === plugin && row.closest<HTMLElement>('[data-page-slot]')?.style.display !== 'none')?.focus();
          host.notices.announcer.polite.announce(`Choose one of the connections of ${name}.`);
        }

        return;
      }

      tabs.open({ route: home }, { how, source: 'home' });
    });
  };

  // A plugin that did not load has no sidebar to show: choosing its entry opens its page, which names what happened and offers the Retry (as its row of the empty window does), and the rail's current
  // entry and the sidebar stay. Any other entry shows its plugin's sidebar.
  const selectRail = (id: string): void => {
    // A host page draws no sidebar for a plugin to take (the Plugins page lists its own): choosing a plugin on the rail opens it.
    if (route?.plugin === HOST_PLUGIN || entries.some((candidate) => candidate.id === id && candidate.phase === 'failed')) {
      open(id);
    } else {
      setChosen(id);
    }
  };

  // The panel. What each plugin that is ready brings to it is registered in a layout effect, in the commit the plugin turned ready in, so a tool does not arrive a frame after the interface it
  // belongs to; a plugin that goes away takes its tools and sessions with it in the same transaction (PO1).
  const { panel, logs, terminals, ports, panelHosts } = host;
  // The Logs tool is the host's: it is in the strip whatever the plugins are (the sessions that plugins open in it show when their plugin is ready). Registered before the plugins are, in the
  // first layout effect, so the strip is never drawn without it; registering it again changes nothing.
  useLayoutEffect(() => {
    panel.registerTool(LOGS_TOOL);
    panel.registerTool(TERMINAL_TOOL);
    // Ports, Problems and Operations are the host's tools too (ch16 S114): singletons, in the strip whatever the plugins are, between and after Terminal and Logs by their orders.
    panel.registerTool(PORTS_TOOL);
    panel.registerTool(PROBLEMS_TOOL);
    panel.registerTool(OPERATIONS_TOOL);
  }, [panel]);
  useLayoutEffect(() => {
    panel.syncPlugins(panelPluginsOf(entries));
  }, [panel, entries]);
  // The feeds of the Logs sessions belong to the host from the moment a plugin hands over a target: they are released with the session, with the plugin, and with the window.
  useEffect(() => logs.attach(), [logs]);
  // The terminals are the host's too: each process is released with its session, with its plugin, and with the window.
  useEffect(() => terminals.attach(), [terminals]);
  // The items of the native menu (`backend/menus`) arrive as the app event `menu/command`, with a host command id, at every window: the one that has the focus runs the command as the palette runs a chosen row, unless the palette or the question a close of a running terminal asks is open (a modal keeps
  // the window's chords from what is behind it: the same condition that holds the toasts' timers), and says why when it cannot. A browser tab has no window service and listens to nothing.
  useEffect(
    () =>
      windows?.on('menu/command', (id) => {
        if (typeof id !== 'string' || !document.hasFocus() || host.palette.store.getSnapshot().open || host.terminals.modal.open()) {
          return;
        }

        void Promise.resolve(host.palette.run({ id })).then((outcome) => {
          if (typeof outcome === 'object' && outcome.ok === false) {
            host.notices.announcer.polite.announce(outcome.reason ?? 'It could not run.');
          }
        });
      }),
    [windows, host],
  );
  // What the two tools list is read from the producers the window already holds, and kept true by their events for as long as the window is on screen (`panelTools.ts`).
  useEffect(() => attachPanelTools({ plugins, connections: host.connections?.store, feed: host.feed, problems: host.problems, operations: host.operations, resolve: host.resolve }), [plugins, host]);
  // Command K clears a terminal that has the focus (VS Code and JetBrains agree) and is also the palette's chord: a layout effect runs before every passive one, so this listener is the window's first and sees the key first.
  useLayoutEffect(() => terminals.takeKeys(), [terminals]);
  const bindings = useMemo<PanelBindings>(
    () => ({
      store: terminals.store,
      terminalMenu: host.terminalMenu?.open,
      terminalMenuContent: host.terminalMenu && <TerminalMenuContent menu={host.terminalMenu} />,
      renderBody: (session, visible) => {
        if (session.tool === TERMINAL_TOOL_ID) {
          return terminalBodyOf(terminals, session, visible);
        }

        return session.tool === LOGS_TOOL_ID ? logsBodyOf(logs, session, visible) : panelBodyOf(entries, session, visible);
      },
      // The Logs card is the host's, completed member by member by what the plugin says for the sessions it opens there (`panel.sessions.logs.card`): the plugin's words win over the host's.
      cardOf: (session) => {
        if (session.tool === TERMINAL_TOOL_ID) {
          return terminals.cardOf(session);
        }

        const given = cardOfSession(entries, session);
        return session.tool === LOGS_TOOL_ID ? completeLogCard(logCardOf(session, logs.recordOf(session.id)), given) : given;
      },
      emptyOf: (toolId) => {
        if (toolId === TERMINAL_TOOL_ID) {
          return terminals.empty;
        }

        return toolId === LOGS_TOOL_ID ? LOGS_EMPTY : undefined;
      },
      // Ports, Problems and Operations have no sessions (S114): the host draws their bodies, only while the tool is on screen, each in a boundary of its own so a body that throws loses that tool and no other.
      renderTool: (toolId) => {
        if (toolId === PORTS_TOOL_ID) {
          return portsBodyOf(ports);
        }

        if (toolId === PROBLEMS_TOOL_ID) {
          return (
            <ContributionBoundary name="problems tool" fallback={(retry) => <ErrorBody title="Couldn't show Problems" onRetry={retry} />}>
              <ProblemsBody problems={host.problems} open={host.openers.problems} />
            </ContributionBoundary>
          );
        }

        return toolId === OPERATIONS_TOOL_ID ? (
          <ContributionBoundary name="operations tool" fallback={(retry) => <ErrorBody title="Couldn't show Operations" onRetry={retry} />}>
            <OperationsBody operations={host.operations} open={host.openers.operations} />
          </ContributionBoundary>
        ) : undefined;
      },
      badges: host.toolBadges,
      newSessionOf: (toolId) => {
        if (toolId === TERMINAL_TOOL_ID) {
          return terminals.newSession;
        }

        return newSessionOf(entries, toolId, (input) => {
          const opened = panel.openSession(input);
          if (opened.status === 'refused') {
            console.warn(`[panel] a session was refused: ${opened.message}`);
          }
        });
      },
      stopOf: (id) => terminals.sessions.stopOf(id) ?? logs.stopOf(id),
      linkOf: (route) => ({
        href: routeAddressOf(route),
        open: (activation) => {
          // The model's answer is not the card's to report: a refusal changes nothing, and the card closes on the click either way.
          tabs.open({ route }, { how: dispositionOf(activation, { platform }), source: 'panel' });
        },
      }),
    }),
    [panel, logs, terminals, ports, entries, tabs, platform, host],
  );

  const sidebar = shown?.phase === 'ready' ? shown.contribution.sidebar : undefined;
  return (
    <ExtensionMenuNavigationContext.Provider value={menuNavigation}>
      {verifiedTree && shown?.phase === 'ready' && railRoute !== undefined && sidebar?.useNodes !== undefined ? (
        <ContributionBoundary key={shown.id} name={`${shown.id} sidebar`} fallback={() => <NoNodes plugin={shown.id} nodes={sidebarNodes} />}>
          <NodesSource plugin={shown.id} route={railRoute} useNodes={sidebar.useNodes} nodes={sidebarNodes} open={host.sidebarOpen} panelHost={panelHosts(shown.id, bare ? undefined : railConnection)} connections={host.connectionsHosts(shown.id)} />
        </ContributionBoundary>
      ) : null}
      <Shell
        registration={registrationOf({ entries, coming, waiting, held, route, lane, frame, rail, failed, railPlugin, nodes: verifiedTree ? published : undefined, bare, group: mount.group })}
        tabs={tabs}
        pageKey={(tab: PageTab) => pageKeyOf(entries, tab)}
        renderPage={(tab: PageTab) => tab.location.route.kind === 'extension-view'
          ? tab.id === activeId ? <MountedLocation key={`${activeVisit}:${selection}`} route={tab.location.route} entry={entries.find(entry => entry.id === tab.location.route.plugin)} tabId={tab.id} host={host}
            inventory={inventory} pluginName={tabs.selectors.face(tabs.getSnapshot(), tab.id)?.pluginName ?? ''} onRetry={onRetry} onRetryInventory={onRetryInventory} /> : null
          : (
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
              connectionsHosts={host.connectionsHosts}
              connections={hostConnections}
              openPlugin={openPlugin}
              source={plugins}
            />
          )}
        empty={emptyOf({ entries, coming, inventory, onRetryInventory, onOpen: open, plugins, connections: hostConnections })}
        onChoose={choose}
        onSidebarOpen={host.reportSidebarOpen}
        onSelectRail={selectRail}
        onNewTab={newTab}
        onCloseWindow={onCloseWindow}
        panel={bindings}
        palette={host.palette}
        notices={host.notices}
        settings={host.settings}
      />
      {navigationDialog}
      {terminals.prompt}
      {host.verbs === undefined ? null : <ConnectionQuestion questions={host.verbs.questions} />}
    </ExtensionMenuNavigationContext.Provider>
  );
}
