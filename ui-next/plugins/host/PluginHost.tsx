import { LinkProvider, type PageHeaderCrumb } from '@omniviewdev/kit';
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DetailPage, ListPage } from '../../page';
import { createTabsStore, dispositionOf, platformOf, Shell, type Contributions, type ModifierEvent, type PageTab, type Route, type ShellRegistration, type ShellSidebar, type TabsStore } from '../../shell';
import { openable } from '../contract/admit';
import type { ContextV1, ContributionV1, FrameV1, SidebarNodeV1 } from '../contract/v1';
import { ContributionBoundary } from './ContributionBoundary';
import { connectionOf, createContributions, describeDetail, HOME_PAGE, routeKey, textParamsOf, type PluginSource } from './contributions';
import { createLinkHandler } from './links';
import { PlaceholderPage } from './PlaceholderPage';
import type { PluginEntry } from './pluginStore';
import { Published } from './published';
import { NO_PARAMS, type HostRoute } from './route';

// The host of contributed pages: given what each installed plugin's interface came to (`PluginStore`), it drives the shell's tab model with them. A tab is a route in a plugin; the model asks
// the host what a route is called (`contributions.ts`) and the host draws each mounted tab's page, the list page for the plugin's contribution, or the kit's collection state where there
// is no page to draw. The registration the shell reads is built here from the contribution (the plugin never imports the shell); the contribution's hooks run here, each page's inside its
// own tab's component and its own error boundary, so a plugin that throws loses its page or its sidebar entries and the frame, the other tabs and the other plugins stay
// (docs/ui-next/slices/n19-plugin-seam.md, 2.4). The window does not wait for plugins: until one has loaded the frame is drawn with its regions reserved, and nothing moves when it registers.

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
};

