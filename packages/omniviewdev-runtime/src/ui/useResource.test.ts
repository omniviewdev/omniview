import React from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HostGetRequest, HostRecord } from '../resource/v2/host';
import { useResource } from './v1';

// `useResource` through the curated entry, with the runtime's native seams replaced (the Wails call, the readiness store, the activity provider).
const native = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../resource/v2/client', () => ({ Get: native.get, Mutate: vi.fn() }));
vi.mock('../activity/context', () => ({ useNotifications: () => ({ notify: vi.fn() }) }));
vi.mock('../hooks/useResolvedPluginId', () => ({ useResolvedPluginId: (id?: string) => id ?? 'provider' }));
vi.mock('../hooks/connection/useConnectionReadiness', () => ({ useConnectionReadiness: () => ({ phase: 'connected' }) }));
vi.mock('../connection/connectionReadiness', () => ({
  requireConnectionReady: vi.fn(),
  getConnectionReadinessGeneration: () => 1,
  isConnectionReadinessCurrent: (_plugin: string, _connection: string, generation: number) => generation === 1,
  connectionReadinessStore: () => ({ subscribe: () => () => {} }),
}));

const request: HostGetRequest = {
  targetId: 'target',
  request: {
    route: { connection: 'c' },
    reference: { address: { provider: 'provider', authority: 'authority', type: 'pods', scope: [{ dimension: 'namespace', value: 'default' }], id: 'web' } },
    representation: 'raw',
  },
};
const record = (revision: string): HostRecord => ({
  key: 'web',
  addressKey: 'web',
  targetId: 'target',
  route: { connection: 'c' },
  record: { reference: request.request.reference, body: { kind: 'string', value: revision }, representation: { id: 'raw', revision }, coverage: { kind: 'complete', paths: [] } },
});

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);

beforeEach(() => {
  client = new QueryClient();
  native.get.mockReset();
});
afterEach(() => {
  cleanup();
  client.clear();
});

describe('useResource through @omniviewdev/runtime/ui/v1', () => {
  it('is callable and reads one object once: its record, and nothing but `resource`', async () => {
    native.get.mockResolvedValue(record('r1'));
    const { result } = renderHook(() => useResource({ pluginID: 'provider', request }), { wrapper });
    await waitFor(() => { expect(result.current.resource.isSuccess).toBe(true); });
    expect(Object.keys(result.current)).toEqual(['resource']);
    expect(result.current.resource.data).toEqual(record('r1'));
    expect(native.get).toHaveBeenCalledTimes(1);
    expect(native.get).toHaveBeenCalledWith('provider', request);
  });

  it('is not live: a changed object is not pushed, and only a refetch sees it', async () => {
    native.get.mockResolvedValueOnce(record('r1')).mockResolvedValueOnce(record('r2'));
    const { result } = renderHook(() => useResource({ pluginID: 'provider', request }), { wrapper });
    await waitFor(() => { expect(result.current.resource.data).toEqual(record('r1')); });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(native.get).toHaveBeenCalledTimes(1);
    expect(result.current.resource.data).toEqual(record('r1'));
    await result.current.resource.refetch();
    await waitFor(() => { expect(result.current.resource.data).toEqual(record('r2')); });
  });

  it('shows a deleted object as a failed read on the next one, with the error the host answered', async () => {
    native.get.mockResolvedValueOnce(record('r1')).mockRejectedValueOnce(new Error('NOT_FOUND'));
    const { result } = renderHook(() => useResource({ pluginID: 'provider', request }), { wrapper });
    await waitFor(() => { expect(result.current.resource.isSuccess).toBe(true); });
    await result.current.resource.refetch();
    await waitFor(() => { expect(result.current.resource.isError).toBe(true); });
    expect(result.current.resource.error?.message).toBe('NOT_FOUND');
  });

  it('reads nothing without a request', () => {
    const { result } = renderHook(() => useResource({ pluginID: 'provider' }), { wrapper });
    expect(result.current.resource.fetchStatus).toBe('idle');
    expect(native.get).not.toHaveBeenCalled();
  });
});
