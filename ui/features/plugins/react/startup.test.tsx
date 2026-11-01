import { StrictMode, useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { DevProcessStatus, DevServerState } from '@omniviewdev/runtime/models';
import { PluginWindow } from '@omniviewdev/runtime';
import { PluginServiceProvider } from './PluginServiceProvider';
import { usePageRoutes } from '../../workspace/pageRoutes';
import { PageTabRouters, routerPathOf } from '../../workspace/tabRouters';
import { devToolsChannel } from '../../devtools/events';
import { createDeferred, createTestDeps } from '../testing/helpers';
import type { PluginServiceDeps } from '../core/types';
import type { TestDeps } from '../testing/helpers';
import type * as RuntimeAPI from '@omniviewdev/runtime/api';
import type * as RuntimeCore from '@omniviewdev/runtime/runtime';

const backend = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  listServers: vi.fn(),
  restart: vi.fn(),
  openSettings: vi.fn(),
  deps: null as PluginServiceDeps | null,
}));
vi.mock('@omniviewdev/runtime/api', async (importOriginal) => {
  const original = await importOriginal<typeof RuntimeAPI>();
  return {
    ...original,
    PluginManager: { ...original.PluginManager, ListPlugins: backend.listPlugins },
    DevServerManager: { ...original.DevServerManager, ListDevServerStates: backend.listServers, RestartDevServer: backend.restart },
  };
});
vi.mock('@omniviewdev/runtime/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof RuntimeCore>();
  return {
    ...original,
    Events: {
      ...original.Events,
      On: (eventName: string, handler: (event: { data: unknown }) => void) =>
        backend.deps!.onEvent(eventName, (data: unknown) => {
          handler({ data }); 
        }),
    },
  };
});
vi.mock('../../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/window/service', () => ({
  OpenSettings: backend.openSettings,
}));
vi.mock('../../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/servicewrapper', () => ({
  GetPluginMeta: async () => ({ id: 'kubernetes', name: 'Kubernetes' }),
}));
vi.mock('../../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/settings/binding', () => ({
  GetSnapshot: async (scope: { kind: string; pluginId?: string }) => ({ scope, categories: {} }),
}));
vi.mock('../adapters/createProductionDeps', () => ({ createProductionDeps: () => backend.deps }));
vi.mock('@/pages/home', () => ({ default: () => <h1>Home</h1> }));
vi.mock('@/pages/plugins', () => ({ default: () => <h1>Plugins</h1> }));
vi.mock('@/pages/plugins/InstalledPlugins', () => ({ default: () => null }));
vi.mock('@/pages/plugins/PluginDetails', () => ({ default: () => null }));

const TAB_ID = 'tab';
let startPath = '/_plugin/kubernetes';
let tabRouters: PageTabRouters | null = null;

/** One page tab, as a workspace pane renders it: a memory router rebuilt in place when plugin routes change. */
function SingleTabWorkspace() {
  const routes = usePageRoutes();
  const [routers] = useState(() => new PageTabRouters(routes, () => undefined));
  const router = useSyncExternalStore(routers.subscribe, () => routers.get(TAB_ID));
  useEffect(() => {
    tabRouters = routers;
    routers.setRoutes(routes);
  }, [routers, routes]);
  useLayoutEffect(() => {
    routers.ensure(TAB_ID, startPath);
  }, [routers]);

  return (
    <main>
      <button
        type="button"
        onClick={() => {
          void router?.navigate('/settings');
        }}
      >
        Settings
      </button>
      {router && <RouterProvider router={router} />}
    </main>
  );
}

function currentTabPath(): string {
  const router = tabRouters?.get(TAB_ID);
  if (!router) {
    throw new Error('the tab has no router');
  }

  return routerPathOf(router.state.location);
}

function server(viteStatus: DevProcessStatus) {
  return new DevServerState({ pluginID: 'kubernetes', vitePort: 15173, viteStatus });
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <PluginServiceProvider><SingleTabWorkspace /></PluginServiceProvider>
    </QueryClientProvider>,
  );
  return client;
}

type PluginModule = { plugin: PluginWindow };

function pluginModule(title = 'Kubernetes clusters'): PluginModule {
  return { plugin: new PluginWindow().withRoutes([
    { index: true, Component: () => <h1>{title}</h1> },
    { path: 'cluster/:id', Component: () => <h1>Cluster details</h1> },
  ]) };
}

