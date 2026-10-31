import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExtensionProvider, GLOBAL_SEARCH_OPEN_EVENT, PluginWindow, resourceQueryKeys, usePluginContext } from '@omniviewdev/runtime';
import { Category, ConnectionStatusCode, Setting, SettingType } from '@omniviewdev/runtime/models';
import type * as RuntimeAPI from '@omniviewdev/runtime/api';
import type * as RuntimeCore from '@omniviewdev/runtime';
import type * as RuntimeWindow from '@omniviewdev/runtime/runtime';
import type * as WailsRuntime from '@wailsio/runtime';
import { afterAll, afterEach, expect, it, vi } from 'vitest';

import { InstanceProvider } from '@/features/instance/InstanceContext';
import { EXTENSION_REGISTRY } from '@/features/extensions/store';
import { ensureBuiltinExtensionPointsRegistered } from '@/features/extensions/registerBuiltinExtensionPoints';
import { PluginService } from '@/features/plugins/core/PluginService';
import type { PluginServiceDeps } from '@/features/plugins/core/types';
import { PluginServiceContext } from '@/features/plugins/react/context';
import { createDeferred, createTestDeps } from '@/features/plugins/testing/helpers';
import headerReducer, { actions } from '@/store/header/slice';
import { HeaderAreaItemType, type HeaderIconLink, type HeaderState } from '@/store/header/types';
import CoreLayoutHeader from '..';
import { RouterBoundPageNavigation } from '@/features/workspace/testing/RouterBoundPageNavigation';

const fixture = vi.hoisted(() => {
  const previousBootstrap = window.__OMNIVIEW_BOOTSTRAP__;
  const identity = Object.freeze({
    schemaVersion: 1 as const,
    instanceID: '58613958-8ec9-4b66-92aa-7c8d28b8eb0e',
    displayName: 'Header profile',
    generation: 'a41c2df9-5315-4a3b-b1b1-9384bbdc2613',
    kind: 'development' as const,
  });
  window.__OMNIVIEW_BOOTSTRAP__ = { identity, storageKey: (key: string) => `${identity.instanceID}:${key}` };
  return { identity, previousBootstrap };
});

const native = vi.hoisted(() => ({
  listPlugins: vi.fn(async (): Promise<string[]> => []),
  listAllConnections: vi.fn(async () => ({})),
  loadConnections: vi.fn(async (_pluginId: string): Promise<never[]> => []),
  checkConnection: vi.fn(async () => ({ status: '', details: '', error: '' })),
  subscribeResource: vi.fn(async (): Promise<void> => undefined),
  unsubscribeResource: vi.fn(async (): Promise<void> => undefined),
  listeners: new Map<string, Set<(event: { data: unknown }) => void>>(),
  showResourceSidebar: vi.fn(async () => true),
  isMaximised: vi.fn(async () => false),
  maximise: vi.fn(async () => undefined),
  unMaximise: vi.fn(async () => undefined),
}));

function resourceTypeScope(pluginId = 'opaque', connectionId = 'project'): Extract<RuntimeCore.SearchScopeV1, { kind: 'resource-type' }> {
  return {
    kind: 'resource-type', pluginId, targetId: 'header-search-membership', label: 'Instances',
    target: { provider: pluginId, authority: 'host-test-authority', type: 'instance', route: { connection: connectionId }, scope: [], representation: 'json' },
  };
}

function resourceScope(): Extract<RuntimeCore.SearchScopeV1, { kind: 'resource' }> {
  const { pluginId, targetId, target } = resourceTypeScope();
  return {
    kind: 'resource', pluginId, targetId, label: 'Virtual machine',
    route: target.route, representation: target.representation,
    reference: { address: { provider: target.provider, authority: target.authority, type: target.type, id: 'vm', scope: [] } },
  };
}

function resourceUpdate(targetId = 'header-search-membership'): { data: RuntimeCore.HostWatchUpdatePayload } {
  const scope = resourceScope();
  return { data: {
    route: scope.route, metadata: {}, guarantee: 'bestEffort',
    record: {
      key: 'host-test-row', addressKey: 'host-test-address', targetId, route: scope.route,
      record: {
        reference: scope.reference, body: { kind: 'map', value: {} },
        representation: { id: scope.representation, revision: '1', schema: { state: 'unavailable', validation: 'unvalidated', unvalidated: [] } },
        coverage: { kind: 'complete', paths: [] },
      },
    },
  } };
}

vi.mock('@wailsio/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof WailsRuntime>();
  return {
    ...original,
    Events: {
      ...original.Events,
      On: (name: string, callback: (event: { data: unknown }) => void) => {
        const listeners = native.listeners.get(name) ?? new Set();
        listeners.add(callback);
        native.listeners.set(name, listeners);
        return () => {
          listeners.delete(callback); 
        };
      },
    },
  };
});

vi.mock('../../../../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/servicewrapper', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  GetPluginMeta: async (pluginId: string) => ({ id: pluginId, name: pluginId, version: 'test' }),
}));

