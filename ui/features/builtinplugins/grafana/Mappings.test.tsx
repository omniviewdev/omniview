import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MetricDefinition, MetricValidationResult, MetricsObservationSpec } from '@omniviewdev/runtime';
import { MappingEditor } from './Mappings';

const api = vi.hoisted(() => ({ validate: vi.fn(), preview: vi.fn(), discover: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ MetricClient: {
  ValidateMetricDefinition: api.validate, PreviewMetricDefinition: api.preview, DiscoverMetricLabels: api.discover,
} }));
afterEach(() => {
  cleanup(); vi.resetAllMocks(); 
});

const definition: MetricDefinition = {
  id: 'cpu', name: 'CPU', resource_keys: ['k8s:/pods'], unit: 'cores', semantics: 'rate', dimensions: [],
  supported_shapes: ['current', 'range'], query_language: 'promql', query: 'rate(cpu[5m])',
  field_bindings: [], identity_labels: ['pod'], reducer: 'none', batch_strategy: 'identity', revision: 'global-1', native: false,
};
const sample: MetricsObservationSpec = {
  owner_plugin_id: 'kubernetes', owner_connection_id: 'cluster', resource_key: 'k8s:/pods', binding_id: '', source: null,
  targets: [], metric_ids: [], shape: 'range', duration_ms: 300000,
  start_time: '0001-01-01T00:00:00Z', end_time: '0001-01-01T00:00:00Z', step_ms: 15000, interval_ms: 0,
};

it('does not accept an empty mapping validation response or enable saving', async () => {
  api.validate.mockResolvedValue(null);
  const save = vi.fn();
  render(<MappingEditor definition={definition} connectionID="monitor" datasourceUID="prom" onSave={save} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Validate definition' })); 
  });
  expect(screen.getByRole('alert').textContent).toBe('No mapping validation response.');
  expect(screen.getByRole('button', { name: 'Save mapping' })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
});

it('reports an empty admitted preview response instead of displaying success', async () => {
  api.preview.mockResolvedValue(null);
  render(<MappingEditor definition={definition} connectionID="monitor" datasourceUID="prom" onSave={vi.fn()} sampleRequest={sample} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Test query' })); 
  });
  expect(screen.getByRole('alert').textContent).toBe('No query preview response.');
  expect(screen.queryByRole('region', { name: 'Sample query results' })).toBeNull();
});

it('reports an empty label discovery response without dereferencing it', async () => {
  api.discover.mockResolvedValue(null);
  render(<MappingEditor definition={definition} connectionID="monitor" datasourceUID="prom" onSave={vi.fn()} />);
  fireEvent.click(screen.getByText('Variables & identity'));
  fireEvent.change(screen.getByLabelText('Metric name for label discovery'), { target: { value: 'cpu' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Discover labels' })); 
  });
  expect(screen.getByRole('alert').textContent).toBe('No label discovery response.');
});

it('derives validation and preview visibility from the current draft and datasource', async () => {
  api.validate.mockResolvedValue({ valid: true, issues: [] });
  api.preview.mockResolvedValue({ results: [], complete: true, warnings: [] });
  const view = render(<MappingEditor definition={definition} connectionID="monitor" datasourceUID="prom" onSave={vi.fn()} sampleRequest={sample} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Validate definition' })); 
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Test query' })); 
  });
  expect(screen.getByRole('button', { name: 'Save mapping' })).toBeEnabled();
  expect(screen.getByRole('region', { name: 'Sample query results' })).toBeVisible();
  view.rerender(<MappingEditor definition={definition} connectionID="monitor" datasourceUID="other" onSave={vi.fn()} sampleRequest={sample} />);
  expect(screen.getByRole('button', { name: 'Save mapping' })).toBeDisabled();
  expect(screen.queryByRole('region', { name: 'Sample query results' })).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Validate definition' })); 
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'PromQL' }), { target: { value: 'rate(cpu[1m])' } });
  expect(screen.getByRole('button', { name: 'Save mapping' })).toBeDisabled();
});

it('does not publish validation that completed after the draft changed', async () => {
  const pending = Promise.withResolvers<Pick<MetricValidationResult, 'valid' | 'issues'>>();
  api.validate.mockReturnValue(pending.promise);
  render(<MappingEditor definition={definition} connectionID="monitor" datasourceUID="prom" onSave={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Validate definition' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'PromQL' }), { target: { value: 'rate(cpu[1m])' } });
  await act(async () => {
    pending.resolve({ valid: true, issues: [] }); 
  });
  expect(screen.getByRole('button', { name: 'Save mapping' })).toBeDisabled();
});
