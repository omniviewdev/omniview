import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useResources } from './useResources';
import type { HostEnumerateRequest, HostSourcePage } from '../../resource/v2/host';

const { enumerate } = vi.hoisted(() => ({ enumerate: vi.fn() }));
vi.mock('../../resource/v2/client', () => ({ Enumerate: enumerate }));
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: () => 'provider' }));
vi.mock('@wailsio/runtime', () => ({ Events: {} }));

it('keeps native page boundaries and cached earlier pages after a continuation failure', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
  const request: HostEnumerateRequest = { targetId: 'host-target', request: { target: {
    route: { connection: 'c' }, provider: 'provider', authority: 'authority', type: 'items', scope: [], representation: 'raw',
  }, pageSize: 1 } };
  const first: HostSourcePage = { records: [{ key: 'host-row', addressKey: 'host-address', targetId: 'host-target', route: { connection: 'c' }, record: {
    reference: { address: { provider: 'provider', authority: 'authority', type: 'items', id: 'one', scope: [] } },
    coverage: { kind: 'complete', paths: [] }, body: { kind: 'uint64', value: '18446744073709551615' }, representation: { id: 'raw', revision: 'r', schema: { state: 'absent', validation: 'none', unvalidated: [] } },
  } }], sourcePage: { nextCursor: 'second', count: { kind: 'unknown' }, coverage: { kind: 'partial', paths: [] }, consistency: 'bestEffort' } };
  enumerate.mockImplementation((_plugin, input) => input.request.cursor ? Promise.reject(new Error('later page denied')) : Promise.resolve(first));
  const { result, rerender } = renderHook(({ cursor }: { cursor?: string }) => useResources({ pluginID: 'provider', request: { ...request, request: { ...request.request, cursor } }, live: false }), { wrapper, initialProps: { cursor: undefined as string | undefined } });
  await waitFor(() => expect(result.current.resources.isSuccess).toBe(true));
  expect(result.current.resources.data).toEqual(first);
  expect(enumerate).toHaveBeenCalledTimes(1);
  rerender({ cursor: 'second' });
  await waitFor(() => expect(result.current.resources.isError).toBe(true));
  expect(result.current.resources.error?.message).toBe('later page denied');
  rerender({ cursor: undefined });
  await waitFor(() => expect(result.current.resources.isSuccess).toBe(true));
  expect(result.current.resources.data?.records[0].record.body).toEqual({ kind: 'uint64', value: '18446744073709551615' });
  expect(result.current.resources.data?.sourcePage.nextCursor).toBe('second');
  expect(enumerate).toHaveBeenCalledTimes(2);
});
