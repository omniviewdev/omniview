import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import type { Description, ShellTreeNode, TabsStore } from '../../shell';
import type { ExtensionViewRoute, TabRoute } from '../../shell/core/tabs';
import type { ContributionV1, SidebarNodeV1 } from '../contract/v1';
import type { ConnectionsState } from './connections/store';
import { connectionOf, readsNoConnection } from './contributions';
import type { ExtensionAuthority, ExtensionBinding, ExtensionPlacement } from './extensionAuthority';
import type { PluginEntry } from './pluginStore';

type Ready = Extract<PluginEntry, { phase: 'ready' }>;
type Nodes = readonly SidebarNodeV1[] | null | undefined;
const EMPTY: readonly ExtensionBinding[] = Object.freeze([]);
const EMPTY_INPUT = Object.freeze({});
type SidebarSnapshot = { readonly bindings: readonly ExtensionBinding[]; readonly placement?: ExtensionPlacement | undefined };
const UNMOUNTED: SidebarSnapshot = { bindings: EMPTY };
const idle = () => undefined;
const INACTIVE_SIDEBAR = { snapshot: () => UNMOUNTED, subscribe: () => idle, attach: idle };
export const VIEW_NODE_PREFIX = '~view/';
const LIMIT = 16;

/** An all-plugin-scope workspace names no connection. A mixed owner's unscoped landing is a picker, not its ordinary tree. */
const unscoped = (owner: ContributionV1): boolean =>
  owner.landing === undefined && readsNoConnection(owner.pages[owner.home]) && Object.values(owner.pages).every(readsNoConnection);

/** `null` proves an unscoped workspace; `undefined` is no proof. A restored locator never acquires an implicit connection. */
export function sidebarScope(entry: Ready, route: TabRoute, known: ConnectionsState | undefined): string | null | undefined {
  if (route.plugin !== entry.id) {
    return undefined;
  }

  const key = connectionOf(route);
  if (unscoped(entry.contribution)) {
    return key === undefined ? null : undefined;
  }

  if (!known?.loaded || known.failed || (route.kind !== 'extension-view' && readsNoConnection(entry.contribution.pages[route.contribution]))) {
    return undefined;
  }

  if (key === undefined && route.kind === 'extension-view') {
    return undefined;
  }

  let verified: string | undefined;
  let found = false;
  for (const row of known.connections) {
    if (row.plugin !== entry.id || (key !== undefined && row.key !== key)) {
      continue;
    }

    if (found) {
      return undefined;
    }

    found = true;
    if (row.state === 'connected' && row.busy === undefined) {
      verified = row.key;
    }
  }

  return verified;
}

export type SidebarLeaf = { readonly node: ShellTreeNode; readonly binding: ExtensionBinding };
export type SidebarGroup = { readonly node: ShellTreeNode; readonly leaves: readonly SidebarLeaf[] };
export type SidebarMount = {
  readonly group: SidebarGroup | undefined;
  readonly scope: string | null | undefined;
  readonly placement: ExtensionPlacement | undefined;
};

const pointOf = (entry: Ready): string | undefined => entry.contribution.sidebar.outlet === undefined ? undefined : `${entry.id}/${entry.contribution.sidebar.outlet}`;

function declared(authority: ExtensionAuthority, entry: Ready, point: string) {
  const info = authority.declaredPoint(point);
  return entry.artifact && info?.declaration.placement === 'sidebar' && info.declaration.kind === 'view' &&
    info.ownerPin === entry.artifact.pin && info.sourceGeneration === entry.artifact.generation ? info : undefined;
}

