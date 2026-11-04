import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type * as Runtime from '@omniviewdev/runtime';
const api = vi.hoisted(() => ({ connections: vi.fn(), definitions: vi.fn(), bindings: vi.fn(), sources: vi.fn(), openSettings: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: { GetProviderConnections: api.connections, GetMetricDefinitions: api.definitions, GetMetricBindings: api.bindings, GetDataSources: api.sources } }));
vi.mock('@omniviewdev/runtime', async importOriginal => ({ ...await importOriginal<typeof Runtime>(), openSettings: api.openSettings }));
vi.mock('./SampleResource', () => ({ default: () => null }));
import ConnectionSettings from './ConnectionSettings';
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('query-only datasource selection', () => {
  it('preserves a manual UID despite denied discovery and invalidates it when provider changes', async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole('combobox', { name: 'Provider connection' }));
    await user.click(await screen.findByRole('option', { name: 'Two' }));
    await waitFor(() => expect(screen.getByLabelText('Prometheus datasource UID')).toHaveValue(''));
    await waitFor(() => expect(api.sources).toHaveBeenCalledWith('grafana', 'two'));
    expect(screen.getByRole('button', { name: 'Save connection metrics' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('status')).toHaveTextContent('Changes discarded');
    expect(screen.getByRole('status').closest('.grafana-binding-actions')).not.toBeNull();
    expect(screen.getByLabelText('Prometheus datasource UID')).toHaveValue('saved');
  });
  it('limits mappings to owner resource types and opens actual Grafana settings', async () => {
    const user = userEvent.setup();
    api.connections.mockResolvedValue([]);
    api.bindings.mockResolvedValue([]);
    api.openSettings.mockResolvedValue('settings');
    const definition = { query: 'sum(cpu)', unit: 11, field_bindings: [], identity_labels: [], revision: '1', native: false };
    api.definitions.mockResolvedValue([
      { ...definition, id: 'pod-cpu', name: 'Pod CPU', resource_keys: ['k8s:/pods'] },
      { ...definition, id: 'aws-cpu', name: 'EC2 CPU', resource_keys: ['aws:/instances'] },
      { ...definition, id: 'native', name: 'Native CPU', resource_keys: ['k8s:/pods'], native: true },
    ]);
    render(<ConnectionSettings resourcePluginID="owner" connectionID="cluster" signal="metrics" catalogRevision="1" publicMetadata={{}} resourceTypes={['k8s:/pods']} />);
    expect(await screen.findByText('Metric mappings 1')).toBeInTheDocument();
    expect(screen.getByText('Pod CPU')).toBeInTheDocument();
    expect(screen.queryByText('EC2 CPU')).not.toBeInTheDocument();
    expect(screen.queryByText('Native CPU')).not.toBeInTheDocument();
    expect(screen.getByText('{{cluster}}')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Manage Grafana connections' }));
    expect(api.openSettings).toHaveBeenCalledWith('/settings?section=plugins&plugin=grafana');
  });
});
