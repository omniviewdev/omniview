import { describe, expect, it } from 'vitest';
import type { MetricBinding, MetricDefinition } from '@omniviewdev/runtime';
import { changeProvider, resetOverride, resolveDefinition } from './model';

const global = { id: 'cpu', name: 'CPU', query: 'global-v1', revision: '1', field_bindings: [{ label: 'pod', source: 'resource', field: 'id', required: true }], identity_labels: ['pod'] } as MetricDefinition;
const binding = { id: 'binding-a', resource_connection_id: 'cluster-a', source: { plugin_id: 'grafana', connection_id: 'provider-a', datasource_uid: 'reused-uid', datasource_kind: 'prometheus' }, overrides: [{ metric_id: 'cpu', query: 'cluster-query', revision: '1' }] } as MetricBinding;

describe('connection metric inheritance', () => {
  it('inherits live global fields while preserving only explicitly overridden query', () => {
    const updated = { ...global, query: 'global-v2', revision: '2', identity_labels: ['cluster', 'pod'] };
    expect(resolveDefinition(updated, binding.overrides[0])).toMatchObject({ query: 'cluster-query', revision: '2', identity_labels: ['cluster', 'pod'] });
    expect(resolveDefinition(updated)).toBe(updated);
  });
  it('reset deletes override rather than snapshotting current global state', () => {
    const reset = resetOverride(binding, 'cpu');
    expect(reset.overrides).toEqual([]);
    const next = { ...global, query: 'global-v3' };
    expect(resolveDefinition(next, reset.overrides.find(value => value.metric_id === 'cpu')).query).toBe('global-v3');
    expect(binding.overrides[0].query).toBe('cluster-query');
  });
  it('provider changes invalidate reused datasource UID without mutating another connection draft', () => {
    const other = { ...binding, id: 'binding-b', resource_connection_id: 'cluster-b' };
    const changed = changeProvider(binding, 'provider-b');
    expect(changed.source).toMatchObject({ connection_id: 'provider-b', datasource_uid: '', datasource_kind: '' });
    expect(other.source.datasource_uid).toBe('reused-uid');
    expect(binding.source.connection_id).toBe('provider-a');
  });
});
