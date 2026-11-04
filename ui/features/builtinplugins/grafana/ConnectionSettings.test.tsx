import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ connections: vi.fn(), definitions: vi.fn(), bindings: vi.fn(), sources: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: { GetProviderConnections: api.connections, GetMetricDefinitions: api.definitions, GetMetricBindings: api.bindings, GetDataSources: api.sources } }));
vi.mock('./SampleResource', () => ({ default: () => null }));
import ConnectionSettings from './ConnectionSettings';
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('query-only datasource selection', () => {
  it('preserves a manual UID despite denied discovery and invalidates it when provider changes', async () => {
    api.connections.mockResolvedValue([{ id: 'one', name: 'One', url: 'https://one.test' }, { id: 'two', name: 'Two', url: 'https://two.test' }]);
    api.definitions.mockResolvedValue([]);
    api.bindings.mockResolvedValue([{ id: 'binding', signal: 'metrics', resource_plugin_id: 'owner', resource_connection_id: 'cluster', source: { plugin_id: 'grafana', connection_id: 'one', datasource_uid: 'saved', datasource_kind: 'prometheus' }, policy: 'supplement', public_scope: { cluster: 'production' }, overrides: [], revision: '1' }]);
    api.sources.mockRejectedValue(new Error('403 catalog access denied'));
    render(<ConnectionSettings resourcePluginID="owner" connectionID="cluster" signal="metrics" catalogRevision="1" publicMetadata={{}} resourceTypes={[]} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('403 catalog access denied'));
    const manual = screen.getByRole('textbox', { name: 'Prometheus datasource UID' });
    fireEvent.change(manual, { target: { value: 'query-only-prometheus' } });
    expect(manual).toHaveValue('query-only-prometheus');
    expect(screen.getByRole('alert')).toHaveTextContent('403 catalog access denied');
    expect(screen.getByRole('button', { name: 'Save connection metrics' })).toBeEnabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Provider connection' }), { target: { value: 'two' } });
    expect(manual).toHaveValue('');
    await waitFor(() => expect(api.sources).toHaveBeenCalledWith('grafana', 'two'));
    expect(screen.getByRole('button', { name: 'Save connection metrics' })).toBeDisabled();
  });
});