/** Discovery is metadata only. Reserve IDs even in a collapsed group or in an owner skeleton supplanted by dynamic rows. */
export function sidebarGroup(authority: ExtensionAuthority | null, entry: Ready, dynamic: Nodes): SidebarGroup | undefined {
  const point = pointOf(entry);
  if (!authority || !point) {
    return undefined;
  }

  const info = declared(authority, entry, point);
  if (!info) {
    return undefined;
  }

  const bindings = authority.point(point);
  if (!bindings.length) {
    return undefined;
  }

  const groupId = `${VIEW_NODE_PREFIX}${point}`;
  const reserved = new Set<string>();
  function reserve(nodes: readonly SidebarNodeV1[]): void {
    for (const node of nodes) {
      reserved.add(node.id);
      if (node.children) {
        reserve(node.children);
      }
    }
  }

  reserve(entry.contribution.sidebar.nodes);
  if (dynamic && dynamic !== entry.contribution.sidebar.nodes) {
    reserve(dynamic);
  }

  if (reserved.has(groupId)) {
    return undefined;
  }

  // Gate 2 admitted an empty context and no condition. Its first 16 rows are the live sidebar fan-out, before ID collisions.
  const rows = bindings.slice(0, LIMIT).filter(row => !reserved.has(`${groupId}/${row.offer}`));
  if (!rows.length) {
    return undefined;
  }

  const labels = new Set<string>();
  const duplicates = new Set<string>();
  for (const { declaration: { label } } of rows) {
    if (labels.has(label)) {
      duplicates.add(label);
    }

    labels.add(label);
  }

  const leaves = rows.map((binding): SidebarLeaf => ({ binding, node: {
    id: `${groupId}/${binding.offer}`, icon: 'box',
    label: duplicates.has(binding.declaration.label) ? `${binding.declaration.label} (${binding.offer})` : binding.declaration.label,
  } }));
  return { leaves, node: { id: groupId, label: info.declaration.label, icon: 'layers', children: leaves.map(leaf => leaf.node) } };
}

export function leafRoute(entry: Ready, leaf: SidebarLeaf, scope: string | null): ExtensionViewRoute {
  return { kind: 'extension-view', plugin: entry.id, point: entry.contribution.sidebar.outlet!, offer: leaf.binding.offer,
    ...(scope === null ? {} : { connection: scope }) };
}

export function viewLeaf(authority: ExtensionAuthority | null, entry: PluginEntry | undefined, route: ExtensionViewRoute, dynamic: Nodes): SidebarLeaf | undefined {
  if (entry?.phase !== 'ready' || entry.id !== route.plugin || entry.contribution.sidebar.outlet !== route.point) {
    return undefined;
  }

  return sidebarGroup(authority, entry, dynamic)?.leaves.find(leaf => leaf.binding.offer === route.offer);
}

export function viewFace(authority: ExtensionAuthority | null, entry: PluginEntry | undefined, route: ExtensionViewRoute, known: ConnectionsState | undefined, dynamic: Nodes): Description {
  const ownerName = entry?.phase === 'ready' ? entry.contribution.plugin.name : entry?.name ?? route.plugin;
  const leaf = entry?.phase === 'ready' && sidebarScope(entry, route, known) !== undefined ? viewLeaf(authority, entry, route, dynamic) : undefined;
  const connectionName = known?.connections.find(row => row.plugin === route.plugin && row.key === route.connection)?.name;
  const title = leaf?.node.label ?? 'View unavailable';
  return { title, icon: 'box', pluginName: ownerName, path: [ownerName, ...(connectionName ? [connectionName] : []), title],
    scope: route.connection === undefined ? undefined : { id: route.connection, label: connectionName ?? '' }, facets: connectionName ? [connectionName] : [] };
}

