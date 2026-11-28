import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react';
import type { DetailSource } from '../../page';
import type { DetailIdentity } from '../../page/detailDefinition';
import type { Route, TabId, TabsStore } from '../../shell';
import type { ConnectionsStore } from './connections';
import type { ExtensionAuthority } from './extensionAuthority';
import { ExtensionAuthorityContext } from './extensionAuthorityContext';
import type { PluginEntry } from './pluginStore';
import { sidebarScope } from './sidebarMount';

export type DetailHost = {
  readonly entry: Extract<PluginEntry, { phase: 'ready' }>;
  readonly route: Route;
  readonly tabs: TabsStore;
  readonly tabId: TabId;
  readonly source: DetailSource;
  readonly connections: ConnectionsStore | undefined;
};
export type DetailOrigin = {
  readonly owner: string;
  readonly connection: string;
  readonly extensionScopeKey: string;
  readonly route: { readonly page: string; readonly params: Readonly<Record<string, string>> };
};
export type DetailScope = DetailOrigin & {
  readonly authority: ExtensionAuthority;
  readonly artifact: NonNullable<PluginEntry['artifact']>;
  readonly identity: DetailIdentity;
  readonly visit: Record<string, unknown>;
  readonly current: () => boolean;
  readonly watch: (notify: () => void) => () => void;
};

/** Do not invoke owner accessors or inspect a raw throw. An invalid adapter member costs only that placement. */
export function ownData(object: unknown, key: string): unknown {
  try {
    if (typeof object !== 'object' || object === null) {
      return undefined;
    }

    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Only declared identity belongs to a resource locator. Extra launch parameters stay private to that launch. */
export function detailResourceParams(identity: DetailIdentity, params: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> | undefined {
  const name = ownData(params, identity.name);
  if (identity.name === 'connection' || typeof name !== 'string' || !name.trim()) {
    return undefined;
  }

  const keys: Record<string, string> = Object.create(null);
  keys[identity.name] = name;
  for (const key of identity.facets ?? []) {
    if (key === 'connection') {
      continue;
    }

    const value = ownData(params, key);
    if (value === undefined) {
      continue;
    }

    if (typeof value !== 'string') {
      return undefined;
    }

    keys[key] = value;
  }

  return keys;
}

const noop = () => undefined;
const PENDING_CONNECTION = Symbol('pending owner connection lookup');

/** A route is only a locator. Require the verified ordinary entry, current connected scope and the owner's ready incarnation. */
export function useDetailScope({ entry, route, tabs, tabId, source, connections }: DetailHost) {
  const authority = useContext(ExtensionAuthorityContext);
  const { artifact } = entry;
  const pages = entry.contribution.pages;
  const page = Object.hasOwn(pages, route.contribution) ? pages[route.contribution] : undefined;
  const identity = page?.kind === 'detail' ? page.definition.identity : undefined;
  const params = useMemo(() => authority && artifact && identity ? detailResourceParams(identity, route.params) : undefined, [authority, artifact, identity, route.params]);
  const key = params && source.state.kind === 'ready' && !source.refreshing
    ? ownData(source.view, 'extensionScopeKey') : undefined;
  const scopeKey = typeof key === 'string' && key.length > 0 && key.length <= 256 ? key : undefined;
  const watchTab = useCallback((notify: () => void) => {
    if (scopeKey === undefined) {
      return noop;
    }

    const stop = tabs.subscribe(notify);
    document.addEventListener('visibilitychange', notify);
    return () => {
      stop(); document.removeEventListener('visibilitychange', notify);
    };
  }, [scopeKey, tabs]);
  const activeVisit = useCallback(() => {
    if (scopeKey === undefined || document.hidden) {
      return undefined;
    }

    const state = tabs.getSnapshot();
    return state.active === tabId && state.tabs[tabId]?.location.route === route ? state.activeVisit : undefined;
  }, [scopeKey, tabs, tabId, route]);
  const visit = useSyncExternalStore(watchTab, activeVisit);
  const readScope = useCallback(() => {
    if (visit === undefined) {
      return undefined;
    }

    const known = connections?.getSnapshot();
    if (known && !known.loaded && !known.failed) {
      return PENDING_CONNECTION;
    }

    return sidebarScope(entry, route, known);
  }, [visit, entry, route, connections]);
  const connected = useSyncExternalStore(visit !== undefined && connections ? connections.subscribe : () => noop, readScope);
  const scope = useMemo<DetailScope | undefined>(() => {
    if (!authority || !artifact || !scopeKey || !params || !identity || visit === undefined || typeof connected !== 'string') {
      return undefined;
    }

    const location = tabs.getSnapshot().tabs[tabId]?.location;
    return {
      authority, artifact, owner: entry.id, extensionScopeKey: scopeKey, connection: connected,
      identity, route: { page: route.contribution, params }, visit: { tabId, location, visit },
      current: () => activeVisit() === visit && tabs.getSnapshot().tabs[tabId]?.location === location && readScope() === connected,
      watch: (notify: () => void) => {
        const stopTab = watchTab(notify);
        const stopScope = connections?.subscribe(notify);
        return () => {
          stopTab(); stopScope?.();
        };
      },
    };
  }, [authority, artifact, scopeKey, params, identity, visit, connected, tabs, tabId, entry.id, route, connections, activeVisit, readScope, watchTab]);
  return { scope, pending: connected === PENDING_CONNECTION };
}
