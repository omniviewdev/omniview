import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetricDefinition } from '@omniviewdev/runtime';
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
  it('keeps sample execution disabled without real admitted resource and separates syntax success', async () => {
    api.validate.mockResolvedValue({ valid: true, issues: [] });
    render(<MappingEditor definition={definition} connectionID="one" datasourceUID="direct" onSave={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Test query' })).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Validate definition' })); });
    expect(screen.getByRole('status')).toHaveTextContent('no sample query executed');
    expect(api.preview).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save mapping' })).toBeEnabled();
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