vi.mock('@omniviewdev/runtime/api', async (importOriginal) => {
  const original = await importOriginal<typeof RuntimeAPI>();
  return {
    ...original,
    GetInstanceInfo: async () => ({
      ...fixture.identity,
      workspaceID: 'bb25942b-d05e-4de7-9c4c-8bd39479502f',
      channel: 'local',
      stateRoot: '/disposable/header/state',
      version: 'test',
      commit: 'test',
      readiness: 'host-ready',
      repositories: [],
      endpoints: { browser: null, vite: null, hmr: null, mcp: null, control: null, health: null },
    }),
    ResourceClient: {
      ...original.ResourceClient,
      ListPlugins: native.listPlugins,
      // eslint-disable-next-line @typescript-eslint/promise-function-async -- Async wrapping discards the native cancel method.
      ListAllConnections: () => Object.assign(native.listAllConnections(), { cancel: vi.fn() }),
      LoadConnections: native.loadConnections,
      // eslint-disable-next-line @typescript-eslint/promise-function-async -- Async wrapping discards the native cancel method.
      CheckConnection: () => Object.assign(native.checkConnection(), { cancel: vi.fn() }),
      SubscribeResource: native.subscribeResource,
      UnsubscribeResource: native.unsubscribeResource,
    },
    SettingsService: {
      ...original.SettingsService,
      GetSnapshot: vi.fn(async () => ({
        scope: { kind: 'host' },
        categories: { appearance: new Category({
          id: 'appearance',
          label: 'Appearance',
          description: 'Application appearance',
          settings: { theme: new Setting({ id: 'theme', label: 'Theme', type: SettingType.Select }) },
        }) },
      })),
    },
  };
});

vi.mock('@omniviewdev/runtime/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof RuntimeWindow>();
  return {
    ...original,
    Window: {
      ...original.Window,
      IsMaximised: native.isMaximised,
      Maximise: native.maximise,
      UnMaximise: native.unMaximise,
    },
  };
});

vi.mock('@omniviewdev/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof RuntimeCore>();
  return { ...original, useSnackbar: () => ({ showSnackbar: vi.fn() }) };
});

vi.mock('@/hooks/useDevMode', () => ({ useDevMode: () => false }));
vi.mock('@/hooks/useRightDrawer', () => ({
  default: () => ({ showResourceSidebar: native.showResourceSidebar }),
}));

afterEach(() => {
  cleanup();
  native.listPlugins.mockReset().mockResolvedValue([]);
  native.listAllConnections.mockReset().mockResolvedValue({});
  native.loadConnections.mockReset().mockResolvedValue([]);
  native.checkConnection.mockReset().mockResolvedValue({ status: '', details: '', error: '' });
  native.subscribeResource.mockReset().mockResolvedValue(undefined);
  native.unsubscribeResource.mockReset().mockResolvedValue(undefined);
  native.listeners.clear();
  native.isMaximised.mockClear();
  native.maximise.mockClear();
  native.unMaximise.mockClear();
});

function HeaderProviders({ children, service: suppliedService, client: suppliedClient }: {
  children: ReactNode; service?: PluginService; client?: QueryClient;
}) {
  const [client] = useState(() => suppliedClient ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }));
  const [service] = useState(() => suppliedService ?? new PluginService(createTestDeps().deps));
  return (
    <QueryClientProvider client={client}>
      <PluginServiceContext.Provider value={service}>
        <ExtensionProvider registry={EXTENSION_REGISTRY}>{children}</ExtensionProvider>
      </PluginServiceContext.Provider>
    </QueryClientProvider>
  );
}

afterAll(() => {
  window.__OMNIVIEW_BOOTSTRAP__ = fixture.previousBootstrap;
});

it('leaves instance controls out of the header when optional controls are hidden', async () => {
  const item: HeaderIconLink = {
    id: 'optional-settings',
    type: HeaderAreaItemType.LINK,
    icon: 'LuSettings',
    helpText: 'Optional settings tool',
    href: '/settings',
  };
  const header: HeaderState = {
    visible: true,
    areas: {
      left: { visible: true, type: 'items', items: [item] },
      center: { visible: true, type: 'items', items: [] },
      right: { visible: true, type: 'items', items: [] },
    },
  };
  const store = configureStore({ reducer: { header: headerReducer }, preloadedState: { header } });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <RouterBoundPageNavigation>
          <HeaderProviders>
            <InstanceProvider>
              <CoreLayoutHeader />
            </InstanceProvider>
          </HeaderProviders>
        </RouterBoundPageNavigation>
      </MemoryRouter>
    </Provider>,
  );

  expect(screen.getByRole('button', { name: 'Optional settings tool' })).toBeVisible();
  act(() => {
    store.dispatch(actions.setHeaderVisibility(false));
    for (const area of ['left', 'center', 'right'] as const) {
      store.dispatch(actions.setHeaderAreaVisibility({ area, visible: false }));
    }
  });

  expect(screen.queryByRole('button', { name: 'Optional settings tool' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /DEV · Header profile/ })).not.toBeInTheDocument();
  await waitFor(() => {
    expect(document.title).toBe('Omniview — DEV · Header profile');
  });
});

