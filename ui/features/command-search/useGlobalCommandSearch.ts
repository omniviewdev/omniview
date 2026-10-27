import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ResourceClient } from '@omniviewdev/runtime/api';
import { matchRoutes, useNavigate } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSettingsProvider } from '@/hooks/settings/useCoreSettings';
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

const closed: SearchSnapshot = { isOpen: false, query: '', rows: [], sources: [], executionPending: false };
const subscribeClosed = () => () => undefined;
const closedSnapshot = () => closed;

function normalizedRoutes(routes: RouteObject[]): RouteObject[] {
  return routes.map((route) => {
    const normalized: RouteObject = { ...route, path: route.index ? undefined : route.path?.replace(/^\/+/, '') };
    if (route.children) {
      normalized.children = normalizedRoutes(route.children);
    }

    return normalized;
  });
}

export function useGlobalCommandSearch() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { plugins, registrations } = usePluginService();
  const pluginService = useContext(PluginServiceContext);
  if (!pluginService) {
    throw new Error('Global command search requires PluginServiceProvider.');
  }

  const { settings } = useSettingsProvider();
  const devMode = useDevMode();
  const routeTrees = useMemo(
    () =>
      new Map<string, RouteObject[]>(
        Array.from(registrations, ([id, registration]) => [id, normalizedRoutes(registration.routes)]),
      ),
    [registrations],
  );
  const latestRoutingContext = useRef({ registrations, routeTrees, navigate });
  latestRoutingContext.current = { registrations, routeTrees, navigate };
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const navigated = useRef(false);
  const controllerRef = useRef<GlobalSearchController | null>(null);
  const [controller, setController] = useState<GlobalSearchController | null>(null);
  const [catalogueStatus, setCatalogueStatus] = useState({ truncated: false, unavailable: false });
  const catalogueRef = useRef<{
    settings: typeof settings.data;
    plugins: CoreSearchPlugin[];
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
            : normalizedRoutes(registration.routes);
        return routes !== undefined && matchRoutes(routes, path) !== null;
      },
      listResourcePlugins: ResourceClient.ListPlugins,
      loadConnections: async (id) => reloadConnections(queryClient, id),
      navigate: (href) => {
        navigated.current = true;
        latestRoutingContext.current.navigate(href);
      },
    });
    controllerRef.current = next;
    setController(next);
    const unsubscribeService = pluginService.subscribe(next.refresh);
    return () => {
      unsubscribeService();
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
      previous &&
      previous.settings === settings.data &&
      previous.devMode === devMode &&
      previous.plugins.length === cataloguePlugins.length &&
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
      devMode,
    });
    catalogueRef.current = { settings: settings.data, plugins: cataloguePlugins, devMode, catalogue };
    setCatalogueStatus((current) =>
      current.truncated === catalogue.truncated && current.unavailable === catalogue.unavailable
        ? current
        : { truncated: catalogue.truncated, unavailable: catalogue.unavailable },
    );
  }, [settings.data, plugins, devMode]);

  useEffect(
    () => () => {
      catalogueRef.current?.catalogue.dispose();
      // StrictMode replay must register a fresh owned catalogue.
      catalogueRef.current = null;
    },
    [],
  );

  const open = useCallback(() => {
    if (!controllerRef.current?.getSnapshot().isOpen) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      navigated.current = false;
    }

    controllerRef.current?.open();
    input.current?.focus();
  }, []);
  const close = useCallback(() => {
    controllerRef.current?.close();
  }, []);

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

  return {
    open,
    paletteProps: {
      controller,
      snapshot,
      input,
      onClose: close,
      catalogueMessage:
        settings.isError || catalogueStatus.unavailable
          ? 'Settings search is unavailable.'
          : catalogueStatus.truncated
            ? 'Settings catalogue limit reached. Narrow your search; additional settings were not searched.'
            : undefined,
    },
  };
}
