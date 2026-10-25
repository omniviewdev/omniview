import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { CommandList, Dialog, useCommandListConfig, useCommandListStoreContext } from '@omniviewdev/base-ui';
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
import { createGlobalSearchController } from './controller';
import { reloadConnections } from './commands';
import type { GlobalSearchController } from './controller';
import type { SearchRow, SearchSnapshot } from './types';
import styles from './GlobalCommandSearch.module.css';

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
  const routeTrees = useMemo(() => new Map<string, RouteObject[]>(Array.from(registrations, ([id, registration]) => [id, normalizedRoutes(registration.routes)])), [registrations]);
  const context = useRef({ registrations, routeTrees, navigate });
  context.current = { registrations, routeTrees, navigate };
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const navigated = useRef(false);
  const instance = useRef<GlobalSearchController | null>(null);
  const [controller, setController] = useState<GlobalSearchController | null>(null);
  const [catalogueStatus, setCatalogueStatus] = useState({ truncated: false, unavailable: false });
  const snapshot = useSyncExternalStore(controller?.subscribe ?? subscribeClosed, controller?.getSnapshot ?? closedSnapshot, closedSnapshot);
  const previousOpen = useRef(false);

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
        const routes = context.current.registrations.get(id) === registration
          ? context.current.routeTrees.get(id)
          : normalizedRoutes(registration.routes);
        return routes !== undefined && matchRoutes(routes, path) !== null;
      },
      listResourcePlugins: ResourceClient.ListPlugins,
      loadConnections: async (id) => reloadConnections(queryClient, id),
      navigate: (href) => {
        navigated.current = true;
        context.current.navigate(href);
      },
    });
    instance.current = next;
    setController(next);
    const unsubscribeService = pluginService.subscribe(next.refresh);
    return () => {
      unsubscribeService();
      const wasOpen = next.getSnapshot().isOpen;
      next.dispose();
      instance.current = null;
      if (wasOpen && !navigated.current && opener.current?.isConnected) {
        opener.current.focus();
      }
    };
  }, [queryClient, pluginService]);

  const cataloguePlugins = useMemo(() => Array.from(plugins.values(), (plugin) => ({
    id: plugin.id, label: plugin.id, ready: plugin.phase === 'ready',
  })), [plugins]);
  useEffect(() => {
    const catalogue = registerCoreSearchCatalogue(EXTENSION_REGISTRY, {
      settings: settings.data ?? {}, plugins: cataloguePlugins, devMode,
    });
    setCatalogueStatus({ truncated: catalogue.truncated, unavailable: catalogue.unavailable });
    return catalogue.dispose;
  }, [settings.data, cataloguePlugins, devMode]);


  const open = useCallback(() => {
    if (!instance.current?.getSnapshot().isOpen) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      navigated.current = false;
    }

    instance.current?.open();
    input.current?.focus();
  }, []);
  const close = useCallback(() => {
    instance.current?.close(); 
  }, []);

  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey
        || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') {
        return;
      }

      event.preventDefault();
      open();
    };

    document.addEventListener('keydown', shortcut);
    return () => {
      document.removeEventListener('keydown', shortcut); 
    };
  }, [open]);

  useEffect(() => {
    if (previousOpen.current && !snapshot.isOpen) {
      if (!navigated.current && opener.current?.isConnected) {
        opener.current.focus();
      }

      navigated.current = false;
    }

    previousOpen.current = snapshot.isOpen;
  }, [snapshot.isOpen]);

  return {
    open,
    palette: <GlobalCommandSearch
      controller={controller}
      snapshot={snapshot}
      input={input}
      onClose={close}
      catalogueMessage={settings.isError || catalogueStatus.unavailable
        ? 'Settings search is unavailable.'
        : catalogueStatus.truncated ? 'Settings catalogue limit reached. Narrow your search; additional settings were not searched.' : undefined}
    />,
  };
}

