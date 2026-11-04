import type { MetricBinding, MetricDefinition, MetricDefinitionOverride } from '@omniviewdev/runtime';

export function resolveDefinition(global: MetricDefinition, override?: MetricDefinitionOverride): MetricDefinition {
  if (!override) return global;
  return { ...global, ...Object.fromEntries(Object.entries(override).filter(([key, value]) =>
    value !== undefined && key !== 'metric_id' && key !== 'revision')) };
}
export function resetOverride(binding: MetricBinding, metricID: string): MetricBinding {
  return { ...binding, overrides: binding.overrides.filter(value => value.metric_id !== metricID) };
}
export function changeProvider(binding: MetricBinding, connectionID: string): MetricBinding {
  return { ...binding, source: { ...binding.source, connection_id: connectionID, datasource_uid: '', datasource_kind: '' } };
}
export function stageDefinition(binding: MetricBinding, global: MetricDefinition, draft: MetricDefinition): MetricBinding {
  const override: MetricDefinitionOverride = {
    metric_id: global.id, revision: global.revision,
    ...(draft.query !== global.query ? { query: draft.query } : {}),
    ...(JSON.stringify(draft.field_bindings) !== JSON.stringify(global.field_bindings) ? { field_bindings: draft.field_bindings } : {}),
    ...(JSON.stringify(draft.identity_labels) !== JSON.stringify(global.identity_labels) ? { identity_labels: draft.identity_labels } : {}),
  };
  return { ...binding, overrides: [...binding.overrides.filter(value => value.metric_id !== global.id),
    ...(Object.keys(override).length > 2 ? [override] : [])] };
}
