import { describe, expect, it } from 'vitest';
import type { MetricBinding, MetricDefinition } from '@omniviewdev/runtime';
import { approvedScope, changeProvider, resetOverride, resolveDefinition, scopeRequirements, stageDefinition, validScope } from './model';

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

describe('owner-approved public scope', () => {
  const fields = [{ key: 'region' }, { key: 'account' }];
  it('preserves declared metadata and rejects undeclared fields', () => {
    expect(approvedScope({ region: 'west', account: 'shared', secret: 'private' }, fields))
      .toEqual({ region: 'west', account: 'shared' });
    expect(validScope({ secret: 'private' }, fields, new Set())).toBe(false);
  });
  it('derives required fields from effective bindings, not field names', () => {
    const effective = resolveDefinition(definition, { metric_id: definition.id, revision: '', field_bindings: [
      { source: 'scope', field: 'region', label: 'location', required: true },
      { source: 'scope', field: 'account', label: 'tenant', required: false },
    ] });
    const required = scopeRequirements([effective]);
    expect([...required]).toEqual(['region']);
    expect(validScope({ region: 'west' }, fields, required)).toBe(true);
    expect(validScope({}, fields, required)).toBe(false);
    expect(validScope({}, [], scopeRequirements([definition]))).toBe(true);
    expect(validScope({ region: 'west' }, [], required)).toBe(false);
  });
  it('bounds UTF-8 values and number of declarations', () => {
    expect(validScope({ region: 'é'.repeat(512) }, fields, new Set())).toBe(true);
    expect(validScope({ region: 'é'.repeat(513) }, fields, new Set())).toBe(false);
    expect(validScope({}, Array.from({ length: 33 }, (_, i) => ({ key: `scope${i}` })), new Set())).toBe(false);
  });
});
