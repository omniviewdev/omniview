import type { FC } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ExtensionProvider, PluginWindow } from '@omniviewdev/runtime';
import type { ExtensionRegistration, HomepageCardProps } from '@omniviewdev/runtime';
import { DevProcessStatus, DevServerState } from '@omniviewdev/runtime/models';
import { PluginService } from '@/features/plugins/core/PluginService';
import { PluginServiceContext } from '@/features/plugins/react/context';
import { createDeferred, createTestDeps } from '@/features/plugins/testing/helpers';
import type { TestDeps } from '@/features/plugins/testing/helpers';
import Home from './index';

const backend = vi.hoisted(() => ({ listPlugins: vi.fn(), listServers: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({
  PluginManager: { ListPlugins: backend.listPlugins },
  DevServerManager: { ListDevServerStates: backend.listServers },
}));

type HomepageModule = {
  plugin: PluginWindow;
  extensionRegistrations: Array<ExtensionRegistration<FC<HomepageCardProps>>>;
};

function cardModule(label: string): HomepageModule {
  return {
    plugin: new PluginWindow(),
    extensionRegistrations: [{
      extensionPointId: 'omniview/home/card',
      registration: { id: 'home', label, value: () => <h2>{label}</h2> },
    }],
  };
}

describe('homepage plugin startup', () => {
  let deps: TestDeps;
  let service: PluginService;

  beforeEach(() => {
    localStorage.clear();
    deps = createTestDeps();
    deps.extensions.addExtensionPoint({ id: 'omniview/home/card', pluginId: 'core', mode: 'multiple' });
    service = new PluginService(deps.deps);
    backend.listPlugins.mockReset().mockResolvedValue([{ id: 'kubernetes', devMode: false }]);
    backend.listServers.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  function renderHome() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(
      <QueryClientProvider client={client}>
        <ExtensionProvider registry={deps.extensions}>
          <PluginServiceContext.Provider value={service}>
            <MemoryRouter><Home /></MemoryRouter>
          </PluginServiceContext.Provider>
        </ExtensionProvider>
      </QueryClientProvider>,
    );
  }

  it('does not show the empty Welcome page while plugin contributions are importing', async () => {
    const imported = createDeferred<HomepageModule>();
    deps.importer.register('kubernetes', async () => imported.promise);
    const loading = service.load('kubernetes');
    renderHome();

    expect(screen.queryByText('The IDE for')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeVisible();
    await act(async () => {
      imported.resolve(cardModule('Kubernetes clusters'));
      await loading;
      service.markReady();
    });

    expect(await screen.findByRole('heading', { name: 'Kubernetes clusters' })).toBeVisible();
    expect(screen.queryByText('The IDE for')).not.toBeInTheDocument();
  });

  it('keeps pending dev-server contributions distinct from a settled empty homepage', async () => {
    backend.listPlugins.mockResolvedValue([{ id: 'kubernetes', devMode: true }]);
    backend.listServers.mockResolvedValue([new DevServerState({
      pluginID: 'kubernetes', vitePort: 15173, viteStatus: DevProcessStatus.DevProcessStatusStarting,
    })]);
    service.markReady();
    renderHome();

    expect(await screen.findByRole('status')).toBeVisible();
    expect(screen.queryByText('The IDE for')).not.toBeInTheDocument();
  });

  it('preserves the saved card order while another plugin has not registered yet', async () => {
    backend.listPlugins.mockResolvedValue([
      { id: 'kubernetes', devMode: false }, { id: 'other', devMode: false },
    ]);
    localStorage.setItem('omniview:homepage:cards', JSON.stringify({
      order: ['other/home', 'kubernetes/home'], hidden: [], configs: {},
    }));
    deps.importer.register('kubernetes', cardModule('Kubernetes clusters'));
    deps.importer.register('other', cardModule('Other clusters'));
    await service.load('kubernetes');
    service.markReady();
    renderHome();
    await screen.findByRole('heading', { name: 'Kubernetes clusters' });
    await act(async () => {
      await service.load('other');
    });

    await waitFor(() => {
      expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent))
        .toEqual(['Other clusters', 'Kubernetes clusters']);
    });
  });

  it('shows Welcome after discovery settles with no plugins', async () => {
    backend.listPlugins.mockResolvedValue([]);
    service.markReady();
    renderHome();

    expect(await screen.findByText('The IDE for')).toBeVisible();
  });
});
