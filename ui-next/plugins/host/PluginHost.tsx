import { useMemo, type ReactElement } from 'react';
import { ListPage } from '../../page';
import { Shell, type ShellSidebar } from '../../shell';
import { openable } from '../contract/admit';
import type { ContextV1, ContributionV1, SidebarNodeV1 } from '../contract/v1';
import { ContributionBoundary } from './ContributionBoundary';
import { PlaceholderFrame } from './PlaceholderFrame';
import type { PluginEntry } from './pluginStore';
import type { HostRoute } from './route';

// The host of contributed pages: given what each installed plugin's interface came to (`PluginStore`) and the route, it draws the shell and the list page
// for the plugin's page, or the kit's collection state where there is no page to draw. The registration the shell reads is built here from the contribution
// (the plugin never imports the shell); the contribution's hooks run here, each inside its own error boundary, so a plugin that throws loses its page or
// its sidebar entries and the frame, the other pages and the other plugins stay (docs/ui-next/slices/n19-plugin-seam.md, 2.4).

export type PluginHostProps = {
  /** Every installed plugin the host has started to load, by id. */
  readonly entries: readonly PluginEntry[];
  /** Whether the list of installed plugins itself was read. */
  readonly inventory: 'loading' | 'ready' | 'failed';
  readonly route: HostRoute;
  readonly onNavigate: (route: HostRoute) => void;
  /** Loads a plugin's interface again from its files. */
  readonly onRetry: (id: string) => void;
  /** Asks again for the list of installed plugins. */
  readonly onRetryInventory: () => void;
};

type FrameProps = {
  readonly entry: PluginEntry & { readonly phase: 'ready' };
  readonly route: HostRoute;
  readonly onNavigate: (route: HostRoute) => void;
};

/** The sidebar as the shell reads it: the contribution's words, the nodes that open a page, and the page on screen as current. */
function sidebarOf(contribution: ContributionV1, nodes: readonly SidebarNodeV1[], current: string): ShellSidebar {
  const { label, title } = contribution.sidebar;
  return { label, title, nodes: openable(nodes, contribution.pages), current, accent: contribution.plugin.accent };
}

type PageProps = {
  readonly entry: PluginEntry & { readonly phase: 'ready' };
  readonly pageId: string;
  readonly nodes: readonly SidebarNodeV1[];
  readonly context: ContextV1;
  readonly onChoose: (id: string) => void;
};

/** The page's own component: its data hook runs here, above the shell, because the frame it hands back is what the shell registers. */
function ListContribution({ entry, pageId, nodes, context, onChoose }: PageProps) {
  const { contribution } = entry;
  const page = contribution.pages[pageId];
  if (page === undefined) {
    throw new Error(`The plugin has no page "${pageId}"`);
  }

  const { frame, source } = page.usePage(context);
  return (
    <Shell
      registration={{
        plugin: { name: contribution.plugin.name },
        tab: frame.tab,
        path: frame.path,
        rail: contribution.rail,
        layout: 'pane',
        sidebar: sidebarOf(contribution, nodes, pageId),
        scope: frame.scope,
      }}
      onChoose={onChoose}
    >
      <ListPage definition={page.definition} source={source} />
    </Shell>
  );
}

function PageSlot({ entry, pageId, nodes, context, onChoose }: PageProps) {
  const { contribution } = entry;
  const title = contribution.pages[pageId]?.definition.title ?? entry.name;
  return (
    <ContributionBoundary
      name={`${entry.id} page ${pageId}`}
      resetKey={pageId}
      fallback={(retry) => (
        <PlaceholderFrame
          pluginName={contribution.plugin.name}
          title={title}
          state={{ kind: 'failed', message: 'This page failed to display.', retry }}
          sidebar={sidebarOf(contribution, nodes, pageId)}
          onChoose={onChoose}
        />
      )}
    >
      <ListContribution key={pageId} entry={entry} pageId={pageId} nodes={nodes} context={context} onChoose={onChoose} />
    </ContributionBoundary>
  );
}

type DynamicSidebarProps = {
  readonly useNodes: (context: ContextV1) => readonly SidebarNodeV1[] | undefined;
  readonly context: ContextV1;
  readonly skeleton: readonly SidebarNodeV1[];
  readonly children: (nodes: readonly SidebarNodeV1[]) => ReactElement;
};

/** Runs the sidebar's data hook. Until it answers, the skeleton stands. */
function DynamicSidebar({ useNodes, context, skeleton, children }: DynamicSidebarProps) {
  return children(useNodes(context) ?? skeleton);
}

function ContributionFrame({ entry, route, onNavigate }: FrameProps) {
  const { contribution } = entry;
  const pageId = route.page !== undefined && Object.hasOwn(contribution.pages, route.page) ? route.page : contribution.home;
  const context = useMemo<ContextV1>(() => ({ plugin: entry.id, route: { page: pageId, connection: route.connection } }), [entry.id, pageId, route.connection]);
  const onChoose = (id: string): void => {
    onNavigate({ plugin: entry.id, page: id, connection: route.connection });
  };

  const skeleton = contribution.sidebar.nodes;
  const slot = (nodes: readonly SidebarNodeV1[]): ReactElement => <PageSlot entry={entry} pageId={pageId} nodes={nodes} context={context} onChoose={onChoose} />;
  const { useNodes } = contribution.sidebar;
  return (
    <ContributionBoundary name={`${entry.id} sidebar`} fallback={() => slot(skeleton)}>
      {useNodes === undefined ? (
        slot(skeleton)
      ) : (
        <DynamicSidebar useNodes={useNodes} context={context} skeleton={skeleton}>
          {slot}
        </DynamicSidebar>
      )}
    </ContributionBoundary>
  );
}

export function PluginHost({ entries, inventory, route, onNavigate, onRetry, onRetryInventory }: PluginHostProps) {
  // A route that names a plugin shows it as soon as it is known. With no route the window opens the first plugin (by id) that is ready, and it chooses
  // once every plugin has settled, so a plugin that happens to load faster does not flash by before the one that would be chosen.
  const settled = entries.every((candidate) => candidate.phase !== 'loading');
  const entry =
    entries.find((candidate) => candidate.id === route.plugin) ??
    (settled ? (entries.find((candidate) => candidate.phase === 'ready') ?? entries[0]) : entries.find((candidate) => candidate.phase === 'loading'));
  if (entry === undefined) {
    if (inventory === 'failed') {
      return <PlaceholderFrame pluginName="Omniview" title="Plugins" state={{ kind: 'failed', message: 'The list of installed plugins could not be read.', retry: onRetryInventory }} />;
    }

    return <PlaceholderFrame pluginName="Omniview" title="Plugins" state={inventory === 'loading' ? { kind: 'loading' } : { kind: 'ready' }} empty={inventory === 'ready'} />;
  }

  if (entry.phase === 'loading') {
    return <PlaceholderFrame key={entry.id} pluginName={entry.name} title={entry.name} state={{ kind: 'loading' }} />;
  }

  if (entry.phase === 'failed') {
    return (
      <PlaceholderFrame
        key={entry.id}
        pluginName={entry.name}
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

  return <ContributionFrame key={entry.id} entry={entry} route={route} onNavigate={onNavigate} />;
}