function SearchCombobox({ input }: { input: RefObject<HTMLInputElement | null> }) {
  const config = useCommandListConfig();
  const store = useCommandListStoreContext();
  const activeKey = useSyncExternalStore(store.subscribe, () => store.getSnapshot().activeKey, () => null);
  useEffect(() => {
    if (activeKey !== null) {
      document.getElementById(`${config.listId}-item-${activeKey}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeKey, config.listId]);
  return <CommandList.Input
    ref={input}
    autoFocus={false}
    role='combobox'
    aria-label='Search commands, settings and navigation'
    aria-expanded='true'
    aria-haspopup='listbox'
    aria-activedescendant={activeKey === null ? undefined : `${config.listId}-item-${activeKey}`}
    onKeyDownCapture={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        event.stopPropagation();
      }
    }}
  />;
}

type PaletteProps = {
  controller: GlobalSearchController | null;
  snapshot: SearchSnapshot;
  input: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  catalogueMessage?: string;
};

function GlobalCommandSearch({ controller, snapshot, input, onClose, catalogueMessage }: PaletteProps) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (snapshot.isOpen) {
      input.current?.focus();
    } 
  }, [snapshot.isOpen, input]);
  const disabledKeys = useMemo(() => snapshot.rows.filter((row) => row.disabledReason !== undefined || snapshot.executionPending).map((row) => row.key), [snapshot.rows, snapshot.executionPending]);
  const loading = snapshot.sources.some((source) => source.state === 'queued' || source.state === 'pending');
  function containFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') {
      return;
    }

    const targets = surface.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])');
    const focusable = targets ? Array.from(targets).filter((target) => !target.closest('[hidden], [aria-hidden="true"]')) : [];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first) {
      event.preventDefault(); surface.current?.focus(); return; 
    }

    if (event.shiftKey && (document.activeElement === first || !surface.current?.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !surface.current?.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  }

  return <Dialog ref={surface} open={snapshot.isOpen} onClose={onClose} size='lg' onKeyDown={containFocus}>
    <Dialog.Title>Search commands, settings and navigation</Dialog.Title>
    <Dialog.Close aria-label='Close search' />
    <Dialog.Body>
      <CommandList<SearchRow>
        role='presentation'
        aria-expanded={undefined}
        aria-haspopup={undefined}
        aria-owns={undefined}
        aria-activedescendant={undefined}
        items={snapshot.rows}
        itemKey={(row) => row.key}
        getTextValue={(row) => row.label}
        query={snapshot.query}
        onQueryChange={(query) => controller?.setQuery(query)}
        sortByScore={false}
        virtualized={false}
        disabledKeys={disabledKeys}
        loading={loading}
        aria-busy={snapshot.executionPending || undefined}
        placeholder='Search commands, settings and navigation…'
        onAction={(key) => {
          void controller?.activate(String(key)); 
        }}
        onDismiss={onClose}
        onKeyDownCapture={(event) => {
          if (event.target !== input.current && (event.key === 'Enter' || event.key === ' ')) {
            event.stopPropagation();
          }
        }}
        renderItem={(row) => <CommandList.Item itemKey={row.key} disabled={Boolean(row.disabledReason) || snapshot.executionPending}>
          <div className={styles.Row}>
            <CommandList.ItemLabel>{row.label}</CommandList.ItemLabel>
            <span className={styles.Kind}>{row.value.kind}{row.value.kind === 'setting' && row.value.target.section !== 'extensions'
              && ` · ${row.value.target.settingId ?? (row.value.target.section === 'core' ? row.value.target.categoryId : row.value.target.pluginId)}`}</span>
            {row.value.description && <CommandList.ItemDescription>{row.value.description}</CommandList.ItemDescription>}
            {row.disabledReason && <CommandList.ItemDescription>{row.disabledReason}</CommandList.ItemDescription>}
          </div>
        </CommandList.Item>}
      >
        <SearchCombobox input={input} />
        <CommandList.Results className={styles.Results} />
        {!loading && <CommandList.Empty>No matching commands, settings or navigation.</CommandList.Empty>}
        <CommandList.Loading>Searching external sources…</CommandList.Loading>
      </CommandList>
      {(Boolean(snapshot.message) || Boolean(catalogueMessage)) && <p role='status'>{[snapshot.message, catalogueMessage].filter(Boolean).join(' ')}</p>}
      {snapshot.sources.some((source) => source.state !== 'complete') && <ul className={styles.Sources} aria-label='Search source status'>
        {snapshot.sources.filter((source) => source.state !== 'complete').map((source) => <li key={source.id}>
          {source.label}: {source.state === 'unavailable' ? 'Search source unavailable.'
            : source.state === 'source-limit' ? 'Source limit reached; additional sources were not searched.'
              : source.state === 'truncated' ? 'Additional results are not displayed.' : 'Searching…'}
        </li>)}
      </ul>}
      {snapshot.feedback && <p role='status' aria-live='polite'>
        {snapshot.feedback.message}{snapshot.feedback.code && ` (${snapshot.feedback.code})`}{snapshot.feedback.requestId && ` Request: ${snapshot.feedback.requestId}`}
      </p>}
    </Dialog.Body>
  </Dialog>;
}
