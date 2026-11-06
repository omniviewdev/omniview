import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Text } from '@omniviewdev/base-ui';
import { MetricClient } from '@omniviewdev/runtime/api';
import type { ConnectionSettingsContext, MetricBinding, MetricDataSource, MetricDefinition, MetricScopeField, ProviderConnection, ResourceMetricTarget, MetricsObservationSpec } from '@omniviewdev/runtime';
import { navigateActivePage } from '@omniviewdev/runtime';
import { MappingEditor, QueryPreview } from './Mappings';
import { approvedScope, changeProvider, resetOverride, resolveDefinition, scopeRequirements, stageDefinition, validScope } from './model';
import SampleResource from './SampleResource';
import DatasourceSelector, { MetricsSelect } from './DatasourceSelector';
import { SiGrafana } from 'react-icons/si';

export default function GrafanaConnectionSettings(props: ConnectionSettingsContext) {
  return <OwnerConnectionSettings key={JSON.stringify([props.resourcePluginID, props.connectionID])} {...props} />;
}

function OwnerConnectionSettings({ resourcePluginID, connectionID, resourceTypes }: ConnectionSettingsContext) {
  const queryClient = useQueryClient();
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [definitions, setDefinitions] = useState<MetricDefinition[]>([]);
  const [scopeFields, setScopeFields] = useState<MetricScopeField[]>([]);
  const [saved, setSaved] = useState<MetricBinding>();
  const [draft, setDraft] = useState<MetricBinding>();
  const sourceConnectionID = draft?.source.connection_id ?? '';
  const [error, setError] = useState('');
  const sourceContext = useMemo(() => ({ connectionID: sourceConnectionID }), [sourceConnectionID]);
  const [sourceResult, setSourceResult] = useState<{ context: typeof sourceContext; sources: MetricDataSource[]; error: string }>();
  const sources = sourceResult?.context === sourceContext ? sourceResult.sources : [];
  const catalogError = sourceResult?.context === sourceContext ? sourceResult.error : '';
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [mappingDrafts, setMappingDrafts] = useState<Record<string, MetricDefinition>>({});
  const onMappingDraft = useCallback((id: string, value: MetricDefinition | undefined) => {
    setMappingDrafts(previous => {
      if (JSON.stringify(previous[id]) === JSON.stringify(value)) {
        return previous;
      }

      if (value) {
        return { ...previous, [id]: value };
      }

      return Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id));
    }); 
  }, []);
  const [sample, setSample] = useState<ResourceMetricTarget>();
  const [sampleType, setSampleType] = useState(resourceTypes[0] ?? '');
  const [search, setSearch] = useState('');
  const sampleSource = draft?.source;
  const sampleRequest = useMemo<MetricsObservationSpec | undefined>(() => {
    if (!sample || !sampleSource?.datasource_uid) {
      return undefined;
    }

    return { owner_plugin_id: resourcePluginID, owner_connection_id: connectionID, resource_key: sample.reference.address.type,
      binding_id: saved?.id ?? '', source: sampleSource, targets: [sample], metric_ids: [], shape: 'range',
      start_time: '0001-01-01T00:00:00Z', end_time: '0001-01-01T00:00:00Z', duration_ms: 300000, step_ms: 15000, interval_ms: 0 };
  }, [sample, sampleSource, saved?.id, resourcePluginID, connectionID]);
  useEffect(() => {
    let active = true;
    Promise.all([MetricClient.GetProviderConnections('grafana'), MetricClient.GetMetricOwnerCatalog(resourcePluginID, connectionID), MetricClient.GetMetricBindings(resourcePluginID, connectionID), MetricClient.GetMetricSourceDefaults()]).then(([catalog, ownerCatalog, bindings, defaults]) => {
      if (!active) {
        return;
      }

      // The host catalog includes effective global profile definitions, not just raw owner defaults.
      setConnections(catalog ?? []); setDefinitions(ownerCatalog?.definitions ?? []); setScopeFields(ownerCatalog?.scope_fields ?? []);
      const binding = bindings?.find(value => value.signal === 'metrics' && value.source.plugin_id === 'grafana');
      setSaved(binding ? { ...binding, public_scope: approvedScope(binding.public_scope, ownerCatalog?.scope_fields ?? []) } : undefined);
      setDraft(binding ? { ...binding, policy: 'replace', public_scope: approvedScope(binding.public_scope, ownerCatalog?.scope_fields ?? []) } : { id: crypto.randomUUID(), signal: 'metrics', resource_plugin_id: resourcePluginID, resource_connection_id: connectionID, source: defaults?.source?.plugin_id === 'grafana' ? defaults.source : { plugin_id: 'grafana', connection_id: '', datasource_uid: '', datasource_kind: '', native: false }, policy: 'replace', public_scope: {}, overrides: [], revision: '' });
    }).catch(err => {
      if (active) {
        setError(String(err));
      } 
    });
    return () => {
      active = false;
    };
  }, [resourcePluginID, connectionID]);
  useEffect(() => {
    let active = true;
    if (sourceContext.connectionID) {
      MetricClient.GetDataSources('grafana', sourceContext.connectionID).then(values => {
        if (!values) {
          throw new Error('No datasource catalog returned.');
        }

        if (active) {
          setSourceResult({ context: sourceContext, sources: values.filter(value => value.kind === 'prometheus'), error: '' });
        }
      }).catch(err => {
        if (active) {
          setSourceResult({ context: sourceContext, sources: [], error: String(err) });
        }
      });
    }

    return () => {
      active = false;
    };
  }, [sourceContext]);
  if (!draft) {
    return <Card><Text size="sm">Loading external metric settings…</Text>{error && <p role="alert">{error}</p>}</Card>;
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved) || Object.keys(mappingDrafts).length > 0;
  const applicableDefinitions = definitions.filter(definition => definition.query_language === 'promql' && Boolean(definition.query) && definition.resource_keys.some(key => resourceTypes.includes(key)));
  const applicableOverrideCount = draft.overrides.filter(override => applicableDefinitions.some(definition => definition.id === override.metric_id)).length;
  const requiredScope = scopeRequirements(applicableDefinitions.map(global =>
    mappingDrafts[global.id] ?? resolveDefinition(global, draft.overrides.find(value => value.metric_id === global.id))));
  const scopeValid = validScope(draft.public_scope, scopeFields, requiredScope);
  async function saveBinding() {
    if (!draft) {
      return;
    }

    if (!scopeValid) {
      setError('Provide required owner-approved scope values, each at most 1024 bytes.');
      return;
    }

    setBusy(true); setError('');
    try {
      let resolved = draft;
      for (const value of Object.values(mappingDrafts)) {
        const validation = await MetricClient.ValidateMetricDefinition('grafana', draft.source.connection_id, draft.source.datasource_uid, value);
        if (!validation) {
          throw new Error('No mapping validation response.');
        }

        if (!validation.valid) {
          throw new Error(validation.issues.map(issue => issue.message).join('; '));
        }

        const global = definitions.find(definition => definition.id === value.id);
        if (global) {
          resolved = stageDefinition(resolved, global, value);
        }
      }

      const value = await MetricClient.SaveMetricBinding({ ...resolved, public_scope: approvedScope(resolved.public_scope, scopeFields) });
      await queryClient.invalidateQueries({ queryKey: ['metric'] });
      if (!value) {
        throw new Error('No saved binding returned.');
      }

      setSaved(value); setDraft(value); setMappingDrafts({}); setEditorEpoch(value => value + 1);
      setStatus('Changes saved');
    } catch (err) {
      setError(String(err)); 
    } finally {
      setBusy(false); 
    }
  }

  return <div className="grafana-settings grafana-connection-settings">
    {error && <p role="alert">{error}</p>}
    <section className="grafana-provider-card">
      <header className="grafana-provider-heading"><SiGrafana /><strong>Metrics provider</strong><span className="grafana-spacer" /><span className="grafana-badge">This connection</span><span>Grafana</span></header>
      <div className="grafana-provider-fields">
        <div><label>Grafana connection<MetricsSelect label="Provider connection" value={draft.source.connection_id} disabled={busy}
          onChange={value => {
            setDraft(changeProvider(draft, value)); setMappingDrafts({}); setError(''); 
          }}
          options={[{ value: '', label: 'Choose Grafana connection' }, ...connections.map(connection => ({ value: connection.id, label: connection.name }))]} /></label>
        <small>{connections.find(connection => connection.id === draft.source.connection_id)?.url}</small></div>
        <DatasourceSelector sources={sources} value={draft.source.datasource_uid} disabled={!draft.source.connection_id || busy} catalogError={catalogError} onChange={uid => {
          setDraft({ ...draft, source: { ...draft.source, datasource_uid: uid, datasource_kind: uid ? 'prometheus' : '', native: false } });
        }} />
        <label>Use for<MetricsSelect label="Source policy" value={draft.policy} onChange={value => {
          setDraft({ ...draft, policy: value }); 
        }}
        options={[{ value: 'replace', label: 'Replace mapped metrics' }]} /></label>
        {scopeFields.map(field => <div key={field.key}><label>{field.name}{requiredScope.has(field.key) ? ' *' : ''}<Input.Root className="grafana-input" size="md"><Input.Control value={draft.public_scope[field.key] ?? ''} required={requiredScope.has(field.key)} aria-label={field.name} title={field.description} onChange={event => {
          const value = event.target.value;
          if (new TextEncoder().encode(value).length <= 1024) {
            setDraft({ ...draft, public_scope: { ...draft.public_scope, [field.key]: value } });
          }
        }} /></Input.Root></label><small><code>{`{{${field.key}}}`}</code></small></div>)}
      </div>
      <footer className="grafana-provider-foot">Read-only <span className="grafana-spacer" /><Button size="sm" variant="ghost" onClick={() => {
        try {
          navigateActivePage('/_plugin/grafana'); 
        } catch (err) {
          setError(String(err)); 
        } 
      }}>Manage Grafana connections</Button></footer>
    </section>
    <div className="grafana-mapping-heading"><strong>Metric mappings {applicableDefinitions.length}</strong><span className="grafana-badge grafana-badge-override">{applicableOverrideCount} connection {applicableOverrideCount === 1 ? 'override' : 'overrides'}</span></div>
    <div className="grafana-mapping-toolbar"><Input.Root className="grafana-input" size="md"><Input.Control aria-label="Search connection mappings" placeholder="Search mappings…" value={search} onChange={event => {
      setSearch(event.target.value); 
    }} /></Input.Root><span className="grafana-spacer" /><small>Owner defaults + connection overrides</small></div>
    {applicableDefinitions.map(global => {
      const override = draft.overrides.find(value => value.metric_id === global.id);
      const effective = resolveDefinition(global, override);
      return <details hidden={![global.name, ...global.resource_keys, effective.query].join(' ').toLowerCase().includes(search.toLowerCase())} className="grafana-mapping" key={global.id}><summary><span className="grafana-mapping-row"><strong>{global.name}</strong><span className="grafana-resource">{global.resource_keys.join(', ')}</span><span className="grafana-badge">{global.unit}</span><span className="grafana-spacer" /><span className={`grafana-badge ${override ? 'grafana-badge-override' : ''}`}>{override ? 'Connection override' : 'Inherited'}</span><span className="grafana-override-action">{override ? 'Edit override' : 'Override'}</span></span><QueryPreview query={effective.query} /></summary>
        <MappingEditor key={JSON.stringify([effective, draft.source, editorEpoch])} scopeFields={scopeFields} definition={effective} connectionID={draft.source.connection_id} datasourceUID={draft.source.datasource_uid} schemaContext={{ pluginID: resourcePluginID, connectionID, resourceType: global.resource_keys.includes(sampleType) ? sampleType : global.resource_keys[0] }} sampleRequest={sample && global.resource_keys.includes(sample.reference.address.type) ? sampleRequest : undefined} inherited={!override} onDraft={onMappingDraft} onReset={override ? () => {
          setDraft(resetOverride(draft, global.id)); onMappingDraft(global.id, undefined); setEditorEpoch(value => value + 1); 
        } : undefined} onSave={async value => {
          setDraft(stageDefinition(draft, global, value));
          onMappingDraft(global.id, undefined);
          setStatus('Mapping staged');
        }} />
      </details>;
    })}
    <details className="grafana-sample-context"><summary>Query test resource</summary>
      <label>Sample resource type<MetricsSelect label="Sample resource type" value={sampleType} onChange={value => {
        setSample(undefined); setSampleType(value); 
      }} options={resourceTypes.map(type => ({ value: type, label: type }))} /></label>
      {sampleType && <SampleResource key={sampleType} pluginID={resourcePluginID} connectionID={connectionID} resourceKey={sampleType} onSelect={setSample} />}
    </details>
    {saved && <details className="grafana-sample-context"><summary>Binding actions</summary><Button size="sm" variant="ghost" color="danger" disabled={busy} onClick={async () => {
      setBusy(true); try {
        await MetricClient.DeleteMetricBinding(resourcePluginID, connectionID, saved.id); setSaved(undefined); setMappingDrafts({}); setEditorEpoch(value => value + 1); setDraft({ ...draft, source: { ...draft.source, connection_id: '', datasource_uid: '', datasource_kind: '' }, overrides: [], public_scope: {} }); setStatus('External binding removed. Native configuration preserved.'); 
        await queryClient.invalidateQueries({ queryKey: ['metric'] });
      } catch (err) {
        setError(String(err)); 
      } finally {
        setBusy(false); 
      } 
    }}>Remove binding</Button></details>}
    <div className="grafana-binding-actions"><Text size="xs" role="status" aria-live="polite">{dirty ? (status === 'Mapping staged' ? 'Mapping staged · Unsaved changes' : 'Unsaved changes') : status || 'All changes saved'}</Text><span className="grafana-spacer" />
      <Button size="sm" variant="ghost" disabled={busy || !dirty} onClick={() => {
        setDraft(saved ?? { ...draft, source: { ...draft.source, connection_id: '', datasource_uid: '', datasource_kind: '' }, public_scope: {}, overrides: [] }); setMappingDrafts({}); setEditorEpoch(value => value + 1); setError(''); setStatus('Changes discarded'); 
      }}>Discard changes</Button>
      <Button size="sm" disabled={busy || !dirty || !draft.source.datasource_uid || !scopeValid} onClick={saveBinding}>Save connection metrics</Button>
    </div>
  </div>;
}
