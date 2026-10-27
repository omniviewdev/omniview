import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExtensionProvider, PluginWindow } from '@omniviewdev/runtime';
import { Category, Setting, SettingType } from '@omniviewdev/runtime/models';
import type * as RuntimeAPI from '@omniviewdev/runtime/api';
import type * as RuntimeCore from '@omniviewdev/runtime';
import type * as RuntimeWindow from '@omniviewdev/runtime/runtime';
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
  loadConnections: vi.fn(async (_pluginId: string): Promise<never[]> => []),
  isMaximised: vi.fn(async () => false),
  maximise: vi.fn(async () => undefined),
  unMaximise: vi.fn(async () => undefined),
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
      readiness: 'ready',
      repositories: [],
      endpoints: { browser: null, vite: null, hmr: null, mcp: null, control: null, health: null },
    }),
    ResourceClient: {
      ...original.ResourceClient,
      ListPlugins: native.listPlugins,
      LoadConnections: native.loadConnections,
    },
    SettingsProvider: {
      ...original.SettingsProvider,
      ListSettings: vi.fn(async () => ({
        appearance: new Category({
          id: 'appearance',
          label: 'Appearance',
          description: 'Application appearance',
          settings: { theme: new Setting({ id: 'theme', label: 'Theme', type: SettingType.Select }) },
        }),
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

afterEach(() => {
  cleanup();
  native.listPlugins.mockReset().mockResolvedValue([]);
  native.loadConnections.mockReset().mockResolvedValue([]);
  native.isMaximised.mockClear();
  native.maximise.mockClear();
  native.unMaximise.mockClear();
});

function HeaderProviders({ children, service: suppliedService }: { children: ReactNode; service?: PluginService }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }));
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

it('keeps development identity and details available when optional header controls are hidden', async () => {
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
        <HeaderProviders>
          <InstanceProvider>
            <CoreLayoutHeader />
          </InstanceProvider>
        </HeaderProviders>
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
  const instanceButton = screen.getByRole('button', { name: 'DEV · Header profile — instance details' });
  expect(instanceButton).toBeVisible();
  await waitFor(() => {
    expect(document.title).toBe('Omniview — DEV · Header profile');
  });
  fireEvent.click(instanceButton);
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(await screen.findByText('Identity confirmed by the host.')).toBeVisible();
  expect(screen.getByText(fixture.identity.instanceID)).toBeVisible();
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

function renderSearchHeader(searchVisible = true, service?: PluginService) {
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
          <HeaderProviders service={service}>
            <InstanceProvider>
              <button type='button'>Before header</button>
              <CoreLayoutHeader />
              <CurrentLocation />
            </InstanceProvider>
          </HeaderProviders>
        </MemoryRouter>
      </Provider>
    </StrictMode>,
  );
}

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
  await screen.findByRole('option', { name: /home/i });
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