describe('plugin startup navigation', () => {
  let testDeps: TestDeps;

  beforeEach(() => {
    testDeps = createTestDeps();
    backend.deps = testDeps.deps;
    backend.listPlugins.mockReset().mockResolvedValue([{ id: 'kubernetes', devMode: true }]);
    backend.listServers.mockReset().mockResolvedValue([server(DevProcessStatus.DevProcessStatusStarting)]);
    backend.restart.mockReset().mockResolvedValue(undefined);
    backend.openSettings.mockReset().mockResolvedValue('settings');
    startPath = '/_plugin/kubernetes';
    tabRouters = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('shows progress and opens automatically when a delayed dev server becomes ready', async () => {
    const imported = createDeferred<PluginModule>();
    testDeps.importer.register('kubernetes', async () => imported.promise);
    renderWorkspace();

    expect(await screen.findByRole('status')).toBeVisible();
    // Allocating the port must not start an import from a server still starting.
    await screen.findByText(/Waiting for the plugin development server/);
    expect(testDeps.importer.importCount).toBe(0);

    await act(async () => {
      devToolsChannel.emit('onStatusChange', server(DevProcessStatus.DevProcessStatusReady)); 
    });
    await waitFor(() => {
      expect(testDeps.importer.importCount).toBe(1); 
    });
    expect(screen.getByRole('status')).toBeVisible();
    await act(async () => {
      imported.resolve(pluginModule()); 
    });

    expect(await screen.findByRole('heading', { name: 'Kubernetes clusters' })).toBeVisible();
    expect(currentTabPath()).toBe('/_plugin/kubernetes');
  });

  it('loads from an already-ready snapshot without waiting for another event', async () => {
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    testDeps.importer.register('kubernetes', pluginModule());
    startPath = '/_plugin/kubernetes/cluster/early';
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Cluster details' })).toBeVisible();
    expect(currentTabPath()).toBe('/_plugin/kubernetes/cluster/early');
  });

  it('renders repaired plugin routes after the provider remounts over the same extension registry', async () => {
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    const original = pluginModule('Original plugin');
    original.plugin.registerExtensionPoints([{ id: 'kubernetes/cluster/page', mode: 'multiple' }]);
    testDeps.importer.register('kubernetes', original);
    renderWorkspace();
    await screen.findByRole('heading', { name: 'Original plugin' });

    // Fast Refresh can replace the provider without replacing the retained registry.
    cleanup();
    const repaired = pluginModule('Repaired plugin');
    repaired.plugin.registerExtensionPoints([{ id: 'kubernetes/cluster/page', mode: 'multiple' }]);
    testDeps.importer.register('kubernetes', repaired);
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Repaired plugin' })).toBeVisible();
    expect(currentTabPath()).toBe('/_plugin/kubernetes');
    expect(testDeps.extensions.getExtensionPoint('kubernetes/cluster/page')).toBeDefined();
  });

  it('does not publish a retired provider import over the repaired provider', async () => {
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    const started = createDeferred();
    const pending = createDeferred<PluginModule>();
    testDeps.importer.register('kubernetes', async () => {
      started.resolve();
      return pending.promise;
    });
    renderWorkspace();
    await act(async () => {
      await started.promise;
    });
    cleanup();

    const repaired = pluginModule('Repaired plugin');
    repaired.plugin.registerExtensionPoints([{ id: 'kubernetes/cluster/page', mode: 'multiple' }]);
    testDeps.importer.register('kubernetes', repaired);
    renderWorkspace();
    await screen.findByRole('heading', { name: 'Repaired plugin' });

    const retired = pluginModule('Retired plugin');
    retired.plugin.registerExtensionPoints([{ id: 'kubernetes/cluster/page', mode: 'multiple' }]);
    await act(async () => {
      pending.resolve(retired);
    });

    expect(screen.getByRole('heading', { name: 'Repaired plugin' })).toBeVisible();
    expect(testDeps.log.byLevel('error')).toEqual([]);
  });

  it('loads cached startup descriptors after Strict Mode replays provider effects', async () => {
    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: false }]);
    const module = pluginModule('Strict Mode plugin');
    module.plugin.registerExtensionPoints([{ id: 'kubernetes/cluster/page', mode: 'multiple' }]);
    testDeps.importer.register('kubernetes', module);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryData(['plugins'], [{ id: 'kubernetes', devMode: false }]);
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <PluginServiceProvider><SingleTabWorkspace /></PluginServiceProvider>
        </QueryClientProvider>
      </StrictMode>,
    );

    expect(await screen.findByRole('heading', { name: 'Strict Mode plugin' })).toBeVisible();
    expect(testDeps.log.byLevel('error')).toEqual([]);
  });

  it.each(['Retry', 'Reset'])('recovers from import failure through %s at the same URL', async (action) => {
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    testDeps.importer.register('kubernetes', () => {
      throw new Error('Plugin entry unavailable'); 
    });
    const client = renderWorkspace();

    await waitFor(() => {
      expect(screen.getByText('Plugin entry unavailable')).toBeVisible();
    });
    // A refreshed inventory must leave failed imports available for recovery.
    await act(async () => {
      await client.refetchQueries({ queryKey: ['plugins'] });
    });
    expect(screen.getByText('Plugin entry unavailable')).toBeVisible();
    testDeps.importer.register('kubernetes', pluginModule());
    await act(async () => {
      screen.getByRole('button', { name: action }).click();
    });

    // The service applies its normal one-second retry backoff.
    expect(await screen.findByRole('heading', { name: 'Kubernetes clusters' }, { timeout: 3000 })).toBeVisible();
  });

  it('shows dev-server failure instead of waiting forever', async () => {
    backend.listServers.mockResolvedValue([new DevServerState({
      ...server(DevProcessStatus.DevProcessStatusError), lastError: 'Vite could not start',
    })]);
    renderWorkspace();

    expect(await screen.findByText('Vite could not start')).toBeVisible();
    expect(testDeps.importer.importCount).toBe(0);
  });

  it.each(['Stopped', 'Failed', 'BuildFailed'])('shows %s inventory without a dev server and exposes recovery tools', async (phase) => {
    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: true, phase }]);
    backend.listServers.mockResolvedValue([]);
    renderWorkspace();
    expect(await screen.findByRole('heading', { name: 'Unable to load kubernetes' })).toBeVisible();
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(testDeps.importer.importCount).toBe(0);
    expect(screen.getByRole('button', { name: 'Restart dev server' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open build output' })).toBeVisible();
  });

  it('does not offer development recovery for failed production inventory', async () => {
    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: false, phase: 'BuildFailed' }]);
    backend.listServers.mockResolvedValue([]);
    const pendingImport = createDeferred<PluginModule>();
    testDeps.importer.register('kubernetes', async () => pendingImport.promise);
    renderWorkspace();
    expect(await screen.findByRole('heading', { name: 'Unable to load kubernetes' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Restart dev server' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open build output' })).not.toBeInTheDocument();
  });

  it('preserves inventory failure details when server discovery also fails', async () => {
    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: true, phase: 'BuildFailed', lastError: 'Compiler rejected resource handler' }]);
    backend.listServers.mockRejectedValue(new Error('Server discovery unavailable'));
    renderWorkspace();
    expect(await screen.findByText('Compiler rejected resource handler')).toBeVisible();
    expect(screen.queryByText('Server discovery unavailable')).not.toBeInTheDocument();
  });

  it('reports restart rejection without needing a backend status event', async () => {
    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: true, phase: 'Stopped' }]);
    backend.listServers.mockResolvedValue([]);
    backend.restart.mockRejectedValue(new Error('Workspace selection changed'));
    renderWorkspace();
    const button = await screen.findByRole('button', { name: 'Restart dev server' });
    await act(async () => {
      button.click();
    });
    expect(await screen.findByText('Workspace selection changed')).toBeVisible();
    expect(button).toBeEnabled();
  });

  it('waits for an absent server while inventory is starting, then loads on readiness', async () => {
    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: true, phase: 'Starting' }]);
    backend.listServers.mockResolvedValue([]);
    testDeps.importer.register('kubernetes', pluginModule());
    renderWorkspace();

    expect(await screen.findByText(/Waiting for the plugin development server/)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(testDeps.importer.importCount).toBe(0);
    await act(async () => {
      devToolsChannel.emit('onStatusChange', server(DevProcessStatus.DevProcessStatusReady));
    });

    expect(await screen.findByRole('heading', { name: 'Kubernetes clusters' })).toBeVisible();
  });

  it('clears failed inventory feedback during recovery and loads at the same URL', async () => {
    backend.listPlugins.mockResolvedValue([{
      id: 'kubernetes', devMode: true, phase: 'Failed', lastError: 'Plugin handshake failed',
    }]);
    backend.listServers.mockResolvedValue([]);
    testDeps.importer.register('kubernetes', pluginModule());
    renderWorkspace();
    await screen.findByText('Plugin handshake failed');

    backend.listPlugins.mockResolvedValue([{
      id: 'kubernetes', devMode: true, phase: 'Starting', lastError: '',
    }]);
    await act(async () => {
      testDeps.eventBus.emit('plugin/inventory_changed', { id: 'kubernetes' });
    });
    expect(await screen.findByText(/Waiting for the plugin development server/)).toBeVisible();
    expect(screen.queryByText('Plugin handshake failed')).not.toBeInTheDocument();
    await act(async () => {
      devToolsChannel.emit('onStatusChange', server(DevProcessStatus.DevProcessStatusReady));
    });

    expect(await screen.findByRole('heading', { name: 'Kubernetes clusters' })).toBeVisible();
    expect(currentTabPath()).toBe('/_plugin/kubernetes');
  });

  it('accepts server readiness before stale stopped inventory refreshes', async () => {
    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: true, phase: 'Stopped' }]);
    backend.listServers.mockResolvedValue([]);
    testDeps.importer.register('kubernetes', pluginModule());
    renderWorkspace();
    await screen.findByRole('alert');
    await act(async () => {
      devToolsChannel.emit('onStatusChange', server(DevProcessStatus.DevProcessStatusReady));
    });

    expect(await screen.findByRole('heading', { name: 'Kubernetes clusters' })).toBeVisible();
  });

  it.each(['/_plugin/not-installed', '/_plugin/kubernetes/not-a-page'])(
    'shows not-found feedback for %s',
    async (path) => {
      backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
      testDeps.importer.register('kubernetes', pluginModule());
      startPath = path;
      renderWorkspace();

      // Registering the installed plugin replaces the tab router and may run
      // loaders before the final not-found page commits.
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Page not found' })).toBeVisible();
      });
    },
  );

  it('opens native Settings while a plugin import is pending without replacing that page', async () => {
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    const imported = createDeferred<PluginModule>();
    testDeps.importer.register('kubernetes', async () => imported.promise);
    renderWorkspace();
    await screen.findByRole('status');

    await act(async () => {
      screen.getByRole('button', { name: 'Settings' }).click();
    });
    expect(backend.openSettings).toHaveBeenCalledWith('');
    expect(currentTabPath()).toBe('/_plugin/kubernetes');
    await act(async () => {
      imported.resolve(pluginModule());
    });

    expect(await screen.findByRole('heading', { name: 'Kubernetes clusters' })).toBeVisible();
    expect(currentTabPath()).toBe('/_plugin/kubernetes');
  });

  it('loads a committed replacement after the previous module failed at the same URL', async () => {
    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: false }]);
    let currentModule: () => PluginModule = () => {
      throw new Error('Broken previous plugin module');
    };

    // SystemJS retains rejected imports until their URL is explicitly evicted.
    let cachedModule: Promise<PluginModule> | undefined;
    testDeps.deps.importPlugin = async () => {
      cachedModule ??= Promise.resolve().then(currentModule);
      return cachedModule;
    };

    testDeps.deps.clearPlugin = async () => {
      cachedModule = undefined;
    };

    renderWorkspace();
    await screen.findByText('Broken previous plugin module');

    currentModule = () => pluginModule('Reinstalled plugin');
    await act(async () => {
      testDeps.eventBus.emit('plugin/install_finished', { id: 'kubernetes' });
    });

    expect(await screen.findByRole('heading', { name: 'Reinstalled plugin' })).toBeVisible();
    expect(currentTabPath()).toBe('/_plugin/kubernetes');
  });

  it('keeps a committed replacement when the previous startup import finishes later', async () => {
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    const started = createDeferred();
    const importing = createDeferred<PluginModule>();
    testDeps.importer.register('kubernetes', async () => {
      started.resolve();
      return importing.promise;
    });
    renderWorkspace();
    await act(async () => {
      await started.promise;
    });

    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: false }]);
    testDeps.importer.register('kubernetes', pluginModule('Committed startup replacement'));
    await act(async () => {
      testDeps.eventBus.emit('plugin/install_finished', { id: 'kubernetes' });
    });
    await act(async () => {
      importing.resolve(pluginModule('Superseded startup plugin'));
    });

    expect(await screen.findByRole('heading', { name: 'Committed startup replacement' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Superseded startup plugin' })).not.toBeInTheDocument();
  });

  it('recovers a failed archive replacement of a running development plugin', async () => {
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    let currentArchive: () => PluginModule = () => {
      throw new Error('Broken archive replacement');
    };

    let cachedArchive: Promise<PluginModule> | undefined;
    testDeps.deps.importPlugin = async (options) => {
      if (options.dev) {
        return Promise.resolve(pluginModule('Original development plugin'));
      }

      cachedArchive ??= Promise.resolve().then(currentArchive);
      return cachedArchive;
    };

    testDeps.deps.clearPlugin = async (options) => {
      if (!options.dev) {
        cachedArchive = undefined;
      }
    };

    renderWorkspace();
    await screen.findByRole('heading', { name: 'Original development plugin' });

    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: false }]);
    await act(async () => {
      testDeps.eventBus.emit('plugin/install_finished', { id: 'kubernetes' });
    });
    currentArchive = () => pluginModule('Repaired archive replacement');
    await act(async () => {
      testDeps.eventBus.emit('plugin/install_finished', { id: 'kubernetes' });
    });

    expect(await screen.findByRole('heading', { name: 'Repaired archive replacement' })).toBeVisible();
  });

  it('publishes the latest committed artifact when a prior reload is still importing', async () => {
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    testDeps.importer.register('kubernetes', pluginModule('Original plugin'));
    renderWorkspace();
    await screen.findByRole('heading', { name: 'Original plugin' });

    const started = createDeferred();
    const importing = createDeferred<PluginModule>();
    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: false }]);
    testDeps.importer.register('kubernetes', async () => {
      started.resolve();
      return importing.promise;
    });
    await act(async () => {
      testDeps.eventBus.emit('plugin/update_complete', { pluginID: 'kubernetes' });
      await started.promise;
    });

    testDeps.importer.register('kubernetes', pluginModule('Latest committed plugin'));
    await act(async () => {
      testDeps.eventBus.emit('plugin/install_finished', { id: 'kubernetes' });
      importing.resolve(pluginModule('Superseded plugin'));
    });

    expect(await screen.findByRole('heading', { name: 'Latest committed plugin' })).toBeVisible();
    expect(currentTabPath()).toBe('/_plugin/kubernetes');
  });

  it('discovers committed inventory without a mounted management screen', async () => {
    backend.listPlugins.mockResolvedValue([]);
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    testDeps.importer.register('kubernetes', pluginModule());
    renderWorkspace();
    await screen.findByRole('heading', { name: 'Page not found' });

    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: true }]);
    await act(async () => {
      testDeps.eventBus.emit('plugin/inventory_changed', { id: 'kubernetes' });
    });

    expect(await screen.findByRole('heading', { name: 'Kubernetes clusters' })).toBeVisible();
  });

  it('does not load a dev plugin twice when it is queued behind the first startup chunk', async () => {
    const first = createDeferred<PluginModule>();
    const descriptors = Array.from({ length: 5 }, (_, index) => ({ id: `plugin-${index}`, devMode: false }));
    backend.listPlugins.mockResolvedValue([...descriptors, { id: 'kubernetes', devMode: true }]);
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    for (const descriptor of descriptors) {
      testDeps.importer.register(descriptor.id, pluginModule());
    }

    testDeps.importer.register('plugin-0', async () => first.promise);
    const module = pluginModule();
    module.plugin.registerExtensionPoints([{ id: 'kubernetes/startup', mode: 'multiple' }]);
    testDeps.importer.register('kubernetes', module);
    renderWorkspace();
    await waitFor(() => {
      expect(testDeps.importer.importCount).toBeGreaterThanOrEqual(5);
    });

    await act(async () => {
      first.resolve(pluginModule());
    });

    expect(await screen.findByRole('heading', { name: 'Kubernetes clusters' })).toBeVisible();
  });
});
