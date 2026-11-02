import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { PluginWindow } from '@omniviewdev/runtime';
import { PluginService } from '@/features/plugins/core/PluginService';
import type * as Runtime from '@omniviewdev/runtime';
import { PluginServiceContext } from '@/features/plugins/react/context';
import { createTestDeps } from '@/features/plugins/testing/helpers';
import { usePlugin } from './usePluginManager';

vi.mock('@omniviewdev/runtime', async importOriginal => ({
  ...await importOriginal<typeof Runtime>(),
  useSnackbar: () => ({ showSnackbar: () => undefined }),
}));
vi.mock('@omniviewdev/runtime/api', () => ({ PluginManager: {
  ReloadPlugin: async (id: string) => ({ id, metadata: { id, name: 'Recovery fixture' } }),
  GetPluginVersions: async () => [],
} }));

describe('plugin startup recovery', () => {
  it('restores real frontend routes after a failed import and backend restart', async () => {
    const fixture = createTestDeps();
    const service = new PluginService(fixture.deps);
    await service.load('recovery-fixture');
    expect(service.getSnapshot().plugins.get('recovery-fixture')?.phase).toBe('error');
    fixture.importer.register('recovery-fixture', {
      plugin: new PluginWindow().withRoutes([{ path: '/recovered', Component: () => null }]),
      extensionRegistrations: [], sidebars: {}, drawers: {},
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}><PluginServiceContext.Provider value={service}>{children}</PluginServiceContext.Provider></QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => usePlugin({ id: 'recovery-fixture', installed: false }), { wrapper });
    try {
      await act(async () => {
        await result.current.reload(); 
      });
      expect(service.getSnapshot().plugins.get('recovery-fixture')?.phase).toBe('ready');
      expect(service.getAllRoutes().some(route => route.path === '/recovered')).toBe(true);
    } finally {
      unmount();
      client.clear();
      await service.unload('recovery-fixture');
    }
  });
});