function CurrentLocation() {
  const location = useLocation();
  return (
    <output data-testid='current-location'>
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderSearchHeader(searchVisible = true, service?: PluginService, client?: QueryClient) {
  const header: HeaderState = {
    visible: true,
    areas: {
      left: { visible: false, type: 'items', items: [] },
      center: { visible: searchVisible, type: 'search', items: [] },
      right: { visible: false, type: 'items', items: [] },
    },
  };
  const store = configureStore({ reducer: { header: headerReducer }, preloadedState: { header } });
  return render(
    <StrictMode>
      <Provider store={store}>
        <MemoryRouter initialEntries={['/plugins']}>
          <RouterBoundPageNavigation>
            <HeaderProviders service={service} client={client}>
              <InstanceProvider>
                <button type='button'>Before header</button>
                <CoreLayoutHeader />
                <CurrentLocation />
              </InstanceProvider>
            </HeaderProviders>
          </RouterBoundPageNavigation>
        </MemoryRouter>
      </Provider>
    </StrictMode>,
  );
}

it('keeps the typed search session and opener across late plugin route publication, reload and removal', async () => {
  const testDeps = createTestDeps();
  const service = new PluginService(testDeps.deps);
  const header: HeaderState = {
    visible: true,
    areas: {
      left: { visible: false, type: 'items', items: [] },
      center: { visible: true, type: 'search', items: [] },
      right: { visible: false, type: 'items', items: [] },
    },
  };
  const store = configureStore({ reducer: { header: headerReducer }, preloadedState: { header } });
  render(
    <StrictMode>
      <Provider store={store}>
        <MemoryRouter initialEntries={['/plugins']}>
          <RouterBoundPageNavigation>
            <HeaderProviders service={service}>
              <InstanceProvider>
                <CoreLayoutHeader />
                <CurrentLocation />
              </InstanceProvider>
            </HeaderProviders>
          </RouterBoundPageNavigation>
        </MemoryRouter>
      </Provider>
    </StrictMode>,
  );
  try {
    const opener = await screen.findByRole('button', { name: 'Search Omniview' });
    opener.focus();
    fireEvent.keyDown(opener, { key: 'k', metaKey: true });
    const input = await screen.findByRole('combobox', { name: 'Search Omniview' });
    fireEvent.change(input, { target: { value: 'Home' } });
    await screen.findByRole('option', { name: /^Home/ });

    testDeps.importer.register('late-search', {
      plugin: new PluginWindow().withRoutes([{ index: true, Component: () => <h1>Late plugin</h1> }]),
    });
    await act(async () => {
      await service.load('late-search');
    });
    expect(screen.getByRole('combobox', { name: 'Search Omniview' })).toBe(input);
    expect(input).toHaveValue('Home');
    expect(input).toHaveFocus();

    await act(async () => {
      await service.reload('late-search');
    });
    expect(screen.getByRole('combobox', { name: 'Search Omniview' })).toBe(input);
    expect(input).toHaveValue('Home');
    expect(input).toHaveFocus();

    await act(async () => {
      await service.unload('late-search');
    });
    expect(screen.getByRole('combobox', { name: 'Search Omniview' })).toBe(input);
    expect(input).toHaveValue('Home');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Search Omniview' })).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    const reopened = await screen.findByRole('combobox', { name: 'Search Omniview' });
    fireEvent.change(reopened, { target: { value: 'Home' } });
    const home = await screen.findByRole('option', { name: /^Home/ });
    await waitFor(() => {
      expect(home).not.toHaveAttribute('aria-disabled', 'true');
    });
    fireEvent.keyDown(reopened, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByTestId('current-location')).toHaveTextContent(/^\/$/);
    });
    expect(screen.queryByRole('dialog', { name: 'Search Omniview' })).not.toBeInTheDocument();
  } finally {
    cleanup();
  }
});

it.each(['ctrlKey', 'metaKey'] as const)(
  'opens one real header session with %s+K even when the configurable search area is hidden',
  async (modifier) => {
    renderSearchHeader(false);
    const shortcut = new KeyboardEvent('keydown', { key: 'k', [modifier]: true, bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(shortcut);
    });
    const dialog = await screen.findByRole('dialog', { name: /search/i });
    expect(shortcut.defaultPrevented).toBe(true);
    expect(dialog).toBeVisible();
    const input = screen.getByRole('combobox', { name: /search/i });
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(input).toHaveFocus();
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    const listId = input.getAttribute('aria-controls');
    expect(listId).toBeTruthy();
    expect(document.getElementById(listId!)).toHaveAttribute('role', 'listbox');
  },
);

it('opens a focused global search when an external event has null detail', async () => {
  renderSearchHeader();
  act(() => {
    window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_OPEN_EVENT, { detail: null }));
  });
  const input = await screen.findByRole('combobox', { name: /search/i });
  expect(input).toHaveFocus();
  expect(await screen.findByRole('option', { name: /^Home/ })).toBeVisible();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: /search/i })).not.toBeInTheDocument();
});

it('keeps palette double-clicks outside native title-bar maximize behavior', async () => {
  renderSearchHeader();
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  const input = await screen.findByRole('combobox', { name: /search/i });

  await act(async () => {
    fireEvent.click(input, { detail: 2 });
  });
  expect(native.isMaximised).not.toHaveBeenCalled();
  expect(native.maximise).not.toHaveBeenCalled();
  expect(native.unMaximise).not.toHaveBeenCalled();

  fireEvent.keyDown(input, { key: 'Escape' });
  await act(async () => {
    fireEvent.click(screen.getByTestId('app-header'), { detail: 2 });
  });
  expect(native.maximise).toHaveBeenCalledOnce();
});

it('ignores both IME composition and legacy229 shortcut events without preventing browser default', async () => {
  renderSearchHeader();
  for (const detail of [{ isComposing: true }, { keyCode: 229 }]) {
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true, ...detail });
    await act(async () => {
      document.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog', { name: /search/i })).not.toBeInTheDocument();
  }
});

it.each(['ctrlKey', 'metaKey'] as const)('toggles with exact %s+K and restores focus', async (modifier) => {
  renderSearchHeader();
  const opener = screen.getByRole('button', { name: /search/i });
  act(() => {
    opener.focus();
  });
  fireEvent.keyDown(opener, { key: 'k', [modifier]: true });
  const input = await screen.findByRole('combobox', { name: /search/i });
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: 'k', [modifier]: true });
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: /search/i })).not.toBeInTheDocument();
  });
  expect(opener).toHaveFocus();
});

