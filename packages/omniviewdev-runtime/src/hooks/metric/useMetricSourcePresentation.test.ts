import { expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const api = vi.hoisted(() => ({ connections: vi.fn(), datasources: vi.fn() }));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/servicewrapper', () => ({
  GetProviders: async () => [{ plugin_id: 'owner', name: 'Owner', icon: 'owner.svg', supports_connections: false },
    { plugin_id: 'monitor', name: 'Monitoring', icon: 'monitor.svg', supports_connections: true }],
  GetProviderConnections: api.connections, GetDataSources: api.datasources, GetMetricBindings: vi.fn(),
}));
vi.mock('../../resource/v2/client', () => ({ ListConnections: vi.fn() }));
vi.mock('../connection/useConnections', () => ({ connectionListQueryKey: (plugin: string) => [plugin, 'connection', 'list'] }));
import { loadMetricSourceInventory, presentMetricSource, metricSourceIdentity, useMetricSourceInventory, useMetricSourcePresentation } from './useMetricSourcePresentation';

it('keeps human metadata but never caches connection URLs, config, or credentials', async () => {
  api.connections.mockResolvedValue([{ id: 'tenant', name: 'Production', url: 'https://secret@example.test',
    credential: 'private', public_config: { token: 'private' } }]);
  api.datasources.mockResolvedValue([{ uid: 'prom', name: 'Fleet', kind: 'prometheus' }]);
  const inventory = await loadMetricSourceInventory();
  expect(api.connections).toHaveBeenCalledWith('monitor');
  expect(api.connections).not.toHaveBeenCalledWith('owner');
  expect(inventory.options[0]).toMatchObject({ providerName: 'Monitoring', providerIcon: 'monitor.svg',
    connectionName: 'Production', datasourceName: 'Fleet', label: 'Production · Fleet' });
  expect(JSON.stringify(inventory)).not.toMatch(/private|secret|public_config|credential/);
  const source = inventory.options[0].source;
  expect(presentMetricSource(source, inventory)?.available).toBe(true);
  expect(presentMetricSource({ ...source, connection_id: 'other' }, inventory)?.available).toBe(false);
  expect(presentMetricSource({ ...source, native: true }, inventory)?.datasourceName).toBe('Native');
  expect(metricSourceIdentity({ ...source, native: true })).not.toBe(metricSourceIdentity(source));
});

it('bounds provider failures without disclosing raw upstream errors', async () => {
  api.connections.mockResolvedValue([{ id: 'good', name: 'Good' }, { id: 'bad', name: 'Bad' }]);
  api.datasources.mockImplementation(async (_plugin: string, connection: string) => {
    if (connection === 'bad') throw new Error('https://token:private@example.test');
    return [{ uid: 'prom', name: 'Fleet', kind: 'prometheus' }];
  });
  const inventory = await loadMetricSourceInventory();
  expect(inventory.options).toHaveLength(1);
  expect(inventory.failures).toEqual([{ pluginID: 'monitor', message: 'A connection source catalog is unavailable.' }]);
  expect(JSON.stringify(inventory)).not.toContain('private');
});

it('shares one inventory fetch across selector and provenance consumers', async () => {
  api.connections.mockClear();
  api.connections.mockResolvedValue([{ id: 'tenant', name: 'Production' }]);
  api.datasources.mockResolvedValue([{ uid: 'prom', name: 'Fleet', kind: 'prometheus' }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  const selector = renderHook(() => useMetricSourceInventory(), { wrapper });
  const details = renderHook(() => useMetricSourcePresentation({ plugin_id: 'monitor', connection_id: 'tenant',
    datasource_uid: 'prom', datasource_kind: 'prometheus', native: false }), { wrapper });
  await waitFor(() => expect(selector.result.current.data?.options).toHaveLength(1));
  await waitFor(() => expect(details.result.current?.label).toBe('Production · Fleet'));
  expect(api.connections).toHaveBeenCalledTimes(1);
  selector.unmount();
  details.unmount();
  client.clear();
});