/** Track metadata and the lease in the same snapshot. Release it synchronously when this visit leaves layout. */
function observeSidebar(authority: ExtensionAuthority | null, owner: Ready | undefined, scope: string | null | undefined, visit: Record<string, unknown>) {
  const point = owner && pointOf(owner);
  if (!authority || !owner || !point || scope === undefined) {
    return INACTIVE_SIDEBAR;
  }

  const holder = {};
  let value: SidebarSnapshot = { bindings: authority.point(point) };
  let listener: (() => void) | undefined;
  return {
    snapshot: () => value,
    subscribe(notify: () => void) {
      listener = notify;
      return () => {
        listener = undefined;
      };
    },
    attach() {
      const outlet = {
        owner: owner.id, point, placement: 'sidebar' as const, visible: true, ready: true,
        subject: owner.id, ...(scope === null ? {} : { connection: scope }), context: EMPTY_INPUT, visit,
      };
      let attached = true;
      const refresh = () => {
        if (!attached) {
          return;
        }

        const bindings = authority.point(point);
        const available = bindings.length > 0 && declared(authority, owner, point) !== undefined;
        const placement = authority.setPlacement(holder, available ? outlet : undefined);
        if (attached && authority.point(point) === bindings && (bindings !== value.bindings || placement !== value.placement)) {
          value = { bindings, placement };
          listener?.();
        }
      };

      const stop = authority.subscribePoint(point, refresh);
      refresh();
      return () => {
        attached = false;
        stop();
        authority.setPlacement(holder, undefined);
        value = UNMOUNTED;
      };
    },
  };
}

/** Subscribe only to the displayed outlet's point. A new visit or scope gets a fresh lease before a press or Body can use it. */
export function useSidebarMount(authority: ExtensionAuthority | null, entry: PluginEntry | undefined, route: TabRoute | undefined, known: ConnectionsState | undefined, dynamic: Nodes, visit: Record<string, unknown>): SidebarMount {
  const owner = entry?.phase === 'ready' && entry.contribution.sidebar.outlet !== undefined ? entry : undefined;
  const scope = owner && route ? sidebarScope(owner, route, known) : undefined;
  const observation = useMemo(() => observeSidebar(authority, owner, scope, visit), [authority, owner, scope, visit]);
  useLayoutEffect(() => observation.attach(), [observation]);
  const { bindings, placement } = useSyncExternalStore(observation.subscribe, observation.snapshot);
  const group = useMemo(() => owner && bindings.length ? sidebarGroup(authority, owner, dynamic) : undefined, [authority, owner, bindings, dynamic]);
  // Metadata may survive a visit change; dispatch still needs the lease for this exact visit.
  return { group, scope, placement };
}

/** The strip shows faces for background tabs, but subscribes only to the points it actually names. Never create a background placement. */
export function watchViewFaces(tabs: TabsStore, authority: ExtensionAuthority, sources: ReadonlyArray<{ subscribe(listener: () => void): () => void } | undefined>): () => void {
  const stops = new Map<string, () => void>();
  let previous = tabs.getSnapshot();
  function sync(): void {
    const state = tabs.getSnapshot();
    previous = state;
    const points = new Set<string>();
    for (const id of state.order) {
      const route = state.tabs[id]?.location.route;
      if (route?.kind !== 'extension-view') {
        continue;
      }

      const point = `${route.plugin}/${route.point}`;
      points.add(point);
      if (!stops.has(point)) {
        stops.set(point, authority.subscribePoint(point, () => {
          tabs.refresh(route.plugin);
        }));
      }
    }

    for (const [point, stop] of stops) {
      if (!points.has(point)) {
        stop(); stops.delete(point);
      }
    }
  }

  sync();
  const stop = tabs.subscribe(() => {
    const state = tabs.getSnapshot();
    if (previous.tabs !== state.tabs && (previous.order !== state.order || state.order.some(id => {
      const from = previous.tabs[id]?.location.route;
      const to = state.tabs[id]?.location.route;
      return from !== to && (from?.kind === 'extension-view' || to?.kind === 'extension-view');
    }))) {
      sync();
    } else {
      previous = state;
    }
  });
  const refresh = () => {
    if (!stops.size) {
      return;
    }

    const owners = new Set<string>();
    for (const key of stops.keys()) {
      owners.add(key.slice(0, key.indexOf('/')));
    }

    for (const owner of owners) {
      tabs.refresh(owner);
    }
  };

  const unsubscribe = sources.map(source => source?.subscribe(refresh));
  refresh();
  return () => {
    stop();
    for (const done of unsubscribe) {
      done?.();
    }

    for (const done of stops.values()) {
      done();
    }
  };
}
