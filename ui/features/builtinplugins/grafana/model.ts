import type { MetricBinding, MetricDefinition, MetricDefinitionOverride } from '@omniviewdev/runtime';

export function resolveDefinition(global: MetricDefinition, override?: MetricDefinitionOverride): MetricDefinition {
  if (!override) {
    return global;
  }

  return { ...global, ...Object.fromEntries(Object.entries(override).filter(([key, value]) =>
    value != null && key !== 'metric_id' && key !== 'revision' && key !== 'source')) };
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

/** Keep only public metadata declared by the resource owner. */
export function approvedScope(scope: Readonly<Record<string, string | undefined>>, fields: ReadonlyArray<{ key: string }>): Record<string, string> {
  return Object.fromEntries(fields.slice(0, 32).flatMap(field => {
    const value = scope[field.key];
    return typeof value === 'string' ? [[field.key, value]] : [];
  }));
}

export function scopeRequirements(definitions: readonly MetricDefinition[]): Set<string> {
  return new Set(definitions.flatMap(definition => definition.field_bindings
    .filter(binding => binding.source === 'scope' && binding.required).map(binding => binding.field)));
}

export function validScope(scope: Readonly<Record<string, string | undefined>>, fields: ReadonlyArray<{ key: string }>, required: ReadonlySet<string>): boolean {
  const approved = new Set(fields.slice(0, 32).map(field => field.key));
  return fields.length <= 32 && Object.entries(scope).length <= 32
    && Object.entries(scope).every(([key, value]) => approved.has(key) && typeof value === 'string' && new TextEncoder().encode(value).length <= 1024)
    && [...required].every(key => approved.has(key) && Boolean(scope[key]?.trim()));
}