it('leaves modifier variants, held keys and consumed shortcuts to their owner', async () => {
  renderSearchHeader();
  for (const detail of [
    { ctrlKey: true, shiftKey: true },
    { metaKey: true, shiftKey: true },
    { ctrlKey: true, altKey: true },
    { ctrlKey: true, metaKey: true },
    { ctrlKey: true, repeat: true },
  ]) {
    const event = new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true, ...detail });
    act(() => {
      document.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog', { name: /search/i })).not.toBeInTheDocument();
  }

  const consumed = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
  consumed.preventDefault();
  act(() => {
    document.dispatchEvent(consumed);
  });
  expect(screen.queryByRole('dialog', { name: /search/i })).not.toBeInTheDocument();
});

it.each(['dialog', 'alertdialog', 'menu', 'listbox'])('does not steal focus from another %s', async (role) => {
  renderSearchHeader();
  const owner = document.createElement('div');
  owner.setAttribute('role', role);
  const input = document.createElement('input');
  owner.append(input);
  document.body.append(owner);
  try {
    input.focus();
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      input.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(input).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: /search/i })).not.toBeInTheDocument();
  } finally {
    owner.remove();
  }
});

it('opens from the accessible trigger, closes on Escape and restores the connected opener', async () => {
  renderSearchHeader();
  const opener = screen.getByRole('button', { name: /search/i });
  act(() => {
    opener.focus();
  });
  fireEvent.click(opener);
  const input = await screen.findByRole('combobox', { name: /search/i });
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: /search/i })).not.toBeInTheDocument();
  });
  expect(opener).toHaveFocus();
});

it('uses the actual input for controlled matching, current active-option ownership and Enter navigation', async () => {
  renderSearchHeader();
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  const input = await screen.findByRole('combobox', { name: /search/i });
  fireEvent.change(input, { target: { value: 'Home' } });
  const home = await screen.findByRole('option', { name: /home/i });
  await waitFor(() => {
    expect(home).not.toHaveAttribute('aria-disabled', 'true'); 
  });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  const activeId = input.getAttribute('aria-activedescendant');
  expect(activeId).toBeTruthy();
  expect(document.getElementById(activeId!)).toHaveAttribute('role', 'option');
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => {
    expect(screen.getByTestId('current-location').textContent).toBe('/');
  });
  expect(screen.queryByRole('dialog', { name: /search/i })).not.toBeInTheDocument();
});

