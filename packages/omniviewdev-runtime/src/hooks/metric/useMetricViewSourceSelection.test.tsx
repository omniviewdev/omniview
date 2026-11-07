import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useMetricViewSourceSelection } from './useMetricViewSourceSelection';

const host = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock('../../metric', () => ({ GetMetricViewSourceSelection: host.get, SaveMetricViewSourceSelection: host.save }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function setup(connection = 'cluster-a') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(() => useMetricViewSourceSelection('kubernetes', connection, 'k8s:/pods'), { wrapper }) };
}
const stored = { owner_plugin_id: 'kubernetes', owner_connection_id: 'cluster-a', resource_key: 'k8s:/pods', mode: 'inherit', revision: 'r1' };
const source = { plugin_id: 'grafana', connection_id: 'monitor', datasource_uid: 'prom', datasource_kind: 'prometheus', native: false };

it('loads host routing using owner connection and resource kind, independent of presentation', async () => {
  host.get.mockResolvedValue(stored);
  const { result } = setup();
  await waitFor(() => expect(result.current.selection).toEqual(stored));
  expect(host.get).toHaveBeenCalledWith('kubernetes', 'cluster-a', 'k8s:/pods');
});

it('saves exact external source using host revision and publishes returned revision', async () => {
  host.get.mockResolvedValue(stored);
  host.save.mockImplementation(async selection => ({ ...selection, revision: 'r2' }));
  const { result } = setup();
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () => { await result.current.update('external', source); });
  expect(host.save).toHaveBeenCalledWith({ ...stored, mode: 'external', source });
  expect(result.current.selection?.revision).toBe('r2');
});

it('keeps failed explicit choice visible without overwriting admitted host routing', async () => {
  host.get.mockResolvedValue(stored);
  host.save.mockRejectedValue(new Error('revision conflict'));
  const { result, client } = setup();
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () => { await expect(result.current.update('external', source)).rejects.toThrow('revision conflict'); });
  expect(result.current.selection?.source).toEqual(source);
  expect(result.current.error?.message).toBe('revision conflict');
  expect(client.getQueryData(['metric', 'view-source', 'kubernetes', 'cluster-a', 'k8s:/pods'])).toEqual(stored);
  expect(host.save).toHaveBeenCalledTimes(1);
});

it('clears external source when explicitly choosing native', async () => {
  host.get.mockResolvedValue({ ...stored, mode: 'external', source });
  host.save.mockImplementation(async selection => ({ ...selection, revision: 'r3' }));
  const { result } = setup();
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () => { await result.current.update('native'); });
  expect(host.save).toHaveBeenCalledWith({ ...stored, mode: 'native', source: undefined });
});

it('rejects an empty save response without discarding admitted routing or the failed choice', async () => {
  host.get.mockResolvedValue(stored);
  host.save.mockResolvedValue(null);
  const { result, client } = setup();
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () => {
    await expect(result.current.update('external', source)).rejects.toThrow('No metric source selection response.');
  });
  expect(result.current.selection?.source).toEqual(source);
  expect(result.current.error?.message).toBe('No metric source selection response.');
  expect(client.getQueryData(['metric', 'view-source', 'kubernetes', 'cluster-a', 'k8s:/pods'])).toEqual(stored);
});

it('invalidates only catalogs for the saved owner, connection, and resource kind', async () => {
  host.get.mockResolvedValue(stored);
  host.save.mockImplementation(async selection => ({ ...selection, revision: 'r2' }));
  const { result, client } = setup();
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  const request = { owner_plugin_id: 'kubernetes', owner_connection_id: 'cluster-a', resource_key: 'k8s:/pods', binding_id: '', source: null };
  const affected = [
    ['metric', 'catalog', request],
    ['metric', 'catalog', { ...request, binding_id: 'external', source }],
  ];
  const unaffected = [
    ['metric', 'catalog', { ...request, owner_plugin_id: 'other-owner' }],
    ['metric', 'catalog', { ...request, owner_connection_id: 'cluster-b' }],
    ['metric', 'catalog', { ...request, resource_key: 'k8s:/nodes' }],
  ];
  const catalog = { metrics: [{ id: 'cpu' }, { id: 'optional' }], source };
  for (const key of [...affected, ...unaffected]) client.setQueryData(key, catalog);
  await act(async () => { await result.current.update('external', source); });
  for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  for (const key of unaffected) {
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(client.getQueryData(key)).toEqual(catalog);
  }
});
