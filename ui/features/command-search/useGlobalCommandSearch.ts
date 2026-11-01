import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PluginManager, ResourceClient } from '@omniviewdev/runtime/api';
import { GLOBAL_SEARCH_OPEN_EVENT, resourceQueryKeys } from '@omniviewdev/runtime';
import type { ExtensionContributionRegistration, NavigationTargetV1, OpenGlobalSearchOptions, ReadTarget, SearchProviderV1, SearchProviderItemV1 } from '@omniviewdev/runtime';
import { ConnectionStatusCode } from '@omniviewdev/runtime/models';
import { Events } from '@wailsio/runtime';
import useRightDrawer from '@/hooks/useRightDrawer';
import { GLOBAL_SEARCH_EXTENSION_POINT_ID } from './extensionPoint';
import { admitSearchContribution, getNavigationHref } from './admission';
import { matchRoutes } from 'react-router';
import { useActivePageNavigation } from '../workspace/activePageNavigation';
import { selectNewTabPlugins } from '../workspace/newTab/newTabPlugins';
import { openPath } from '../workspace/newTab/openDisposition';
import type { RouteObject } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HOST_SETTINGS_SCOPE, useScopedSettings } from '@omniviewdev/runtime';
import { useDevMode } from '@/hooks/useDevMode';
import { EXTENSION_REGISTRY } from '../extensions/store';
import { usePluginService } from '../plugins/react/usePluginService';
import { PluginServiceContext } from '../plugins/react/context';
import { registerCoreSearchCatalogue } from './catalogue';
import type { CoreSearchCatalogue, CoreSearchPlugin } from './catalogue';
import { createGlobalSearchController } from './controller';
import { reloadConnections } from './commands';
import type { GlobalSearchController } from './controller';
import type { SearchSnapshot } from './types';
import type { SearchProviderContextRegistration } from './SearchProviderContexts';
import { normalizePluginRoutes } from '../plugins/react/normalizePluginRoutes';
import { scopeConnection } from './scope';
import { resolveRouteSearchScope, resolveSearchOpenOptions } from './routeScope';

const closed: SearchSnapshot = { isOpen: false, query: '', scopes: [], rows: [], sources: [], searchPending: false, executionPending: false };
const subscribeClosed = () => () => undefined;
const closedSnapshot = () => closed;