it('removes the sole shortcut listener on unmount after StrictMode replay', async () => {
  const view = renderSearchHeader(false);
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  await screen.findByRole('dialog', { name: /search/i });
  view.unmount();
  const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
  act(() => {
    document.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(false);
  expect(screen.queryByRole('dialog', { name: /search/i })).not.toBeInTheDocument();
});

it('keeps Clear search keyboard activation out of command dispatch and returns input focus after clearing', async () => {
  renderSearchHeader();
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  const input = await screen.findByRole('combobox', { name: /search/i });
  fireEvent.change(input, { target: { value: 'Home' } });
  await screen.findByRole('option', { name: /home/i });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  const clear = screen.getByRole('button', { name: 'Clear search' });
  act(() => {
    clear.focus();
  });
  fireEvent.keyDown(clear, { key: 'Enter' });
  expect(screen.getByTestId('current-location').textContent).toBe('/plugins');
  await act(async () => {
    fireEvent.click(clear);
    await Promise.resolve();
  });
  expect(input).toHaveValue('');
  expect(input).toHaveFocus();
  expect(screen.getByRole('dialog', { name: /search/i })).toBeVisible();
});

it('ignores IME Enter on the current command option', async () => {
  renderSearchHeader();
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  const input = await screen.findByRole('combobox', { name: /search/i });
  fireEvent.change(input, { target: { value: 'Home' } });
  await screen.findByRole('option', { name: /home/i });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
  expect(screen.getByTestId('current-location').textContent).toBe('/plugins');
});

it('keeps navigation enabled while an accepted native reload remains pending', async () => {
  const pluginId = 'palette-pending-navigation';
  const { service, importer } = createHeaderPluginEnvironment();
  importer.register(pluginId, { plugin: new PluginWindow() });
  await service.load(pluginId);
  const pendingNative = createDeferred<never[]>();
  native.listPlugins.mockResolvedValue([pluginId]);
  native.loadConnections.mockImplementation(async () => pendingNative.promise);

  try {
    renderSearchHeader(true, service);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const input = await screen.findByRole('combobox', { name: /search/i });
    fireEvent.change(input, { target: { value: `Reload ${pluginId} connections` } });
    const command = await screen.findByRole('option', { name: new RegExp(`Reload ${pluginId} connections`) });
    await waitFor(() => {
      expect(command).not.toHaveAttribute('aria-disabled', 'true');
    });
    fireEvent.click(command);
    expect(native.loadConnections).toHaveBeenCalledExactlyOnceWith(pluginId);
    fireEvent.change(input, { target: { value: 'Home' } });
    const home = await screen.findByRole('option', { name: /^Home/ });
    expect(home).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(home);
    expect(screen.getByTestId('current-location').textContent).toBe('/');
    expect(screen.queryByRole('dialog', { name: /search/i })).not.toBeInTheDocument();
  } finally {
    await act(async () => {
      pendingNative.resolve([]);
      await Promise.resolve();
      await service.unload(pluginId);
    });
  }
});

function createHeaderPluginEnvironment(clearPlugin?: PluginServiceDeps['clearPlugin']) {
  const environment = createTestDeps();
  const service = new PluginService({
    ...environment.deps,
    clearPlugin: clearPlugin ?? environment.deps.clearPlugin,
    ensureBuiltinExtensionPoints: () => {
      ensureBuiltinExtensionPointsRegistered(EXTENSION_REGISTRY);
    },
    addExtensionPoint: (point) => {
      EXTENSION_REGISTRY.addExtensionPoint(point);
    },
    removeExtensionPoints: (owner) => {
      EXTENSION_REGISTRY.removeExtensionPoints(owner);
    },
    registerContribution: (point, contribution) => {
      const store = EXTENSION_REGISTRY.getExtensionPoint(point);
      if (!store) {
        throw new Error(`Missing actual extension point: ${point}`);
      }

      store.register(contribution);
    },
    removeContributions: (owner) => {
      EXTENSION_REGISTRY.removeContributions(owner);
    },
  });

  return { service, importer: environment.importer };
}

it('refuses a real row click in the same task that reload moves its owner to loading', async () => {
  const pluginId = 'palette-reload-race';
  const { service, importer } = createHeaderPluginEnvironment();
  const pluginModule = {
    plugin: new PluginWindow().withRoutes([
      { path: '/capabilities', Component: () => <h1>Native tasks navigation</h1> },
    ]),
    extensionRegistrations: [
      {
        extensionPointId: 'omniview/global-search',
        registration: {
          id: 'lifecycle-navigation',
          label: 'Lifecycle navigation target',
          value: { schemaVersion: 1, kind: 'navigation', target: { kind: 'plugin', pluginId, path: '/capabilities' } },
        },
      },
    ],
  };
  importer.register(pluginId, pluginModule);
  await service.load(pluginId);
  expect(service.getPluginState(pluginId)?.phase).toBe('ready');
  const delayedImport = createDeferred<typeof pluginModule>();
  importer.register(pluginId, async () => delayedImport.promise);
  let reloading: Promise<void> | undefined;

  try {
    renderSearchHeader(true, service);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const input = await screen.findByRole('combobox', { name: /search/i });
    fireEvent.change(input, { target: { value: 'Lifecycle navigation target' } });
    const oldRow = await screen.findByRole('option', { name: /Lifecycle navigation target/ });
    await waitFor(() => {
      expect(oldRow).not.toHaveAttribute('aria-disabled', 'true'); 
    });
    expect(screen.getByTestId('current-location').textContent).toBe('/plugins');
    let phaseAtClick: string | undefined;

    await act(async () => {
      reloading = service.reload(pluginId);
      phaseAtClick = service.getPluginState(pluginId)?.phase;
      // No await or React commit between the real loading transition and
      // dispatching through the old, still-connected DOM row.
      expect(oldRow).toBeInTheDocument();
      expect(oldRow).not.toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(oldRow);
      await Promise.resolve();
    });

    expect(phaseAtClick).toBe('loading');
    expect(service.getPluginState(pluginId)?.phase).toBe('loading');
    expect(screen.getByTestId('current-location').textContent).toBe('/plugins');
    expect(screen.getByRole('dialog', { name: /search/i })).toBeVisible();
    expect(input).toHaveValue('Lifecycle navigation target');
  } finally {
    await act(async () => {
      delayedImport.resolve(pluginModule);
      if (reloading) {
        await reloading;
      }

      await service.unload(pluginId);
    });
  }
});

it.each([
  ['reload', 'success'],
  ['reload', 'error'],
  ['unload', 'success'],
  ['unload', 'error'],
] as const)(
  'does not announce a pending native command’s stale %s/%s completion during its owner transition',
  async (operation, outcome) => {
    const pluginId = `palette-pending-${operation}-${outcome}`;
    const clearing = createDeferred();
    let holdClear = false;
    const { service, importer } = createHeaderPluginEnvironment(async () => {
      if (holdClear) {
        await clearing.promise;
      }
    });
    const pluginModule = { plugin: new PluginWindow() };
    importer.register(pluginId, pluginModule);
    await service.load(pluginId);
    expect(service.getPluginState(pluginId)?.phase).toBe('ready');
    const importing = createDeferred<typeof pluginModule>();
    importer.register(pluginId, async () => importing.promise);
    const pendingNative = createDeferred<never[]>();
    native.listPlugins.mockResolvedValue([pluginId]);
    native.loadConnections.mockImplementation(async () => pendingNative.promise);
    let transition: Promise<void> | undefined;
    let observer: MutationObserver | undefined;

    try {
      renderSearchHeader(true, service);
      fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
      const input = await screen.findByRole('combobox', { name: /search/i });
      const label = `Reload ${pluginId} connections`;
      fireEvent.change(input, { target: { value: label } });
      const command = await screen.findByRole('option', { name: new RegExp(label) });
      await waitFor(() => {
        expect(command).not.toHaveAttribute('aria-disabled', 'true');
      });
      fireEvent.click(command);
      expect(native.loadConnections).toHaveBeenCalledExactlyOnceWith(pluginId);
      const dialog = screen.getByRole('dialog', { name: /search/i });
      expect(dialog.querySelector('[aria-busy="true"]')).not.toBeNull();
      holdClear = operation === 'unload';

      await act(async () => {
        transition = operation === 'reload' ? service.reload(pluginId) : service.unload(pluginId);
        await Promise.resolve();
      });

      const expectedPhase = operation === 'reload' ? 'loading' : 'unloading';
      expect(service.getPluginState(pluginId)?.phase).toBe(expectedPhase);
      const renderedUpdates: string[] = [];
      const recordUpdates = (records: MutationRecord[]) => {
        for (const record of records) {
          renderedUpdates.push(record.target.textContent ?? '');
          for (const node of record.addedNodes) {
            renderedUpdates.push(node.textContent ?? '');
          }

          for (const node of record.removedNodes) {
            renderedUpdates.push(node.textContent ?? '');
          }
        }
      };

      observer = new MutationObserver(recordUpdates);
      observer.observe(dialog, { subtree: true, childList: true, characterData: true });

      await act(async () => {
        if (outcome === 'success') {
          pendingNative.resolve([]);
        } else {
          pendingNative.reject(
            new Error(
              JSON.stringify({
                type: 'omniview:resource/forbidden',
                status: 403,
                title: 'Forbidden',
                detail: 'Retired native failure.',
                code: 'FORBIDDEN',
                requestId: 'retired-native-request',
              }),
            ),
          );
        }

        await Promise.resolve();
      });
      await waitFor(() => {
        expect(dialog.querySelector('[aria-busy="true"]')).toBeNull();
      });
      recordUpdates(observer.takeRecords());

      expect(service.getPluginState(pluginId)?.phase).toBe(expectedPhase);
      expect(dialog).toBeVisible();
      expect(input).toHaveValue(label);
      const retiredFeedback = /Connections reloaded\.|Retired native failure\.|FORBIDDEN|retired-native-request/;
      expect(screen.queryByText(retiredFeedback)).not.toBeInTheDocument();
      // A message briefly committed to the live region still violates the epoch
      // fence, even if a later catalogue render removes it before this assertion.
      expect(renderedUpdates.join('\n')).not.toMatch(retiredFeedback);
    } finally {
      observer?.disconnect();
      await act(async () => {
        pendingNative.resolve([]);
        importing.resolve(pluginModule);
        holdClear = false;
        clearing.resolve();
        if (transition) {
          await transition;
        }

        await service.unload(pluginId);
      });
    }
  },
);

it.each(['close', 'unmount', 'scope-change'] as const)('releases late native acquisition after %s without duplicate type ownership', async (operation) => {
  const acquisition = createDeferred();
  native.subscribeResource.mockReturnValueOnce(acquisition.promise);
  const { service, importer } = createHeaderPluginEnvironment();
  importer.register('opaque', { plugin: new PluginWindow() });
  await service.load('opaque');
  const view = renderSearchHeader(true, service);
  act(() => {
    window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_OPEN_EVENT, { detail: {
      scope: resourceScope(),
    } }));
  });
  await screen.findByRole('combobox', { name: /search/i });
  await waitFor(() => {
    expect(native.subscribeResource).toHaveBeenCalledOnce();
  });
  await act(async () => {
    // Moving from an instance to its type keeps the existing native subscription.
    window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_OPEN_EVENT, { detail: {
      scope: resourceTypeScope(),
    } }));
    await Promise.resolve();
  });
  expect(native.subscribeResource).toHaveBeenCalledOnce();
  if (operation === 'unmount') {
    view.unmount();
  } else if (operation === 'scope-change') {
    act(() => {
      window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_OPEN_EVENT, { detail: {
        scope: { kind: 'connection', pluginId: 'opaque', connectionId: 'project', label: 'Project' },
      } }));
    });
  } else {
    fireEvent.keyDown(document, { key: 'Escape' });
  }

  expect(native.unsubscribeResource).not.toHaveBeenCalled();
  await act(async () => {
    acquisition.resolve();
    await acquisition.promise;
  });
  expect(native.unsubscribeResource).toHaveBeenCalledOnce();
  expect(native.listeners.get('opaque/project/instance/UPDATE')?.size).toBe(0);
  view.unmount();
  expect(native.unsubscribeResource).toHaveBeenCalledOnce();
  await act(async () => {
    await service.unload('opaque'); 
  });
});

