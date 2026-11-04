import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Stack, Text } from '@omniviewdev/base-ui';
import { MetricClient } from '@omniviewdev/runtime/api';
import type { MetricDefinition, MetricValidationResult, ResourceSetQueryRequest, ResourceSetQueryResponse } from '@omniviewdev/runtime';
import './grafana.css';
import SchemaFieldPicker, { type MappingSchemaContext } from './SchemaFieldPicker';
import { LuPlus } from 'react-icons/lu';
const unitLabel = (unit: number) => ['dimensionless', 'bytes', 'KB', 'MB', 'GB', '%', 'ms', 'seconds', 'count', 'ops/s', 'bytes/s', 'millicores', 'cores'][unit] ?? `unit ${unit}`;

export function QueryPreview({ query }: { query: string }) {
  return <pre className="grafana-query" aria-label="Query preview"><code>{query.split(/(\{\{[^}]+\}\}|\b(?:sum|rate|by|avg|max|min|count|irate)\b|"[^"]*")/g).map((part, index) =>
    <span key={index} className={part.startsWith('{{') ? 'grafana-interpolation' : /^"/.test(part) ? 'grafana-string' : /^(sum|rate|by|avg|max|min|count|irate)$/.test(part) ? 'grafana-function' : undefined}>{part}</span>)}</code></pre>;
}
export function MappingEditor({ definition, connectionID, datasourceUID, onSave, onReset, inherited, onDraft, sampleRequest, schemaContext, editSemantics = false }: {
  definition: MetricDefinition; connectionID: string; datasourceUID: string; onSave: (definition: MetricDefinition) => Promise<void>;
  onReset?: () => void; inherited?: boolean; onDraft?: (id: string, draft: MetricDefinition | undefined) => void;
  sampleRequest?: ResourceSetQueryRequest;
  schemaContext?: MappingSchemaContext;
  editSemantics?: boolean;
}) {
  const [draft, setDraft] = useState(definition);
  const [validation, setValidation] = useState<MetricValidationResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ResourceSetQueryResponse>();
  const [labels, setLabels] = useState<string[]>([]);
  const [metricName, setMetricName] = useState('');
  const requestGeneration = useRef(0);
  useEffect(() => { requestGeneration.current++; setPreview(undefined); }, [draft, connectionID, datasourceUID, sampleRequest]);
  useEffect(() => () => { requestGeneration.current++; }, []);
  async function testQuery() {
    if (!sampleRequest) return;
    const generation = ++requestGeneration.current;
    setBusy(true); setError('');
    try {
      const result = await MetricClient.PreviewMetricDefinition({ ...sampleRequest, definitions: [draft], metric_ids: [draft.id] });
      if (generation === requestGeneration.current) setPreview(result ?? undefined);
    } catch (err) { if (generation === requestGeneration.current) setError(String(err)); }
    finally { setBusy(false); }
  }
  useEffect(() => { onDraft?.(definition.id, JSON.stringify(draft) === JSON.stringify(definition) ? undefined : draft); }, [draft, definition, onDraft]);
  useEffect(() => { setValidation(undefined); }, [draft, connectionID, datasourceUID]);
  async function validate() {
    const generation = ++requestGeneration.current;
    setBusy(true); setError('');
    try { const result = await MetricClient.ValidateMetricDefinition('grafana', connectionID, datasourceUID, draft); if (generation === requestGeneration.current) setValidation(result ?? undefined); }
    catch (err) { if (generation === requestGeneration.current) setError(String(err)); }
    finally { setBusy(false); }
  }
  return <Stack direction="column" spacing={2}>
    <Text size="xs">{inherited ? 'Inherited from current global definition' : 'Local definition'} · revision {definition.revision}</Text>
    {editSemantics && <fieldset><legend>Metric definition</legend><Text size="xs">Stable ID: {draft.id}</Text>
      <label>Name<Input.Control value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>Applicable resource types<Input.Control value={draft.resource_keys.join(', ')} onChange={event => setDraft({ ...draft, resource_keys: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} /></label>
      <label>Unit<select value={draft.unit} onChange={event => setDraft({ ...draft, unit: Number(event.target.value) })}>{Array.from({ length: 13 }, (_, unit) => <option key={unit} value={unit}>{unitLabel(unit)}</option>)}</select></label>
      <label>Value semantics<select value={draft.semantics} onChange={event => setDraft({ ...draft, semantics: event.target.value })}><option value="gauge">Gauge</option><option value="rate">Rate</option></select></label>
      <label>Declared result dimensions<Input.Control value={(draft.dimensions ?? []).join(', ')} placeholder="Optional: container" onChange={event => setDraft({ ...draft, dimensions: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} /></label>
      <Text size="xs">Aggregate explicitly in PromQL. Results preserve resource identity and every declared dimension tuple.</Text>
    </fieldset>}
    <label>PromQL<textarea className="grafana-query-input" value={draft.query} onChange={event => {
      setDraft({ ...draft, query: event.target.value }); setValidation(undefined);
    }} spellCheck={false} /></label>
    <QueryPreview query={draft.query} />
    <fieldset><legend>Typed field bindings</legend>{draft.field_bindings.map((binding, index) => <div className="grafana-field-row" key={index}>
      <label>Label<Input.Control value={binding.label} onChange={event => setDraft({ ...draft, field_bindings: draft.field_bindings.map((value, i) => i === index ? { ...value, label: event.target.value } : value) })} /></label>
      <label>Source<select value={binding.source} onChange={event => setDraft({ ...draft, field_bindings: draft.field_bindings.map((value, i) => i === index ? { ...value, source: event.target.value, field: event.target.value === 'scope' ? 'cluster' : 'id', resource_path: '' } : value) })}><option value="resource">Approved resource scalar</option><option value="scope">Public scope</option></select></label>
      <label>Template field<Input.Control value={binding.field} onChange={event => setDraft({ ...draft, field_bindings: draft.field_bindings.map((value, i) => i === index ? { ...value, field: event.target.value } : value) })} /></label>
      <Text size="xs">{binding.required ? 'Required scalar' : 'Optional scalar'} · {binding.resource_path || (binding.source === 'scope' ? 'Public scope value' : 'Canonical identity field')}</Text>
      {binding.source === 'resource' && (schemaContext ? <SchemaFieldPicker key={JSON.stringify([schemaContext, index])} context={schemaContext} value={binding.resource_path ?? ''} onSelect={pointer => setDraft({ ...draft, field_bindings: draft.field_bindings.map((value, i) => i === index ? { ...value, resource_path: pointer } : value) })} /> : <Text size="xs">Select a resource connection validation context to browse authoritative schema fields.</Text>)}
      <label>Transform<select value={binding.transform || 'identity'} onChange={event => setDraft({ ...draft, field_bindings: draft.field_bindings.map((value, i) => i === index ? { ...value, transform: event.target.value as typeof binding.transform } : value) })}><option value="identity">Identity</option><option value="lowercase">Lowercase</option><option value="uppercase">Uppercase</option></select></label>
    </div>)}</fieldset>
    <Button size="sm" onClick={() => setDraft({ ...draft, field_bindings: [...draft.field_bindings, { field: `field${draft.field_bindings.length + 1}`, label: '', source: 'resource', required: true, resource_path: '' }] })}>Add typed field binding</Button>
    <label>Metric name for label discovery<Input.Control value={metricName} onChange={event => setMetricName(event.target.value)} placeholder="e.g. container_cpu_usage_seconds_total" /></label>
    <Button size="sm" disabled={!connectionID || !datasourceUID || !metricName || busy} onClick={async () => {
      const generation = ++requestGeneration.current;
      setBusy(true); setError('');
      try {
        const now = Date.now();
        const result = await MetricClient.DiscoverMetricLabels('grafana', connectionID, datasourceUID, {
          source: { plugin_id: 'grafana', connection_id: connectionID, datasource_uid: datasourceUID, datasource_kind: 'prometheus' },
          metric_name: metricName, label_name: '', matchers: {}, start_time: new Date(now - 3600000).toISOString(),
          end_time: new Date(now).toISOString(), limit: 100,
        });
        if (generation === requestGeneration.current) {
          setLabels(result.values ?? []);
          if (result.truncated || result.warnings?.length) setError([...(result.truncated ? ['Label results limited to 100.'] : []), ...(result.warnings ?? [])].join(' '));
        }
      } catch (err) { if (generation === requestGeneration.current) setError(String(err)); }
      finally { setBusy(false); }
    }}>Discover labels</Button>
    {labels.length > 0 && <label>Discovered identity label<select value="" onChange={event => setDraft({ ...draft, identity_labels: [...new Set([...draft.identity_labels, event.target.value])] })}><option value="">Add label</option>{labels.map(label => <option key={label}>{label}</option>)}</select></label>}
    <label>Result identity labels (comma-separated)<Input.Control value={draft.identity_labels.join(', ')} onChange={event => setDraft({ ...draft, identity_labels: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} /></label>
    {error && <p role="alert">{error}</p>}
    {validation && <div role="status">{validation.valid ? 'Definition syntax and schema valid; no sample query executed.' : 'Mapping invalid'}{validation.issues?.map((issue, i) => <p key={i}>{issue.field}: {issue.message}</p>)}</div>}
    <Stack direction="row" spacing={2}>
      <Button size="sm" disabled={!connectionID || !datasourceUID || busy} onClick={() => void validate()}>Validate definition</Button>
      <Button size="sm" disabled={!sampleRequest || !connectionID || !datasourceUID || busy} onClick={() => void testQuery()}>Test query</Button>
      <Button size="sm" disabled={busy || !validation?.valid} onClick={async () => { setBusy(true); try { await onSave(draft); } catch (err) { setError(String(err)); } finally { setBusy(false); } }}>Save mapping</Button>
      {onReset && <Button size="sm" onClick={onReset}>Reset to global</Button>}
    </Stack>
    {!sampleRequest && <Text size="xs">Choose a real resource in connection settings to test this mapping against admitted data.</Text>}
    {preview && <div role="status" aria-label="Sample query results">{preview.results?.map((result, index) => <div key={index}>
      <Text size="xs">{result.resource_token} · {result.metric_id} · {result.status} · {unitLabel(definition.unit)}</Text>
      <pre className="grafana-query">{JSON.stringify(result.value ?? null, null, 2)}</pre>
      <Text size="xs">Observed {result.observed_at} · expires {result.expires_at} · mapping {result.mapping_revision}</Text>
      <Text size="xs">{JSON.stringify(result.provenance)} {result.warnings?.join('; ')}</Text>
    </div>)}</div>}
  </Stack>;
}
export function Mappings({ definitions, connectionID, datasourceUID, save, onDraft, sampleRequest, schemaContext }: { definitions: MetricDefinition[]; connectionID: string; datasourceUID: string; save: (definition: MetricDefinition) => Promise<void>; onDraft?: (id: string, draft: MetricDefinition | undefined) => void; sampleRequest?: ResourceSetQueryRequest; schemaContext?: MappingSchemaContext }) {
  const [search, setSearch] = useState('');
  const [newDefinition, setNewDefinition] = useState<MetricDefinition>();
  return <Stack direction="column" spacing={2}><Input.Control aria-label="Search global mappings" placeholder="Search name, resource, or query" value={search} onChange={event => setSearch(event.target.value)} />
    <Button size="sm" onClick={() => {
      const template = definitions[0];
      const definition: MetricDefinition = {
        id: crypto.randomUUID(), name: 'New metric', resource_keys: schemaContext ? [schemaContext.resourceType] : [...(template?.resource_keys ?? [])],
        unit: 0, semantics: 'gauge', dimensions: [], supported_shapes: [0, 1], query_language: 'promql', query: '',
        field_bindings: template?.field_bindings.map(binding => ({ ...binding })) ?? [], identity_labels: [...(template?.identity_labels ?? [])],
        reducer: 'none', batch_strategy: 'identity', revision: '', native: false,
      };
      setNewDefinition(definition); onDraft?.(definition.id, definition);
    }} disabled={Boolean(newDefinition)}><LuPlus size={14} aria-hidden />Add metric</Button>
    {newDefinition && <section className="grafana-mapping" aria-label="New metric definition">
      <MappingEditor definition={newDefinition} connectionID={connectionID} datasourceUID={datasourceUID} editSemantics schemaContext={schemaContext} sampleRequest={sampleRequest}
        onDraft={(id, draft) => onDraft?.(id, draft ?? newDefinition)} onSave={async draft => { await save(draft); setNewDefinition(undefined); }} />
      <Button size="sm" onClick={() => { onDraft?.(newDefinition.id, undefined); setNewDefinition(undefined); }}>Cancel new metric</Button>
    </section>}
    {definitions.map(definition => <details hidden={![definition.name, ...definition.resource_keys, definition.query].join(' ').toLowerCase().includes(search.toLowerCase())} className="grafana-mapping" key={`${definition.id}:${definition.revision}`}>
      <summary><strong>{definition.name}</strong><span>{definition.resource_keys.join(', ')} · {unitLabel(definition.unit)}</span></summary>
      <QueryPreview query={definition.query} /><MappingEditor definition={definition} connectionID={connectionID} datasourceUID={datasourceUID} onSave={save} onDraft={onDraft} editSemantics schemaContext={schemaContext && definition.resource_keys.includes(schemaContext.resourceType) ? schemaContext : undefined} sampleRequest={sampleRequest?.resources.some(resource => definition.resource_keys.includes(resource.resource_key)) ? sampleRequest : undefined} />
    </details>)}
    {!definitions.length && <Text size="sm">No metric definitions available from active providers.</Text>}
  </Stack>;
}