async function checkConnection(pluginId: string, connectionId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const request = ResourceClient.CheckConnection(pluginId, connectionId);
  const cancel = () => {
    void request.cancel();
  };

  signal.addEventListener('abort', cancel, { once: true });
  try {
    const status = await request;
    signal.throwIfAborted();
    return status;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}


export function useGlobalCommandSearch() {
  // The palette lives in the shell, outside every page router: it reads and navigates the active page tab.
  const { pathname, search, navigate, openInNewTab, openInNewWindow } = useActivePageNavigation();
  const location = useMemo(() => ({ pathname, search }), [pathname, search]);
  const latestLocation = useRef(location);
  const queryClient = useQueryClient();
  const { showResourceSidebar } = useRightDrawer();
  const { plugins, registrations } = usePluginService();
  // Observe metadata already loaded by startup; do not add another inventory fetch.
  const inventory = useQuery({ queryKey: ['plugins'], queryFn: PluginManager.ListPlugins, enabled: false });
  const pluginIcons = useMemo<ReadonlyMap<string, string>>(
    () => new Map((inventory.data ?? []).flatMap((plugin) =>
      plugin.metadata?.icon ? [[plugin.id, plugin.metadata.icon] as const] : [])),
    [inventory.data],
  );
  const newTabPlugins = useMemo(() => selectNewTabPlugins(inventory.data, registrations), [inventory.data, registrations]);
  // Changes only when a plugin with pages appears, goes away or is renamed.
  const newTabKey = JSON.stringify(newTabPlugins.map(({ id, name }) => [id, name]));
  const pluginService = useContext(PluginServiceContext);
  if (!pluginService) {
    throw new Error('Global command search requires PluginServiceProvider.');
  }

  const scopedSettings = useScopedSettings(HOST_SETTINGS_SCOPE);
  const settings = { data: scopedSettings.categories, isError: Boolean(scopedSettings.error) };
  const devMode = useDevMode();
  const routeTrees = useMemo(
    () =>
      new Map<string, RouteObject[]>(
        Array.from(registrations, ([id, registration]) => [id, normalizePluginRoutes(registration.routes)]),
      ),
    [registrations],
  );
  const latestRoutingContext = useRef({ registrations, routeTrees, navigate, openInNewTab, openInNewWindow });
  const latestDrawer = useRef(showResourceSidebar);
  useLayoutEffect(() => {
    latestLocation.current = location;
    latestRoutingContext.current = { registrations, routeTrees, navigate, openInNewTab, openInNewWindow };
    latestDrawer.current = showResourceSidebar;
  }, [location, registrations, routeTrees, navigate, openInNewTab, openInNewWindow, showResourceSidebar]);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const navigated = useRef(false);
  const controllerRef = useRef<GlobalSearchController | null>(null);
  const [controller, setController] = useState<GlobalSearchController | null>(null);
  const [catalogueStatus, setCatalogueStatus] = useState({ truncated: false, unavailable: false });
  const catalogueRef = useRef<{
    settings: typeof settings.data;
    plugins: CoreSearchPlugin[];
    newTabKey: string;
    devMode: boolean;
    catalogue: CoreSearchCatalogue;
  } | null>(null);
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? subscribeClosed,
    controller?.getSnapshot ?? closedSnapshot,
    closedSnapshot,
  );
  const previouslyOpen = useRef(false);

  useEffect(() => {
    const next = createGlobalSearchController({
      registry: EXTENSION_REGISTRY,
      isPluginReady: (id) => pluginService.getPluginState(id)?.phase === 'ready',
      hasPluginRoute: (id, path) => {
        const registration = pluginService.getSnapshot().registrations.get(id);
        if (!registration) {
          return false;
        }

        // Render-time normalization is reusable only for the exact live route
        // registration. A transition cannot borrow a retired route tree.
        const routes =
          latestRoutingContext.current.registrations.get(id) === registration
            ? latestRoutingContext.current.routeTrees.get(id)
            : normalizePluginRoutes(registration.routes);
        return routes !== undefined && matchRoutes(routes, path) !== null;
      },
      listResourcePlugins: ResourceClient.ListPlugins,
      loadConnections: async (id) => reloadConnections(queryClient, id),
      openResource: async (target, signal, validateData) => {
        if (pluginService.getPluginState(target.pluginId)?.phase !== 'ready') {
          throw new Error('Resource plugin is unavailable.');
        }

        signal.throwIfAborted();
        const status = await checkConnection(target.pluginId, target.route.connection, signal);
        signal.throwIfAborted();
        if (status.status !== ConnectionStatusCode.ConnectionStatusConnected) {
          throw new Error(status.details ? status.details : status.error ? status.error : 'Connection is not ready.');
        }

        await latestDrawer.current({
          pluginID: target.pluginId,
          route: target.route,
          reference: target.reference,
          representation: target.representation,
          targetId: target.targetId,
          resourceName: target.label,
          validateData,
          signal,
        });
      },
      navigate: (href) => {
        navigated.current = true;
        latestRoutingContext.current.navigate(href);
      },
      openNew: (href, disposition) => {
        navigated.current = true;
        openPath(latestRoutingContext.current, href, disposition);
      },
    });
    controllerRef.current = next;
    setController(next);
    const store = EXTENSION_REGISTRY.getExtensionPoint(GLOBAL_SEARCH_EXTENSION_POINT_ID);
    const provider: SearchProviderV1 = {
      schemaVersion: 1,
      kind: 'provider',
      supportsScope: () => true,
      async search({ query, signal, limit, scopes }) {
        const deepestScope = [...scopes].reverse().find((scope) => scope.kind === 'connection');
        const adapters = new Map<string, SearchProviderV1[]>();
        for (const contribution of store?.listAll() ?? []) {
          const admitted = admitSearchContribution(contribution);
          if (contribution.plugin === 'core' || admitted?.kind !== 'provider') {
            continue;
          }

          const providers = adapters.get(contribution.plugin) ?? [];
          providers.push(admitted);
          adapters.set(contribution.plugin, providers);
        }

        if (deepestScope) {
          const ownsRecovery = (adapters.get(deepestScope.pluginId) ?? []).some((adapter) => {
            try {
              return adapter.connectionRecovery === 'provider' && (adapter.supportsScope?.(scopes) ?? true);
            } catch {
              return false;
            }
          });
          if (ownsRecovery) {
            return { items: [], completion: 'complete' };
          }

          if (pluginService.getPluginState(deepestScope.pluginId)?.phase !== 'ready') {
            return { items: [], completion: 'complete', status: 'unavailable', message: 'Connection plugin is unavailable.' };
          }

          const connection = await checkConnection(deepestScope.pluginId, deepestScope.connectionId, signal);
          signal.throwIfAborted();
          if (connection.status === ConnectionStatusCode.ConnectionStatusConnected) {
            return { items: [], completion: 'complete', status: 'ready' };
          }

          const status =
            connection.status === ConnectionStatusCode.ConnectionStatusPending ? 'connecting' :
              connection.status === ConnectionStatusCode.ConnectionStatusUnauthorized ? 'authentication-required' :
                connection.status === ConnectionStatusCode.ConnectionStatusForbidden ? 'forbidden' :
                  connection.status === ConnectionStatusCode.ConnectionStatusDisconnected ? 'disconnected' : 'unavailable';
          const label = `Connect ${deepestScope.label}`;
          const matches = !query.trim() || label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
          const canConnect = status !== 'connecting' && status !== 'forbidden';
          return {
            items: canConnect && matches && limit > 0 ? [{
              id: `${deepestScope.pluginId}/${deepestScope.connectionId}/connect`,
              label,
              value: { schemaVersion: 1, kind: 'action', scope: deepestScope,
                action: { id: 'core:connect', target: deepestScope, recovery: 'connection' } },
            }] : [],
            completion: 'complete',
            status,
            message: (connection.details ? connection.details : connection.error ? connection.error : 'Connection is not ready.').slice(0, 1024),
          };
        }

        const request = ResourceClient.ListAllConnections();
        const cancel = async () => request.cancel();
        signal.addEventListener('abort', cancel, { once: true });
        let all: Awaited<typeof request>;
        try {
          signal.throwIfAborted();
          all = await request;
          signal.throwIfAborted();
        } finally {
          signal.removeEventListener('abort', cancel);
        }

        const items: SearchProviderItemV1[] = [];
        const needle = query.trim().toLocaleLowerCase();
        let truncated = false;
        for (const [pluginId, connections] of Object.entries(all)) {
          if (pluginService.getPluginState(pluginId)?.phase !== 'ready') {
            continue;
          }

          for (const connection of connections ?? []) {
            const label = connection.name ? connection.name : connection.id;
            if (needle && !`${label} ${pluginId} ${connection.id}`.toLocaleLowerCase().includes(needle)) {
              continue;
            }

            if (items.length >= limit) {
              truncated = true; break; 
            }

            const scope = { kind: 'connection' as const, pluginId, connectionId: connection.id, label };
            let target: NavigationTargetV1 = { kind: 'plugin', pluginId, path: '/' };
            for (const adapter of adapters.get(pluginId) ?? []) {
              try {
                if (!adapter.connectionTarget || !(adapter.supportsScope?.([scope]) ?? true)) {
                  continue;
                }

                const candidate = adapter.connectionTarget(connection.id);
                if (getNavigationHref(candidate) && candidate.kind === 'plugin' && candidate.pluginId === pluginId) {
                  target = candidate;
                  break;
                }
              } catch {
                // A broken adapter cannot hide other connections or their healthy adapters.
              }
            }

            items.push({
              id: `${pluginId}/${connection.id}`, label,
              value: {
                schemaVersion: 1, kind: 'navigation', scope,
                description: `${pluginId} connection`,
                target,
              },
            });
          }
        }

        return { items, completion: truncated ? 'truncated' : 'complete' };
      },
      async validateAction(action, { signal }) {
        if (action.id !== 'core:connect' || action.target.kind !== 'connection') {
          return false;
        }

        const { pluginId, connectionId } = action.target;
        if (pluginService.getPluginState(pluginId)?.phase !== 'ready') {
          return false;
        }

        const connections = await ResourceClient.ListConnections(pluginId);
        signal.throwIfAborted();
        if (!connections.some((connection) => connection.id === connectionId)) {
          return false;
        }

        const current = await checkConnection(pluginId, connectionId, signal);
        signal.throwIfAborted();
        return current.status !== ConnectionStatusCode.ConnectionStatusConnected &&
          current.status !== ConnectionStatusCode.ConnectionStatusPending &&
          current.status !== ConnectionStatusCode.ConnectionStatusForbidden;
      },
      async executeAction(action, { signal }) {
        signal.throwIfAborted();
        if (action.id !== 'core:connect' || action.target.kind !== 'connection') {
          throw new Error('Unknown connection action.');
        }

        const { pluginId, connectionId } = action.target;

        if (pluginService.getPluginState(pluginId)?.phase !== 'ready') {
          throw new Error('Connection plugin is unavailable.');
        }

        const status = await ResourceClient.StartConnection(pluginId, connectionId);
        if (status.status !== ConnectionStatusCode.ConnectionStatusConnected) {
          throw new Error(status.details ? status.details : status.error ? status.error : 'Connection is not ready.');
        }

        signal.throwIfAborted();
        return { keepOpen: true };
      },
    };
    const registration = { id: 'core/global-search/connections', plugin: 'core', label: 'Connections', value: provider };
    if (store && admitSearchContribution(registration)) {
      store.register(registration);
    }

    const stopEvents = [
      Events.On('connection/status', (event) => {
        void queryClient.invalidateQueries({
          queryKey: ['search-connection-status', event.data.pluginID, event.data.connectionID],
          refetchType: 'none',
        });
        next.notifyDataChanged();
      }),
      Events.On('watch/STATE', () => {
        next.notifyDataChanged(); 
      }),
      Events.On('plugin/inventory_changed', next.refresh),
    ];
    const connectionEvents = new Map<string, () => void>();
    const syncConnectionEvents = () => {
      const ids = new Set(pluginService.getSnapshot().plugins.keys());
      for (const [id, stop] of connectionEvents) {
        if (!ids.has(id)) {
          stop(); connectionEvents.delete(id); 
        }
      }

      for (const id of ids) {
        if (!connectionEvents.has(id)) {
          connectionEvents.set(id, Events.On(`${id}/connection/sync`, (event) => {
            void queryClient.invalidateQueries({ queryKey: ['search-connection-status', id], refetchType: 'none' });
            // Only a successful native sync is authoritative about removal.
            if (Array.isArray(event.data)) {
              const connectionIds = new Set(event.data.map((connection: { id: string }) => connection.id));
              const scopes = next.getSnapshot().scopes;
              const removed = scopes.findIndex((scope) => scope.pluginId === id && !connectionIds.has(scopeConnection(scope)));
              if (removed >= 0) {
                next.removeScope(removed, 'Connection was removed.');
              }
            }

            next.notifyDataChanged();
          }));
        }
      }

      next.refresh();
    };

    syncConnectionEvents();
    const unsubscribeService = pluginService.subscribe(syncConnectionEvents);
    return () => {
      unsubscribeService();
      stopEvents.forEach((stop) => {
        stop(); 
      });
      connectionEvents.forEach((stop) => {
        stop(); 
      });
      if (store?.listAll().includes(registration)) {
        store.unregister(registration.id);
      }

      const wasOpen = next.getSnapshot().isOpen;
      next.dispose();
      controllerRef.current = null;
      if (wasOpen && !navigated.current && opener.current?.isConnected) {
        opener.current.focus();
      }
    };
  }, [queryClient, pluginService]);

  useEffect(() => {
    const cataloguePlugins = Array.from(plugins.values(), (plugin) => ({
      id: plugin.id,
      label: plugin.id,
      ready: plugin.phase === 'ready',
    }));
    const previous = catalogueRef.current;
    if (
      previous?.plugins.length === cataloguePlugins.length &&
      previous.settings === settings.data &&
      previous.devMode === devMode &&
      previous.newTabKey === newTabKey &&
      cataloguePlugins.every(
        (plugin, index) => plugin.id === previous.plugins[index].id && plugin.ready === previous.plugins[index].ready,
      )
    ) {
      return;
    }

    previous?.catalogue.dispose();
    const catalogue = registerCoreSearchCatalogue(EXTENSION_REGISTRY, {
      settings: settings.data ?? {},
      plugins: cataloguePlugins,
      newTabPlugins,
      devMode,
    });
    catalogueRef.current = { settings: settings.data, plugins: cataloguePlugins, newTabKey, devMode, catalogue };
    setCatalogueStatus((current) =>
      current.truncated === catalogue.truncated && current.unavailable === catalogue.unavailable
        ? current
        : { truncated: catalogue.truncated, unavailable: catalogue.unavailable },
    );
  }, [settings.data, plugins, devMode, newTabKey, newTabPlugins]);

  useEffect(
    () => () => {
      catalogueRef.current?.catalogue.dispose();
      // StrictMode replay must register a fresh owned catalogue.
      catalogueRef.current = null;
    },
    [],
  );

  const open = useCallback((options: OpenGlobalSearchOptions = {}) => {
    if (!controllerRef.current?.getSnapshot().isOpen) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      navigated.current = false;
    }

    const resolved = resolveSearchOpenOptions(options, controllerRef.current?.getSnapshot().isOpen ?? false, () =>
      resolveRouteSearchScope(latestLocation.current, (id) => {
        const registration = pluginService.getSnapshot().registrations.get(id);
        if (!registration) {
          return undefined;
        }

        return latestRoutingContext.current.registrations.get(id) === registration
          ? latestRoutingContext.current.routeTrees.get(id)
          : normalizePluginRoutes(registration.routes);
      }, (id) => pluginService.getPluginState(id)?.phase === 'ready'));
    controllerRef.current?.open(resolved);
    input.current?.focus();
  }, [pluginService]);
  const close = useCallback(() => {
    controllerRef.current?.close();
  }, []);

  useEffect(() => {
    const requested = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      open(detail !== null && typeof detail === 'object' ? detail : {});
    };

    window.addEventListener(GLOBAL_SEARCH_OPEN_EVENT, requested);
    return () => {
      window.removeEventListener(GLOBAL_SEARCH_OPEN_EVENT, requested); 
    };
  }, [open]);

  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        event.repeat ||
        event.shiftKey ||
        event.altKey ||
        event.ctrlKey === event.metaKey ||
        event.key.toLowerCase() !== 'k'
      ) {
        return;
      }

      const isOpen = controllerRef.current?.getSnapshot().isOpen;
      const target = event.target instanceof Element ? event.target : null;
      const owner = target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
      const palette = input.current?.closest('[role="dialog"]');
      if (owner && owner !== palette && !(owner.getAttribute('role') === 'listbox' && palette?.contains(owner))) {
        return;
      }

      event.preventDefault();
      if (isOpen) {
        close();
      } else {
        open();
      }
    };

    document.addEventListener('keydown', shortcut);
    return () => {
      document.removeEventListener('keydown', shortcut);
    };
  }, [open, close]);

  useEffect(() => {
    if (previouslyOpen.current && !snapshot.isOpen) {
      if (!navigated.current && opener.current?.isConnected) {
        opener.current.focus();
      }

      navigated.current = false;
    }

    previouslyOpen.current = snapshot.isOpen;
  }, [snapshot.isOpen]);

  const [contexts, setContexts] = useState<readonly SearchProviderContextRegistration[]>([]);
  const contextIncarnations = useRef(new WeakMap<ExtensionContributionRegistration, number>());
  const nextContextIncarnation = useRef(0);
  useEffect(() => {
    const refresh = () => {
      const store = EXTENSION_REGISTRY.getExtensionPoint(GLOBAL_SEARCH_EXTENSION_POINT_ID);
      const next = (store?.listAll() ?? []).flatMap((registration) => {
        const admitted = admitSearchContribution(registration);
        if (admitted?.kind !== 'provider' || !admitted.Context) {
          return [];
        }

        if (registration.plugin !== 'core' && pluginService.getPluginState(registration.plugin)?.phase !== 'ready') {
          return [];
        }

        let incarnation = contextIncarnations.current.get(registration);
        if (incarnation === undefined) {
          incarnation = ++nextContextIncarnation.current;
          contextIncarnations.current.set(registration, incarnation);
        }

        return [{
          key: `${registration.plugin}/${registration.id}/${incarnation}`,
          sourceId: registration.id,
          pluginId: registration.plugin,
          Component: admitted.Context,
        }];
      });
      setContexts((current) => current.length === next.length &&
        current.every((item, index) => item.key === next[index].key && item.Component === next[index].Component) ? current : next);
    };

    const stopRegistry = EXTENSION_REGISTRY.subscribe(refresh);
    const stopService = pluginService.subscribe(refresh);
    refresh();
    return () => {
      stopRegistry(); stopService(); 
    };
  }, [pluginService]);

  const nativeSubscriptions = useRef(new Map<string, () => void>());
  const failedSubscriptions = useRef(new Set<string>());
  const [liveFailureCount, setLiveFailureCount] = useState(0);
  const [liveRetry, setLiveRetry] = useState(0);
  const retryLiveUpdates = useCallback(() => {
    for (const key of failedSubscriptions.current) {
      nativeSubscriptions.current.get(key)?.();
      nativeSubscriptions.current.delete(key);
    }

    failedSubscriptions.current.clear();
    setLiveFailureCount(0);
    setLiveRetry((value) => value + 1);
  }, []);
  useEffect(() => () => {
    nativeSubscriptions.current.forEach((release) => {
      release(); 
    });
    nativeSubscriptions.current.clear();
    failedSubscriptions.current.clear();
  }, [controller]);
  useEffect(() => {
    const desired = new Set<string>();
    const resources = new Map<string, { pluginId: string; target: ReadTarget; targetId: string }>();
    const connections = new Map<string, { pluginId: string; connectionId: string }>();
    for (const scope of snapshot.scopes) {
      const connectionId = scopeConnection(scope);
      connections.set(JSON.stringify([scope.pluginId, connectionId]), { pluginId: scope.pluginId, connectionId });
      if (scope.kind !== 'connection') {
        const target: ReadTarget = scope.kind === 'resource-type' ? scope.target : {
          route: scope.route, provider: scope.reference.address.provider, authority: scope.reference.address.authority,
          type: scope.reference.address.type, representation: scope.representation,
          scope: scope.reference.address.scope.map(entry => ({ dimension: entry.dimension, match: 'oneOf', values: [entry.value] })),
        };
        resources.set(JSON.stringify([scope.pluginId, scope.targetId, target]), { pluginId: scope.pluginId, target, targetId: scope.targetId });
      }
    }

    if (snapshot.isOpen && controller) {
      for (const [key, { pluginId, connectionId }] of connections) {
        const subscriptionKey = `connection:${key}`;
        desired.add(subscriptionKey);
        if (nativeSubscriptions.current.has(subscriptionKey)) {
          continue;
        }

        const stop = Events.On(`${pluginId}/${connectionId}/watch/STATE`, () => {
          void queryClient.invalidateQueries({ queryKey: ['search-connection-status', pluginId, connectionId], refetchType: 'none' });
          controller.notifyDataChanged();
        });
        nativeSubscriptions.current.set(subscriptionKey, stop);
      }

      for (const [key, { pluginId, target, targetId }] of resources) {
        const connectionId = target.route.connection;
        const resourceKey = target.type;
        const subscriptionKey = `resource:${key}`;
        desired.add(subscriptionKey);
        if (nativeSubscriptions.current.has(subscriptionKey)) {
          continue;
        }

        let active = true;
        const queryKey = resourceQueryKeys.all(pluginId);
        const queryCache = queryClient.getQueryCache();
        const dirtyQueries = new Set<string>();
        const stopCache = queryCache.subscribe((event) => {
          const query = event.query;
          if (!active || !dirtyQueries.has(query.queryHash)) {
            return;
          }

          if (event.type === 'removed') {
            dirtyQueries.delete(query.queryHash);
          } else if (query.state.fetchStatus === 'idle') {
            // A successful read clears isInvalidated. Preserve events that arrived
            // during that read, before a trailing provider search can reuse it.
            dirtyQueries.delete(query.queryHash);
            void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true, refetchType: 'none' });
            controller.notifyDataChanged();
          }
        });
        const stops = ['ADD', 'UPDATE', 'DELETE'].map((type) =>
          Events.On(`${pluginId}/${connectionId}/${resourceKey}/${type}`, (event) => {
            const payload = event.data;
            if ((type === 'DELETE' ? payload?.targetId : payload?.record?.targetId) !== targetId) {
              return;
            }

            for (const query of queryCache.findAll({ queryKey })) {
              if (query.state.fetchStatus !== 'idle') {
                dirtyQueries.add(query.queryHash);
              }
            }

            void queryClient.invalidateQueries({ queryKey, refetchType: 'none' });
            controller.notifyDataChanged();
          }));
        // Deferring acquisition also catches synchronous native failures.
        const acquired = Promise.resolve().then(async () => {
          if (!active) {
            return false;
          }

          await ResourceClient.SubscribeResource(pluginId, { targetId, target });
          return true;
        }).catch(() => {
          if (active) {
            failedSubscriptions.current.add(subscriptionKey);
            setLiveFailureCount(failedSubscriptions.current.size);
          }

          return false;
        });
        nativeSubscriptions.current.set(subscriptionKey, () => {
          active = false;
          stopCache();
          dirtyQueries.clear();
          failedSubscriptions.current.delete(subscriptionKey);
          stops.forEach((stop) => {
            stop(); 
          });
          void acquired.then(async (success) => {
            if (success) {
              await ResourceClient.UnsubscribeResource(pluginId, { targetId, target });
            }
          }).catch(() => undefined);
        });
      }
    }

    for (const [key, release] of nativeSubscriptions.current) {
      if (!desired.has(key)) {
        release();
        nativeSubscriptions.current.delete(key);
      }
    }

    setLiveFailureCount(failedSubscriptions.current.size);
  }, [controller, queryClient, snapshot.isOpen, snapshot.scopes, liveRetry]);

  return {
    open,
    paletteProps: {
      controller,
      contexts,
      pluginIcons,
      snapshot,
      input,
      onClose: close,
      liveUpdateError: snapshot.isOpen && liveFailureCount > 0
        ? 'Live updates are unavailable. Results may be out of date.'
        : undefined,
      retryLiveUpdates,
      catalogueMessage:
        settings.isError || catalogueStatus.unavailable
          ? 'Settings search is unavailable.'
          : catalogueStatus.truncated
            ? 'Settings catalogue limit reached. Narrow your search; additional settings were not searched.'
            : undefined,
    },
  };
}
