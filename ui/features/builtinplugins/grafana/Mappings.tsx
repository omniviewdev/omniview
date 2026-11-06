import { useEffect, useRef, useState } from 'react';
import { Button, Input, Stack, Text, TextArea, Tooltip } from '@omniviewdev/base-ui';
import { MetricClient } from '@omniviewdev/runtime/api';
import type { MetricDefinition, MetricScopeField, MetricValidationResult, MetricsObservationSpec, ResourceMetricsResponse } from '@omniviewdev/runtime';
import './grafana.css';
import SchemaFieldPicker, { type MappingSchemaContext } from './SchemaFieldPicker';
import { LuPlus } from 'react-icons/lu';
import { MetricsSelect } from './DatasourceSelector';

export function QueryPreview({ query }: { query: string }) {
  return <pre className="grafana-query" aria-label="Query preview"><code>{query.split(/("(?:\\.|[^"\\])*"|\{\{[^}]+\}\}|\b(?:sum|rate|by|avg|max|min|count|irate)\b)/g).map((part, index) =>
    part.startsWith('"') ? <span key={index} className="grafana-string">{part.split(/(\{\{[^}]+\}\})/g).map((value, nested) =>
      <span key={nested} className={value.startsWith('{{') ? 'grafana-interpolation' : undefined}>{value}</span>)}</span> :
      <span key={index} className={part.startsWith('{{') ? 'grafana-interpolation' : /^(sum|rate|by|avg|max|min|count|irate)$/.test(part) ? 'grafana-function' : undefined}>{part}</span>)}</code></pre>;
}

