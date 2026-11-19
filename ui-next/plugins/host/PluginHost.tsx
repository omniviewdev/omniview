import { LinkProvider, type PageHeaderCrumb } from '@omniviewdev/kit';
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DetailPage, ListPage } from '../../page';
import { createTabsStore, dispositionOf, platformOf, Shell, type Contributions, type ModifierEvent, type PageTab, type Route, type ShellRail, type ShellRegistration, type ShellSidebar, type TabsStore } from '../../shell';
import { openable } from '../contract/admit';
import type { ContextV1, ContributionV1, FrameV1, SidebarNodeV1 } from '../contract/v1';
import { ContributionBoundary } from './ContributionBoundary';
import { connectionOf, createContributions, describeDetail, HOME_PAGE, routeKey, textParamsOf, type PluginSource } from './contributions';
import { createLinkHandler } from './links';
import { homeEntriesOf, NoTabs } from './NoTabs';
import { PlaceholderPage } from './PlaceholderPage';
import type { PluginEntry } from './pluginStore';
import { Published } from './published';
import { currentRail, railOf, type RailEntry } from './rail';
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
};

type Host = {
  readonly frames: Published<FrameV1>;
  readonly nodes: Published<readonly SidebarNodeV1[] | null>;
  /** The route each plugin was last shown at, by plugin: where its sidebar picks up when the rail shows it while another plugin's tab is on screen. */
  readonly routes: Published<Route>;
  readonly tabs: TabsStore;
  readonly contributions: Contributions;
  /** The request at the address the window last opened, by key: a link opens once, however often the plugins change. */
  readonly opened: Published<string>;
  /** Lets the window open its home page: the link at load found its plugin. */
  readonly release: () => void;
};

/** The tab model of a window, over its plugins. It lives as long as the window does. */
function createHost(plugins: PluginSource, link: HostRoute): Host {
  const frames = new Published<FrameV1>();
  const nodes = new Published<readonly SidebarNodeV1[] | null>();
  const hold = { held: link.plugin !== undefined };
  const contributions = createContributions({ plugins, frames, holdHome: () => hold.held });
  return {
    frames,
    nodes,
    routes: new Published<Route>(),
    tabs: createTabsStore({ contributions }),
    contributions,
    opened: new Published<string>(),
    release: () => {
      hold.held = false;
    },
  };
}

/** The route of the tab on screen: the same object until the tab moves. */
function activeRoute(tabs: TabsStore): Route | undefined {
  const state = tabs.getSnapshot();
  return state.active === null ? undefined : tabs.selectors.location(state, state.active)?.route;
}

/** The sidebar as the shell reads it: the contribution's words, the nodes that open a page, and the page on screen as current, when it is this plugin's. */
function sidebarOf(contribution: ContributionV1, nodes: readonly SidebarNodeV1[], current: string | undefined): ShellSidebar {
  const { label, title } = contribution.sidebar;
  return { label, title, nodes: openable(nodes, contribution.pages), current, accent: contribution.plugin.accent };
}

type FrameInputs = {
  readonly entries: readonly PluginEntry[];
  /** The window is waiting for something before it has a first tab: the inventory, a plugin's interface, or the plugin a link names. */
  readonly coming: boolean;
  /** The route of the tab on screen. */
  readonly route: Route | undefined;
  readonly frame: FrameV1 | undefined;
  /** The plugins that contribute, in the order of the rail, and the one whose sidebar shows (none while the window is coming and has no tab: there is nothing to anchor it to yet). */
  readonly rail: readonly RailEntry[];
  readonly railPlugin: string | undefined;
  /** What the sidebar's data hook of the plugin on the rail answered: nothing until it does, and the contribution's skeleton stands. */
  readonly nodes: readonly SidebarNodeV1[] | null | undefined;
};

/** The page of a contribution a route names, as the host draws it: the plugin's own first page for one it does not have. */
const pageOf = (contribution: ContributionV1, route: Route): string => (Object.hasOwn(contribution.pages, route.contribution) ? route.contribution : contribution.home);

/**
 * What the shell draws around the tab on screen. The island, the lane and the landmarks follow the tab on screen: while its plugin is loading (or the window has no tab yet and one is on
 * its way) the frame is pending, its regions reserved, so the plugin's frame lands in the rectangles they hold; a plugin that did not load is drawn bare. The rail and the sidebar follow
 * the rail: every plugin that contributes has an entry, and the sidebar is the current entry's, with the page on screen current in it when it is that plugin's. With no plugin that
 * contributes there is nothing to reserve for and nothing to show: the frame is bare.
 */
