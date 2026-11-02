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
  installVersion: vi.fn(),
  uninstall: vi.fn(),
  versions: vi.fn(async () => []),
  readme: vi.fn(async () => ''),
  reviews: vi.fn(async () => []),
  stats: vi.fn(async () => ({})),
}));

// Replace IPC and presentation boundaries, not QueryClient or mutation hooks.
vi.mock('@omniviewdev/runtime/api', () => ({
  PluginManager: {
    InstallInDevMode: backend.installDev,
    ListPlugins: backend.list,
    GetPlugin: backend.get,
    InstallPluginVersion: backend.installVersion,
    UninstallPlugin: backend.uninstall,
    ListAvailablePlugins: async () => [],
    GetPluginVersions: backend.versions,
    GetPluginReadme: backend.readme,
    GetPluginReviews: backend.reviews,
    GetPluginDownloadStats: backend.stats,
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
    getSnapshot: () => ({ plugins: new Map() }),
    retry: async () => undefined,
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

describe('shared plugin operation guard', () => {
  it('blocks conflicting calls across consumers and releases the guard after failure', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { promise: installation, reject: rejectInstall } = Promise.withResolvers<unknown>();
    backend.installVersion.mockImplementation(async () => installation);
    backend.uninstall.mockResolvedValue({ id: 'fixture', metadata: { id: 'fixture', name: 'Fixture' } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, unmount } = renderHook(() => ({
      first: usePlugin({ id: 'fixture', installed: false }),
      second: usePlugin({ id: 'fixture', installed: false }),
    }), { wrapper });
    let pending!: Promise<unknown>;
    try {
      act(() => {
        pending = result.current.first.update('1.0.0').catch(error => error); 
      });
      await waitFor(() => {
        expect(result.current.second.operation).toBe('Installing and starting plugin…'); 
      });
      await act(async () => {
        await expect(result.current.second.uninstall()).rejects.toThrow('Another operation');
      });
      expect(backend.uninstall).not.toHaveBeenCalled();
      await act(async () => {
        rejectInstall(new Error('Download failed'));
        await pending;
      });
      await waitFor(() => {
        expect(result.current.second.operation).toBeNull(); 
      });
      await act(async () => {
        await result.current.second.uninstall(); 
      });
      expect(backend.uninstall).toHaveBeenCalledWith('fixture');
    } finally {
      unmount();
      client.clear();
    }
  });
});

describe('marketplace detail fetching', () => {
  it('shares release data and fetches only active tab content without installed lookups', async () => {
    backend.get.mockClear();
    backend.versions.mockClear();
    backend.readme.mockClear();
    backend.reviews.mockClear();
    backend.stats.mockClear();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender, unmount } = renderHook(({ tab }) => ({
      detail: usePlugin({ id: 'marketplace-only', installed: false, tab }),
      action: usePlugin({ id: 'marketplace-only', installed: false }),
    }), { wrapper, initialProps: { tab: 'overview' } });
    try {
      await waitFor(() => {
        expect(result.current.detail.readme.isSuccess).toBe(true); 
      });
      expect(backend.versions).toHaveBeenCalledTimes(1);
      expect(backend.readme).toHaveBeenCalledTimes(1);
      expect(backend.reviews).not.toHaveBeenCalled();
      expect(backend.stats).not.toHaveBeenCalled();
      expect(backend.get).not.toHaveBeenCalled();
      expect(result.current.detail.releaseHistory.data).toBe(result.current.action.versions.data);
      rerender({ tab: 'reviews' });
      await waitFor(() => {
        expect(result.current.detail.reviews.isSuccess).toBe(true); 
      });
      expect(backend.reviews).toHaveBeenCalledTimes(1);
      expect(backend.versions).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
      client.clear();
    }
  });
});