export function MappingEditor({ definition, connectionID, datasourceUID, onSave, onReset, inherited, onDraft, sampleRequest, schemaContext, scopeFields = [], editSemantics = false }: {
  definition: MetricDefinition; connectionID: string; datasourceUID: string; onSave: (definition: MetricDefinition) => Promise<void>;
  onReset?: () => void; inherited?: boolean; onDraft?: (id: string, draft: MetricDefinition | undefined) => void;
  sampleRequest?: MetricsObservationSpec;
  schemaContext?: MappingSchemaContext;
  scopeFields?: readonly MetricScopeField[];
  editSemantics?: boolean;
}) {
  const [draft, setDraft] = useState(definition);
  const [identityLabelsText, setIdentityLabelsText] = useState(() => definition.identity_labels.join(', '));
  const [resourceKeysText, setResourceKeysText] = useState(() => definition.resource_keys.join(', '));
  const [dimensionsText, setDimensionsText] = useState(() => (definition.dimensions ?? []).join(', '));
  const [validationState, setValidation] = useState<{ context: string; result: MetricValidationResult }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewState, setPreview] = useState<{ context: string; result: ResourceMetricsResponse }>();
  const [labels, setLabels] = useState<string[]>([]);
  const [metricName, setMetricName] = useState('');
  // Responses remain visible only for the draft/source that produced them.
  const validationContext = JSON.stringify([draft, connectionID, datasourceUID]);
  const previewContext = JSON.stringify([validationContext, sampleRequest]);
  const validation = validationState?.context === validationContext ? validationState.result : undefined;
  const preview = previewState?.context === previewContext ? previewState.result : undefined;
  const requestGeneration = useRef(0);
  useEffect(() => {
    requestGeneration.current++;
  }, [draft, connectionID, datasourceUID, sampleRequest]);
  useEffect(() => () => {
    requestGeneration.current++; 
  }, []);
  async function testQuery() {
    if (!sampleRequest) {
      return;
    }

    const generation = ++requestGeneration.current;
    setBusy(true); setError('');
    try {
      const spec = draft.supported_shapes.includes('range') ? sampleRequest : { ...sampleRequest, shape: 'current', start_time: '0001-01-01T00:00:00Z', end_time: '0001-01-01T00:00:00Z', duration_ms: 0, step_ms: 0 };
      const result = await MetricClient.PreviewMetricDefinition({ ...spec, metric_ids: [draft.id] }, draft);
      if (generation === requestGeneration.current) {
        if (!result) {
          setError('No query preview response.'); setPreview(undefined); return; 
        }

        setPreview({ context: previewContext, result });
      }
    } catch (err) {
      if (generation === requestGeneration.current) {
        setError(String(err));
      } 
    } finally {
      setBusy(false); 
    }
  }

  useEffect(() => {
    onDraft?.(definition.id, JSON.stringify(draft) === JSON.stringify(definition) ? undefined : draft); 
  }, [draft, definition, onDraft]);
  async function validate() {
    const generation = ++requestGeneration.current;
    setBusy(true); setError(''); setValidation(undefined);
    try {
      const result = await MetricClient.ValidateMetricDefinition('grafana', connectionID, datasourceUID, draft);
      if (generation === requestGeneration.current) {
        if (!result) {
          setError('No mapping validation response.'); return; 
        }

        setValidation({ context: validationContext, result });
      }
    } catch (err) {
      if (generation === requestGeneration.current) {
        setError(String(err));
      } 
    } finally {
      setBusy(false); 
    }
  }

  return <Stack className="grafana-mapping-editor" direction="column" spacing={2}>
    <div className="grafana-editor-heading"><strong>{inherited === true || onReset !== undefined ? 'Connection override' : 'Metric query'}</strong><span className="grafana-spacer" />{onReset && <Button size="sm" variant="ghost" onClick={onReset}>Reset to owner default</Button>}</div>
    {editSemantics && <fieldset><legend>Metric definition</legend><Text size="xs">Stable ID: {draft.id}</Text>
      <label>Name<Input.Root className="grafana-input" size="md"><Input.Control value={draft.name} onChange={event => {
        setDraft({ ...draft, name: event.target.value }); 
      }} /></Input.Root></label>
      <label>Applicable resource types<Input.Root className="grafana-input" size="md"><Input.Control value={resourceKeysText} onChange={event => {
        const text = event.target.value; setResourceKeysText(text); setDraft({ ...draft, resource_keys: text.split(',').map(value => value.trim()).filter(Boolean) }); 
      }} /></Input.Root></label>
      <label>Unit<MetricsSelect label="Unit" value={draft.unit} onChange={value => {
        setDraft({ ...draft, unit: value }); 
      }} options={['cores', 'bytes', 'bytes_per_second', 'percent', 'count', 'count_per_second'].map(value => ({ value, label: value.replaceAll('_', ' ') }))} /></label>
      <label>Supported shapes<MetricsSelect label="Supported shapes" value={draft.supported_shapes.join(',')} onChange={value => {
        setDraft({ ...draft, supported_shapes: value.split(',') }); 
      }} options={[{ value: 'current,range', label: 'Current and range' }, { value: 'current', label: 'Current only' }, { value: 'range', label: 'Range only' }]} /></label>
      <label>Value semantics<MetricsSelect label="Value semantics" value={draft.semantics} onChange={value => {
        setDraft({ ...draft, semantics: value }); 
      }} options={[{ value: 'gauge', label: 'Gauge' }, { value: 'rate', label: 'Rate' }]} /></label>
      <label>Declared result dimensions<Input.Root className="grafana-input" size="md"><Input.Control value={dimensionsText} placeholder="Optional: container" onChange={event => {
        const text = event.target.value; setDimensionsText(text); setDraft({ ...draft, dimensions: text.split(',').map(value => value.trim()).filter(Boolean) }); 
      }} /></Input.Root></label>
      <Text size="xs">Aggregate explicitly in PromQL. Results preserve resource identity and every declared dimension tuple.</Text>
    </fieldset>}
    <TextArea.Root className="grafana-codebox"><QueryPreview query={draft.query} /><TextArea.Control aria-label="PromQL" className="grafana-query-input" value={draft.query} onScroll={event => {
      const preview = event.currentTarget.previousElementSibling;
      if (preview) {
        preview.scrollTop = event.currentTarget.scrollTop; preview.scrollLeft = event.currentTarget.scrollLeft; 
      }
    }} onChange={event => {
      setDraft({ ...draft, query: event.target.value }); setValidation(undefined);
    }} spellCheck={false} /></TextArea.Root>
    <label className="grafana-identity-label">Response identity labels<Input.Root className="grafana-input" size="md"><Input.Control value={identityLabelsText} onChange={event => {
      const text = event.target.value; setIdentityLabelsText(text); setDraft({ ...draft, identity_labels: text.split(',').map(value => value.trim()).filter(Boolean) }); 
    }} /></Input.Root></label>
    <details className="grafana-binding-tools"><summary>Variables & identity</summary>
      <fieldset><legend>Typed field bindings</legend>{draft.field_bindings.map((binding, index) => <div className="grafana-field-row" key={index}>
        <label>Label<Input.Root className="grafana-input" size="md"><Input.Control value={binding.label} onChange={event => {
          setDraft({ ...draft, field_bindings: draft.field_bindings.map((value, i) => i === index ? { ...value, label: event.target.value } : value) }); 
        }} /></Input.Root></label>
        <label>Source<MetricsSelect label="Binding source" value={binding.source} onChange={value => {
          setDraft({ ...draft, field_bindings: draft.field_bindings.map((binding, i) => i === index ? { ...binding, source: value, field: '', resource_path: '' } : binding) });
        }} options={[{ value: 'resource', label: 'Resource scalar' }, { value: 'scope', label: 'Public scope' }]} /></label>
        {binding.source === 'scope' ? <label>Public scope field<MetricsSelect label="Public scope field" value={binding.field} onChange={field => {
          setDraft({ ...draft, field_bindings: draft.field_bindings.map((value, i) => i === index ? { ...value, field } : value) });
        }} options={[{ value: '', label: 'Choose owner scope field' }, ...scopeFields.map(field => ({ value: field.key, label: field.name }))]} /></label> :
          <label>Template field<Input.Root className="grafana-input" size="md"><Input.Control value={binding.field} onChange={event => {
            setDraft({ ...draft, field_bindings: draft.field_bindings.map((value, i) => i === index ? { ...value, field: event.target.value } : value) });
          }} /></Input.Root></label>}
        <Text size="xs">{binding.required ? 'Required scalar' : 'Optional scalar'} · {binding.source === 'scope' ? 'Public scope value' : binding.resource_path === '' ? 'Select an explicit resource path' : binding.resource_path ?? 'Select an explicit resource path'}</Text>
        {binding.source === 'resource' && (schemaContext ? <SchemaFieldPicker key={JSON.stringify([schemaContext, index])} context={schemaContext} value={binding.resource_path ?? ''} onSelect={pointer => {
          setDraft({ ...draft, field_bindings: draft.field_bindings.map((value, i) => i === index ? { ...value, resource_path: pointer } : value) }); 
        }} /> : <Text size="xs">Select a resource connection validation context to browse authoritative schema fields.</Text>)}
        <label>Transform<MetricsSelect label="Transform" value={binding.transform === undefined || binding.transform.length === 0 ? 'identity' : binding.transform} onChange={value => {
          setDraft({ ...draft, field_bindings: draft.field_bindings.map((binding, i) => i === index ? { ...binding, transform: value as typeof binding.transform } : binding) }); 
        }} options={['identity', 'lowercase', 'uppercase'].map(value => ({ value, label: value }))} /></label>
      </div>)}</fieldset>
      <Button size="sm" onClick={() => {
        setDraft({ ...draft, field_bindings: [...draft.field_bindings, { field: `field${draft.field_bindings.length + 1}`, label: '', source: 'resource', required: true, resource_path: '' }] }); 
      }}>Add typed field binding</Button>
      <label>Metric name for label discovery<Input.Root className="grafana-input" size="md"><Input.Control value={metricName} onChange={event => {
        setMetricName(event.target.value); 
      }} placeholder="e.g. container_cpu_usage_seconds_total" /></Input.Root></label>
      <Button size="sm" disabled={!connectionID || !datasourceUID || !metricName || busy} onClick={async () => {
        const generation = ++requestGeneration.current;
        setBusy(true); setError('');
        try {
          const now = Date.now();
          const result = await MetricClient.DiscoverMetricLabels('grafana', connectionID, datasourceUID, {
            source: { plugin_id: 'grafana', connection_id: connectionID, datasource_uid: datasourceUID, datasource_kind: 'prometheus', native: false },
            metric_name: metricName, label_name: '', matchers: {}, start_time: new Date(now - 3600000).toISOString(),
            end_time: new Date(now).toISOString(), limit: 100,
          });
          if (generation === requestGeneration.current) {
            if (!result) {
              setError('No label discovery response.'); setLabels([]); return; 
            }

            setLabels(result.values ?? []);
            if (result.truncated || result.warnings?.length) {
              setError([...(result.truncated ? ['Label results limited to 100.'] : []), ...(result.warnings ?? [])].join(' '));
            }
          }
        } catch (err) {
          if (generation === requestGeneration.current) {
            setError(String(err));
          } 
        } finally {
          setBusy(false); 
        }
      }}>Discover labels</Button>
      {labels.length > 0 && <label>Discovered identity label<MetricsSelect label="Discovered identity label" value="" onChange={value => {
        const identityLabels = [...new Set([...draft.identity_labels, value])]; setIdentityLabelsText(identityLabels.join(', ')); setDraft({ ...draft, identity_labels: identityLabels }); 
      }} options={[{ value: '', label: 'Add label' }, ...labels.map(value => ({ value, label: value }))]} /></label>}
    </details>
    {error && <p role="alert">{error}</p>}
    {validation && <div role="status">{validation.valid ? <Tooltip.Root><Tooltip.Trigger render={<span tabIndex={0} />}>Definition valid</Tooltip.Trigger><Tooltip.Portal><Tooltip.Positioner><Tooltip.Popup>Template and binding fields valid. PromQL grammar not checked; no sample query executed. Test query executes PromQL against the selected real resource.</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal></Tooltip.Root> : 'Mapping invalid'}{validation.issues?.map((issue, i) => <p key={i}>{issue.field}: {issue.message}</p>)}</div>}
    <Stack direction="row" spacing={2}>
      <Button size="sm" disabled={!connectionID || !datasourceUID || busy} onClick={() => {
        validate().catch(err => {
          setError(String(err)); 
        }); 
      }}>Validate definition</Button>
      <Button size="sm" disabled={!sampleRequest || !connectionID || !datasourceUID || busy} onClick={() => {
        testQuery().catch(err => {
          setError(String(err)); 
        }); 
      }}>Test query</Button>
      <Button size="sm" disabled={busy || !validation?.valid} onClick={async () => {
        setBusy(true); try {
          await onSave(draft); 
        } catch (err) {
          setError(String(err)); 
        } finally {
          setBusy(false); 
        } 
      }}>Save mapping</Button>
    </Stack>
    {preview && <section className="grafana-query-results" aria-label="Sample query results">
      <table><thead><tr><th>Resource</th><th>Metric</th><th>Value</th><th>Status</th></tr></thead><tbody>{preview.results?.map((result, index) => {
        const resource = sampleRequest?.targets.find(resource => resource.token === result.resource_token);
        const points = result.points;
        const latest = points?.length ? points[points.length - 1].value : undefined;
        const value = result.value ?? latest;
        const qualifier = result.value != null ? '' : 'Latest ';
        return <tr key={index}><td>{resource?.reference.address.id ?? 'Unmatched resource'}{Object.keys(result.dimensions ?? {}).length > 0 && <small>{Object.entries(result.dimensions).map(([key, value]) => `${key}=${value}`).join(' · ')}</small>}</td><td>{result.metric_id === draft.id ? draft.name : result.metric_id}</td><td>{value != null && Number.isFinite(value) ? `${qualifier}${new Intl.NumberFormat(undefined, { maximumFractionDigits: 5 }).format(value)} ${draft.unit}` : '—'}</td><td>{result.status}{result.message && <small>{result.message}</small>}</td></tr>;
      })}</tbody></table>
      {!preview.results?.length && <Text size="sm">No query results returned.</Text>}
      {preview.warnings?.length > 0 && <p role="status">{preview.warnings.join('; ')}</p>}
      <details><summary>Response details & provenance</summary><pre className="grafana-query">{JSON.stringify(preview, null, 2)}</pre></details>
    </section>}
  </Stack>;
}