function registrationOf({ entries, coming, route, frame, rail, railPlugin, nodes }: FrameInputs): ShellRegistration {
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
  const railData: ShellRail | undefined = railPlugin === undefined || rail.length === 0 ? undefined : { label: 'Plugins', entries: rail.map(({ id, label, icon }) => ({ id, label, icon })), current: railPlugin };

  if (route === undefined || active === undefined) {
    // No tab, or a tab of a plugin the host does not have (its page says so). With no tab the window is loading, or it is empty: the empty window is a document (the home content), loading is
    // a collection state (the kit's loading skeleton).
    const empty = route === undefined && !coming && entries.length > 0;
    return { plugin: { name: loading?.name ?? 'Omniview' }, layout: empty ? 'document' : 'pane', ...(coming ? { pending: true as const } : {}), rail: railData, sidebar };
  }

  if (active.phase === 'loading') {
    return { plugin: { name: active.name }, layout: 'pane', pending: true, rail: railData, sidebar };
  }

  if (active.phase === 'failed') {
    return { plugin: { name: active.name }, layout: 'pane', rail: railData, sidebar };
  }

  const { contribution } = active;
  const page = contribution.pages[pageOf(contribution, route)];
  return {
    plugin: { name: contribution.plugin.name },
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
};

/** The page's own component: its data hook runs here, in its tab's own subtree, and what the hook says about the frame is published for the frame and the tab to read. */
function ListContribution({ entry, route, page: pageId, frames }: ListProps) {
  const page = entry.contribution.pages[pageId];
  if (page?.kind !== 'list') {
    throw new Error(`The plugin has no list page "${pageId}"`);
  }

  const connection = connectionOf(route);
  // A list page's route has no parameters of its own (`RouteV1.params`): what an address adds to one is not an identity the page reads, so its hook is told none.
  const context = useMemo<ContextV1>(() => ({ plugin: entry.id, route: { page: pageId, connection, params: NO_PARAMS } }), [entry.id, pageId, connection]);
  const { frame, source } = page.usePage(context);
  // Before the first paint, so the scope lane and the tab's words are there with the page; a frame equal to the one held changes nothing.
  useLayoutEffect(() => {
    frames.publish(routeKey(route), frame);
  }, [frames, route, frame]);

  return <ListPage definition={page.definition} source={source} />;
}

type DetailProps = {
  readonly entry: PluginEntry & { readonly phase: 'ready' };
  readonly route: Route;
  readonly page: string;
  readonly frames: Published<FrameV1>;
  readonly tabs: TabsStore;
};

/**
 * The detail page's own component, as the list's: its data hook runs here with the route's parameters, and the scope lane's faces it answers are published for the frame to read. The tab's
 * title, glyph and path are not the hook's: they are the route's and the definition's (`describeDetail`), the same before this component has run. The back path above the heading is
 * the same path, its parents links that open in place.
 */
function DetailContribution({ entry, route, page: pageId, frames, tabs }: DetailProps) {
  const page = entry.contribution.pages[pageId];
  if (page?.kind !== 'detail') {
    throw new Error(`The plugin has no detail page "${pageId}"`);
  }

  const connection = connectionOf(route);
  const params = useMemo(() => textParamsOf(route), [route]);
  const context = useMemo<ContextV1>(() => ({ plugin: entry.id, route: { page: pageId, connection, params } }), [entry.id, pageId, connection, params]);
  const { scope, source } = page.usePage(context);
  const { definition } = page;
  const pluginName = entry.contribution.plugin.name;
  const face = useMemo(() => describeDetail(pluginName, route, definition), [pluginName, route, definition]);
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
  readonly frames: Published<FrameV1>;
  readonly tabs: TabsStore;
  readonly platform: 'mac' | 'other';
  readonly onRetry: (id: string) => void;
};

/** One tab's page: the plugin's, in its own boundary and with its links, or the state the plugin is in. */
function HostPage({ entries, route, frames, tabs, platform, onRetry }: HostPageProps) {
  // The links of the page open where the page is: its plugin, and the connection it is read in. The handler changes only when the page moves.
  const connection = connectionOf(route);
  const handler = useMemo(() => createLinkHandler({ tabs, platform, plugin: route.plugin, connection }), [tabs, platform, route.plugin, connection]);
  const entry = entries.find((candidate) => candidate.id === route.plugin);
  if (entry === undefined) {
    return <PlaceholderPage title={route.plugin} state={{ kind: 'failed', message: 'This plugin is not installed, or is turned off.' }} />;
  }

  if (entry.phase === 'loading') {
    return <PlaceholderPage title={entry.name} state={{ kind: 'loading' }} />;
  }

  if (entry.phase === 'failed') {
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
          <DetailContribution entry={entry} route={route} page={page} frames={frames} tabs={tabs} />
        ) : (
          <ListContribution entry={entry} route={route} page={page} frames={frames} />
        )}
      </ContributionBoundary>
    </LinkProvider>
  );
}

