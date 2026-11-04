import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetricDefinition, ResourceSetQueryRequest } from '@omniviewdev/runtime';
import userEvent from '@testing-library/user-event';
const api = vi.hoisted(() => ({ validate: vi.fn(), preview: vi.fn(), discover: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: { ValidateMetricDefinition: api.validate, PreviewMetricDefinition: api.preview, DiscoverMetricLabels: api.discover } }));
import { MappingEditor, Mappings, QueryPreview } from './Mappings';
const definition = { id: 'cpu', name: 'CPU', query: 'sum(rate(cpu[5m]))', revision: '1', field_bindings: [], identity_labels: ['pod'], resource_keys: ['k8s:/pods'], unit: 12 } as MetricDefinition;
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('mapping validation surface', () => {
  it('highlights interpolation inside quoted matchers without breaking escaped quotes', () => {
    const query = String.raw`sum(metric{pod=~"{{pod}}",note="say \"hello\" {{cluster}}"})`;
    render(<QueryPreview query={query} />);
    expect(screen.getByLabelText('Query preview')).toHaveTextContent(query);
    expect(screen.getByText('{{pod}}')).toHaveClass('grafana-interpolation');
    expect(screen.getByText('{{cluster}}')).toHaveClass('grafana-interpolation');
    expect(screen.getByText('{{cluster}}').parentElement).toHaveClass('grafana-string');
  });
  it('keeps validation separate from admitted sample execution', async () => {
    api.validate.mockResolvedValue({ valid: true, issues: [] });
    render(<MappingEditor definition={definition} connectionID="one" datasourceUID="direct" onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Test query' })).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Validate definition' })); });
    expect(api.preview).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save mapping' })).toBeEnabled();
  });
  it('shows canonical sample identity and real zero results without exposing raw payload by default', async () => {
    const sampleRequest = { resources: [{ token: 'opaque-token', resource_namespace: 'team-a', resource_id: 'api-pod' }] } as ResourceSetQueryRequest;
    api.preview.mockResolvedValue({ results: [{ resource_token: 'opaque-token', metric_id: 'cpu', status: 'ok', value: { current_value: { value: 0 } }, dimensions: {}, warnings: [], provenance: { provider_id: 'grafana' } }], warnings: [] });
    render(<MappingEditor definition={definition} connectionID="one" datasourceUID="direct" onSave={vi.fn()} sampleRequest={sampleRequest} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Test query' })); });
    const results = within(screen.getByRole('region', { name: 'Sample query results' }));
    expect(results.getByRole('cell', { name: 'team-a/api-pod' })).toBeVisible();
    expect(results.getByRole('cell', { name: '0 cores' })).toBeVisible();
    expect(results.getByRole('cell', { name: 'ok' })).toBeVisible();
    expect(results.getByText('Response details & provenance').closest('details')).not.toHaveAttribute('open');
    expect(api.preview).toHaveBeenCalledWith(expect.objectContaining({ resources: sampleRequest.resources, definitions: [definition], metric_ids: ['cpu'] }));
  });
  it('invalidates validation when query changes and preserves invalid draft', async () => {
    api.validate.mockResolvedValue({ valid: false, issues: [{ field: 'query', message: 'Unknown interpolation' }] });
    render(<MappingEditor definition={definition} connectionID="one" datasourceUID="direct" onSave={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'PromQL' }), { target: { value: '{{unknown}}' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Validate definition' })); });
    expect(screen.getByRole('status')).toHaveTextContent('Unknown interpolation');
    expect(screen.getByRole('textbox', { name: 'PromQL' })).toHaveValue('{{unknown}}');
    expect(screen.getByRole('button', { name: 'Save mapping' })).toBeDisabled();
  });
  it('ignores validation result from previous query generation', async () => {
    const { promise, resolve: complete } = Promise.withResolvers<{ valid: boolean; issues: [] }>();
    api.validate.mockReturnValue(promise);
    render(<MappingEditor definition={definition} connectionID="one" datasourceUID="direct" onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Validate definition' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'PromQL' }), { target: { value: 'new-query' } });
    await act(async () => { complete({ valid: true, issues: [] }); });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save mapping' })).toBeDisabled();
  });
  it('keeps field tools progressive while identity and highlighted query stay visible', () => {
    render(<MappingEditor definition={definition} connectionID="one" datasourceUID="direct" onSave={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Response identity labels' })).toHaveValue('pod');
    expect(screen.getByLabelText('Query preview')).toHaveTextContent(definition.query);
    const tools = screen.getByText('Variables & identity').closest('details');
    expect(tools).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Variables & identity'));
    expect(tools).toHaveAttribute('open');
  });
  it('preserves comma-separated typing and saves parsed identity labels, resource types, and dimensions', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue(undefined);
    api.validate.mockResolvedValue({ valid: true, issues: [] });
    render(<MappingEditor definition={definition} connectionID="one" datasourceUID="direct" onSave={save} editSemantics />);
    const identity = screen.getByRole('textbox', { name: 'Response identity labels' });
    await user.clear(identity);
    await user.type(identity, 'cluster_name, ');
    expect(identity).toHaveValue('cluster_name, ');
    await user.type(identity, 'kube_namespace, workload');
    expect(identity).toHaveValue('cluster_name, kube_namespace, workload');
    const resourceTypes = screen.getByRole('textbox', { name: 'Applicable resource types' });
    await user.clear(resourceTypes);
    await user.type(resourceTypes, 'k8s:/pods, k8s:/nodes');
    expect(resourceTypes).toHaveValue('k8s:/pods, k8s:/nodes');
    const dimensions = screen.getByRole('textbox', { name: 'Declared result dimensions' });
    await user.type(dimensions, 'container, device');
    expect(dimensions).toHaveValue('container, device');
    await user.click(screen.getByRole('button', { name: 'Validate definition' }));
    expect(api.validate).toHaveBeenCalledWith('grafana', 'one', 'direct', expect.objectContaining({
      identity_labels: ['cluster_name', 'kube_namespace', 'workload'],
      resource_keys: ['k8s:/pods', 'k8s:/nodes'], dimensions: ['container', 'device'],
    }));
    await user.click(screen.getByRole('button', { name: 'Save mapping' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      identity_labels: ['cluster_name', 'kube_namespace', 'workload'],
      resource_keys: ['k8s:/pods', 'k8s:/nodes'], dimensions: ['container', 'device'],
      query: definition.query,
    }));
  });
  it('creates a distinct user-defined metric with canonical semantics and dimensions', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    api.validate.mockResolvedValue({ valid: true, issues: [] });
    render(<Mappings definitions={[definition]} connectionID="one" datasourceUID="direct" save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add metric' }));
    const editor = within(screen.getByRole('region', { name: 'New metric definition' }));
    fireEvent.change(editor.getByRole('textbox', { name: 'Name' }), { target: { value: 'Container restarts' } });
    fireEvent.change(editor.getByRole('textbox', { name: 'Declared result dimensions' }), { target: { value: 'container' } });
    fireEvent.change(editor.getByRole('textbox', { name: 'PromQL' }), { target: { value: 'sum by (pod,container) (kube_pod_container_status_restarts_total)' } });
    await act(async () => { fireEvent.click(editor.getByRole('button', { name: 'Validate definition' })); });
    await act(async () => { fireEvent.click(editor.getByRole('button', { name: 'Save mapping' })); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Container restarts', dimensions: ['container'], unit: 0, semantics: 'gauge',
      reducer: 'none', batch_strategy: 'identity', native: false,
    }));
    expect(save.mock.calls[0][0].id).not.toBe(definition.id);
  });
});
