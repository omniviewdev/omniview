import { describe, expect, it } from 'vitest';
import type { MetricBinding, MetricDefinition } from '@omniviewdev/runtime';
import { changeProvider, resetOverride, resolveDefinition, stageDefinition } from './model';

const definition: MetricDefinition = {
  id: 'cpu', name: 'CPU', resource_keys: ['core::v1::Pod'], unit: 'cores', semantics: 'rate', dimensions: [],
  supported_shapes: ['current', 'range'], query_language: 'promql', query: 'rate(cpu[5m])',
  field_bindings: [], identity_labels: ['pod'], reducer: 'none', batch_strategy: 'identity', revision: 'global-1', native: false,
};
const binding: MetricBinding = {
  id: 'cluster', signal: 'metrics', resource_plugin_id: 'kubernetes', resource_connection_id: 'cluster-1',
  source: { plugin_id: 'grafana', connection_id: 'cloud', datasource_uid: 'prom', datasource_kind: 'prometheus' },
  policy: 'supplement', public_scope: { cluster: 'production' }, overrides: [], revision: 'binding-1',
};

describe('finite mapping overrides', () => {
  it('stores only changed mapping fields and preserves physical semantics', () => {
    const staged = stageDefinition(binding, definition, { ...definition, query: 'rate(cpu[1m])' });
    expect(staged.overrides).toEqual([{ metric_id: 'cpu', revision: 'global-1', query: 'rate(cpu[1m])' }]);
    expect(resolveDefinition(definition, staged.overrides[0])).toEqual({ ...definition, query: 'rate(cpu[1m])' });
  });
  it('removes redundant overrides and resets without changing source or public scope', () => {
    const staged = stageDefinition(binding, definition, { ...definition, identity_labels: [] });
    expect(staged.overrides[0].identity_labels).toEqual([]);
    expect(resetOverride(staged, 'cpu')).toEqual(binding);
    expect(stageDefinition(staged, definition, definition)).toEqual(binding);
  });
  it('clears datasource identity when provider connection changes', () => {
    expect(changeProvider(binding, 'other').source).toEqual({ plugin_id: 'grafana', connection_id: 'other', datasource_uid: '', datasource_kind: '' });
    expect(binding.source.datasource_uid).toBe('prom');
  });
});
