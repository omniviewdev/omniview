import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { DevProcessStatus } from '@omniviewdev/runtime/models';
import { useInstalledPlugins } from './useInstalledPlugins';

const backend = vi.hoisted(() => ({
  list: vi.fn(),
  listeners: new Map<string, Set<(event: { data: unknown }) => void>>(),
}));
vi.mock('@omniviewdev/runtime/api', () => ({
  PluginManager: { ListPlugins: backend.list },
}));
vi.mock('@omniviewdev/runtime/runtime', () => ({
  Events: {
    On: (name: string, handler: (event: { data: unknown }) => void) => {
      const listeners = backend.listeners.get(name) ?? new Set();
      listeners.add(handler);
      backend.listeners.set(name, listeners);
      return () => listeners.delete(handler);
    },
  },
}));
vi.mock('@/features/devtools/useDevServers', () => ({
  useDevServers: () => ({
    servers: new Map([
      ['workspace-probe', { viteStatus: DevProcessStatus.DevProcessStatusReady, vitePort: 24001 }],
      ['kubernetes', { viteStatus: DevProcessStatus.DevProcessStatusReady, vitePort: 24002 }],
    ]),
    isLoading: false,
    error: null,
  }),
}));

function StartupInventory() {
  const { plugins } = useInstalledPlugins();
  return <ul aria-label="Available source plugins">{plugins.map(plugin => (
    <li key={plugin.id}>{plugin.id} {plugin.devPort ? 'ready' : 'waiting'}</li>
  ))}</ul>;
}

describe('managed plugin publication', () => {
  it('adds a late managed source to an already-mounted startup consumer', async () => {
    backend.listeners.clear();
    let published = [{ id: 'workspace-probe', devMode: true }];
    backend.list.mockImplementation(async () => published);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
    });
    const { unmount } = render(
      <QueryClientProvider client={client}><StartupInventory /></QueryClientProvider>,
    );
    try {
      await screen.findByText('workspace-probe ready');
      expect(screen.queryByText('kubernetes ready')).not.toBeInTheDocument();
      published = [...published, { id: 'kubernetes', devMode: true }];
      await act(async () => {
        for (const handler of backend.listeners.get('plugin/dev_install_complete') ?? []) {
          handler({ data: { id: 'kubernetes', name: 'Kubernetes' } });
        }
      });
      expect(await screen.findByText('kubernetes ready')).toBeInTheDocument();
      expect(screen.getByText('workspace-probe ready')).toBeInTheDocument();
    } finally {
      unmount();
      client.clear();
      backend.listeners.clear();
    }
  });
});
