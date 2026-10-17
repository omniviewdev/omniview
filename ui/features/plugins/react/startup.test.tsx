import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Outlet } from 'react-router-dom';
import { DevProcessStatus, DevServerState } from '@omniviewdev/runtime/models';
import { PluginWindow } from '@omniviewdev/runtime';
import { PluginServiceProvider } from './PluginServiceProvider';
import { RouteProvider } from '../../router/RouteProvider';
import { devToolsChannel } from '../../devtools/events';
import { createDeferred, createTestDeps } from '../testing/helpers';
import type { PluginServiceDeps } from '../core/types';
import type { TestDeps } from '../testing/helpers';
import type * as RuntimeAPI from '@omniviewdev/runtime/api';

const backend = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  listServers: vi.fn(),
  deps: null as PluginServiceDeps | null,
}));
vi.mock('@omniviewdev/runtime/api', async (importOriginal) => {
  const original = await importOriginal<typeof RuntimeAPI>();
  return {
    ...original,
    PluginManager: { ...original.PluginManager, ListPlugins: backend.listPlugins },
    DevServerManager: { ...original.DevServerManager, ListDevServerStates: backend.listServers },
  };
});
vi.mock('../../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/servicewrapper', () => ({
  GetPluginMeta: async () => ({ id: 'kubernetes', name: 'Kubernetes' }),
}));
vi.mock('../../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/settings/servicewrapper', () => ({
  PluginValues: async () => ({}),
}));
vi.mock('../adapters/createProductionDeps', () => ({ createProductionDeps: () => backend.deps }));
vi.mock('../../router/routes', () => ({
  coreRoutes: [{
    path: '/',
    Component: () => <main><Link to="/settings">Settings</Link><Outlet /></main>,
    children: [{ path: 'settings', Component: () => <h1>Settings</h1> }],
  }],
}));

function server(viteStatus: DevProcessStatus) {
  return new DevServerState({ pluginID: 'kubernetes', vitePort: 15173, viteStatus });
}

function renderWorkspace() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <PluginServiceProvider><RouteProvider /></PluginServiceProvider>
    </QueryClientProvider>,
  );
  return client;
}

type PluginModule = { plugin: PluginWindow };

function pluginModule(): PluginModule {
  return { plugin: new PluginWindow().withRoutes([
    { index: true, Component: () => <h1>Kubernetes clusters</h1> },
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
    window.location.hash = '#/_plugin/kubernetes';
  });

  afterEach(() => {
    cleanup();
    window.location.hash = '';
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
    expect(window.location.hash).toBe('#/_plugin/kubernetes');
  });

  it('loads from an already-ready snapshot without waiting for another event', async () => {
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    testDeps.importer.register('kubernetes', pluginModule());
    window.location.hash = '#/_plugin/kubernetes/cluster/early';
    renderWorkspace();

    expect(await screen.findByRole('heading', { name: 'Cluster details' })).toBeVisible();
    expect(window.location.hash).toBe('#/_plugin/kubernetes/cluster/early');
  });

  it.each(['Retry', 'Reset'])('recovers from import failure through %s at the same URL', async (action) => {
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    testDeps.importer.register('kubernetes', () => {
      throw new Error('Plugin entry unavailable'); 
    });
    renderWorkspace();

    expect(await screen.findByText('Plugin entry unavailable')).toBeVisible();
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

  it.each(['/_plugin/not-installed', '/_plugin/kubernetes/not-a-page'])(
    'shows not-found feedback for %s',
    async (path) => {
      backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
      testDeps.importer.register('kubernetes', pluginModule());
      window.location.hash = `#${path}`;
      renderWorkspace();

      expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeVisible();
    },
  );

  it('keeps core navigation responsive while a plugin import is pending', async () => {
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    const imported = createDeferred<PluginModule>();
    testDeps.importer.register('kubernetes', async () => imported.promise);
    renderWorkspace();
    await screen.findByRole('status');

    await act(async () => {
      screen.getByRole('link', { name: 'Settings' }).click();
    });
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeVisible();
    await act(async () => {
      imported.resolve(pluginModule());
    });

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(window.location.hash).toBe('#/settings');
  });

  it('loads dev plugins installed after startup through the normal plugin cache refresh', async () => {
    backend.listPlugins.mockResolvedValue([]);
    backend.listServers.mockResolvedValue([server(DevProcessStatus.DevProcessStatusReady)]);
    testDeps.importer.register('kubernetes', pluginModule());
    const client = renderWorkspace();
    await screen.findByRole('heading', { name: 'Page not found' });

    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: true }]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['plugins'] });
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