it('coalesces native resource bursts without rediscovering plugins', async () => {
  const { service, importer } = createHeaderPluginEnvironment();
  let version = 0;
  const search = vi.fn(async (): Promise<RuntimeCore.SearchProviderResponseV1> => ({
    items: [{
      id: 'snapshot', label: `Snapshot ${version}`,
      value: { schemaVersion: 1, kind: 'navigation',
        scope: resourceTypeScope(),
        target: { kind: 'plugin', pluginId: 'opaque', path: '/' } },
    }],
    completion: 'complete',
  }));
  importer.register('opaque', {
    plugin: new PluginWindow().withRoutes([{ path: '/', Component: () => null }]),
    extensionRegistrations: [{
      extensionPointId: 'omniview/global-search',
      registration: { id: 'opaque-live', label: 'Opaque resources', value: {
        schemaVersion: 1, kind: 'provider', connectionRecovery: 'provider', search,
      } },
    }],
  });
  await service.load('opaque');
  renderSearchHeader(true, service);
  act(() => {
    window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_OPEN_EVENT, { detail: {
      scope: resourceTypeScope(),
    } }));
  });
  await screen.findByRole('combobox', { name: /search/i });
  await waitFor(() => {
    expect(native.listPlugins).toHaveBeenCalled(); 
  });
  await screen.findByRole('option', { name: /Snapshot 0/ });
  const searches = search.mock.calls.length;
  const discoveries = native.listPlugins.mock.calls.length;
  try {
    await act(async () => {
      for (let index = 0; index < 10; index++) {
        version = index + 1;
        native.listeners.get('opaque/project/instance/UPDATE')?.forEach((listener) => {
          listener(resourceUpdate());
        });
      }

      await Promise.resolve();
    });
    expect(native.listPlugins).toHaveBeenCalledTimes(discoveries);
    expect(native.subscribeResource).toHaveBeenCalledOnce();
    expect(await screen.findByRole('option', { name: /Snapshot 10/ })).toBeVisible();
    // An idle burst can start one read immediately and one trailing read for changes
    // arriving during it. Ten events must not become ten provider reads.
    expect(search.mock.calls.length - searches).toBeGreaterThan(0);
    expect(search.mock.calls.length - searches).toBeLessThanOrEqual(2);
  } finally {
    await act(async () => {
      await service.unload('opaque'); 
    });
  }
});