export function Mappings({ definitions, connectionID, datasourceUID, save, onDraft, sampleRequest, schemaContext }: { definitions: MetricDefinition[]; connectionID: string; datasourceUID: string; save: (definition: MetricDefinition) => Promise<void>; onDraft?: (id: string, draft: MetricDefinition | undefined) => void; sampleRequest?: MetricsObservationSpec; schemaContext?: MappingSchemaContext }) {
  const [search, setSearch] = useState('');
  const [newDefinition, setNewDefinition] = useState<MetricDefinition>();
  const [deleted, setDeleted] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState('');
  const [ownerScope, setOwnerScope] = useState<{ context: string; fields: MetricScopeField[]; error: string }>();
  const ownerPluginID = schemaContext?.pluginID;
  const ownerConnectionID = schemaContext?.connectionID;
  const ownerContext = JSON.stringify([ownerPluginID, ownerConnectionID]);
  const scopeFields = ownerScope?.context === ownerContext ? ownerScope.fields : [];
  const ownerError = ownerScope?.context === ownerContext ? ownerScope.error : '';
  useEffect(() => {
    let active = true;
    if (ownerPluginID !== undefined && ownerConnectionID !== undefined) {
      MetricClient.GetMetricOwnerCatalog(ownerPluginID, ownerConnectionID).then(catalog => {
        if (!catalog) {
          throw new Error('No owner metric catalog returned.');
        }

        if (active) {
          setOwnerScope({ context: ownerContext, fields: catalog.scope_fields ?? [], error: '' });
        }
      }).catch(error => {
        if (active) {
          setOwnerScope({ context: ownerContext, fields: [], error: String(error) });
        }
      });
    }

    return () => {
      active = false;
    };
  }, [ownerPluginID, ownerConnectionID, ownerContext]);
  return <Stack direction="column" spacing={2}><Input.Root className="grafana-input grafana-mapping-search" size="md"><Input.Control aria-label="Search global mappings" placeholder="Search name, resource, or query" value={search} onChange={event => {
    setSearch(event.target.value); 
  }} /></Input.Root>
  {deleteError && <p role="alert">{deleteError}</p>}
  {ownerError && <p role="alert">{ownerError}</p>}
  <Button size="sm" onClick={() => {
    const template = definitions[0];
    const definition: MetricDefinition = {
      id: crypto.randomUUID(), name: 'New metric', resource_keys: schemaContext ? [schemaContext.resourceType] : [...(template?.resource_keys ?? [])],
      unit: 'cores', semantics: 'gauge', dimensions: [], supported_shapes: ['current', 'range'], query_language: 'promql', query: '',
      field_bindings: template?.field_bindings.map(binding => ({ ...binding })) ?? [], identity_labels: [...(template?.identity_labels ?? [])],
      reducer: 'none', batch_strategy: 'identity', revision: '', native: false,
    };
    setNewDefinition(definition); onDraft?.(definition.id, definition);
  }} disabled={Boolean(newDefinition)}><LuPlus size={14} aria-hidden />Add metric</Button>
  {newDefinition && <section className="grafana-mapping" aria-label="New metric definition">
    <MappingEditor definition={newDefinition} scopeFields={scopeFields} connectionID={connectionID} datasourceUID={datasourceUID} editSemantics schemaContext={schemaContext} sampleRequest={sampleRequest}
      onDraft={(id, draft) => onDraft?.(id, draft ?? newDefinition)} onSave={async draft => {
        await save(draft); setNewDefinition(undefined); 
      }} />
    <Button size="sm" onClick={() => {
      onDraft?.(newDefinition.id, undefined); setNewDefinition(undefined); 
    }}>Cancel new metric</Button>
  </section>}
  {definitions.filter(definition => definition.query_language === 'promql' && Boolean(definition.query) && !deleted.includes(definition.id)).map(definition => <details hidden={![definition.name, ...definition.resource_keys, definition.query].join(' ').toLowerCase().includes(search.toLowerCase())} className="grafana-mapping" key={`${definition.id}:${definition.revision}`}>
    <summary><strong>{definition.name}</strong><span>{definition.resource_keys.join(', ')} · {definition.unit}</span><QueryPreview query={definition.query} /></summary>
    <MappingEditor definition={definition} scopeFields={scopeFields} connectionID={connectionID} datasourceUID={datasourceUID} onSave={save} onDraft={onDraft} editSemantics schemaContext={schemaContext && definition.resource_keys.includes(schemaContext.resourceType) ? schemaContext : undefined} sampleRequest={sampleRequest && definition.resource_keys.includes(sampleRequest.resource_key) ? sampleRequest : undefined} />
    {!definition.native && <Button size="sm" variant="ghost" color="danger" onClick={async () => {
      if (!window.confirm(`Delete ${definition.name}? Existing overrides will no longer resolve this metric.`)) {
        return;
      }

      try {
        await MetricClient.DeleteMetricDefinition(definition.id); onDraft?.(definition.id, undefined); setDeleted(previous => [...previous, definition.id]); 
      } catch (error) {
        setDeleteError(String(error)); 
      }
    }}>Delete metric</Button>}
  </details>)}
  {!definitions.length && <Text size="sm">No metric definitions available from active providers.</Text>}
  </Stack>;
}
