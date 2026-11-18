import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ListPage } from '../../page';
import { createTabsStore, dispositionOf, platformOf, Shell, type Contributions, type ModifierEvent, type PageTab, type Route, type ShellRegistration, type ShellSidebar, type TabsStore } from '../../shell';
import { openable } from '../contract/admit';
import type { ContextV1, ContributionV1, FrameV1, SidebarNodeV1 } from '../contract/v1';
import { ContributionBoundary } from './ContributionBoundary';
import { connectionOf, createContributions, HOME_PAGE, routeKey, type PluginSource } from './contributions';
import { PlaceholderPage } from './PlaceholderPage';
import type { PluginEntry } from './pluginStore';
import { Published } from './published';
import type { HostRoute } from './route';

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
  return {
    plugin: { name: contribution.plugin.name },
    rail: contribution.rail,
    layout: 'pane',
    sidebar: sidebarOf(contribution, nodes ?? contribution.sidebar.nodes, Object.hasOwn(contribution.pages, route.contribution) ? route.contribution : contribution.home),
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
  if (page === undefined) {
    throw new Error(`The plugin has no page "${pageId}"`);
  }

  const connection = connectionOf(route);
  const context = useMemo<ContextV1>(() => ({ plugin: entry.id, route: { page: pageId, connection } }), [entry.id, pageId, connection]);
  const { frame, source } = page.usePage(context);
  // Before the first paint, so the scope lane and the tab's words are there with the page; a frame equal to the one held changes nothing.
  useLayoutEffect(() => {
    frames.publish(routeKey(route), frame);
  }, [frames, route, frame]);

  return <ListPage definition={page.definition} source={source} />;
}

type HostPageProps = {
  readonly entries: readonly PluginEntry[];
  readonly route: Route;
  readonly frames: Published<FrameV1>;
  readonly onRetry: (id: string) => void;
};

/** One tab's page: the plugin's, in its own boundary, or the state the plugin is in. */
function HostPage({ entries, route, frames, onRetry }: HostPageProps) {
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
  const title = contribution.pages[page]?.definition.title ?? entry.name;
  return (
    <ContributionBoundary
      name={`${entry.id} page ${page}`}
      resetKey={page}
      fallback={(retry) => <PlaceholderPage title={title} state={{ kind: 'failed', message: 'This page failed to display.', retry }} />}
    >
      <ListContribution entry={entry} route={route} page={page} frames={frames} />
    </ContributionBoundary>
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
  const answer = useNodes(useMemo<ContextV1>(() => ({ plugin, route: { page, connection } }), [plugin, page, connection]));
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
  const linkKey = link.plugin === undefined ? undefined : JSON.stringify([link.plugin, link.page, link.connection]);
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
    tabs.open({ route: { plugin: link.plugin, contribution: link.page ?? HOME_PAGE, params: { connection: link.connection } } }, { how: 'smart', source: 'link' });
    // The window opens its home page when the link opened nothing.
    tabs.refresh();
  }, [host, tabs, opened, link.plugin, link.page, link.connection, linkKey, known, inventory, settled]);

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
        renderPage={(tab: PageTab) => <HostPage entries={entries} route={tab.location.route} frames={frames} onRetry={onRetry} />}
        empty={emptyOf({ entries, inventory, onRetryInventory })}
        onChoose={choose}
        onNewTab={newTab}
      />
    </>
  );
}