it('updates provider Context identity without freezing same-length context metadata', async () => {
  const { service, importer } = createHeaderPluginEnvironment();
  const pluginId = 'dynamic-context';
  const search = async () => ({ items: [], completion: 'complete' as const });
  function FirstContext() {
    const owner = usePluginContext();
    return <span>First context {owner.pluginId}</span>;
  }

  function ReplacementContext() {
    const owner = usePluginContext();
    return <span>Replacement context {owner.pluginId}</span>;
  }

  importer.register(pluginId, {
    plugin: new PluginWindow(),
    extensionRegistrations: [{
      extensionPointId: 'omniview/global-search',
      registration: { id: 'dynamic-context', label: 'Dynamic context', value: {
        schemaVersion: 1, kind: 'provider', search,
        Context: FirstContext,
      } },
    }],
  });
  await service.load(pluginId);
  try {
    renderSearchHeader(true, service);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(await screen.findByText('First context dynamic-context')).toBeVisible();
    expect(screen.getByRole('dialog', { name: /search/i })).toBeVisible();
    act(() => {
      const store = EXTENSION_REGISTRY.getExtensionPoint('omniview/global-search')!;
      const id = store.listAll().find((entry) => entry.plugin === pluginId)!.id;
      store.unregister(id);
      store.register({ id, plugin: pluginId, label: 'Dynamic context', value: {
        schemaVersion: 1, kind: 'provider', search,
        Context: ReplacementContext,
      } });
    });
    expect(await screen.findByText('Replacement context dynamic-context')).toBeVisible();
    expect(screen.queryByText('First context dynamic-context')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /search/i })).toBeVisible();
  } finally {
    await act(async () => {
      await service.unload(pluginId); 
    });
  }
});

it('uses connection-depth adapter targets and isolates throwing adapters', async () => {
  const { service, importer } = createHeaderPluginEnvironment();
  const pluginId = 'adapter-targets';
  const search = async () => ({ items: [], completion: 'complete' as const });
  const target = { kind: 'plugin' as const, pluginId, path: '/dashboard' };
  const supportsScope = vi.fn((scopes: readonly RuntimeCore.SearchScopeV1[]) => scopes[0]?.kind === 'connection');
  importer.register(pluginId, {
    plugin: new PluginWindow().withRoutes([{ path: '/dashboard', Component: () => null }]),
    extensionRegistrations: [
      { extensionPointId: 'omniview/global-search', registration: { id: 'broken-scope', label: 'Broken scope', value: {
        schemaVersion: 1, kind: 'provider', search, connectionRecovery: 'provider',
        supportsScope: () => {
          throw new Error('private adapter details'); 
        },
        connectionTarget: () => target,
      } } },
      { extensionPointId: 'omniview/global-search', registration: { id: 'broken-target', label: 'Broken target', value: {
        schemaVersion: 1, kind: 'provider', search,
        connectionTarget: () => {
          throw new Error('private target details'); 
        },
      } } },
      { extensionPointId: 'omniview/global-search', registration: { id: 'healthy-target', label: 'Healthy target', value: {
        schemaVersion: 1, kind: 'provider', search, supportsScope, connectionTarget: () => target,
      } } },
    ],
  });
  await service.load(pluginId);
  native.listAllConnections.mockResolvedValue({ [pluginId]: [{ id: 'cluster', name: 'Cluster' }] });
  native.checkConnection.mockResolvedValue({ status: ConnectionStatusCode.ConnectionStatusDisconnected, details: '', error: '' });
  try {
    renderSearchHeader(true, service);
    const provider = EXTENSION_REGISTRY.getExtensionPoint('omniview/global-search')!.listAll()
      .find((entry) => entry.id === 'core/global-search/connections')!.value as RuntimeCore.SearchProviderV1;
    const request = { query: '', scopes: [], signal: new AbortController().signal, limit: 20, generation: 1 };
    const root = await provider.search(request);
    expect(root.items[0]?.value).toMatchObject({ target });
    expect(supportsScope).toHaveBeenCalledWith([{ kind: 'connection', pluginId, connectionId: 'cluster', label: 'Cluster' }]);
    const scoped = await provider.search({ ...request, scopes: [
      { kind: 'connection', pluginId, connectionId: 'cluster', label: 'Cluster' },
      resourceTypeScope(pluginId, 'cluster'),
    ] });
    expect(scoped.items[0]?.value).toMatchObject({ action: { recovery: 'connection', target: { kind: 'connection' } } });
  } finally {
    await act(async () => {
      await service.unload(pluginId); 
    });
  }
});

it('reports native subscription failure and retries without replacing the healthy connection watcher', async () => {
  native.subscribeResource.mockRejectedValueOnce(new Error('private backend path'));
  const { service, importer } = createHeaderPluginEnvironment();
  importer.register('opaque', { plugin: new PluginWindow() });
  await service.load('opaque');
  const view = renderSearchHeader(true, service);
  act(() => {
    window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_OPEN_EVENT, { detail: {
      scope: resourceTypeScope(),
    } }));
  });
  expect(await screen.findByText('Live updates are unavailable. Results may be out of date.')).toBeVisible();
  expect(screen.queryByText('private backend path')).not.toBeInTheDocument();
  const watcher = Array.from(native.listeners.get('opaque/project/watch/STATE') ?? []);
  fireEvent.click(screen.getByRole('button', { name: /retry live updates/i }));
  await waitFor(() => {
    expect(native.subscribeResource).toHaveBeenCalledTimes(2); 
  });
  await waitFor(() => {
    expect(screen.queryByText('Live updates are unavailable. Results may be out of date.')).not.toBeInTheDocument(); 
  });
  expect(Array.from(native.listeners.get('opaque/project/watch/STATE') ?? [])).toEqual(watcher);
  expect(native.unsubscribeResource).not.toHaveBeenCalled();
  expect(native.listeners.get('opaque/project/instance/UPDATE')?.size).toBe(1);
  view.unmount();
  await act(async () => {
    await service.unload('opaque'); 
  });
});