type Host = {
  readonly frames: Published<FrameV1>;
  readonly nodes: Published<readonly SidebarNodeV1[] | null>;
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

/** The sidebar as the shell reads it: the contribution's words, the nodes that open a page, and the page on screen as current. */
function sidebarOf(contribution: ContributionV1, nodes: readonly SidebarNodeV1[], current: string): ShellSidebar {
  const { label, title } = contribution.sidebar;
  return { label, title, nodes: openable(nodes, contribution.pages), current, accent: contribution.plugin.accent };
}

type FrameInputs = {
  readonly entries: readonly PluginEntry[];
  readonly inventory: PluginHostProps['inventory'];
  readonly waiting: boolean;
  readonly route: Route | undefined;
  readonly frame: FrameV1 | undefined;
  readonly nodes: readonly SidebarNodeV1[] | null | undefined;
};

/**
 * What the shell draws around the tab on screen. While the plugin it belongs to is loading (or the window has no tab yet and a plugin is on its way) the frame is pending: its regions are
 * reserved, so the plugin's frame lands in the rectangles they hold. A plugin that did not load, or none installed, is drawn bare: there is nothing to reserve for.
 */
function registrationOf({ entries, inventory, waiting, route, frame, nodes }: FrameInputs): ShellRegistration {
  const entry = route === undefined ? undefined : entries.find((candidate) => candidate.id === route.plugin);
  if (route === undefined || entry === undefined) {
    const loading = entries.find((candidate) => candidate.phase === 'loading');
    const coming = inventory === 'loading' || loading !== undefined || waiting;
    return { plugin: { name: loading?.name ?? 'Omniview' }, layout: 'pane', ...(coming ? { pending: true as const } : {}) };
  }

  if (entry.phase === 'loading') {
    return { plugin: { name: entry.name }, layout: 'pane', pending: true };
  }

  if (entry.phase === 'failed') {
    return { plugin: { name: entry.name }, layout: 'pane' };
  }

  const { contribution } = entry;
  const pageId = Object.hasOwn(contribution.pages, route.contribution) ? route.contribution : contribution.home;
  const page = contribution.pages[pageId];
  const detail = page?.kind === 'detail' ? page : undefined;
  return {
    plugin: { name: contribution.plugin.name },
    rail: contribution.rail,
    // A detail page is a document: the page scrolls, header and body together (ch16 S15). A list owns its own scrolling.
    layout: detail === undefined ? 'pane' : 'document',
    // The entry that stays selected while an object is open is the list it belongs to.
    sidebar: sidebarOf(contribution, nodes ?? contribution.sidebar.nodes, detail?.definition.list?.page ?? pageId),
    scope: frame?.scope,
  };
}

/** What the island shows while there is no tab: the plugins' own states, in the host's words. */
function emptyOf({ entries, inventory, onRetryInventory }: Pick<FrameInputs, 'entries' | 'inventory'> & Pick<PluginHostProps, 'onRetryInventory'>): ReactNode {
  if (entries.length === 0) {
    if (inventory === 'failed') {
      return <PlaceholderPage title="Plugins" state={{ kind: 'failed', message: 'The list of installed plugins could not be read.', retry: onRetryInventory }} />;
    }

    return <PlaceholderPage title="Plugins" state={inventory === 'loading' ? { kind: 'loading' } : { kind: 'ready' }} empty={inventory === 'ready'} />;
  }

  return <PlaceholderPage title={entries.find((entry) => entry.phase === 'loading')?.name ?? 'Plugins'} state={{ kind: 'loading' }} />;
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
  const page = Object.hasOwn(contribution.pages, route.contribution) ? route.contribution : contribution.home;
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

/** Runs the sidebar's data hook for the plugin on screen, and publishes what it answers: nothing until it answers, and the skeleton stands. It draws nothing. */
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

export function PluginHost({ plugins, inventory, link, onRetry, onRetryInventory }: PluginHostProps) {
  const entries = useSyncExternalStore(plugins.subscribe, plugins.getSnapshot);
  const [host] = useState(() => createHost(plugins, link));
  const [platform] = useState(() => platformOf(navigator));
  // A link at load waits for its plugin, so the window does not open its home page over it; each distinct link opens once. Where it stands is the host's (an external store), not state of
  // this component: opening it is the effect's whole job.
  const { tabs, frames, nodes, opened } = host;
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
  const entry = route === undefined ? undefined : entries.find((candidate) => candidate.id === route.plugin);
  const key = route === undefined ? undefined : routeKey(route);
  const frame = useSyncExternalStore(frames.subscribe, () => (key === undefined ? undefined : frames.get(key)));
  const published = useSyncExternalStore(nodes.subscribe, () => (entry === undefined ? undefined : nodes.get(entry.id)));

  const choose = (id: string, event: ModifierEvent | undefined): void => {
    if (route !== undefined) {
      // The model's result is the answer: a destination that wants a window of its own (there is none) or that would discard unsaved changes (no page reports a draft yet) changes nothing.
      tabs.open({ route: { plugin: route.plugin, contribution: id } }, { how: dispositionOf(event, { platform }), source: 'sidebar' });
    }
  };

  const newTab =
    route === undefined
      ? undefined
      : () => {
        const home = host.contributions.home?.(route.plugin);
        if (home !== undefined) {
          tabs.open({ route: home }, { how: 'new', source: 'new-tab' });
        }
      };

  const sidebar = entry?.phase === 'ready' ? entry.contribution.sidebar : undefined;
  return (
    <>
      {entry?.phase === 'ready' && route !== undefined && sidebar?.useNodes !== undefined ? (
        <ContributionBoundary key={entry.id} name={`${entry.id} sidebar`} fallback={() => <NoNodes plugin={entry.id} nodes={nodes} />}>
          <NodesSource plugin={entry.id} route={route} useNodes={sidebar.useNodes} nodes={nodes} />
        </ContributionBoundary>
      ) : null}
      <Shell
        registration={registrationOf({ entries, inventory, waiting, route, frame, nodes: published })}
        tabs={tabs}
        renderPage={(tab: PageTab) => <HostPage entries={entries} route={tab.location.route} frames={frames} tabs={tabs} platform={platform} onRetry={onRetry} />}
        empty={emptyOf({ entries, inventory, onRetryInventory })}
        onChoose={choose}
        onNewTab={newTab}
      />
    </>
  );
}
