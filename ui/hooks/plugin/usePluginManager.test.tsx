import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { usePlugin, usePluginManager } from './usePluginManager';

const backend = vi.hoisted(() => ({
  installDev: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  showSnackbar: vi.fn(),
}));

// Replace IPC and presentation boundaries, not QueryClient or mutation hooks.
vi.mock('@omniviewdev/runtime/api', () => ({
  PluginManager: {
    InstallInDevMode: backend.installDev,
    ListPlugins: backend.list,
    GetPlugin: backend.get,
    ListAvailablePlugins: async () => [],
    GetPluginVersions: async () => [],
    GetPluginReadme: async () => '',
    GetPluginReviews: async () => [],
    GetPluginDownloadStats: async () => ({}),
    GetPluginReleaseHistory: async () => [],
  },
}));
vi.mock('@omniviewdev/runtime', () => ({
  useSnackbar: () => ({ showSnackbar: backend.showSnackbar }),
  createErrorHandler: () => () => undefined,
  parseAppError: () => ({ title: 'Error', type: 'omniview:internal', detail: 'The operation could not be completed.' }),
  actionToSnackbar: (action: unknown) => action,
}));
vi.mock('@omniviewdev/runtime/runtime', () => ({
  Events: { On: () => () => undefined },
}));
vi.mock('@/features/plugins', () => ({
  usePluginService: () => ({
    load: async () => undefined,
    reload: async () => undefined,
    unload: async () => undefined,
  }),
}));

describe('dev install retained-failure reconciliation', () => {
  it.each(['new install', 'rebind'])('refreshes list and detail after a failed %s without reporting success', async (operation) => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
        mutations: { retry: false },
      },
    });
    const old = {
      id: 'fixture', metadata: { id: 'fixture', name: 'Fixture' },
      phase: 'Running', devMode: true, devPath: '/source/a', lastError: '',
    };
    const retained = {
      ...old, phase: 'BuildFailed', devPath: '/source/b', lastError: 'compiler failed',
    };
    let authoritative = operation === 'rebind' ? [old] : [];
    backend.list.mockImplementation(async () => authoritative);
    backend.get.mockImplementation(async () => authoritative[0] ?? null);
    backend.installDev.mockImplementation(async () => {
      authoritative = [retained];
      throw new Error('Dev plugin build failed');
    });
    client.setQueryData(['plugins'], authoritative);
    client.setQueryData(['plugins', 'fixture'], authoritative[0] ?? null);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => ({
      manager: usePluginManager(),
      detail: usePlugin({ id: 'fixture' }),
    }), { wrapper });

    try {
      await act(async () => {
        await expect(result.current.manager.installDev.mutateAsync()).rejects.toThrow('Dev plugin build failed');
      });
      await waitFor(() => {
        expect(result.current.manager.plugins.data?.[0]?.phase).toBe('BuildFailed');
        expect(result.current.detail.plugin.data?.devPath).toBe('/source/b');
        expect(result.current.detail.plugin.data?.lastError).toBe('compiler failed');
      });
      expect(result.current.manager.installDev.isError).toBe(true);
      expect(result.current.manager.installDev.isSuccess).toBe(false);
      expect(backend.showSnackbar).toHaveBeenLastCalledWith(expect.objectContaining({
        status: 'error',
        details: expect.stringContaining('Dev plugin build failed'),
        actions: expect.arrayContaining([expect.objectContaining({ label: 'Retry installation' })]),
      }));
    } finally {
      unmount();
      client.clear();
    }
  });
});