it.each(['close', 'unmount'] as const)('ignores late native subscription failure after %s', async (operation) => {
  const acquisition = createDeferred();
  native.subscribeResource.mockReturnValueOnce(acquisition.promise);
  const { service, importer } = createHeaderPluginEnvironment();
  importer.register('opaque', { plugin: new PluginWindow() });
  await service.load('opaque');
  const view = renderSearchHeader(true, service);
  act(() => {
    window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_OPEN_EVENT, { detail: {
      scope: resourceTypeScope(),
    } }));
  });
  await screen.findByRole('combobox', { name: /search/i });
  await waitFor(() => {
    expect(native.subscribeResource).toHaveBeenCalledOnce(); 
  });
  if (operation === 'unmount') {
    view.unmount();
  } else {
    fireEvent.keyDown(document, { key: 'Escape' });
  }

  await act(async () => {
    acquisition.reject(new Error('retired subscription failure'));
    await acquisition.promise.catch(() => undefined);
  });
  if (operation === 'close') {
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    await screen.findByRole('combobox', { name: /search/i });
    expect(screen.queryByText('Live updates are unavailable. Results may be out of date.')).not.toBeInTheDocument();
  }

  expect(native.unsubscribeResource).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => {
    await service.unload('opaque'); 
  });
});

it.each(['publish', 'close'] as const)('preserves an event during a canonical query fetch until %s without leaking cache listeners', async (operation) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const queryKey = resourceQueryKeys.list('opaque');
  const cache = client.getQueryCache();
  const cacheListeners = new Set<unknown>();
  const subscribe = cache.subscribe.bind(cache);
  vi.spyOn(cache, 'subscribe').mockImplementation((listener) => {
    cacheListeners.add(listener);
    const stop = subscribe(listener);
    return () => {
      cacheListeners.delete(listener);
      stop();
    };
  });
  const initialRead = createDeferred();
  let backend = 'old';
  const fetchSnapshot = vi.fn(async () => {
    const snapshot = backend;
    if (snapshot === 'old') {
      await initialRead.promise;
    }

    return snapshot;
  });
  const search = async (): Promise<RuntimeCore.SearchProviderResponseV1> => {
    const snapshot = await client.fetchQuery({ queryKey, queryFn: fetchSnapshot, staleTime: 15_000 });
    return { items: [{
      id: 'snapshot', label: `Snapshot ${snapshot}`,
      value: { schemaVersion: 1, kind: 'navigation',
        scope: resourceTypeScope(),
        target: { kind: 'plugin', pluginId: 'opaque', path: '/' } },
    }], completion: 'complete' };
  };

  const { service, importer } = createHeaderPluginEnvironment();
  importer.register('opaque', {
    plugin: new PluginWindow().withRoutes([{ path: '/', Component: () => null }]),
    extensionRegistrations: [{
      extensionPointId: 'omniview/global-search',
      registration: { id: 'canonical-snapshot', label: 'Canonical snapshot', value: {
        schemaVersion: 1, kind: 'provider', connectionRecovery: 'provider', search,
      } },
    }],
  });
  await service.load('opaque');
  const view = renderSearchHeader(true, service, client);
  const idleListeners = cacheListeners.size;
  try {
    act(() => {
      window.dispatchEvent(new CustomEvent(GLOBAL_SEARCH_OPEN_EVENT, { detail: {
        scope: resourceTypeScope(),
      } }));
    });
    await waitFor(() => {
      expect(fetchSnapshot).toHaveBeenCalledOnce(); 
    });
    await waitFor(() => {
      expect(native.subscribeResource).toHaveBeenCalledOnce(); 
    });
    expect(cacheListeners.size).toBe(idleListeners + 1);
    act(() => {
      native.listeners.get('opaque/project/instance/UPDATE')?.forEach((listener) => {
        listener(resourceUpdate('another-view-membership'));
      });
    });
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
    act(() => {
      backend = 'new';
      for (let index = 0; index < 10; index++) {
        native.listeners.get('opaque/project/instance/UPDATE')?.forEach((listener) => {
          listener(resourceUpdate());
        });
      }
    });
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    if (operation === 'close') {
      fireEvent.keyDown(document, { key: 'Escape' });
    }

    await act(async () => {
      initialRead.resolve();
      await initialRead.promise;
    });
    if (operation === 'publish') {
      expect(await screen.findByRole('option', { name: /Snapshot new/ })).toBeVisible();
      expect(screen.queryByRole('option', { name: /Snapshot old/ })).not.toBeInTheDocument();
      expect(fetchSnapshot).toHaveBeenCalledTimes(2);
      fireEvent.keyDown(document, { key: 'Escape' });
    } else {
      expect(fetchSnapshot).toHaveBeenCalledOnce();
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
    }

    expect(cacheListeners.size).toBe(idleListeners);
  } finally {
    view.unmount();
    await act(async () => {
      await service.unload('opaque'); 
    });
    client.clear();
  }
});