type NodesProps = {
  readonly plugin: string;
  readonly route: Route;
  readonly useNodes: (context: ContextV1) => readonly SidebarNodeV1[] | undefined;
  readonly nodes: Published<readonly SidebarNodeV1[] | null>;
};

/** Runs the sidebar's data hook for the plugin on the rail, and publishes what it answers: nothing until it answers, and the skeleton stands. It draws nothing. */
function NodesSource({ plugin, route, useNodes, nodes }: NodesProps) {
  const page = route.contribution;
  const connection = connectionOf(route);
  const answer = useNodes(useMemo<ContextV1>(() => ({ plugin, route: { page, connection, params: NO_PARAMS } }), [plugin, page, connection]));
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

export function PluginHost({ plugins, inventory, link, onRetry, onRetryInventory, onCloseWindow }: PluginHostProps) {
  const entries = useSyncExternalStore(plugins.subscribe, plugins.getSnapshot);
  const [host] = useState(() => createHost(plugins, link));
  const [platform] = useState(() => platformOf(navigator));
  // A link at load waits for its plugin, so the window does not open its home page over it; each distinct link opens once. Where it stands is the host's (an external store), not state of
  // this component: opening it is the effect's whole job.
  const { tabs, frames, nodes, routes, opened } = host;
  const linkKey = link.plugin === undefined ? undefined : JSON.stringify([link.plugin, link.page, link.connection, link.params]);
  const waiting = useSyncExternalStore(opened.subscribe, () => linkKey !== undefined && opened.get('link') !== linkKey);
  const known = link.plugin !== undefined && entries.some((entry) => entry.id === link.plugin);
  // Whether the screen has had its turn since the inventory came in: its effect hands the plugins to the store after this component's, so a link looked at in the commit the inventory
  // arrives in would find its plugin missing and be refused for good.
  const settled = useSyncExternalStore(opened.subscribe, () => opened.get('settled') === 'yes');

  useEffect(() => {
    if (link.plugin === undefined || linkKey === undefined) {
      // No link, or it was cleared while an unknown one was waited for: nothing holds the window back from opening its home page.
      host.release();
      tabs.refresh();
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
    host.release();
    tabs.open({ route: { plugin: link.plugin, contribution: link.page ?? HOME_PAGE, params: { ...link.params, connection: link.connection } } }, { how: 'smart', source: 'link' });
    // The window opens its home page when the link opened nothing.
    tabs.refresh();
  }, [host, tabs, opened, link.plugin, link.page, link.connection, link.params, linkKey, known, inventory, settled]);

  const route = useSyncExternalStore(tabs.subscribe, () => activeRoute(tabs));
  const activeId = useSyncExternalStore(tabs.subscribe, () => tabs.getSnapshot().active);
  const rail = railOf(entries);

  // The rail's current entry. The user's choice stands until the tab on screen changes: activating another tab, or moving the tab on screen to another plugin, makes that plugin current
  // (state kept from the render before, the way React keeps a value derived from what changed). With no tab on screen the choice stands as it was.
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [followed, setFollowed] = useState<string | undefined>(undefined);
  const follow = activeId === null || route === undefined ? undefined : `${activeId}\u0000${route.plugin}`;
  if (follow !== followed) {
    setFollowed(follow);
    if (route !== undefined) {
      setChosen(route.plugin);
    }
  }

  // Until the window has a tab, or has settled with none, there is nothing to anchor a sidebar to: a plugin chosen by guess would run its hooks and then be replaced by the one the first tab opens.
  const coming = inventory === 'loading' || entries.some((entry) => entry.phase === 'loading') || waiting;
  const railPlugin = route === undefined && coming ? undefined : currentRail(rail, chosen, route?.plugin);
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

  const sidebar = shown?.phase === 'ready' ? shown.contribution.sidebar : undefined;
  return (
    <>
      {shown?.phase === 'ready' && railRoute !== undefined && sidebar?.useNodes !== undefined ? (
        <ContributionBoundary key={shown.id} name={`${shown.id} sidebar`} fallback={() => <NoNodes plugin={shown.id} nodes={nodes} />}>
          <NodesSource plugin={shown.id} route={railRoute} useNodes={sidebar.useNodes} nodes={nodes} />
        </ContributionBoundary>
      ) : null}
      <Shell
        registration={registrationOf({ entries, coming, route, frame, rail, railPlugin, nodes: published })}
        tabs={tabs}
        renderPage={(tab: PageTab) => <HostPage entries={entries} route={tab.location.route} frames={frames} tabs={tabs} platform={platform} onRetry={onRetry} />}
        empty={emptyOf({ entries, coming, inventory, onRetryInventory, onOpen: open })}
        onChoose={choose}
        onSelectRail={setChosen}
        onNewTab={newTab}
        onCloseWindow={onCloseWindow}
      />
    </>
  );
}
